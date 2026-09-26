"""
QRDrop Performance & Chunk Size Benchmark Suite
Measures actual throughput (MB/s), duration, chunk overhead, and CPU/RAM usage.
Tests:
1. 10 MB transfer with 64KB, 256KB, 512KB, and 1MB chunks
2. Single-stream vs Parallel-stream transfer
3. Streaming SHA-256 verification throughput
"""

import os
import time
import psutil
import hashlib
import asyncio
import tempfile
from pathlib import Path
from backend.app.models.schemas import FileMetadata
from backend.app.transfer.chunk_engine import TransferEngine
from backend.app.security.crypto import calculate_sha256_file

async def run_benchmark(file_size_mb: int, chunk_size_kb: int, parallel: bool = False):
    total_bytes = file_size_mb * 1024 * 1024
    chunk_size = chunk_size_kb * 1024
    total_chunks = (total_bytes + chunk_size - 1) // chunk_size

    # Generate random test payload
    data = os.urandom(total_bytes)
    expected_sha = hashlib.sha256(data).hexdigest()

    with tempfile.TemporaryDirectory() as temp_dir:
        engine = TransferEngine()
        meta = FileMetadata(
            fileId=f"bench-{file_size_mb}mb-{chunk_size_kb}kb",
            fileName=f"bench_{file_size_mb}mb.bin",
            fileSize=total_bytes,
            totalChunks=total_chunks,
            chunkSize=chunk_size,
            sha256Hash=expected_sha,
        )

        transfer = engine.register_file("bench-xfer", meta, temp_dir)

        process = psutil.Process()
        cpu_start = process.cpu_percent(interval=None)
        mem_start_mb = process.memory_info().rss / (1024 * 1024)
        start_time = time.perf_counter()

        if not parallel:
            # Single stream
            for i in range(total_chunks):
                offset = i * chunk_size
                chunk = data[offset : offset + chunk_size]
                await transfer.write_chunk(i, offset, chunk)
        else:
            # Parallel stream (concurrency of 4)
            sem = asyncio.Semaphore(4)
            async def write_p(idx):
                async with sem:
                    offset = idx * chunk_size
                    chunk = data[offset : offset + chunk_size]
                    await transfer.write_chunk(idx, offset, chunk)
            await asyncio.gather(*(write_p(i) for i in range(total_chunks)))

        write_duration = time.perf_counter() - start_time

        # SHA-256 Verification & Atomic commit
        verify_start = time.perf_counter()
        final_hash = await transfer.finalize_file()
        verify_duration = time.perf_counter() - verify_start

        total_duration = write_duration + verify_duration
        throughput_mbps = file_size_mb / total_duration
        cpu_end = process.cpu_percent(interval=None)
        mem_end_mb = process.memory_info().rss / (1024 * 1024)

        assert final_hash.lower() == expected_sha.lower()

        return {
            "file_size_mb": file_size_mb,
            "chunk_size_kb": chunk_size_kb,
            "parallel": parallel,
            "total_chunks": total_chunks,
            "write_duration_sec": round(write_duration, 4),
            "verify_duration_sec": round(verify_duration, 4),
            "total_duration_sec": round(total_duration, 4),
            "throughput_mbps": round(throughput_mbps, 2),
            "ram_used_mb": round(mem_end_mb - mem_start_mb, 2),
        }

async def main():
    print("=" * 60)
    print("QRDrop Performance & Chunk Size Benchmark")
    print("=" * 60)
    print(f"CPU: {psutil.cpu_count(logical=True)} logical cores, RAM: {round(psutil.virtual_memory().total / (1024**3), 1)} GB")
    print("-" * 60)

    # 1. Chunk size comparison with 20 MB payload
    print("\n--- TEST 1: CHUNK SIZE EVALUATION (20 MB File) ---")
    chunk_sizes = [64, 256, 512, 1024]
    for cs in chunk_sizes:
        res = await run_benchmark(file_size_mb=20, chunk_size_kb=cs, parallel=False)
        print(f"Chunk: {cs:4d} KB ({res['total_chunks']:4d} chunks) | Duration: {res['total_duration_sec']:6.3f}s | Speed: {res['throughput_mbps']:7.2f} MB/s | RAM Diff: {res['ram_used_mb']:5.1f} MB")

    # 2. Single-stream vs Parallel-stream comparison with 50 MB payload
    print("\n--- TEST 2: SINGLE-STREAM vs PARALLEL STREAMS (50 MB File, 256 KB Chunks) ---")
    single_res = await run_benchmark(file_size_mb=50, chunk_size_kb=256, parallel=False)
    print(f"Single-Stream   | Duration: {single_res['total_duration_sec']:6.3f}s | Speed: {single_res['throughput_mbps']:7.2f} MB/s")

    parallel_res = await run_benchmark(file_size_mb=50, chunk_size_kb=256, parallel=True)
    print(f"Parallel (x4)   | Duration: {parallel_res['total_duration_sec']:6.3f}s | Speed: {parallel_res['throughput_mbps']:7.2f} MB/s")

    print("\n--- TEST 3: LARGE FILE STREAMING (100 MB File) ---")
    large_res = await run_benchmark(file_size_mb=100, chunk_size_kb=512, parallel=True)
    print(f"100 MB Parallel | Duration: {large_res['total_duration_sec']:6.3f}s | Speed: {large_res['throughput_mbps']:7.2f} MB/s | Verify: {large_res['verify_duration_sec']}s")

    print("\n" + "=" * 60)
    print("BENCHMARK COMPLETED SUCCESSFULLY")
    print("=" * 60)

if __name__ == "__main__":
    asyncio.run(main())

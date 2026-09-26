import pytest
import os
import hashlib
from pathlib import Path
from backend.app.models.schemas import FileMetadata
from backend.app.transfer.chunk_engine import TransferEngine, ActiveFileTransfer, FileIntegrityError
from backend.app.security.crypto import calculate_sha256_bytes

@pytest.mark.asyncio
async def test_chunked_file_transfer_and_sha256(tmp_path):
    dest_dir = str(tmp_path / "downloads")
    engine = TransferEngine()

    # Generate 1 MB of test data
    chunk_size = 256 * 1024  # 256 KB chunks = 4 chunks
    full_data = os.urandom(1024 * 1024)
    expected_sha256 = hashlib.sha256(full_data).hexdigest()

    meta = FileMetadata(
        fileId="test-file-1",
        fileName="large_video.mp4",
        fileSize=len(full_data),
        totalChunks=4,
        chunkSize=chunk_size,
        sha256Hash=expected_sha256
    )

    transfer = engine.register_file("xfer-test", meta, dest_dir)
    assert transfer.partial_path.name.endswith(".qrdrop.partial")

    # Send chunks out of order: chunk 2, chunk 0, chunk 3, chunk 1
    chunk_order = [2, 0, 3, 1]
    for idx in chunk_order:
        offset = idx * chunk_size
        chunk_bytes = full_data[offset : offset + chunk_size]
        chunk_hash = calculate_sha256_bytes(chunk_bytes)
        ack = await transfer.write_chunk(
            chunk_index=idx,
            offset=offset,
            chunk_data=chunk_bytes,
            expected_checksum=chunk_hash
        )
        assert ack.status == "OK"

    assert transfer.is_all_chunks_received() is True
    assert transfer.get_missing_chunks() == []

    # Finalize file -> verifies SHA-256 and atomically renames
    computed_hash = await transfer.finalize_file()
    assert computed_hash.lower() == expected_sha256.lower()
    assert transfer.final_path.exists()
    assert not transfer.partial_path.exists()
    assert transfer.final_path.read_bytes() == full_data

@pytest.mark.asyncio
async def test_corrupt_chunk_retry(tmp_path):
    dest_dir = str(tmp_path / "downloads")
    engine = TransferEngine()
    data = b"Some valid chunk content for testing"
    expected_hash = calculate_sha256_bytes(data)

    meta = FileMetadata(
        fileId="test-file-corrupt",
        fileName="doc.txt",
        fileSize=len(data),
        totalChunks=1,
        chunkSize=1024,
        sha256Hash=calculate_sha256_bytes(data)
    )
    transfer = engine.register_file("xfer-corrupt", meta, dest_dir)

    # Send corrupted data with valid expected hash
    ack = await transfer.write_chunk(
        chunk_index=0,
        offset=0,
        chunk_data=b"Corrupted tampered bytes",
        expected_checksum=expected_hash
    )
    assert ack.status == "CORRUPT"
    assert 0 not in transfer.completed_chunks

    # Now retry with valid chunk
    ack_retry = await transfer.write_chunk(
        chunk_index=0,
        offset=0,
        chunk_data=data,
        expected_checksum=expected_hash
    )
    assert ack_retry.status == "OK"
    assert 0 in transfer.completed_chunks

@pytest.mark.asyncio
async def test_resumable_transfer_after_interruption(tmp_path):
    dest_dir = str(tmp_path / "downloads")
    chunk_size = 100
    full_data = os.urandom(500)  # 5 chunks of 100 bytes
    expected_sha = hashlib.sha256(full_data).hexdigest()

    meta = FileMetadata(
        fileId="test-resume-file",
        fileName="interrupted.bin",
        fileSize=500,
        totalChunks=5,
        chunkSize=chunk_size,
        sha256Hash=expected_sha
    )

    # Session 1: sends chunks 0, 1, 2 only
    engine1 = TransferEngine()
    xfer1 = engine1.register_file("xfer-resume", meta, dest_dir)
    for i in [0, 1, 2]:
        chunk = full_data[i * 100 : (i + 1) * 100]
        await xfer1.write_chunk(i, i * 100, chunk)

    assert len(xfer1.completed_chunks) == 3

    # Interruption occurs (network drop, crash). Engine restarts.
    engine2 = TransferEngine()
    xfer2 = engine2.register_file("xfer-resume", meta, dest_dir)

    # Resume check: existing progress should be recovered from .meta file
    assert xfer2.completed_chunks == {0, 1, 2}
    missing = xfer2.get_missing_chunks()
    assert missing == [3, 4]

    # Resume by sending only missing chunks 3 and 4
    for i in missing:
        chunk = full_data[i * 100 : (i + 1) * 100]
        await xfer2.write_chunk(i, i * 100, chunk)

    assert xfer2.is_all_chunks_received() is True
    final_sha = await xfer2.finalize_file()
    assert final_sha == expected_sha
    assert xfer2.final_path.read_bytes() == full_data

@pytest.mark.asyncio
async def test_folder_structure_preservation(tmp_path):
    dest_dir = str(tmp_path / "downloads")
    engine = TransferEngine()
    data = b"Code in nested folder"

    meta = FileMetadata(
        fileId="test-folder-file",
        fileName="App.tsx",
        relativePath="frontend/src/components",
        fileSize=len(data),
        totalChunks=1,
        chunkSize=1024,
        sha256Hash=calculate_sha256_bytes(data)
    )

    xfer = engine.register_file("xfer-folder", meta, dest_dir)
    await xfer.write_chunk(0, 0, data)
    await xfer.finalize_file()

    expected_file = Path(dest_dir) / "frontend" / "src" / "components" / "App.tsx"
    assert expected_file.exists()
    assert expected_file.read_bytes() == data

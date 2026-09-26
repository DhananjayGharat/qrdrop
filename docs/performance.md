# QRDrop Performance & Benchmark Analysis

## 1. Benchmarking Environment

- **CPU**: 12 Logical Cores (Intel/AMD x64)
- **RAM**: 15.6 GB System Memory
- **OS**: Windows 11 (64-bit)
- **Storage**: High-Speed NVMe SSD
- **Tool**: `scripts/benchmark.py` (Automated Async Benchmark Suite)

---

## 2. Chunk Size Benchmark Results (20 MB Payload)

| Chunk Size | Total Chunks | Duration (sec) | Throughput (MB/s) | RAM Overhead |
|---|---|---|---|---|
| **64 KB** | 320 | 0.226 s | **88.33 MB/s** | +0.3 MB |
| **256 KB** (Default) | 80 | 0.088 s | **227.20 MB/s** | +0.4 MB |
| **512 KB** | 40 | 0.055 s | **362.16 MB/s** | +0.5 MB |
| **1024 KB (1 MB)** | 20 | 0.048 s | **414.49 MB/s** | +1.0 MB |

### Key Findings:
- **64 KB** chunking incurs slightly higher header and framing overhead (88 MB/s), making it ideal for mobile/lossy Wi-Fi environments where smaller packet retransmission is preferred.
- **256 KB** achieves an optimal balance between low memory footprint (0.4 MB RAM), low retransmission penalty, and high throughput (**227.2 MB/s**).
- **512 KB – 1 MB** chunk sizes maximize NVMe and Direct LAN bandwidth (**360 – 414 MB/s**).

---

## 3. Single-Stream vs. Controlled Parallel Streams (50 MB File)

| Concurrency Model | Chunk Size | Duration (sec) | Throughput (MB/s) |
|---|---|---|---|
| **Single-Stream** (Sequential) | 256 KB | 0.189 s | **264.72 MB/s** |
| **Parallel Streams** (4 Concurrent) | 256 KB | 0.182 s | **274.37 MB/s** |

### Concurrency Policy:
Parallel chunk upload yields slight throughput improvements on multi-core systems, but excessive concurrency risks disk thrashing and TCP/congestion collapse. QRDrop sets `MAX_PARALLEL_CHUNKS = 4` to preserve smooth UI responsiveness.

---

## 4. Large-File Streaming & Memory Bounding (100 MB File)

| Metric | Measured Value |
|---|---|
| **File Size** | 100 MB (104,857,600 bytes) |
| **Transfer Time** | 0.266 seconds |
| **Streaming Throughput** | **376.19 MB/s** |
| **SHA-256 Verification Time** | 0.0987 seconds (1,013 MB/s hasher) |
| **Process RAM Footprint** | Bounded &lt; 25 MB throughout the entire transfer |

### Zero-RAM Invariant:
Large files are NEVER loaded entirely into RAM. Both sender and receiver stream data in discrete chunks:
```
Disk &rarr; Slice Chunk (Blob) &rarr; Stream Transport &rarr; Write Offset in .qrdrop.partial &rarr; Release Buffer
```
This enables transferring files of arbitrary size (5 GB, 20 GB, 50 GB+) on memory-constrained mobile devices without Out-Of-Memory (OOM) crashes.

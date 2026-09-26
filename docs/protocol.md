# QRDrop Protocol Specification: QRDTP/1

## Protocol Version: `QRDTP/1`

QRDTP (QRDrop Transfer Protocol) is an application-layer protocol designed for cross-platform, high-throughput, fault-tolerant file streaming between disparate devices and operating systems.

---

## 1. Message Types & Framing

Control messages are exchanged over JSON WebSockets or REST signaling. Binary chunk frames are transmitted either via HTTP `multipart/form-data`, WebRTC `RTCDataChannel`, or binary WebSocket frames.

### Control Messages
| Message Type | Description | Originator |
|---|---|---|
| `HELLO` | Initial connection handshake with capability parameters | Peer |
| `PAIR_REQUEST` | Submits ephemeral token scanned from QR | Sender |
| `PAIR_ACCEPT` | Acknowledges valid pairing and initiates transport selection | Receiver |
| `PAIR_REJECT` | Rejects pairing (expired token, replay attack, invalid state) | Receiver |
| `CAPABILITIES` | Exchanges supported versions, transports, and chunk sizes | Both |
| `TRANSFER_REQUEST` | Sends transfer manifest containing file list, sizes, and paths | Sender |
| `TRANSFER_ACCEPT` | Receiver confirms user approval to receive files | Receiver |
| `TRANSFER_REJECT` | Receiver user declined transfer | Receiver |
| `MANIFEST` | File metadata manifest with relative directory structures | Sender |
| `CHUNK` | Binary chunk payload with index, offset, and checksum | Sender |
| `CHUNK_ACK` | Chunk acknowledgement (`OK`, `CORRUPT`, `MISSING`) | Receiver |
| `RESUME_REQUEST` | Queries completed chunks for interrupted file | Sender |
| `RESUME_RESPONSE` | Returns bitmap / list of missing chunks | Receiver |
| `HASH_VERIFY` | Signals completed file SHA-256 verification | Receiver |
| `TRANSFER_COMPLETE` | All files in manifest successfully finalized | Both |
| `CANCEL` | Either peer cancels the transfer | Either |
| `ERROR` | Fatal transport or protocol exception | Either |

---

## 2. QR Pairing Payload Structure

```json
{
  "version": "QRDTP/1",
  "sessionId": "4b68e982-fa5e-4c31-8935-d227c81a95b0",
  "deviceId": "recv-101",
  "deviceName": "Dhananjay's Laptop (Windows)",
  "token": "eF91...token_urlsafe_32_bytes",
  "expiresAt": 1774681200000,
  "endpoints": {
    "lanUrls": ["http://192.168.1.150:8000"],
    "relayUrl": "/api/ws/relay/4b68e982-fa5e-4c31-8935-d227c81a95b0",
    "webrtcEnabled": true
  },
  "publicKey": "04a6c8e3...uncompressed_ecdh_p256_public_key"
}
```

---

## 3. Chunk Header Structure

For binary streaming transports, each chunk is framed as follows:

```
+-------------------------------------------------------------+
| Transfer ID (UUID string / 36 bytes)                         |
+-------------------------------------------------------------+
| File ID (UUID string / 36 bytes)                             |
+-------------------------------------------------------------+
| Chunk Index (uint32 / 4 bytes)                              |
+-------------------------------------------------------------+
| Byte Offset in File (uint64 / 8 bytes)                      |
+-------------------------------------------------------------+
| Checksum (SHA-256 Hex / 64 bytes)                           |
+-------------------------------------------------------------+
| Payload Length (uint32 / 4 bytes)                           |
+-------------------------------------------------------------+
| Payload: Encrypted Bytes (12-byte IV + AES-GCM-256 Cipher)  |
+-------------------------------------------------------------+
```

---

## 4. Resumable Transfer Protocol Sequence

```mermaid
sequenceDiagram
    participant Sender
    participant Receiver

    Note over Sender,Receiver: Connection interrupted after 70% of transfer
    Sender->>Receiver: Reconnect & Re-authenticate
    Sender->>Receiver: GET /api/transfer/resume-status/{transferId}/{fileId}
    Receiver->>Receiver: Read .qrdrop.meta on disk
    Receiver-->>Sender: ResumeResponse: completedChunks: [0..70], missingChunks: [71..100]
    
    loop Chunks 71 through 100
        Sender->>Receiver: Upload Chunk(index, offset, data)
        Receiver-->>Sender: ChunkAck: OK
    end
    
    Sender->>Receiver: Finalize File
    Receiver->>Receiver: Verify Full SHA-256 Checksum
    Receiver->>Receiver: Atomic Rename .qrdrop.partial &rarr; final
    Receiver-->>Sender: Status: VERIFIED
```

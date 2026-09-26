# QRDrop Cross-Platform Compatibility Matrix

QRDrop supports universal cross-platform file transfers across Desktop, Mobile, and Web browsers through a standardized protocol (`QRDTP/1`) with progressive transport selection.

---

## 1. Device Combination Matrix

| Sender \ Receiver | Windows | macOS | Linux | Android | iOS / iPadOS | Web / PWA |
|---|:---:|:---:|:---:|:---:|:---:|:---:|
| **Windows** | ✓ Direct LAN | ✓ Direct LAN | ✓ Direct LAN | ✓ Direct LAN | ✓ Direct LAN | ✓ WebRTC / LAN |
| **macOS** | ✓ Direct LAN | ✓ Direct LAN | ✓ Direct LAN | ✓ Direct LAN | ✓ Direct LAN | ✓ WebRTC / LAN |
| **Linux** | ✓ Direct LAN | ✓ Direct LAN | ✓ Direct LAN | ✓ Direct LAN | ✓ Direct LAN | ✓ WebRTC / LAN |
| **Android** | ✓ Direct LAN | ✓ Direct LAN | ✓ Direct LAN | ✓ Direct LAN | ✓ Direct LAN | ✓ WebRTC / LAN |
| **iOS / iPadOS**| ✓ Direct LAN | ✓ Direct LAN | ✓ Direct LAN | ✓ Direct LAN | ✓ Direct LAN | ✓ WebRTC / LAN |
| **Web / PWA** | ✓ WebRTC / LAN | ✓ WebRTC / LAN | ✓ WebRTC / LAN | ✓ WebRTC / LAN | ✓ WebRTC / LAN | ✓ WebRTC P2P |

*Note: In all scenarios where Direct LAN is partitioned across subnets or blocked by restrictive firewalls, **Secure Relay** provides seamless fallback.*

---

## 2. Platform Feature Capability Matrix

| Feature | Windows | macOS | Linux | Android | iOS / iPadOS | Web / PWA |
|---|:---:|:---:|:---:|:---:|:---:|:---:|
| **QR Code Generation** | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| **Camera QR Scanning** | ✓ (Webcam) | ✓ (FaceTime) | ✓ (V4L2) | ✓ (Back/Front) | ✓ (Back/Front) | ✓ (MediaStream) |
| **Upload QR Image Fallback** | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| **Single / Multi-File Selection**| ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| **Recursive Folder Selection**| ✓ | ✓ | ✓ | ✓ (SAF) | Limited (Files) | ✓ (webkitdirectory) |
| **Streaming Chunk Transfer** | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| **Resumable Transfers** | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| **Streaming SHA-256 Check** | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| **E2E Authenticated Encryption** | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| **Direct LAN IP Discovery** | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| **P2P WebRTC DataChannel** | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| **Encrypted Relay Fallback** | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| **Transfer History Persistence**| ✓ (SQLite) | ✓ (SQLite) | ✓ (SQLite) | ✓ (SQLite) | ✓ (IndexedDB) | ✓ (IndexedDB) |

---

## 3. Platform-Specific Guidelines

### Windows
- Native file and directory selection.
- High-performance streaming disk writes using asynchronous I/O.
- Automatic path sanitization of reserved device names (`CON`, `PRN`, `AUX`, `NUL`).

### macOS & Linux
- Full support for POSIX path normalization and directory hierarchy reconstruction.
- Sandboxing-compliant file storage.

### Android
- Modern Storage Access Framework (SAF) and Photo Picker integration.
- Standalone PWA installable with home screen launcher and OS Share Target sheet.

### iOS / iPadOS
- Safari WebKit file and photo selection.
- Standalone PWA with camera scanner and direct download to Files app.

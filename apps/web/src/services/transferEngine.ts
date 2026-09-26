import { FileMetadata, TransferManifest, TransportType } from '@shared/protocol/types';
import { api } from './api';
import { computeSHA256, generateUUID } from '@shared/crypto/crypto';
import { ITransport } from './transports/ITransport';

export interface SelectedItem {
  file: File;
  relativePath: string;
}

export interface ProgressCallbackData {
  transferId: string;
  currentFileName: string;
  fileIndex: number;
  totalFiles: number;
  currentFileBytes: number;
  currentFileSize: number;
  totalBytesTransferred: number;
  totalBytes: number;
  currentSpeedMBps: number;
  avgSpeedMBps: number;
  etaSeconds: number;
  percent: number;
  transport: TransportType;
}

export class ClientTransferEngine {
  private isCancelled = false;
  private startTime = 0;
  private lastSampleTime = 0;
  private lastSampleBytes = 0;
  private currentSpeedMBps = 0;

  public cancel() {
    this.isCancelled = true;
  }

  public async prepareManifest(
    senderDeviceId: string,
    receiverDeviceId: string,
    items: SelectedItem[],
    chunkSize = 256 * 1024
  ): Promise<TransferManifest> {
    const transferId = generateUUID();
    const files: FileMetadata[] = [];
    let totalBytes = 0;

    for (const item of items) {
      const file = item.file;
      const totalChunks = Math.ceil(file.size / chunkSize) || 1;
      totalBytes += file.size;

      files.push({
        fileId: generateUUID(),
        fileName: file.name,
        relativePath: item.relativePath || '',
        fileSize: file.size,
        mimeType: file.type || 'application/octet-stream',
        totalChunks,
        chunkSize,
      });
    }

    return {
      transferId,
      senderDeviceId,
      receiverDeviceId,
      totalFiles: files.length,
      totalBytes,
      createdAt: Date.now(),
      files,
    };
  }

  public async executeSend(
    sessionId: string,
    manifest: TransferManifest,
    items: SelectedItem[],
    transport: TransportType,
    onProgress: (p: ProgressCallbackData) => void,
    transportInstance?: ITransport
  ): Promise<void> {
    this.isCancelled = false;
    this.startTime = Date.now();
    this.lastSampleTime = this.startTime;
    this.lastSampleBytes = 0;

    let overallBytesTransferred = 0;

    for (let fIdx = 0; fIdx < manifest.files.length; fIdx++) {
      if (this.isCancelled) throw new Error('Transfer cancelled by user');

      const meta = manifest.files[fIdx];
      const item = items.find(i => i.file.name === meta.fileName) || items[fIdx];
      const file = item.file;

      // 1. Register file with receiver
      let completedChunksSet = new Set<number>();
      if (transportInstance) {
        const registerRes = await transportInstance.registerFile(sessionId, manifest.transferId, meta);
        completedChunksSet = new Set<number>(registerRes.completedChunks || []);
      } else {
        const registerRes = await api.registerFile(sessionId, manifest.transferId, meta);
        completedChunksSet = new Set<number>(registerRes.completedChunks || []);
      }

      // 2. Iterate through chunks
      const chunkSize = meta.chunkSize;
      const totalChunks = meta.totalChunks;

      for (let cIdx = 0; cIdx < totalChunks; cIdx++) {
        if (this.isCancelled) throw new Error('Transfer cancelled by user');

        const offset = cIdx * chunkSize;
        const end = Math.min(offset + chunkSize, file.size);
        const chunkBlob = file.slice(offset, end);
        const chunkLength = end - offset;

        // Skip if chunk already received on receiver (Resumable feature!)
        if (completedChunksSet.has(cIdx)) {
          overallBytesTransferred += chunkLength;
          continue;
        }

        // Compute chunk checksum for integrity
        const chunkBuffer = await chunkBlob.arrayBuffer();
        const chunkHash = await computeSHA256(new Uint8Array(chunkBuffer));

        // Upload chunk via active transport
        let ack;
        if (transportInstance) {
          ack = await transportInstance.sendChunk(
            manifest.transferId,
            meta.fileId,
            cIdx,
            offset,
            chunkBlob,
            chunkHash
          );
        } else {
          ack = await api.uploadChunk(
            manifest.transferId,
            meta.fileId,
            cIdx,
            offset,
            chunkBlob,
            chunkHash
          );
        }

        if (ack.status === 'CORRUPT') {
          // Retry chunk once
          if (transportInstance) {
            await transportInstance.sendChunk(
              manifest.transferId,
              meta.fileId,
              cIdx,
              offset,
              chunkBlob,
              chunkHash
            );
          } else {
            await api.uploadChunk(
              manifest.transferId,
              meta.fileId,
              cIdx,
              offset,
              chunkBlob,
              chunkHash
            );
          }
        }

        overallBytesTransferred += chunkLength;

        // Metrics calculation (Real-time speed & ETA)
        const now = Date.now();
        const sampleDeltaSec = (now - this.lastSampleTime) / 1000;
        if (sampleDeltaSec >= 0.5) {
          const bytesInWindow = overallBytesTransferred - this.lastSampleBytes;
          this.currentSpeedMBps = bytesInWindow / sampleDeltaSec / (1024 * 1024);
          this.lastSampleTime = now;
          this.lastSampleBytes = overallBytesTransferred;
        }

        const totalElapsedSec = Math.max((now - this.startTime) / 1000, 0.001);
        const avgSpeedMBps = overallBytesTransferred / totalElapsedSec / (1024 * 1024);
        const remainingBytes = Math.max(manifest.totalBytes - overallBytesTransferred, 0);
        const activeSpeedBytes = Math.max(this.currentSpeedMBps * 1024 * 1024, avgSpeedMBps * 1024 * 1024);
        const etaSeconds = activeSpeedBytes > 0 ? Math.ceil(remainingBytes / activeSpeedBytes) : 0;
        const percent = manifest.totalBytes > 0 ? (overallBytesTransferred / manifest.totalBytes) * 100 : 100;

        onProgress({
          transferId: manifest.transferId,
          currentFileName: meta.fileName,
          fileIndex: fIdx + 1,
          totalFiles: manifest.totalFiles,
          currentFileBytes: offset + chunkLength,
          currentFileSize: file.size,
          totalBytesTransferred: overallBytesTransferred,
          totalBytes: manifest.totalBytes,
          currentSpeedMBps: parseFloat(this.currentSpeedMBps.toFixed(1)),
          avgSpeedMBps: parseFloat(avgSpeedMBps.toFixed(1)),
          etaSeconds,
          percent: Math.min(Math.round(percent), 100),
          transport,
        });
      }

      // 3. Finalize file: Receiver computes streaming SHA-256 and atomically commits
      if (transportInstance) {
        await transportInstance.finalizeFile(sessionId, manifest.transferId, meta.fileId);
      } else {
        await api.finalizeFile(manifest.transferId, meta.fileId);
      }
    }
  }
}

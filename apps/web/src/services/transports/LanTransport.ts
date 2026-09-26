import { ChunkAck, FileMetadata, ResumeResponse, TransportType } from '@shared/protocol/types';
import { ITransport } from './ITransport';

export class LanTransport implements ITransport {
  public readonly type: TransportType = 'DIRECT_LAN';
  public readonly name = 'Direct Local Network';
  public readonly badgeLabel = '⚡ DIRECT LAN';

  constructor(private baseUrl: string) {
    this.baseUrl = baseUrl.replace(/\/+$/, '');
  }

  public async initialize(): Promise<void> {
    // Verify target reachability
    const res = await fetch(`${this.baseUrl}/health`, { method: 'GET' });
    if (!res.ok) {
      throw new Error(`Target LAN host unreachable: ${this.baseUrl}`);
    }
  }

  public async registerFile(
    sessionId: string,
    transferId: string,
    meta: FileMetadata
  ): Promise<ResumeResponse> {
    const res = await fetch(`${this.baseUrl}/api/transfer/register-file`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sessionId,
        transferId,
        fileMetadata: meta,
        conflictMode: 'keep_both',
      }),
    });
    if (!res.ok) {
      throw new Error(`LAN file registration failed: ${await res.text()}`);
    }
    return res.json();
  }

  public async sendChunk(
    transferId: string,
    fileId: string,
    chunkIndex: number,
    offset: number,
    chunk: Blob | ArrayBuffer,
    checksum: string
  ): Promise<ChunkAck> {
    const formData = new FormData();
    formData.append('transferId', transferId);
    formData.append('fileId', fileId);
    formData.append('chunkIndex', chunkIndex.toString());
    formData.append('offset', offset.toString());
    if (checksum) formData.append('checksum', checksum);

    const blob = chunk instanceof Blob ? chunk : new Blob([chunk]);
    formData.append('chunkFile', blob, 'chunk.bin');

    const res = await fetch(`${this.baseUrl}/api/transfer/upload-chunk`, {
      method: 'POST',
      body: formData,
    });
    if (!res.ok) {
      throw new Error(`LAN chunk upload failed: ${await res.text()}`);
    }
    return res.json();
  }

  public async finalizeFile(sessionId: string, transferId: string, fileId: string): Promise<any> {
    const res = await fetch(`${this.baseUrl}/api/transfer/finalize-file`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ transferId, fileId }),
    });
    if (!res.ok) {
      throw new Error(`LAN file finalization failed: ${await res.text()}`);
    }
    return res.json();
  }

  public close(): void {
    // HTTP transport does not keep long-lived persistent connections open
  }
}

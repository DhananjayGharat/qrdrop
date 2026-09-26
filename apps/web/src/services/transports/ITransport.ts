import { ChunkAck, FileMetadata, ResumeResponse, TransportType } from '@shared/protocol/types';

export interface TransportProgress {
  bytesTransferred: number;
  totalBytes: number;
  currentChunk: number;
  totalChunks: number;
}

export interface ITransport {
  readonly type: TransportType;
  readonly name: string;
  readonly badgeLabel: string;
  
  initialize(): Promise<void>;
  registerFile(sessionId: string, transferId: string, meta: FileMetadata): Promise<ResumeResponse>;
  sendChunk(
    transferId: string,
    fileId: string,
    chunkIndex: number,
    offset: number,
    chunk: Blob | ArrayBuffer,
    checksum: string
  ): Promise<ChunkAck>;
  finalizeFile(sessionId: string, transferId: string, fileId: string): Promise<any>;
  close(): void;
}

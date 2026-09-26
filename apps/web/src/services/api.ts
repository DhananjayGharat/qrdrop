import {
  SessionCreateRequest,
  SessionCreateResponse,
  SessionJoinRequest,
  TokenLookupResponse,
  NetworkDiagnostics,
  TransferManifest,
  FileMetadata,
  ChunkAck,
  ResumeResponse,
  TransferHistoryRecord,
} from '@shared/protocol/types';

let apiBase = window.location.origin;

export const setApiBase = (url: string) => {
  apiBase = url.replace(/\/+$/, '');
};

export const getApiBase = () => apiBase;

export const api = {
  getApiBase: () => apiBase,
  async getBasicHealth() {
    const res = await fetch(`${apiBase}/health`);
    if (!res.ok) throw new Error('Health check failed');
    return res.json();
  },

  async getHealth() {
    const res = await fetch(`${apiBase}/api/health`);
    if (!res.ok) throw new Error('Health check failed');
    return res.json();
  },

  async getDiagnostics(selectedIp?: string): Promise<NetworkDiagnostics> {
    const url = selectedIp 
      ? `${apiBase}/api/session/diagnostics/network?selected_ip=${encodeURIComponent(selectedIp)}`
      : `${apiBase}/api/session/diagnostics/network`;
    const res = await fetch(url);
    if (!res.ok) throw new Error('Diagnostics check failed');
    return res.json();
  },

  async createSession(req: SessionCreateRequest): Promise<SessionCreateResponse> {
    const res = await fetch(`${apiBase}/api/session/create`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req),
    });
    if (!res.ok) throw new Error(await res.text());
    return res.json();
  },

  async lookupToken(
    token: string,
    deviceName?: string,
    platform?: string,
    browser?: string
  ): Promise<TokenLookupResponse> {
    const params = new URLSearchParams({ token });
    if (deviceName) params.append('device_name', deviceName);
    if (platform) params.append('platform', platform);
    if (browser) params.append('browser', browser);

    const res = await fetch(`${apiBase}/api/session/lookup-token?${params.toString()}`);
    if (!res.ok) throw new Error(await res.text());
    return res.json();
  },

  async deviceDetect(token: string, clientDeviceName?: string, clientPlatform?: string, browser?: string) {
    const res = await fetch(`${apiBase}/api/session/device-detect`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, clientDeviceName, clientPlatform, browser }),
    });
    if (!res.ok) throw new Error(await res.text());
    return res.json();
  },

  async joinSession(sessionId: string, req: SessionJoinRequest) {
    const res = await fetch(`${apiBase}/api/session/join?session_id=${encodeURIComponent(sessionId)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req),
    });
    if (!res.ok) throw new Error(await res.text());
    return res.json();
  },

  async getSession(sessionId: string) {
    const res = await fetch(`${apiBase}/api/session/${encodeURIComponent(sessionId)}`);
    if (!res.ok) throw new Error('Session not found');
    return res.json();
  },

  async submitManifest(sessionId: string, manifest: TransferManifest) {
    const res = await fetch(`${apiBase}/api/session/${encodeURIComponent(sessionId)}/manifest`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(manifest),
    });
    if (!res.ok) throw new Error(await res.text());
    return res.json();
  },

  async approveTransfer(sessionId: string, approved: boolean, reason?: string) {
    const res = await fetch(`${apiBase}/api/session/${encodeURIComponent(sessionId)}/approve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ approved, reason }),
    });
    if (!res.ok) throw new Error(await res.text());
    return res.json();
  },

  async cancelSession(sessionId: string) {
    const res = await fetch(`${apiBase}/api/session/${encodeURIComponent(sessionId)}/cancel`, {
      method: 'POST',
    });
    if (!res.ok) throw new Error(await res.text());
    return res.json();
  },

  async registerFile(sessionId: string, transferId: string, fileMetadata: FileMetadata, conflictMode = 'keep_both') {
    const res = await fetch(`${apiBase}/api/transfer/register-file`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sessionId,
        transferId,
        fileMetadata,
        conflictMode,
      }),
    });
    if (!res.ok) throw new Error(await res.text());
    return res.json();
  },

  async uploadChunk(
    transferId: string,
    fileId: string,
    chunkIndex: number,
    offset: number,
    chunkBlob: Blob,
    checksum?: string
  ): Promise<ChunkAck> {
    const formData = new FormData();
    formData.append('transferId', transferId);
    formData.append('fileId', fileId);
    formData.append('chunkIndex', chunkIndex.toString());
    formData.append('offset', offset.toString());
    if (checksum) formData.append('checksum', checksum);
    formData.append('chunkFile', chunkBlob, 'chunk.bin');

    const res = await fetch(`${apiBase}/api/transfer/upload-chunk`, {
      method: 'POST',
      body: formData,
    });
    if (!res.ok) throw new Error(await res.text());
    return res.json();
  },

  async getResumeStatus(transferId: string, fileId: string): Promise<ResumeResponse> {
    const res = await fetch(`${apiBase}/api/transfer/resume-status/${transferId}/${fileId}`);
    if (!res.ok) throw new Error(await res.text());
    return res.json();
  },

  async finalizeFile(transferId: string, fileId: string) {
    const res = await fetch(`${apiBase}/api/transfer/finalize-file`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ transferId, fileId }),
    });
    if (!res.ok) throw new Error(await res.text());
    return res.json();
  },

  async getIceServers(sessionId: string) {
    const res = await fetch(`${apiBase}/api/session/${encodeURIComponent(sessionId)}/ice-servers`);
    if (!res.ok) throw new Error('Failed to fetch ICE servers');
    return res.json();
  },

  async getHistory(): Promise<TransferHistoryRecord[]> {
    const res = await fetch(`${apiBase}/api/session/history/list`);
    if (!res.ok) throw new Error(await res.text());
    return res.json();
  },

  async addHistoryRecord(record: any) {
    await fetch(`${apiBase}/api/session/history/record`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(record),
    });
  },

  async clearHistory() {
    await fetch(`${apiBase}/api/session/history/clear`, {
      method: 'DELETE',
    });
  },
};

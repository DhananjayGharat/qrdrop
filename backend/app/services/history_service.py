import sqlite3
import json
import time
from typing import List, Optional
from pathlib import Path
from backend.app.core.config import settings
from backend.app.models.schemas import TransferHistoryItem

class HistoryService:
    def __init__(self, db_path: str = settings.DATABASE_PATH):
        self.db_path = db_path
        self._init_db()

    def _get_connection(self) -> sqlite3.Connection:
        conn = sqlite3.connect(self.db_path)
        conn.row_factory = sqlite3.Row
        return conn

    def _init_db(self) -> None:
        with self._get_connection() as conn:
            conn.execute("""
                CREATE TABLE IF NOT EXISTS transfer_history (
                    id TEXT PRIMARY KEY,
                    transfer_id TEXT NOT NULL,
                    timestamp REAL NOT NULL,
                    direction TEXT NOT NULL,
                    remote_device_name TEXT NOT NULL,
                    remote_platform TEXT NOT NULL,
                    transport TEXT NOT NULL,
                    file_count INTEGER NOT NULL,
                    total_bytes INTEGER NOT NULL,
                    duration_seconds REAL NOT NULL,
                    avg_speed_bps REAL NOT NULL,
                    status TEXT NOT NULL,
                    file_names_json TEXT NOT NULL
                )
            """)
            conn.commit()

    def add_record(self, item: TransferHistoryItem) -> None:
        with self._get_connection() as conn:
            conn.execute("""
                INSERT OR REPLACE INTO transfer_history (
                    id, transfer_id, timestamp, direction, remote_device_name,
                    remote_platform, transport, file_count, total_bytes,
                    duration_seconds, avg_speed_bps, status, file_names_json
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, (
                item.id,
                item.transferId,
                item.timestamp,
                item.direction,
                item.remoteDeviceName,
                item.remotePlatform,
                item.transport,
                item.fileCount,
                item.totalBytes,
                item.durationSeconds,
                item.avgSpeedBytesPerSec,
                item.status,
                json.dumps(item.fileNames),
            ))
            conn.commit()

    def list_records(self, limit: int = 50, query: Optional[str] = None) -> List[TransferHistoryItem]:
        with self._get_connection() as conn:
            if query:
                cursor = conn.execute("""
                    SELECT * FROM transfer_history
                    WHERE remote_device_name LIKE ? OR file_names_json LIKE ?
                    ORDER BY timestamp DESC LIMIT ?
                """, (f"%{query}%", f"%{query}%", limit))
            else:
                cursor = conn.execute("""
                    SELECT * FROM transfer_history
                    ORDER BY timestamp DESC LIMIT ?
                """, (limit,))
            
            rows = cursor.fetchall()
            results = []
            for r in rows:
                results.append(TransferHistoryItem(
                    id=r["id"],
                    transferId=r["transfer_id"],
                    timestamp=r["timestamp"],
                    direction=r["direction"],
                    remoteDeviceName=r["remote_device_name"],
                    remotePlatform=r["remote_platform"],
                    transport=r["transport"],
                    fileCount=r["file_count"],
                    totalBytes=r["total_bytes"],
                    durationSeconds=r["duration_seconds"],
                    avgSpeedBytesPerSec=r["avg_speed_bps"],
                    status=r["status"],
                    fileNames=json.loads(r["file_names_json"]),
                ))
            return results

    def clear_history(self) -> None:
        with self._get_connection() as conn:
            conn.execute("DELETE FROM transfer_history")
            conn.commit()

history_service = HistoryService()

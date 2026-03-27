#!/usr/bin/env python3
"""Phase 2 SLM worker pool for Redis Stream claim-check tasks.

Responsibilities:
- Consume task pointers from Redis Streams.
- Fetch full payload from Postgres (Claim Check pattern).
- Run lightweight SLM summarization hook (vLLM/OpenAI-compatible endpoint).
- Apply GC: archive memories when time-weighted hybrid score drops below threshold.
"""

from __future__ import annotations

import asyncio
import hashlib
import json
import os
import socket
import uuid
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any

import aiohttp
import asyncpg
import redis.asyncio as aioredis
from pydantic import BaseModel, Field


def env_float(name: str, fallback: float) -> float:
    value = os.getenv(name)
    if value is None:
        return fallback
    try:
        return float(value)
    except ValueError:
        return fallback


def env_int(name: str, fallback: int) -> int:
    value = os.getenv(name)
    if value is None:
        return fallback
    try:
        return int(value)
    except ValueError:
        return fallback


DB_DSN = os.getenv("DATABASE_URL", "postgresql://postgres:postgres@localhost:5432/vorldx?schema=public")
REDIS_URL = os.getenv("REDIS_URL", "redis://localhost:6379")
STREAM_KEY = os.getenv("DNA_MEMORY_REDIS_STREAM", "dna_memory:slm_tasks")
GROUP_NAME = os.getenv("DNA_MEMORY_REDIS_GROUP", "dna_memory_phase2_workers")
CONSUMER_PREFIX = os.getenv("DNA_MEMORY_REDIS_CONSUMER_PREFIX", "phase2-python")
WORKER_CONCURRENCY = max(1, env_int("DNA_MEMORY_SLM_WORKER_CONCURRENCY", 3))
BLOCK_MS = max(1000, env_int("DNA_MEMORY_SLM_BLOCK_MS", 5000))
COUNT_PER_READ = max(1, env_int("DNA_MEMORY_SLM_COUNT", 12))

ALPHA = max(0.0, min(1.0, env_float("AGENT_MEMORY_TIME_ALPHA", 0.72)))
BETA = max(0.0, min(1.0, env_float("AGENT_MEMORY_TIME_BETA", 0.28)))
LAMBDA_PER_HOUR = max(0.0001, env_float("AGENT_MEMORY_TIME_LAMBDA_PER_HOUR", 0.08))
GC_THRESHOLD = max(0.0, min(1.0, env_float("AGENT_MEMORY_TIME_GC_THRESHOLD", 0.2)))

VLLM_ENDPOINT = os.getenv("DNA_MEMORY_VLLM_ENDPOINT", "").strip()
VLLM_MODEL = os.getenv("DNA_MEMORY_SLM_MODEL", "Llama-3-8B-Instruct")
VLLM_API_KEY = os.getenv("DNA_MEMORY_SLM_API_KEY", "").strip()


class StreamPointer(BaseModel):
    task_id: str = Field(min_length=1)
    tenant_id: str = Field(min_length=1)
    user_id: str = Field(min_length=1)
    session_id: str = Field(min_length=1)
    task_type: str = Field(min_length=1)


class ClaimTask(BaseModel):
    task_id: str
    tenant_id: str
    user_id: str
    session_id: str
    task_type: str
    payload_jsonb: dict[str, Any]
    version: int


@dataclass
class MemoryRow:
    id: str
    content: str
    summary: str
    importance: float
    timestamp: datetime
    pinned: bool


def now_utc() -> datetime:
    return datetime.now(timezone.utc)


def time_decay_score(timestamp: datetime) -> float:
    age_seconds = max(0.0, (now_utc() - timestamp).total_seconds())
    age_hours = age_seconds / 3600.0
    return float(pow(2.718281828459045, -LAMBDA_PER_HOUR * age_hours))


def hybrid_score(semantic_similarity: float, decay: float) -> float:
    alpha = ALPHA
    beta = BETA
    denom = alpha + beta
    alpha = alpha / denom if denom > 0 else 0.5
    beta = beta / denom if denom > 0 else 0.5
    return max(0.0, min(1.0, alpha * semantic_similarity + beta * decay))


def compact(text: str) -> str:
    return " ".join(text.split()).strip()


async def maybe_summarize_with_vllm(session: aiohttp.ClientSession, text: str) -> str:
    if not text:
        return ""
    if not VLLM_ENDPOINT:
        return compact(text)[:800]

    payload = {
        "model": VLLM_MODEL,
        "messages": [
            {
                "role": "system",
                "content": "Summarize this memory session into concise operational learnings."
            },
            {
                "role": "user",
                "content": text[:6000]
            }
        ],
        "temperature": 0.1,
        "max_tokens": 220
    }

    headers = {"Content-Type": "application/json"}
    if VLLM_API_KEY:
        headers["Authorization"] = f"Bearer {VLLM_API_KEY}"

    try:
        async with session.post(VLLM_ENDPOINT, headers=headers, json=payload, timeout=15) as response:
            if response.status >= 400:
                return compact(text)[:800]
            body = await response.json(content_type=None)
            choices = body.get("choices") if isinstance(body, dict) else None
            if isinstance(choices, list) and choices:
                message = choices[0].get("message", {})
                if isinstance(message, dict):
                    content = message.get("content", "")
                    if isinstance(content, str) and content.strip():
                        return compact(content)[:1200]
    except Exception:
        return compact(text)[:800]

    return compact(text)[:800]


async def fetch_claim_task(conn: asyncpg.Connection, task_id: str) -> ClaimTask | None:
    row = await conn.fetchrow(
        """
        SELECT
          task_id::text AS task_id,
          tenant_id,
          user_id,
          session_id,
          task_type,
          payload_jsonb,
          version
        FROM dna_memory.claim_check_tasks
        WHERE task_id = $1::uuid
        LIMIT 1
        """,
        task_id,
    )
    if row is None:
        return None
    return ClaimTask(
        task_id=row["task_id"],
        tenant_id=row["tenant_id"],
        user_id=row["user_id"],
        session_id=row["session_id"],
        task_type=row["task_type"],
        payload_jsonb=dict(row["payload_jsonb"] or {}),
        version=int(row["version"]),
    )


async def update_task_status_occ(
    conn: asyncpg.Connection,
    task: ClaimTask,
    *,
    expected_version: int,
    status: str,
    started: bool = False,
    processed: bool = False,
    error: str | None = None,
    attempt_inc: int = 0,
) -> bool:
    row = await conn.fetchrow(
        """
        SELECT *
        FROM dna_memory.update_claim_check_task_status_occ(
          $1,
          $2,
          $3::uuid,
          $4,
          $5::dna_memory.claim_task_status,
          NULL,
          $6,
          $7,
          $8,
          $9
        )
        """,
        task.tenant_id,
        task.user_id,
        task.task_id,
        expected_version,
        status,
        error,
        now_utc() if started else None,
        now_utc() if processed else None,
        max(0, attempt_inc),
    )
    return bool(row and row["applied"])


async def fetch_session_memories(
    conn: asyncpg.Connection, tenant_id: str, user_id: str, session_id: str
) -> list[MemoryRow]:
    rows = await conn.fetch(
        """
        SELECT
          id,
          COALESCE(content, '') AS content,
          COALESCE(summary, '') AS summary,
          COALESCE(importance, 0.5) AS importance,
          timestamp,
          COALESCE("pinned", FALSE) AS pinned
        FROM "AgentMemory"
        WHERE "orgId" = $1
          AND COALESCE("userId", '') = COALESCE($2, '')
          AND "sessionId" = $3
          AND "archivedAt" IS NULL
          AND "lifecycleState" IN ('SHORT_TERM', 'LONG_TERM')
        ORDER BY timestamp DESC
        LIMIT 140
        """,
        tenant_id,
        user_id,
        session_id,
    )

    return [
        MemoryRow(
            id=str(row["id"]),
            content=str(row["content"]),
            summary=str(row["summary"]),
            importance=float(row["importance"]),
            timestamp=row["timestamp"],
            pinned=bool(row["pinned"]),
        )
        for row in rows
    ]


async def archive_low_scoring_memories(conn: asyncpg.Connection, rows: list[MemoryRow]) -> tuple[int, set[str]]:
    low_ids: list[str] = []
    for row in rows:
        if row.pinned:
            continue
        semantic = max(0.0, min(1.0, row.importance))
        decay = time_decay_score(row.timestamp)
        score = hybrid_score(semantic, decay)
        if score < GC_THRESHOLD:
            low_ids.append(row.id)

    if not low_ids:
        return 0, set()

    await conn.execute(
        """
        UPDATE "AgentMemory"
        SET "archivedAt" = NOW(),
            "lifecycleState" = 'ARCHIVE'::"AgentMemoryLifecycleState",
            "lifecycleUpdatedAt" = NOW(),
            "updatedAt" = NOW()
        WHERE id = ANY($1::text[])
          AND "archivedAt" IS NULL
          AND COALESCE("pinned", FALSE) = FALSE
        """,
        low_ids,
    )
    return len(low_ids), set(low_ids)


async def persist_session_summary(
    conn: asyncpg.Connection,
    tenant_id: str,
    user_id: str,
    session_id: str,
    summary: str,
    archived_count: int,
) -> None:
    if not summary.strip():
        return

    content_hash = hashlib.sha256(
        f"{tenant_id}|{user_id}|{session_id}|{summary.strip().lower()}".encode("utf-8")
    ).hexdigest()

    await conn.execute(
        """
        INSERT INTO "AgentMemory" (
          id,
          "orgId",
          "userId",
          "sessionId",
          content,
          summary,
          "memoryType",
          visibility,
          tags,
          source,
          timestamp,
          importance,
          recency,
          metadata,
          "contentHash",
          "updatedAt"
        )
        VALUES (
          $1,
          $2,
          $3,
          $4,
          $5,
          $6,
          'SEMANTIC'::"AgentMemoryType",
          'SHARED'::"AgentMemoryVisibility",
          ARRAY['phase2', 'session_summary', 'slm']::text[],
          'phase2_slm_worker',
          NOW(),
          0.68,
          0.9,
          $7::jsonb,
          $8,
          NOW()
        )
        """,
        f"slm_{uuid.uuid4().hex}",
        tenant_id,
        user_id,
        session_id,
        summary,
        summary[:240],
        json.dumps(
            {
                "worker": "phase2_slm_worker",
                "model": VLLM_MODEL,
                "archived_count": archived_count,
                "generated_at": now_utc().isoformat(),
            }
        ),
        content_hash,
    )


async def process_task(
    redis_client: aioredis.Redis,
    db_pool: asyncpg.Pool,
    http_session: aiohttp.ClientSession,
    stream_id: str,
    pointer: StreamPointer,
) -> None:
    async with db_pool.acquire() as conn:
        task = await fetch_claim_task(conn, pointer.task_id)
        if task is None:
            await redis_client.xack(STREAM_KEY, GROUP_NAME, stream_id)
            return

        started = await update_task_status_occ(
            conn,
            task,
            expected_version=task.version,
            status="IN_PROGRESS",
            started=True,
            attempt_inc=1,
        )
        if not started:
            await redis_client.xack(STREAM_KEY, GROUP_NAME, stream_id)
            return

        try:
            memories = await fetch_session_memories(
                conn,
                task.tenant_id,
                task.user_id,
                task.session_id,
            )
            archived_count, archived_ids = await archive_low_scoring_memories(conn, memories)

            remaining = [row for row in memories if row.id not in archived_ids]
            summary_source = "\n".join(
                compact(row.summary or row.content)[:260]
                for row in remaining[:24]
                if compact(row.summary or row.content)
            )
            summary = await maybe_summarize_with_vllm(http_session, summary_source)
            await persist_session_summary(
                conn,
                task.tenant_id,
                task.user_id,
                task.session_id,
                summary,
                archived_count,
            )

            await update_task_status_occ(
                conn,
                task,
                expected_version=task.version + 1,
                status="COMPLETED",
                processed=True,
            )
            await redis_client.xack(STREAM_KEY, GROUP_NAME, stream_id)
        except Exception as exc:
            await update_task_status_occ(
                conn,
                task,
                expected_version=task.version + 1,
                status="FAILED",
                processed=True,
                error=str(exc)[:600],
            )
            await redis_client.xack(STREAM_KEY, GROUP_NAME, stream_id)


async def worker_loop(worker_index: int, redis_client: aioredis.Redis, db_pool: asyncpg.Pool) -> None:
    consumer = f"{CONSUMER_PREFIX}-{socket.gethostname()}-{worker_index}"

    async with aiohttp.ClientSession() as http_session:
        while True:
            try:
                streams = await redis_client.xreadgroup(
                    groupname=GROUP_NAME,
                    consumername=consumer,
                    streams={STREAM_KEY: ">"},
                    count=COUNT_PER_READ,
                    block=BLOCK_MS,
                )

                if not streams:
                    continue

                for _stream_name, messages in streams:
                    for stream_id, fields in messages:
                        task_id = fields.get("task_id") or fields.get("taskId")
                        tenant_id = fields.get("tenant_id")
                        user_id = fields.get("user_id")
                        session_id = fields.get("session_id")
                        task_type = fields.get("task_type", "SESSION_IDLE_BATCH")

                        if not task_id or not tenant_id or not user_id or not session_id:
                            await redis_client.xack(STREAM_KEY, GROUP_NAME, stream_id)
                            continue

                        pointer = StreamPointer(
                            task_id=str(task_id),
                            tenant_id=str(tenant_id),
                            user_id=str(user_id),
                            session_id=str(session_id),
                            task_type=str(task_type),
                        )

                        await process_task(redis_client, db_pool, http_session, stream_id, pointer)
            except Exception as exc:
                print(f"[phase2-worker-{worker_index}] loop error: {exc}")
                await asyncio.sleep(1.5)


async def main() -> None:
    redis_client = aioredis.from_url(REDIS_URL, decode_responses=True)
    db_pool = await asyncpg.create_pool(DB_DSN, min_size=1, max_size=max(4, WORKER_CONCURRENCY + 1))

    try:
        try:
            await redis_client.xgroup_create(STREAM_KEY, GROUP_NAME, id="0-0", mkstream=True)
        except Exception as exc:
            if "BUSYGROUP" not in str(exc):
                raise

        workers = [
            asyncio.create_task(worker_loop(index, redis_client, db_pool))
            for index in range(WORKER_CONCURRENCY)
        ]

        await asyncio.gather(*workers)
    finally:
        await db_pool.close()
        await redis_client.close()


if __name__ == "__main__":
    asyncio.run(main())

"""Pydantic v2 contracts for the Phase 1 DNA memory layer.

These models enforce:
- schema_version on every JSON payload
- tenant/user row binding
- optimistic concurrency control fields for all writes
"""

from __future__ import annotations

from enum import StrEnum
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

DNA_SCHEMA_VERSION = "dna.phase1.v1"


class MemoryTier(StrEnum):
    LONG_TERM = "LONG_TERM"
    ARCHIVE = "ARCHIVE"
    STAGING = "STAGING"


class MemoryDomain(StrEnum):
    CONTEXTUAL = "CONTEXTUAL"
    WORKING = "WORKING"


class MemoryKind(StrEnum):
    FACT = "FACT"
    GRAPH_NODE = "GRAPH_NODE"
    RULE = "RULE"
    SOP_PATHWAY = "SOP_PATHWAY"


class Envelope(BaseModel):
    """Base envelope shared by all memory payloads."""

    model_config = ConfigDict(
        extra="forbid",
        str_strip_whitespace=True,
        validate_assignment=True,
    )

    schema_version: Literal[DNA_SCHEMA_VERSION] = DNA_SCHEMA_VERSION
    tenant_id: str = Field(min_length=1, max_length=128)
    user_id: str = Field(min_length=1, max_length=128)


class OCCWriteEnvelope(Envelope):
    """OCC envelope for writes that target an existing row."""

    expected_version: int | None = Field(
        default=None,
        ge=1,
        description="Expected row version. Required when updating existing rows.",
    )


class CentralMemoryChunkPayload(OCCWriteEnvelope):
    """JSON payload for Tier2/3/4 vector memory writes."""

    memory_id: int | None = Field(default=None, ge=1)
    tier: MemoryTier
    memory_domain: MemoryDomain
    memory_kind: MemoryKind
    document_id: str = Field(min_length=1, max_length=256)
    chunk_index: int = Field(ge=0)
    token_count: int = Field(ge=0, le=200_000)
    content: str = Field(min_length=1)
    embedding: list[float] = Field(min_length=256, max_length=512)
    metadata_jsonb: dict[str, Any] = Field(default_factory=dict)

    @field_validator("embedding")
    @classmethod
    def validate_embedding_dimensions(cls, value: list[float]) -> list[float]:
        dims = len(value)
        if dims not in (256, 512):
            raise ValueError("embedding dimensions must be exactly 256 or 512")
        return value

    @model_validator(mode="after")
    def validate_domain_kind(self) -> "CentralMemoryChunkPayload":
        contextual_ok = self.memory_domain is MemoryDomain.CONTEXTUAL and self.memory_kind in {
            MemoryKind.FACT,
            MemoryKind.GRAPH_NODE,
        }
        working_ok = self.memory_domain is MemoryDomain.WORKING and self.memory_kind in {
            MemoryKind.RULE,
            MemoryKind.SOP_PATHWAY,
        }
        if not (contextual_ok or working_ok):
            raise ValueError("memory_domain and memory_kind are not compatible")
        if self.memory_id is not None and self.expected_version is None:
            raise ValueError("expected_version is required when memory_id is provided")
        return self


class GraphNodePayload(OCCWriteEnvelope):
    """Payload for relational graph node writes."""

    node_id: int | None = Field(default=None, ge=1)
    label: str = Field(min_length=1, max_length=200)
    properties_jsonb: dict[str, Any] = Field(default_factory=dict)

    @model_validator(mode="after")
    def validate_occ_for_existing(self) -> "GraphNodePayload":
        if self.node_id is not None and self.expected_version is None:
            raise ValueError("expected_version is required when node_id is provided")
        return self


class GraphEdgePayload(OCCWriteEnvelope):
    """Payload for relational graph edge writes."""

    edge_id: int | None = Field(default=None, ge=1)
    source_id: int = Field(ge=1)
    target_id: int = Field(ge=1)
    relationship_type: str = Field(min_length=1, max_length=120)
    weight: float = Field(default=1.0, ge=0)

    @model_validator(mode="after")
    def validate_occ_for_existing(self) -> "GraphEdgePayload":
        if self.edge_id is not None and self.expected_version is None:
            raise ValueError("expected_version is required when edge_id is provided")
        return self


class OCCUpdateResult(Envelope):
    """Result envelope from an atomic OCC update call."""

    id: int = Field(ge=1)
    applied: bool
    new_version: int | None = Field(default=None, ge=1)


def build_central_memory_occ_sql() -> str:
    """Reference SQL used by the writer service for atomic OCC updates."""

    return (
        "UPDATE dna_memory.central_memory "
        "SET content = $5, metadata_jsonb = $6, token_count = $7, version = version + 1, updated_at = NOW() "
        "WHERE tenant_id = $1 AND user_id = $2 AND id = $3 AND version = $4"
    )

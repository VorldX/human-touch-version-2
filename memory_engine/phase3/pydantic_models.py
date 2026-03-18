"""Pydantic v2 contracts for the Phase 3 Multi-Agent Hive Mind layer.

These models enforce:
- schema_version in every JSON payload
- tenant/user routing
- OCC expected_version for mutable entities
- rule collision metadata through overrides_rule_id
"""

from __future__ import annotations

from enum import StrEnum
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

DNA_SCHEMA_VERSION = "dna.phase3.v1"


class BlackboardStatus(StrEnum):
    ACTIVE = "ACTIVE"
    COMPLETED = "COMPLETED"
    FAILED = "FAILED"
    CANCELLED = "CANCELLED"


class BlackboardStepStatus(StrEnum):
    PENDING = "PENDING"
    CLAIMED = "CLAIMED"
    IN_PROGRESS = "IN_PROGRESS"
    COMPLETED = "COMPLETED"
    SKIPPED = "SKIPPED"


class PathwayStatus(StrEnum):
    ACTIVE = "ACTIVE"
    DEPRECATED = "DEPRECATED"


class Envelope(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
        str_strip_whitespace=True,
        validate_assignment=True,
    )

    schema_version: Literal[DNA_SCHEMA_VERSION] = DNA_SCHEMA_VERSION
    tenant_id: str = Field(min_length=1, max_length=128)
    user_id: str = Field(min_length=1, max_length=128)


class OCCEnvelope(Envelope):
    expected_version: int | None = Field(default=None, ge=1)


class PathwayStepPayload(BaseModel):
    model_config = ConfigDict(extra="allow", str_strip_whitespace=True)

    step_key: str = Field(min_length=1, max_length=80)
    title: str = Field(min_length=1, max_length=300)


class PathwayRegistryPayload(OCCEnvelope):
    pathway_id: str | None = Field(default=None, min_length=1, max_length=128)
    pathway_name: str = Field(min_length=1, max_length=200)
    status: PathwayStatus = PathwayStatus.ACTIVE
    overrides_pathway_id: str | None = Field(default=None, min_length=1, max_length=128)
    steps: list[PathwayStepPayload] = Field(min_length=1, max_length=40)
    metadata_jsonb: dict[str, Any] = Field(default_factory=dict)

    @model_validator(mode="after")
    def validate_occ_for_existing(self) -> "PathwayRegistryPayload":
        if self.pathway_id and self.expected_version is None:
            raise ValueError("expected_version is required when pathway_id is provided")
        return self


class BlackboardSessionPayload(OCCEnvelope):
    board_id: str | None = Field(default=None, min_length=1, max_length=128)
    pathway_id: str = Field(min_length=1, max_length=128)
    session_id: str = Field(min_length=1, max_length=256)
    flow_id: str | None = Field(default=None, max_length=256)
    main_agent_id: str | None = Field(default=None, max_length=128)
    status: BlackboardStatus = BlackboardStatus.ACTIVE
    payload_jsonb: dict[str, Any] = Field(default_factory=dict)

    @model_validator(mode="after")
    def validate_occ_for_existing(self) -> "BlackboardSessionPayload":
        if self.board_id and self.expected_version is None:
            raise ValueError("expected_version is required when board_id is provided")
        return self


class BlackboardStepClaimPayload(OCCEnvelope):
    board_id: str = Field(min_length=1, max_length=128)
    step_id: int = Field(ge=1)
    agent_id: str = Field(min_length=1, max_length=128)
    lock_token: str = Field(min_length=1, max_length=256)
    status: BlackboardStepStatus = BlackboardStepStatus.IN_PROGRESS

    @field_validator("status")
    @classmethod
    def enforce_claim_status(cls, value: BlackboardStepStatus) -> BlackboardStepStatus:
        if value not in {BlackboardStepStatus.CLAIMED, BlackboardStepStatus.IN_PROGRESS}:
            raise ValueError("claim payload status must be CLAIMED or IN_PROGRESS")
        return value

    @model_validator(mode="after")
    def validate_occ(self) -> "BlackboardStepClaimPayload":
        if self.expected_version is None:
            raise ValueError("expected_version is required for step claim")
        return self


class BlackboardStepCompletePayload(OCCEnvelope):
    board_id: str = Field(min_length=1, max_length=128)
    step_id: int = Field(ge=1)
    agent_id: str = Field(min_length=1, max_length=128)
    lock_token: str = Field(min_length=1, max_length=256)
    result_jsonb: dict[str, Any] = Field(default_factory=dict)
    status: BlackboardStepStatus = BlackboardStepStatus.COMPLETED

    @model_validator(mode="after")
    def validate_occ(self) -> "BlackboardStepCompletePayload":
        if self.expected_version is None:
            raise ValueError("expected_version is required for step completion")
        return self


class WorkingRuleCollisionPayload(OCCEnvelope):
    rule_id: str = Field(min_length=1, max_length=200)
    content: str = Field(min_length=1)
    overrides_rule_id: str | None = Field(default=None, min_length=1, max_length=200)
    metadata_jsonb: dict[str, Any] = Field(default_factory=dict)


class SyncBusEventPayload(Envelope):
    event_type: str = Field(default="UPDATE_DNA", min_length=1, max_length=64)
    channel: str = Field(default="dna_memory:update_bus", min_length=1, max_length=160)
    payload_jsonb: dict[str, Any] = Field(default_factory=dict)


def build_blackboard_step_occ_sql() -> str:
    return (
        "UPDATE dna_memory.blackboard_steps "
        "SET status = $5, claimed_by_agent_id = $6, lock_token = $7, lock_expires_at = $8, "
        "result_jsonb = COALESCE($9, result_jsonb), completed_at = $10, version = version + 1, updated_at = NOW() "
        "WHERE tenant_id = $1 AND user_id = $2 AND id = $3 AND version = $4"
    )

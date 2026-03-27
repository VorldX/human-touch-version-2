import type { AssistantMessageMeta } from "@/src/types/chat";

export type StringMode = "discussion" | "direction";
export type CollaboratorKind = "HUMAN" | "AI";
export type CollaboratorGroupType = "team";
export type ChatAudienceKind = "everyone" | "team" | "person";
export type ChatMentionKind = "team" | "person";

export type MessageRole = "user" | "assistant" | "system";

export interface DirectionStep {
  id: string;
  title: string;
  owner: string;
  status: "todo" | "in_progress" | "done";
  tasks: string[];
  actions: string[];
}

export interface DirectionPayload {
  objective: string;
  summary?: string;
  teamName?: string;
  nextAction?: string;
  detailScore?: number;
  requiredToolkits?: string[];
  approvalCount?: number;
  steps: DirectionStep[];
}

export interface MessageMetrics {
  latencyMs: number;
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
  provider?: string;
  model?: string;
  source?: string;
}

export interface MessageRouting {
  route: "CHAT_RESPONSE" | "PLAN_REQUIRED";
  reason?: string;
  toolkitHints?: string[];
}

export interface ChatAudience {
  kind: ChatAudienceKind;
  id?: string | null;
  label?: string | null;
}

export interface ChatMention {
  id: string;
  label: string;
  handle: string;
  kind: ChatMentionKind;
  collaboratorKind?: CollaboratorKind;
}

export interface ChatAttachment {
  id: string;
  name: string;
  url: string;
  sizeLabel?: string;
}

export interface ChatMessage {
  id: string;
  role: MessageRole;
  content: string;
  createdAt: string;
  authorId?: string;
  authorName?: string;
  authorRole?: string;
  authorKind?: CollaboratorKind;
  direction?: DirectionPayload;
  teamId?: string | null;
  teamLabel?: string | null;
  audience?: ChatAudience;
  mentions?: ChatMention[];
  attachments?: ChatAttachment[];
  error?: boolean;
  metrics?: MessageMetrics;
  routing?: MessageRouting;
  meta?: AssistantMessageMeta;
}

export interface ChatString {
  id: string;
  title: string;
  mode: StringMode;
  updatedAt: string;
  createdAt?: string;
  directionId?: string | null;
  planId?: string | null;
  selectedTeamId?: string | null;
  selectedTeamLabel?: string | null;
  activeAudience?: ChatAudience;
  source?: "workspace" | "direction" | "plan";
  workspaceState?: {
    editableDraft?: Record<string, unknown>;
    scoreRecords?: Array<Record<string, unknown>>;
    steerDecisions?: Record<string, "CENTER" | "APPROVED" | "RETHINK">;
    linkedTeamIds?: string[];
    linkedParticipantIds?: string[];
    excludedParticipantIds?: string[];
  };
  createdByUserId?: string | null;
  updatedByUserId?: string | null;
  persisted?: boolean;
  messages: ChatMessage[];
}

export interface Collaborator {
  id: string;
  name: string;
  email: string;
  role?: string;
  kind?: CollaboratorKind;
  online?: boolean;
  source?: "team" | "squad" | "presence" | "system";
  avatar?: string;
  teamNames?: string[];
}

export interface CollaboratorGroup {
  id: string;
  name: string;
  type: CollaboratorGroupType;
  memberIds: string[];
  createdAt: string;
  updatedAt?: string;
  focus?: string;
}

export type Team = CollaboratorGroup;

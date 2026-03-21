export type StringMode = "discussion" | "direction";
export type CollaboratorKind = "HUMAN" | "AI";
export type CollaboratorGroupType = "team";

export type MessageRole = "user" | "system";

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
  steps: DirectionStep[];
}

export interface ChatMessage {
  id: string;
  role: MessageRole;
  content: string;
  createdAt: string;
  direction?: DirectionPayload;
}

export interface ChatString {
  id: string;
  title: string;
  mode: StringMode;
  updatedAt: string;
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
}

export interface CollaboratorGroup {
  id: string;
  name: string;
  type: CollaboratorGroupType;
  memberIds: string[];
  createdAt: string;
}

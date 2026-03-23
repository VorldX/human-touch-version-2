"use client";

import type {
  ChatString,
  Collaborator,
  CollaboratorGroup,
  DirectionPayload
} from "@/components/chat-ui/types";

const now = Date.now();

function minutesAgo(minutes: number) {
  return new Date(now - minutes * 60_000).toISOString();
}

function createDirectionPayload(
  objective: string,
  teamName: string,
  owner: string
): DirectionPayload {
  return {
    objective,
    summary: `Structured direction prepared for ${teamName}.`,
    teamName,
    nextAction: `Share the first checkpoint with ${teamName} today.`,
    steps: [
      {
        id: `${teamName}-discover`,
        title: "Clarify scope and constraints",
        owner,
        status: "done",
        tasks: [
          "Capture the current request in one sentence",
          "List blockers that could slow execution"
        ],
        actions: ["Confirm the deadline and review owners"]
      },
      {
        id: `${teamName}-align`,
        title: "Align owners on execution",
        owner: `${teamName} lead`,
        status: "in_progress",
        tasks: [
          "Assign a primary owner for the next step",
          "Define the smallest shippable milestone"
        ],
        actions: ["Publish a brief checkpoint update"]
      },
      {
        id: `${teamName}-ship`,
        title: "Ship and measure",
        owner: "Operations",
        status: "todo",
        tasks: [
          "Deliver the first release candidate",
          "Track outcome quality and response time"
        ],
        actions: ["Collect feedback and tighten the next pass"]
      }
    ]
  };
}

export const mockCollaborators: Collaborator[] = [
  {
    id: "maya-chen",
    name: "Maya Chen",
    email: "maya@human-touch.ai",
    role: "Product Lead",
    kind: "HUMAN",
    online: true,
    source: "presence"
  },
  {
    id: "leo-brooks",
    name: "Leo Brooks",
    email: "leo@human-touch.ai",
    role: "Design Lead",
    kind: "HUMAN",
    online: true,
    source: "presence"
  },
  {
    id: "talia-owens",
    name: "Talia Owens",
    email: "talia@human-touch.ai",
    role: "Engineering Manager",
    kind: "HUMAN",
    online: true,
    source: "presence"
  },
  {
    id: "omar-reed",
    name: "Omar Reed",
    email: "omar@human-touch.ai",
    role: "Customer Success",
    kind: "HUMAN",
    online: false,
    source: "presence"
  },
  {
    id: "atlas-agent",
    name: "Atlas Agent",
    email: "atlas@human-touch.ai",
    role: "Research Agent",
    kind: "AI",
    online: true,
    source: "team"
  },
  {
    id: "signal-agent",
    name: "Signal Agent",
    email: "signal@human-touch.ai",
    role: "Ops Agent",
    kind: "AI",
    online: true,
    source: "team"
  }
];

export const mockTeams: CollaboratorGroup[] = [
  {
    id: "team-product",
    name: "Product Pod",
    type: "team",
    memberIds: ["maya-chen", "leo-brooks", "atlas-agent"],
    createdAt: minutesAgo(540),
    focus: "UX direction, positioning, and release decisions"
  },
  {
    id: "team-execution",
    name: "Execution Crew",
    type: "team",
    memberIds: ["talia-owens", "signal-agent", "omar-reed"],
    createdAt: minutesAgo(420),
    focus: "Implementation, launch readiness, and support handoff"
  },
  {
    id: "team-growth",
    name: "Growth Loop",
    type: "team",
    memberIds: ["maya-chen", "omar-reed", "atlas-agent"],
    createdAt: minutesAgo(360),
    focus: "Acquisition experiments and customer insight loops"
  }
];

export const mockStrings: ChatString[] = [
  {
    id: "chat-launch",
    title: "Q2 launch alignment",
    mode: "discussion",
    updatedAt: minutesAgo(8),
    messages: [
      {
        id: "msg-launch-1",
        role: "assistant",
        content:
          "We have three open launch risks right now: onboarding clarity, support coverage, and release timing.",
        createdAt: minutesAgo(32),
        teamId: "team-product",
        teamLabel: "Product Pod"
      },
      {
        id: "msg-launch-2",
        role: "user",
        content:
          "Let’s tighten the onboarding story first and keep support informed as we reduce scope.",
        createdAt: minutesAgo(24),
        teamId: "team-product",
        teamLabel: "Product Pod"
      },
      {
        id: "msg-launch-3",
        role: "assistant",
        content:
          "That keeps the conversation focused. We can stay in discussion mode here or turn this into a formal direction when you want owners and milestones.",
        createdAt: minutesAgo(8),
        teamId: "team-product",
        teamLabel: "Product Pod"
      }
    ]
  },
  {
    id: "chat-growth",
    title: "Retention follow-up plan",
    mode: "direction",
    updatedAt: minutesAgo(18),
    messages: [
      {
        id: "msg-growth-1",
        role: "user",
        content:
          "Create a direction for reconnecting with trial users who stalled after setup.",
        createdAt: minutesAgo(34),
        teamId: "team-growth",
        teamLabel: "Growth Loop"
      },
      {
        id: "msg-growth-2",
        role: "assistant",
        content:
          "Direction drafted for the growth team with a first checkpoint, owner alignment, and follow-up measurement.",
        createdAt: minutesAgo(18),
        teamId: "team-growth",
        teamLabel: "Growth Loop",
        direction: createDirectionPayload(
          "Reconnect with stalled trial users within 48 hours of setup drop-off.",
          "Growth Loop",
          "Lifecycle Marketing"
        )
      }
    ]
  },
  {
    id: "chat-enterprise",
    title: "Enterprise pilot notes",
    mode: "discussion",
    updatedAt: minutesAgo(42),
    messages: [
      {
        id: "msg-enterprise-1",
        role: "assistant",
        content:
          "The pilot account wants clearer ownership around rollout communications and success criteria.",
        createdAt: minutesAgo(68),
        teamId: "team-execution",
        teamLabel: "Execution Crew"
      },
      {
        id: "msg-enterprise-2",
        role: "user",
        content:
          "We should mirror their rollout structure and give customer success a tighter handoff checklist.",
        createdAt: minutesAgo(42),
        teamId: "team-execution",
        teamLabel: "Execution Crew"
      }
    ]
  }
];

import type { ChatString, Collaborator } from "@/components/chat-ui/types";

export const mockStrings: ChatString[] = [
  {
    id: "str-001",
    title: "Q2 launch brainstorm",
    mode: "discussion",
    updatedAt: "2026-03-20T11:00:00.000Z",
    messages: [
      {
        id: "msg-001",
        role: "system",
        content: "Let's align on priorities for Q2 launch and risk areas.",
        createdAt: "2026-03-20T10:40:00.000Z"
      },
      {
        id: "msg-002",
        role: "user",
        content: "We should lock scope by Friday and isolate the biggest dependency.",
        createdAt: "2026-03-20T10:42:00.000Z"
      }
    ]
  },
  {
    id: "str-002",
    title: "Onboarding automation direction",
    mode: "direction",
    updatedAt: "2026-03-20T11:20:00.000Z",
    messages: [
      {
        id: "msg-010",
        role: "system",
        content: "Direction drafted for onboarding automation.",
        createdAt: "2026-03-20T10:55:00.000Z",
        direction: {
          objective: "Reduce onboarding cycle time from 3 days to under 1 day.",
          steps: [
            {
              id: "step-1",
              title: "Map current onboarding handoffs",
              owner: "Ops",
              status: "done",
              tasks: ["Audit current checklists", "Document blockers"],
              actions: ["Review with support lead"]
            },
            {
              id: "step-2",
              title: "Implement guided setup flow",
              owner: "Product",
              status: "in_progress",
              tasks: ["Define success metric", "Build first-time flow"],
              actions: ["Run pilot with 10 users"]
            }
          ]
        }
      }
    ]
  }
];

export const mockCollaborators: Collaborator[] = [
  {
    id: "col-1",
    name: "Utkarsh",
    email: "utkarsh@team.ai",
    role: "Founder"
  },
  {
    id: "col-2",
    name: "Asha Rao",
    email: "asha@team.ai",
    role: "Product"
  },
  {
    id: "col-3",
    name: "Noah Kim",
    email: "noah@team.ai",
    role: "Engineering"
  }
];

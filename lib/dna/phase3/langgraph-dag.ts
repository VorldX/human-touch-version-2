import "server-only";

import { claimNextBlackboardStep, listBlackboardSnapshot } from "@/lib/dna/phase3/blackboard";
import { publishDnaUpdateEvent } from "@/lib/dna/phase3/sync-bus";

interface Phase3HiveGraphInput {
  tenantId: string;
  userId: string;
  boardId: string;
  agentId: string;
}

interface Phase3HiveGraphResult {
  handled: boolean;
  claimed: boolean;
  step: {
    id: number;
    stepKey: string;
    stepOrder: number;
    payload: unknown;
    status: string;
    claimedByAgentId: string;
    lockToken: string;
    lockExpiresAt: string;
  } | null;
  assimilationEventId: string | null;
  warnings: string[];
}

let langGraphPackageState: "unknown" | "present" | "missing" = "unknown";

async function detectLangGraphPackage() {
  if (langGraphPackageState !== "unknown") {
    return langGraphPackageState === "present";
  }

  try {
    const importModule = new Function(
      "modulePath",
      "return import(modulePath);"
    ) as (modulePath: string) => Promise<unknown>;
    await importModule("@langchain/langgraph");
    langGraphPackageState = "present";
    return true;
  } catch {
    langGraphPackageState = "missing";
    return false;
  }
}

export class DnaPhase3HiveGraph {
  async run(input: Phase3HiveGraphInput): Promise<Phase3HiveGraphResult> {
    const warnings: string[] = [];

    const langGraphAvailable = await detectLangGraphPackage();
    if (!langGraphAvailable) {
      warnings.push("LangGraph package unavailable; deterministic Phase 3 DAG fallback is active.");
    }

    const board = await listBlackboardSnapshot({
      tenantId: input.tenantId,
      userId: input.userId,
      boardId: input.boardId,
      limit: 1
    });

    if (board.boards.length === 0) {
      return {
        handled: true,
        claimed: false,
        step: null,
        assimilationEventId: null,
        warnings: [...warnings, "Blackboard board not found."]
      };
    }

    // Downward memory splicing: claim the next unlocked step from the active board.
    const claimed = await claimNextBlackboardStep({
      tenantId: input.tenantId,
      userId: input.userId,
      boardId: input.boardId,
      agentId: input.agentId
    });

    if (!claimed.claimed || !claimed.step) {
      return {
        handled: true,
        claimed: false,
        step: null,
        assimilationEventId: null,
        warnings
      };
    }

    // Upward assimilation: emit UPDATE_DNA event so active agents can reload state.
    const sync = await publishDnaUpdateEvent({
      tenantId: input.tenantId,
      userId: input.userId,
      payload: {
        source: "phase3.langgraph.assimilation",
        board_id: input.boardId,
        claimed_step_id: claimed.step.id,
        claimed_step_key: claimed.step.stepKey,
        agent_id: input.agentId
      }
    });

    return {
      handled: true,
      claimed: true,
      step: claimed.step,
      assimilationEventId: sync.eventId,
      warnings
    };
  }
}

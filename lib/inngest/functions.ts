import { inngest } from "@/lib/inngest/client";
import { orchestratorInngestFunctions } from "@/src/inngest/functions";

const syncProbe = inngest.createFunction(
  { id: "sync-probe" },
  { event: "vorldx/inngest.sync_probe" },
  async ({ event }) => {
    return {
      ok: true,
      eventName: event.name,
      receivedAt: new Date().toISOString()
    };
  }
);

export const inngestFunctions = [syncProbe, ...orchestratorInngestFunctions];

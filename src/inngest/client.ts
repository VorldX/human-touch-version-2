import "server-only";

import { Inngest } from "inngest";

import { getInngestRuntimeConfig } from "@/src/inngest/env";

const runtimeConfig = getInngestRuntimeConfig();

export const inngest = new Inngest({
  id: runtimeConfig.appId,
  name: runtimeConfig.appName,
  ...(runtimeConfig.eventKey ? { eventKey: runtimeConfig.eventKey } : {})
});

export function inngestEmitterReady() {
  return runtimeConfig.eventKey.length > 0;
}


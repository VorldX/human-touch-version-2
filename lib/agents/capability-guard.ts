import type { CapabilityCheckResult, RuntimeAgent } from "@/lib/agents/types";

export function checkAgentCapability(input: {
  agent: RuntimeAgent;
  requiredCapabilities: string[];
  requiredTools?: string[];
}): CapabilityCheckResult {
  const missingCapabilities = input.requiredCapabilities.filter(
    (capability) => !input.agent.capabilities.includes(capability)
  );

  const missingTools = (input.requiredTools ?? []).filter(
    (tool) => !input.agent.allowedTools.includes(tool)
  );

  return {
    ok: missingCapabilities.length === 0 && missingTools.length === 0,
    missingCapabilities,
    missingTools
  };
}

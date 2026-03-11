import "server-only";

import { executeSwarmAgent } from "@/lib/ai/swarm-runtime";
import { getOrgLlmRuntime } from "@/lib/ai/org-llm-settings";
import { prisma } from "@/lib/db/prisma";
import {
  buildIntegrationConnectPath,
  ComposioServiceError,
  executeToolAction,
  getToolsForAgent
} from "@/lib/integrations/composio/service";
import {
  listRecentEmails,
  readEmail,
  searchEmails,
  sendEmail,
  type GmailEmailRecord
} from "@/lib/agent/tools/gmail";

interface AgentToolActionDefinition {
  toolSlug: string;
  toArguments: (input: Record<string, unknown>) => Record<string, unknown>;
}

const TOOL_ACTIONS: Record<string, Record<string, AgentToolActionDefinition>> = {
  gmail: {
    LIST_RECENT_EMAILS: {
      toolSlug: "GMAIL_FETCH_EMAILS",
      toArguments: (input) => {
        const limitRaw = typeof input.limit === "number" ? input.limit : Number(input.limit ?? 5);
        const limit = Number.isFinite(limitRaw)
          ? Math.min(25, Math.max(1, Math.floor(limitRaw)))
          : 5;
        const includeSpamTrash =
          input.includeSpamTrash === true || input.includeSpamTrash === "true";
        return {
          maxResults: limit,
          includeSpamTrash
        };
      }
    },
    GET_PROFILE: {
      toolSlug: "GMAIL_GET_PROFILE",
      toArguments: () => ({})
    }
  }
};

const RETRY_ATTEMPTS = 2;
const MAX_EMAIL_BODY_CHARS = 4000;

function parseBooleanEnv(name: string, fallback: boolean) {
  const raw = process.env[name];
  if (typeof raw !== "string") return fallback;
  const normalized = raw.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  return fallback;
}

const AGENT_TOOL_SUMMARY_USE_LLM = parseBooleanEnv("AGENT_TOOL_SUMMARY_USE_LLM", false);

function asText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function canonicalToolkitForCompare(toolkit: string) {
  const normalized = toolkit.trim().toLowerCase();
  if (normalized === "googlemeet" || normalized === "gmeet") {
    return "gmeet";
  }
  return normalized;
}

function toolkitMatches(left: string, right: string) {
  return canonicalToolkitForCompare(left) === canonicalToolkitForCompare(right);
}

function truncate(value: string | null | undefined, maxChars: number) {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text) return null;
  if (text.length <= maxChars) return text;
  return `${text.slice(0, Math.max(0, maxChars - 3))}...`;
}

function isTransientFailure(status: number, message: string) {
  if (status >= 500 || status === 429) {
    return true;
  }
  return /timeout|timed out|temporar|rate limit|network|econnreset|503|502|504/i.test(message);
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeLimit(value: unknown, fallback = 10) {
  const raw = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(raw)) return fallback;
  return Math.min(25, Math.max(1, Math.floor(raw)));
}

function isValidEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

function summarizeEmailLines(emails: GmailEmailRecord[]) {
  if (emails.length === 0) {
    return "No emails were found for this request.";
  }
  return emails
    .slice(0, 5)
    .map((email, index) => {
      const subject = email.subject || "(no subject)";
      const from = email.from || "unknown sender";
      const snippet = email.snippet || "";
      return `${index + 1}. ${subject} from ${from}${snippet ? ` - ${snippet}` : ""}`;
    })
    .join("\n");
}

function shouldUseLlmSummary(prompt: string) {
  if (!AGENT_TOOL_SUMMARY_USE_LLM) {
    return false;
  }
  return /\b(detailed|analy[sz]e|insight|priority|sentiment|themes?)\b/i.test(prompt);
}

const summarizerAgentSelect = {
  id: true,
  name: true,
  role: true,
  brainConfig: true,
  fallbackBrainConfig: true,
  brainKeyEnc: true,
  brainKeyIv: true,
  brainKeyAuthTag: true,
  brainKeyKeyVer: true,
  fallbackBrainKeyEnc: true,
  fallbackBrainKeyIv: true,
  fallbackBrainKeyAuthTag: true,
  fallbackBrainKeyKeyVer: true
} as const;

async function resolveSummarizerAgent(orgId: string) {
  const mainAgent =
    (await prisma.personnel.findFirst({
      where: {
        orgId,
        type: "AI",
        role: { contains: "Main", mode: "insensitive" },
        status: { not: "DISABLED" }
      },
      select: summarizerAgentSelect
    })) ??
    (await prisma.personnel.findFirst({
      where: {
        orgId,
        type: "AI",
        role: { contains: "Boss", mode: "insensitive" },
        status: { not: "DISABLED" }
      },
      select: summarizerAgentSelect
    })) ??
    (await prisma.personnel.findFirst({
      where: {
        orgId,
        type: "AI",
        status: { not: "DISABLED" }
      },
      orderBy: { updatedAt: "desc" },
      select: summarizerAgentSelect
    }));

  if (mainAgent) {
    return mainAgent;
  }

  return {
    id: "gmail-summary-agent-proxy",
    name: "Main Agent",
    role: "Gmail Summarizer",
    brainConfig: {},
    fallbackBrainConfig: {},
    brainKeyEnc: null,
    brainKeyIv: null,
    brainKeyAuthTag: null,
    brainKeyKeyVer: null,
    fallbackBrainKeyEnc: null,
    fallbackBrainKeyIv: null,
    fallbackBrainKeyAuthTag: null,
    fallbackBrainKeyKeyVer: null
  };
}

async function summarizeEmailsWithLlm(input: {
  orgId: string;
  prompt: string;
  query?: string;
  emails: GmailEmailRecord[];
}) {
  if (input.emails.length === 0) {
    return "No emails were found for this request.";
  }

  const runtime = await getOrgLlmRuntime(input.orgId);
  const agent = await resolveSummarizerAgent(input.orgId);
  const compactEmails = input.emails.slice(0, 12).map((item) => ({
    id: item.id,
    from: item.from,
    subject: item.subject,
    snippet: truncate(item.snippet, 220),
    bodyText: truncate(item.bodyText, 280),
    receivedAt: item.receivedAt
  }));

  const execution = await executeSwarmAgent({
    taskId: `gmail-summary-${Date.now()}`,
    flowId: "agent-tools",
    prompt: input.prompt,
    agent,
    contextBlocks: [
      {
        id: "gmail-summary-context",
        name: "Fetched Gmail emails",
        amnesiaProtected: false,
        content: JSON.stringify(compactEmails, null, 2)
      }
    ],
    organizationRuntime: runtime,
    systemPromptOverride: [
      "You summarize emails for a user.",
      "Be concise and factual.",
      "Return plain text, no markdown table."
    ].join("\n"),
    userPromptOverride: [
      `User request: ${input.prompt}`,
      `Search query: ${input.query?.trim() || "none"}`,
      "Summarize key updates, urgent asks, and any follow-ups."
    ].join("\n"),
    maxOutputTokens: 320
  });

  if (execution.ok && execution.outputText?.trim()) {
    return execution.outputText.trim();
  }

  return summarizeEmailLines(input.emails);
}

function safeEmailResponse(item: GmailEmailRecord) {
  return {
    id: item.id,
    from: item.from,
    to: item.to,
    subject: item.subject,
    snippet: item.snippet,
    receivedAt: item.receivedAt
  };
}

async function executeNamedGmailAction(input: {
  orgId: string;
  userId: string;
  action: string;
  arguments: Record<string, unknown>;
}) {
  const action = input.action.toUpperCase();

  if (action === "LIST_RECENT_EMAILS") {
    const limit = normalizeLimit(input.arguments.limit ?? 5, 5);
    const query = asText(input.arguments.query);
    const listed = await listRecentEmails({
      userId: input.userId,
      orgId: input.orgId,
      max: limit,
      ...(query ? { query } : {})
    });
    return {
      toolSlug: listed.toolSlug,
      data: {
        emails: listed.emails.map(safeEmailResponse),
        count: listed.emails.length,
        raw: listed.data
      } as Record<string, unknown>,
      logId: listed.logId
    };
  }

  if (action === "SEARCH_EMAILS") {
    const query = asText(input.arguments.query || input.arguments.search_query);
    if (!query) {
      throw new ComposioServiceError("query is required for SEARCH_EMAILS.", {
        code: "INVALID_TOOL_ACTION",
        status: 400
      });
    }
    const limit = normalizeLimit(input.arguments.limit ?? 10, 10);
    const listed = await searchEmails({
      userId: input.userId,
      orgId: input.orgId,
      query,
      max: limit
    });
    return {
      toolSlug: listed.toolSlug,
      data: {
        query,
        emails: listed.emails.map(safeEmailResponse),
        count: listed.emails.length,
        raw: listed.data
      } as Record<string, unknown>,
      logId: listed.logId
    };
  }

  if (action === "READ_EMAIL") {
    const messageId = asText(
      input.arguments.messageId || input.arguments.message_id || input.arguments.id
    );
    if (!messageId) {
      throw new ComposioServiceError("messageId is required for READ_EMAIL.", {
        code: "INVALID_TOOL_ACTION",
        status: 400
      });
    }
    const read = await readEmail({
      userId: input.userId,
      orgId: input.orgId,
      messageId
    });
    return {
      toolSlug: read.toolSlug,
      data: {
        email: read.email ? safeEmailResponse(read.email) : null,
        raw: read.data
      } as Record<string, unknown>,
      logId: read.logId
    };
  }

  if (action === "SEND_EMAIL") {
    const to = asText(input.arguments.to || input.arguments.recipient_email);
    const subject = asText(input.arguments.subject);
    const body = asText(input.arguments.body || input.arguments.content);
    const cc = asText(input.arguments.cc);
    const bcc = asText(input.arguments.bcc);

    if (!to || !isValidEmail(to)) {
      throw new ComposioServiceError("A valid recipient email is required.", {
        code: "INVALID_TOOL_ACTION",
        status: 400
      });
    }
    if (!subject) {
      throw new ComposioServiceError("Email subject is required.", {
        code: "INVALID_TOOL_ACTION",
        status: 400
      });
    }
    if (!body) {
      throw new ComposioServiceError("Email body is required.", {
        code: "INVALID_TOOL_ACTION",
        status: 400
      });
    }
    if (body.length > MAX_EMAIL_BODY_CHARS) {
      throw new ComposioServiceError(
        `Email body exceeds limit of ${MAX_EMAIL_BODY_CHARS} characters.`,
        { code: "INVALID_TOOL_ACTION", status: 400 }
      );
    }

    const sent = await sendEmail({
      userId: input.userId,
      orgId: input.orgId,
      to,
      subject,
      body,
      ...(cc ? { cc } : {}),
      ...(bcc ? { bcc } : {})
    });

    return {
      toolSlug: sent.toolSlug,
      data: {
        to,
        subject,
        delivered: true,
        raw: sent.data
      } as Record<string, unknown>,
      logId: sent.logId
    };
  }

  if (action === "SUMMARIZE_EMAILS") {
    const query = asText(input.arguments.query || input.arguments.search_query);
    const limit = normalizeLimit(input.arguments.limit ?? 10, 10);
    const prompt = asText(input.arguments.prompt) || "Summarize my recent emails.";
    const listed = query
      ? await searchEmails({
          userId: input.userId,
          orgId: input.orgId,
          query,
          max: limit
        })
      : await listRecentEmails({
          userId: input.userId,
          orgId: input.orgId,
          max: limit
        });

    const summary = shouldUseLlmSummary(prompt)
      ? await summarizeEmailsWithLlm({
          orgId: input.orgId,
          prompt,
          ...(query ? { query } : {}),
          emails: listed.emails
        })
      : summarizeEmailLines(listed.emails);

    return {
      toolSlug: listed.toolSlug,
      data: {
        summary,
        query,
        count: listed.emails.length,
        emails: listed.emails.map(safeEmailResponse)
      } as Record<string, unknown>,
      logId: listed.logId
    };
  }

  throw new ComposioServiceError(`Action "${action}" is not supported for Gmail.`, {
    code: "INVALID_TOOL_ACTION",
    status: 400
  });
}

async function writeAuditLog(orgId: string, message: string) {
  try {
    await prisma.log.create({
      data: {
        orgId,
        type: "EXE",
        actor: "AGENT_TOOL_EXECUTOR",
        message
      }
    });
  } catch {
    // Observability best-effort only; should not break task flow.
  }
}

function resolveActionConfig(input: {
  toolkit: string;
  action: string;
  arguments: Record<string, unknown>;
  availableSlugs: Set<string>;
}) {
  const toolkit = input.toolkit.toLowerCase();
  const normalizedAction = input.action.trim().toUpperCase().replace(/[^A-Z0-9_]+/g, "_");
  const byName = TOOL_ACTIONS[toolkit]?.[normalizedAction];
  if (byName) {
    return {
      toolSlug: byName.toolSlug,
      arguments: byName.toArguments(input.arguments)
    };
  }

  if (input.availableSlugs.has(normalizedAction)) {
    return {
      toolSlug: normalizedAction,
      arguments: input.arguments
    };
  }

  const suffixMatches = [...input.availableSlugs].filter((slug) =>
    slug.endsWith(`_${normalizedAction}`)
  );
  if (suffixMatches.length === 1) {
    return {
      toolSlug: suffixMatches[0],
      arguments: input.arguments
    };
  }

  return null;
}

export interface ExecuteAgentToolInput {
  orgId: string;
  userId: string;
  toolkit: string;
  action: string;
  arguments?: Record<string, unknown>;
  taskId?: string;
}

export type ExecuteAgentToolResult =
  | {
      ok: true;
      toolkit: string;
      action: string;
      toolSlug: string;
      data: Record<string, unknown>;
      logId: string | null;
      attempts: number;
    }
  | {
      ok: false;
      attempts: number;
      error: {
        code:
          | "INTEGRATION_NOT_CONNECTED"
          | "INVALID_TOOL_ACTION"
          | "TOOL_EXECUTION_FAILED"
          | "TOOLS_UNAVAILABLE";
        message: string;
        toolkit: string;
        action: string;
        connectUrl?: string;
        retryable?: boolean;
      };
    };

export async function executeAgentTool(input: ExecuteAgentToolInput): Promise<ExecuteAgentToolResult> {
  const toolkit = input.toolkit.trim().toLowerCase();
  const action = input.action.trim().toUpperCase();
  const args = input.arguments ?? {};
  const usesNamedGmailAction =
    toolkit === "gmail" &&
    [
      "LIST_RECENT_EMAILS",
      "GET_PROFILE",
      "SEND_EMAIL",
      "SEARCH_EMAILS",
      "READ_EMAIL",
      "SUMMARIZE_EMAILS"
    ].includes(action);

  const toolsForAgent = await getToolsForAgent({
    userId: input.userId,
    orgId: input.orgId,
    requestedToolkits: [toolkit],
    action
  });

  if (!toolsForAgent.ok && toolsForAgent.error) {
    await writeAuditLog(
      input.orgId,
      `Task ${input.taskId ?? "n/a"} blocked: integration ${toolsForAgent.error.toolkit} not connected for action ${action}.`
    );
    return {
      ok: false,
      attempts: 1,
      error: {
        code: "INTEGRATION_NOT_CONNECTED",
        message: `Toolkit "${toolsForAgent.error.toolkit}" is not connected.`,
        toolkit: toolsForAgent.error.toolkit,
        action: toolsForAgent.error.action,
        ...(toolsForAgent.error.connectUrl
          ? { connectUrl: toolsForAgent.error.connectUrl }
          : { connectUrl: buildIntegrationConnectPath(toolsForAgent.error.toolkit) })
      }
    };
  }

  const availableSlugs = new Set(
    toolsForAgent.bindings
      .filter((item) => toolkitMatches(item.toolkit, toolkit))
      .map((item) => item.slug.toUpperCase())
  );
  const actionConfig = usesNamedGmailAction
    ? null
    : resolveActionConfig({
        toolkit,
        action,
        arguments: args,
        availableSlugs
      });

  if (!usesNamedGmailAction && !actionConfig) {
    return {
      ok: false,
      attempts: 1,
      error: {
        code: "INVALID_TOOL_ACTION",
        message: `Action "${action}" is not allowed for toolkit "${toolkit}".`,
        toolkit,
        action
      }
    };
  }

  for (let attempt = 1; attempt <= RETRY_ATTEMPTS; attempt += 1) {
    try {
      if (usesNamedGmailAction) {
        if (action === "GET_PROFILE") {
          const profileResult = await executeToolAction({
            userId: input.userId,
            orgId: input.orgId,
            toolkit,
            toolSlug: "GMAIL_GET_PROFILE",
            action,
            arguments: {}
          });

          if (!profileResult.successful) {
            const message = asText(profileResult.error) || "Tool execution failed.";
            const retryable = isTransientFailure(502, message);
            if (retryable && attempt < RETRY_ATTEMPTS) {
              await sleep(200 * attempt);
              continue;
            }
            return {
              ok: false,
              attempts: attempt,
              error: {
                code: "TOOL_EXECUTION_FAILED",
                message,
                toolkit,
                action,
                retryable
              }
            };
          }

          await writeAuditLog(
            input.orgId,
            `Task ${input.taskId ?? "n/a"} tool GMAIL_GET_PROFILE executed successfully on attempt ${attempt}.`
          );
          return {
            ok: true,
            toolkit,
            action,
            toolSlug: "GMAIL_GET_PROFILE",
            data: profileResult.data,
            logId: profileResult.logId,
            attempts: attempt
          };
        }

        const namedResult = await executeNamedGmailAction({
          orgId: input.orgId,
          userId: input.userId,
          action,
          arguments: args
        });

        await writeAuditLog(
          input.orgId,
          `Task ${input.taskId ?? "n/a"} tool ${namedResult.toolSlug} executed successfully on attempt ${attempt}.`
        );

        return {
          ok: true,
          toolkit,
          action,
          toolSlug: namedResult.toolSlug,
          data: namedResult.data,
          logId: namedResult.logId,
          attempts: attempt
        };
      }

      const legacyResult = await executeToolAction({
        userId: input.userId,
        orgId: input.orgId,
        toolkit,
        toolSlug: actionConfig!.toolSlug,
        action,
        arguments: actionConfig!.arguments
      });

      if (!legacyResult.successful) {
        const message = asText(legacyResult.error) || "Tool execution failed.";
        const retryable = isTransientFailure(502, message);
        if (retryable && attempt < RETRY_ATTEMPTS) {
          await sleep(200 * attempt);
          continue;
        }
        await writeAuditLog(
          input.orgId,
          `Task ${input.taskId ?? "n/a"} tool ${actionConfig!.toolSlug} failed on attempt ${attempt}: ${message}`
        );
        return {
          ok: false,
          attempts: attempt,
          error: {
            code: "TOOL_EXECUTION_FAILED",
            message,
            toolkit,
            action,
            retryable
          }
        };
      }

      await writeAuditLog(
        input.orgId,
        `Task ${input.taskId ?? "n/a"} tool ${actionConfig!.toolSlug} executed successfully on attempt ${attempt}.`
      );

      return {
        ok: true,
        toolkit,
        action,
        toolSlug: actionConfig!.toolSlug,
        data: legacyResult.data,
        logId: legacyResult.logId,
        attempts: attempt
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Tool execution failed.";
      const status = error instanceof ComposioServiceError ? error.status : 502;
      const code =
        error instanceof ComposioServiceError ? error.code : "TOOL_EXECUTION_FAILED";

      if (code === "INTEGRATION_NOT_CONNECTED") {
        return {
          ok: false,
          attempts: attempt,
          error: {
            code: "INTEGRATION_NOT_CONNECTED",
            message,
            toolkit,
            action,
            connectUrl: buildIntegrationConnectPath(toolkit)
          }
        };
      }

      if (code === "INVALID_TOOL_ACTION") {
        return {
          ok: false,
          attempts: attempt,
          error: {
            code: "INVALID_TOOL_ACTION",
            message,
            toolkit,
            action
          }
        };
      }

      if (code === "TOOL_EXECUTION_FAILED") {
        return {
          ok: false,
          attempts: attempt,
          error: {
            code: "TOOL_EXECUTION_FAILED",
            message,
            toolkit,
            action,
            retryable: false
          }
        };
      }

      const retryable = isTransientFailure(status, message);
      if (retryable && attempt < RETRY_ATTEMPTS) {
        await sleep(200 * attempt);
        continue;
      }

      await writeAuditLog(
        input.orgId,
        `Task ${input.taskId ?? "n/a"} tool ${
          usesNamedGmailAction ? action : actionConfig?.toolSlug ?? action
        } error on attempt ${attempt}: ${message}`
      );

      return {
        ok: false,
        attempts: attempt,
        error: {
          code: "TOOLS_UNAVAILABLE",
          message,
          toolkit,
          action,
          retryable
        }
      };
    }
  }

  return {
    ok: false,
    attempts: RETRY_ATTEMPTS,
    error: {
      code: "TOOL_EXECUTION_FAILED",
      message: "Tool execution exhausted retries.",
      toolkit,
      action,
      retryable: false
    }
  };
}

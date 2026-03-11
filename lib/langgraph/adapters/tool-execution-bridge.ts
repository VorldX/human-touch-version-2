export interface ExistingToolExecutionInput {
  orgId: string;
  userId: string;
  toolkit: string;
  action: string;
  arguments?: Record<string, unknown>;
  taskId?: string;
}

export type ExistingToolExecutionResult =
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
        code: string;
        message: string;
        toolkit: string;
        action: string;
        connectUrl?: string;
        retryable?: boolean;
      };
    };

export interface ExecuteThroughExistingToolPathDependencies {
  executeFn: (input: ExistingToolExecutionInput) => Promise<ExistingToolExecutionResult>;
}

export async function executeThroughExistingToolPath(
  input: ExistingToolExecutionInput,
  dependencies: ExecuteThroughExistingToolPathDependencies
) {
  const executeFn = dependencies.executeFn;
  return executeFn(input);
}

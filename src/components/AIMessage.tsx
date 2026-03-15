"use client";

import { BRANDING } from "@/src/config/branding.js";
import { MarkdownRenderer } from "@/src/components/MarkdownRenderer";
import type {
  AssistantMessageMeta,
  WorkflowTaskCardItem,
  WorkflowTaskStatus
} from "@/src/types/chat";
import styles from "@/src/styles/human-touch.module.css";

function statusLabel(status: WorkflowTaskStatus) {
  if (status === "RUNNING") return "Running";
  if (status === "PAUSED") return "Paused";
  if (status === "COMPLETED") return "Completed";
  if (status === "FAILED") return "Failed";
  if (status === "ABORTED") return "Aborted";
  if (status === "ACTIVE") return "Active";
  if (status === "DRAFT") return "Draft";
  if (status === "QUEUED") return "Queued";
  return "Unknown";
}

function statusClass(status: WorkflowTaskStatus) {
  if (status === "RUNNING" || status === "ACTIVE") return styles.workflowStatusRunning;
  if (status === "COMPLETED") return styles.workflowStatusCompleted;
  if (status === "FAILED" || status === "ABORTED") return styles.workflowStatusFailed;
  if (status === "PAUSED") return styles.workflowStatusPaused;
  return styles.workflowStatusQueued;
}

function renderTask(task: WorkflowTaskCardItem) {
  return (
    <div key={task.id} className={styles.workflowTaskRow}>
      <span className={`${styles.workflowTaskDot} ${statusClass(task.status)}`} />
      <div className={styles.workflowTaskBody}>
        <p className={styles.workflowTaskTitle}>{task.title}</p>
        <p className={styles.workflowTaskMeta}>
          {statusLabel(task.status)}
          {task.agentLabel ? ` | ${task.agentLabel}` : ""}
        </p>
      </div>
    </div>
  );
}

function StructuredAssistantCard(input: { meta: AssistantMessageMeta }) {
  const { meta } = input;

  if (meta.kind === "plan_card") {
    return (
      <section className={styles.workflowCard}>
        <header className={styles.workflowCardHeader}>
          <p className={styles.workflowCardTitle}>{meta.title}</p>
          <span className={styles.workflowCardChip}>
            {meta.workflows.length} workflow{meta.workflows.length === 1 ? "" : "s"}
          </span>
        </header>
        {meta.summary ? <p className={styles.workflowCardSummary}>{meta.summary}</p> : null}
        {typeof meta.detailScore === "number" ? (
          <p className={styles.workflowCardMeta}>Detail score: {meta.detailScore}</p>
        ) : null}
        {meta.requiredToolkits && meta.requiredToolkits.length > 0 ? (
          <p className={styles.workflowCardMeta}>
            Tools: {meta.requiredToolkits.slice(0, 8).join(", ")}
          </p>
        ) : null}
        <div className={styles.workflowColumns}>
          {meta.workflows.map((workflow, index) => (
            <article key={`${workflow.title}-${index}`} className={styles.workflowColumn}>
              <p className={styles.workflowColumnTitle}>{workflow.title}</p>
              {workflow.goal ? <p className={styles.workflowColumnGoal}>{workflow.goal}</p> : null}
              <div className={styles.workflowTaskList}>
                {workflow.tasks.slice(0, 8).map((task) => renderTask(task))}
              </div>
            </article>
          ))}
        </div>
      </section>
    );
  }

  if (meta.kind === "workflow_graph") {
    const progressValue =
      typeof meta.progress === "number" && Number.isFinite(meta.progress)
        ? Math.max(0, Math.min(100, Math.floor(meta.progress)))
        : null;

    return (
      <section className={styles.workflowCard}>
        <header className={styles.workflowCardHeader}>
          <p className={styles.workflowCardTitle}>{meta.title}</p>
          <span className={styles.workflowCardChip}>{meta.status ?? "Unknown"}</span>
        </header>
        <p className={styles.workflowCardMeta}>
          Flow {meta.flowId.slice(0, 8)}
          {typeof meta.completedCount === "number" && typeof meta.taskCount === "number"
            ? ` | Completed ${meta.completedCount}/${meta.taskCount}`
            : ""}
        </p>
        {progressValue !== null ? (
          <div className={styles.workflowProgressTrack}>
            <div
              className={styles.workflowProgressValue}
              style={{ width: `${Math.max(2, progressValue)}%` }}
            />
          </div>
        ) : null}
        <div className={styles.workflowGraphStrip}>
          {meta.tasks.slice(0, 6).map((task, index) => (
            <div key={task.id} className={styles.workflowGraphNodeWrap}>
              <div className={`${styles.workflowGraphNode} ${statusClass(task.status)}`}>
                <p className={styles.workflowGraphNodeTitle}>{task.title}</p>
                <p className={styles.workflowGraphNodeMeta}>{statusLabel(task.status)}</p>
              </div>
              {index < Math.min(meta.tasks.length, 6) - 1 ? (
                <span className={styles.workflowGraphArrow} aria-hidden="true">
                  {"->"}
                </span>
              ) : null}
            </div>
          ))}
        </div>
        <div className={styles.workflowTaskList}>
          {meta.tasks.slice(0, 10).map((task) => renderTask(task))}
        </div>
      </section>
    );
  }

  return (
    <section className={styles.workflowEventCard}>
      <header className={styles.workflowCardHeader}>
        <p className={styles.workflowCardTitle}>{meta.title}</p>
        <span className={styles.workflowCardChip}>
          {meta.status ?? meta.eventName ?? "Update"}
        </span>
      </header>
      <p className={styles.workflowCardSummary}>{meta.message}</p>
      <p className={styles.workflowCardMeta}>
        {meta.flowId ? `Flow ${meta.flowId.slice(0, 8)}` : "Control Deck"}
        {meta.taskId ? ` | Task ${meta.taskId.slice(0, 8)}` : ""}
        {meta.agentLabel ? ` | ${meta.agentLabel}` : ""}
      </p>
    </section>
  );
}

export function AIMessage(input: {
  content: string;
  isStreaming: boolean;
  isError?: boolean;
  meta?: AssistantMessageMeta;
}) {
  if (input.isError) {
    return (
      <div className={styles.assistantWrap}>
        <span className={styles.assistantAvatar}>{BRANDING.logoFallbackInitial}</span>
        <div className={styles.errorMessage}>
          <span className={styles.errorIcon} aria-hidden="true">
            ⚠
          </span>
          <span>{input.content || "Something went wrong."}</span>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.assistantWrap}>
      <span className={styles.assistantAvatar}>{BRANDING.logoFallbackInitial}</span>
      <div className={styles.assistantContent}>
        {input.meta ? <StructuredAssistantCard meta={input.meta} /> : null}
        {input.content ? (
          <div className={styles.workflowCardText}>
            <MarkdownRenderer content={input.content} />
          </div>
        ) : !input.meta ? (
          <MarkdownRenderer content={input.isStreaming ? "" : " "} />
        ) : null}
        {input.isStreaming ? <span className={styles.cursor}>|</span> : null}
      </div>
    </div>
  );
}

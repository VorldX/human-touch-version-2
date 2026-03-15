"use client";

import { useCallback, useEffect, useRef } from "react";

import { HumanTouchApp } from "@/src/App";
import type { AssistantMessageMeta } from "@/src/types/chat";

type ControlMode = "MINDSTORM" | "DIRECTION";
type AppShellTheme = "APEX" | "VEDA" | "NEXUS";

interface DirectionTurn {
  id: string;
  role: "owner" | "organization";
  content: string;
  meta?: AssistantMessageMeta;
}

interface ControlDeckHumanTouchProps {
  mode: ControlMode;
  appTheme?: AppShellTheme;
  turns: DirectionTurn[];
  message?: { tone: "success" | "warning" | "error"; text: string } | null;
  onModeChange?: (mode: ControlMode) => void;
  onSendMessage: (message: string, mode: ControlMode) => Promise<void>;
  directionChatInFlight: boolean;
  directionPlanningInFlight: boolean;
  agentActionBusy: boolean;
  agentInputSubmitting: boolean;
  [key: string]: unknown;
}

const STREAM_DELAY_MS = 14;

function splitTokens(text: string) {
  const segments = text.match(/\S+\s*/g);
  if (!segments || segments.length === 0) {
    return [text];
  }
  return segments;
}

function delay(ms: number) {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });
}

export function ControlDeckHumanTouch(input: ControlDeckHumanTouchProps) {
  const {
    mode,
    appTheme,
    turns,
    message,
    onModeChange,
    onSendMessage,
    directionChatInFlight,
    directionPlanningInFlight,
    agentActionBusy,
    agentInputSubmitting
  } = input;
  const initializedRef = useRef(false);
  const seenAssistantTurnsRef = useRef<Set<string>>(new Set());
  const streamQueueRef = useRef<Promise<void>>(Promise.resolve());
  const disposedRef = useRef(false);
  const lastManagerMessageRef = useRef<string>("");

  const enqueueAssistantText = useCallback((content: string) => {
    streamQueueRef.current = streamQueueRef.current.then(async () => {
      if (disposedRef.current) return;
      const tokens = splitTokens(content || "");
      for (const token of tokens) {
        if (disposedRef.current) return;
        window.sendMessageToUI?.(token);
        await delay(STREAM_DELAY_MS);
      }
      if (!disposedRef.current) {
        window.completeMessageToUI?.();
      }
    });
  }, []);

  useEffect(() => {
    disposedRef.current = false;
    return () => {
      disposedRef.current = true;
    };
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;

    if (!initializedRef.current) {
      for (const turn of turns) {
        if (turn.role === "organization") {
          seenAssistantTurnsRef.current.add(turn.id);
        }
      }
      initializedRef.current = true;
      return;
    }

    const unseenTurns = turns.filter(
      (turn) => turn.role === "organization" && !seenAssistantTurnsRef.current.has(turn.id)
    );
    if (unseenTurns.length === 0) return;

    for (const turn of unseenTurns) {
      seenAssistantTurnsRef.current.add(turn.id);
      if (turn.meta && window.appendStructuredMessageToUI) {
        window.appendStructuredMessageToUI({
          content: turn.content,
          meta: turn.meta
        });
        continue;
      }
      enqueueAssistantText(turn.content);
    }
  }, [enqueueAssistantText, turns]);

  const handleUserMessage = useCallback(async (rawText: string, nextMode: ControlMode) => {
    const userMessage = rawText.trim();
    if (!userMessage) return;

    const isBusy =
      directionChatInFlight ||
      directionPlanningInFlight ||
      agentActionBusy ||
      agentInputSubmitting;

    if (isBusy) {
      window.showErrorInUI?.("Execution is in progress. Please wait for the current step to finish.");
      window.completeMessageToUI?.();
      return;
    }

    try {
      await onSendMessage(userMessage, nextMode);
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Unable to process your request.";
      window.showErrorInUI?.(errorMessage);
      window.completeMessageToUI?.();
    }
  }, [
    agentActionBusy,
    agentInputSubmitting,
    directionChatInFlight,
    directionPlanningInFlight,
    onSendMessage
  ]);

  const handleStop = useCallback(() => {
    window.completeMessageToUI?.();
  }, []);

  useEffect(() => {
    if (!message?.text) return;
    const fingerprint = `${message.tone}:${message.text}`;
    if (lastManagerMessageRef.current === fingerprint) return;
    lastManagerMessageRef.current = fingerprint;

    if (message.tone === "error") {
      window.showErrorInUI?.(message.text);
      window.completeMessageToUI?.();
    }
  }, [message]);

  return (
    <div className="h-full min-h-0">
      <HumanTouchApp
        mode={mode}
        appTheme={appTheme}
        onModeChange={onModeChange}
        onUserMessage={handleUserMessage}
        onStopGeneration={handleStop}
      />
    </div>
  );
}

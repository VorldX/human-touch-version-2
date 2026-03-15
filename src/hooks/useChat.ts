import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { AssistantMessageMeta, ChatMessage, Feedback } from "@/src/types/chat";

function messageId(prefix: "u" | "a") {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}

export function useChat(input: {
  onToast: (message: string) => void;
  onPlaySound?: () => void;
  soundEnabled: boolean;
  onUserMessage?: (text: string) => Promise<void> | void;
  onStopGeneration?: () => void;
}) {
  const onToast = input.onToast;
  const onPlaySound = input.onPlaySound;
  const soundEnabled = input.soundEnabled;
  const onUserMessage = input.onUserMessage;
  const onStopGeneration = input.onStopGeneration;
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isResponding, setIsResponding] = useState(false);
  const [streamMessageId, setStreamMessageId] = useState<string | null>(null);
  const [isWaitingFirstToken, setIsWaitingFirstToken] = useState(false);
  const streamMessageIdRef = useRef<string | null>(null);

  const setActiveStreamId = useCallback((value: string | null) => {
    streamMessageIdRef.current = value;
    setStreamMessageId(value);
  }, []);

  const appendToken = useCallback((token: string) => {
    if (!token) return;
    let targetId = streamMessageIdRef.current;
    if (!targetId) {
      targetId = messageId("a");
      setActiveStreamId(targetId);
      setMessages((prev) => [
        ...prev,
        {
          id: targetId!,
          role: "assistant",
          content: token,
          createdAt: Date.now(),
          feedback: null,
          isStreaming: true
        }
      ]);
    } else {
      const existingId = targetId;
      setMessages((prev) => {
        const hasTarget = prev.some((msg) => msg.id === existingId);
        if (!hasTarget) {
          return [
            ...prev,
            {
              id: existingId,
              role: "assistant",
              content: token,
              createdAt: Date.now(),
              feedback: null,
              isStreaming: true
            }
          ];
        }
        return prev.map((msg) =>
          msg.id === existingId
            ? {
                ...msg,
                content: `${msg.content}${token}`,
                isStreaming: true
              }
            : msg
        );
      });
    }
    setIsResponding(true);
    setIsWaitingFirstToken(false);
  }, [setActiveStreamId]);

  const completeStream = useCallback(() => {
    const activeId = streamMessageIdRef.current;
    if (!activeId) {
      setIsResponding(false);
      setIsWaitingFirstToken(false);
      return;
    }
    setMessages((prev) => {
      const target = prev.find((msg) => msg.id === activeId);
      if (!target) return prev;
      if ((target.content ?? "").trim().length === 0) {
        return prev.filter((msg) => msg.id !== activeId);
      }
      return prev.map((msg) =>
        msg.id === activeId
          ? {
              ...msg,
              isStreaming: false
            }
          : msg
      );
    });
    setIsResponding(false);
    setIsWaitingFirstToken(false);
    setActiveStreamId(null);
    if (soundEnabled) {
      onPlaySound?.();
    }
  }, [onPlaySound, setActiveStreamId, soundEnabled]);

  const showError = useCallback((message: string) => {
    const errorText = message.trim() || "Something went wrong.";
    const activeId = streamMessageIdRef.current;
    setMessages((prev) => {
      if (!activeId) {
        return [
          ...prev,
          {
            id: messageId("a"),
            role: "assistant",
            content: errorText,
            createdAt: Date.now(),
            feedback: null,
            isError: true
          }
        ];
      }
      return prev.map((msg) =>
        msg.id === activeId
          ? {
              ...msg,
              content: msg.content || errorText,
              isStreaming: false,
              isError: true
            }
          : msg
      );
    });
    setIsResponding(false);
    setIsWaitingFirstToken(false);
    setActiveStreamId(null);
  }, [setActiveStreamId]);

  const appendStructuredMessage = useCallback((payload: {
    content?: string;
    meta: AssistantMessageMeta;
  }) => {
    if (!payload?.meta) {
      return;
    }

    const content = typeof payload.content === "string" ? payload.content : "";
    const activeId = streamMessageIdRef.current;
    let mappedIntoActiveStream = false;

    setMessages((prev) => {
      if (activeId) {
        const target = prev.find((msg) => msg.id === activeId);
        if (target && (target.content ?? "").trim().length === 0) {
          mappedIntoActiveStream = true;
          return prev.map((msg) =>
            msg.id === activeId
              ? {
                  ...msg,
                  content,
                  isStreaming: false,
                  meta: payload.meta
                }
              : msg
          );
        }
      }

      return [
        ...prev,
        {
          id: messageId("a"),
          role: "assistant",
          content,
          createdAt: Date.now(),
          feedback: null,
          meta: payload.meta
        }
      ];
    });

    if (mappedIntoActiveStream) {
      setIsResponding(false);
      setIsWaitingFirstToken(false);
      setActiveStreamId(null);
    }
  }, [setActiveStreamId]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.sendMessageToUI = appendToken;
    window.completeMessageToUI = completeStream;
    window.showErrorInUI = showError;
    window.appendStructuredMessageToUI = appendStructuredMessage;

    return () => {
      if (window.sendMessageToUI === appendToken) {
        delete window.sendMessageToUI;
      }
      if (window.completeMessageToUI === completeStream) {
        delete window.completeMessageToUI;
      }
      if (window.showErrorInUI === showError) {
        delete window.showErrorInUI;
      }
      if (window.appendStructuredMessageToUI === appendStructuredMessage) {
        delete window.appendStructuredMessageToUI;
      }
    };
  }, [appendStructuredMessage, appendToken, completeStream, showError]);

  const sendUserMessage = useCallback((rawText: string) => {
    const text = rawText.trim();
    if (!text || isResponding) return;

    const userMsg: ChatMessage = {
      id: messageId("u"),
      role: "user",
      content: text,
      createdAt: Date.now(),
      feedback: null
    };
    const assistantId = messageId("a");
    const assistantMsg: ChatMessage = {
      id: assistantId,
      role: "assistant",
      content: "",
      createdAt: Date.now(),
      feedback: null,
      isStreaming: true
    };
    setMessages((prev) => [...prev, userMsg, assistantMsg]);
    setActiveStreamId(assistantId);
    setIsResponding(true);
    setIsWaitingFirstToken(true);
    const transport = onUserMessage ?? window.onUserMessage;
    if (!transport) {
      showError("Message handler is not connected.");
      return;
    }
    void Promise.resolve(transport(text)).catch((error) => {
      showError(error instanceof Error ? error.message : "Unable to send message.");
      window.completeMessageToUI?.();
    });
  }, [isResponding, onUserMessage, setActiveStreamId, showError]);

  const stopGeneration = useCallback(() => {
    const stopHandler = onStopGeneration ?? window.onStopGeneration;
    stopHandler?.();
    if (!streamMessageId) {
      setIsResponding(false);
      setIsWaitingFirstToken(false);
      return;
    }
    const activeId = streamMessageIdRef.current ?? streamMessageId;
    setMessages((prev) => {
      const target = prev.find((msg) => msg.id === activeId);
      if (!target) return prev;
      if ((target.content ?? "").trim().length === 0) {
        return prev.filter((msg) => msg.id !== activeId);
      }
      return prev.map((msg) =>
        msg.id === activeId
          ? {
              ...msg,
              isStreaming: false
            }
          : msg
      );
    });
    setIsResponding(false);
    setIsWaitingFirstToken(false);
    setActiveStreamId(null);
  }, [onStopGeneration, setActiveStreamId, streamMessageId]);

  const clearConversation = useCallback(() => {
    setMessages([]);
    setIsResponding(false);
    setIsWaitingFirstToken(false);
    setActiveStreamId(null);
    onToast("Chat cleared");
  }, [onToast, setActiveStreamId]);

  const updateFeedback = useCallback((id: string, next: Feedback) => {
    setMessages((prev) =>
      prev.map((msg) =>
        msg.id === id
          ? {
              ...msg,
              feedback: msg.feedback === next ? null : next
            }
          : msg
      )
    );
  }, []);

  const copyMessage = useCallback(async (id: string) => {
    const message = messages.find((entry) => entry.id === id);
    if (!message) return;
    try {
      await navigator.clipboard.writeText(message.content);
      onToast("Copied!");
    } catch {
      onToast("Copy failed");
    }
  }, [messages, onToast]);

  const streamActive = useMemo(
    () => messages.some((msg) => msg.role === "assistant" && msg.isStreaming),
    [messages]
  );

  return {
    messages,
    sendUserMessage,
    stopGeneration,
    clearConversation,
    copyMessage,
    updateFeedback,
    isResponding,
    streamActive,
    isWaitingFirstToken
  };
}

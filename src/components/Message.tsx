"use client";

import { useState } from "react";

import { AIMessage } from "@/src/components/AIMessage";
import { MessageActions } from "@/src/components/MessageActions";
import { UserMessage } from "@/src/components/UserMessage";
import type { ChatMessage, Feedback } from "@/src/types/chat";
import styles from "@/src/styles/human-touch.module.css";

export function Message(input: {
  message: ChatMessage;
  onCopy: (id: string) => void;
  onFeedback: (id: string, feedback: Feedback) => void;
}) {
  const [hovered, setHovered] = useState(false);
  const { message } = input;

  return (
    <div
      className={styles.messageRow}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <MessageActions
        visible={hovered}
        feedback={message.feedback}
        onCopy={() => input.onCopy(message.id)}
        onUpvote={() => input.onFeedback(message.id, "up")}
        onDownvote={() => input.onFeedback(message.id, "down")}
      />
      {message.role === "user" ? (
        <UserMessage content={message.content} />
      ) : (
        <AIMessage
          content={message.content}
          isStreaming={Boolean(message.isStreaming)}
          isError={message.isError}
          meta={message.meta}
        />
      )}
    </div>
  );
}

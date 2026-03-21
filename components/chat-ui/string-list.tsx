"use client";

import { StringItem } from "@/components/chat-ui/string-item";
import type { ChatString } from "@/components/chat-ui/types";

interface StringListProps {
  items: ChatString[];
  selectedStringId: string | null;
  onSelectString: (stringId: string) => void;
}

export function StringList({ items, selectedStringId, onSelectString }: StringListProps) {
  if (items.length === 0) {
    return (
      <div className="flex h-full items-center justify-center rounded-2xl border border-dashed border-white/10 bg-black/20 px-4 text-center text-sm text-slate-500">
        No strings found.
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {items.map((item) => (
        <StringItem
          key={item.id}
          item={item}
          selected={item.id === selectedStringId}
          onSelect={onSelectString}
        />
      ))}
    </div>
  );
}

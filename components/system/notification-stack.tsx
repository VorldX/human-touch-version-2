"use client";

import { useEffect } from "react";
import { AlertTriangle, CheckCircle2, Info, XCircle } from "lucide-react";

import { useVorldXStore } from "@/lib/store/vorldx-store";

function toneStyle(type: "info" | "success" | "warning" | "error") {
  if (type === "success") {
    return {
      border: "border-emerald-500/40",
      bg: "bg-emerald-500/10",
      text: "text-emerald-300"
    };
  }
  if (type === "warning") {
    return {
      border: "border-amber-500/40",
      bg: "bg-amber-500/10",
      text: "text-amber-300"
    };
  }
  if (type === "error") {
    return {
      border: "border-red-500/40",
      bg: "bg-red-500/10",
      text: "text-red-300"
    };
  }
  return {
    border: "border-cyan-500/40",
    bg: "bg-cyan-500/10",
    text: "text-cyan-300"
  };
}

function ToneIcon({ type }: { type: "info" | "success" | "warning" | "error" }) {
  if (type === "success") return <CheckCircle2 size={15} />;
  if (type === "warning") return <AlertTriangle size={15} />;
  if (type === "error") return <XCircle size={15} />;
  return <Info size={15} />;
}

export function NotificationStack() {
  const notifications = useVorldXStore((state) => state.notifications);
  const dismissNotification = useVorldXStore((state) => state.dismissNotification);

  useEffect(() => {
    if (notifications.length === 0) {
      return;
    }

    const timers = notifications.map((notification) =>
      window.setTimeout(() => dismissNotification(notification.id), 6000)
    );

    return () => {
      timers.forEach((timer) => window.clearTimeout(timer));
    };
  }, [dismissNotification, notifications]);

  if (notifications.length === 0) {
    return null;
  }

  return (
    <div className="pointer-events-none fixed right-4 top-28 z-[70] flex w-[360px] max-w-[calc(100vw-2rem)] flex-col gap-2">
      {notifications.slice(-5).map((notification) => {
        const style = toneStyle(notification.type);
        return (
          <button
            key={notification.id}
            onClick={() => dismissNotification(notification.id)}
            className={`pointer-events-auto rounded-2xl border ${style.border} ${style.bg} p-3 text-left shadow-vx transition hover:opacity-90`}
          >
            <div className={`mb-1 inline-flex items-center gap-2 text-[10px] uppercase tracking-[0.2em] ${style.text}`}>
              <ToneIcon type={notification.type} />
              {notification.type}
            </div>
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-100">
              {notification.title}
            </p>
            <p className="mt-1 text-xs text-slate-300">{notification.message}</p>
          </button>
        );
      })}
    </div>
  );
}


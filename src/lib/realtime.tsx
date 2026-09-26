import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import type { Message, RealtimeEvent } from "@shared/types";

type Status = "connecting" | "open" | "closed";
const RealtimeContext = createContext<Status>("closed");

export function useRealtimeStatus(): Status {
  return useContext(RealtimeContext);
}

interface MessagePage {
  messages: Message[];
  hasMore: boolean;
}

/** Merge a created/updated message into the cached conversation, if loaded. */
export function applyMessageEvent(qc: QueryClient, message: Message) {
  qc.setQueryData<MessagePage>(["messages", message.conversationId], (prev) => {
    if (!prev) return prev;
    const idx = prev.messages.findIndex((m) => m.id === message.id);
    if (idx >= 0) {
      const next = prev.messages.slice();
      next[idx] = message;
      return { ...prev, messages: next };
    }
    return { ...prev, messages: [...prev.messages, message] };
  });
}

/**
 * Keeps one authenticated WebSocket to the ClubRealtime Durable Object and
 * folds incoming events into the TanStack Query cache. D1 remains the source
 * of truth: after any reconnect, conversations are refetched.
 */
export function RealtimeProvider({ enabled, children }: { enabled: boolean; children: ReactNode }) {
  const qc = useQueryClient();
  const [status, setStatus] = useState<Status>("closed");
  const retry = useRef(0);

  useEffect(() => {
    if (!enabled || typeof WebSocket === "undefined") return;
    let ws: WebSocket | null = null;
    let ping: ReturnType<typeof setInterval> | undefined;
    let reconnect: ReturnType<typeof setTimeout> | undefined;
    let stopped = false;

    const connect = () => {
      if (stopped) return;
      setStatus("connecting");
      const url = `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/api/realtime`;
      ws = new WebSocket(url);
      ws.onopen = () => {
        retry.current = 0;
        setStatus("open");
        ping = setInterval(() => ws?.readyState === WebSocket.OPEN && ws.send("ping"), 25_000);
        // Catch up on anything missed while disconnected.
        void qc.invalidateQueries({ queryKey: ["conversations"] });
        void qc.invalidateQueries({ queryKey: ["messages"] });
      };
      ws.onmessage = (e) => {
        let event: RealtimeEvent;
        try {
          event = JSON.parse(String(e.data)) as RealtimeEvent;
        } catch {
          return;
        }
        switch (event.type) {
          case "message.created":
          case "message.updated":
            applyMessageEvent(qc, event.message);
            void qc.invalidateQueries({ queryKey: ["conversations"] });
            void qc.invalidateQueries({ queryKey: ["dashboard"] });
            break;
          case "conversation.created":
            void qc.invalidateQueries({ queryKey: ["conversations"] });
            break;
          case "notification.created":
            void qc.invalidateQueries({ queryKey: ["notifications"] });
            break;
        }
      };
      ws.onclose = (e) => {
        clearInterval(ping);
        setStatus("closed");
        if (stopped) return;
        if (e.code === 4001) {
          // Session ended on the server (sign-out elsewhere / password reset).
          void qc.invalidateQueries({ queryKey: ["session"] });
          return;
        }
        const delay = Math.min(30_000, 1000 * 2 ** retry.current++);
        reconnect = setTimeout(connect, delay + Math.random() * 500);
      };
    };

    connect();
    const onOnline = () => {
      if (!ws || ws.readyState === WebSocket.CLOSED) {
        clearTimeout(reconnect);
        retry.current = 0;
        connect();
      }
    };
    window.addEventListener("online", onOnline);
    return () => {
      stopped = true;
      window.removeEventListener("online", onOnline);
      clearInterval(ping);
      clearTimeout(reconnect);
      ws?.close(1000, "bye");
    };
  }, [enabled, qc]);

  return <RealtimeContext.Provider value={status}>{children}</RealtimeContext.Provider>;
}

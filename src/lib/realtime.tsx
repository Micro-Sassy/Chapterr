import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { useNavigate } from "react-router";
import type { Message, Page, RealtimeEvent } from "@shared/types";
import { useToast } from "@/components/ui/Toast";

type Status = "connecting" | "open" | "closed";
const RealtimeContext = createContext<Status>("closed");

export function useRealtimeStatus(): Status {
  return useContext(RealtimeContext);
}

/**
 * Merge a created/updated message into the cached live page of its
 * conversation (chronological order within the page), if that page is loaded.
 */
export function applyMessageEvent(qc: QueryClient, message: Message) {
  qc.setQueryData<Page<Message>>(["messages", message.conversationId], (prev) => {
    if (!prev) return prev;
    const idx = prev.items.findIndex((m) => m.id === message.id);
    if (idx >= 0) {
      const items = prev.items.slice();
      items[idx] = message;
      return { ...prev, items };
    }
    return { ...prev, items: [...prev.items, message] };
  });
}

/**
 * Keeps one authenticated WebSocket to the realtime Durable Object of the club
 * in the URL, reconnecting when the club changes, and folds incoming events into
 * the TanStack Query cache. No socket is held outside club routes. D1 remains the
 * source of truth: after any reconnect, conversations are refetched.
 */
export function RealtimeProvider({ clubId, children }: { clubId: string | null; children: ReactNode }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const toast = useToast();
  const [status, setStatus] = useState<Status>("closed");
  const retry = useRef(0);

  useEffect(() => {
    if (!clubId || typeof WebSocket === "undefined") {
      setStatus("closed");
      return;
    }
    let ws: WebSocket | null = null;
    let ping: ReturnType<typeof setInterval> | undefined;
    let reconnect: ReturnType<typeof setTimeout> | undefined;
    let stopped = false;
    retry.current = 0;

    const connect = () => {
      if (stopped) return;
      setStatus("connecting");
      const url = `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/api/clubs/${encodeURIComponent(clubId)}/realtime`;
      ws = new WebSocket(url);
      ws.onopen = () => {
        retry.current = 0;
        setStatus("open");
        ping = setInterval(() => ws?.readyState === WebSocket.OPEN && ws.send("ping"), 25_000);
        // Catch up on anything missed while disconnected.
        void qc.invalidateQueries({ queryKey: ["conversations", clubId] });
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
            void qc.invalidateQueries({ queryKey: ["conversations", clubId] });
            void qc.invalidateQueries({ queryKey: ["club-dashboard", clubId] });
            void qc.invalidateQueries({ queryKey: ["home"] });
            break;
          case "conversation.created":
            void qc.invalidateQueries({ queryKey: ["conversations", clubId] });
            break;
          case "notification.created":
            void qc.invalidateQueries({ queryKey: ["notifications"] });
            break;
          case "club.updated":
            void qc.invalidateQueries({ queryKey: ["club", event.clubId] });
            void qc.invalidateQueries({ queryKey: ["club-dashboard", event.clubId] });
            void qc.invalidateQueries({ queryKey: ["club-members", event.clubId] });
            void qc.invalidateQueries({ queryKey: ["me"] });
            void qc.invalidateQueries({ queryKey: ["home"] });
            break;
          case "membership.ended":
            stopped = true;
            void qc.invalidateQueries({ queryKey: ["me"] });
            void qc.invalidateQueries({ queryKey: ["home"] });
            qc.removeQueries({ queryKey: ["club", event.clubId] });
            toast("You are no longer a member of that club.");
            navigate("/", { replace: true });
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
        if (e.code === 4003) {
          // Membership ended: the server closes the socket after membership.ended.
          void qc.invalidateQueries({ queryKey: ["me"] });
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
  }, [clubId, qc, navigate, toast]);

  return <RealtimeContext.Provider value={status}>{children}</RealtimeContext.Provider>;
}

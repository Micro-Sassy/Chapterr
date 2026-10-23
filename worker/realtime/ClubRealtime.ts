import { DurableObject } from "cloudflare:workers";
import type { RealtimeEvent } from "../../shared/types";
import type { Env } from "../env";

interface SocketAttachment {
  userId: string;
  /** Epoch ms when the authenticating session expires; the socket is dropped after it. */
  expiresAt: number;
}

/**
 * One Durable Object instance per club (named `club:<clubId>`) holds the live
 * WebSocket connections of that club's members using the Hibernation API. It
 * never reads or decides permissions itself: the Worker authenticates the
 * socket and checks membership before handing it over, and the Worker decides
 * which user ids receive each event after persisting the authoritative data
 * in D1.
 */
export class ClubRealtime extends DurableObject<Env> {
  async fetch(request: Request): Promise<Response> {
    if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
      return new Response("Expected WebSocket", { status: 426 });
    }
    // These headers are set by the Worker after it validated the session;
    // the Durable Object is not reachable from the internet directly.
    const userId = request.headers.get("x-chapterr-user-id");
    const sessionId = request.headers.get("x-chapterr-session-id");
    const clubId = request.headers.get("x-chapterr-club-id");
    const expiresAt = Number(request.headers.get("x-chapterr-session-expires"));
    if (!userId || !sessionId || !clubId || !Number.isFinite(expiresAt)) return new Response("Unauthorized", { status: 401 });

    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];
    this.ctx.acceptWebSocket(server, [`user:${userId}`, `session:${sessionId}`]);
    const attachment: SocketAttachment = { userId, expiresAt };
    server.serializeAttachment(attachment);
    server.send(JSON.stringify({ type: "hello", userId, clubId } satisfies RealtimeEvent));
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    if (!this.isLive(ws)) return;
    // Clients only send keep-alive pings; all writes go through the HTTP API.
    if (message === "ping") ws.send(JSON.stringify({ type: "pong" } satisfies RealtimeEvent));
  }

  async webSocketClose(ws: WebSocket, code: number): Promise<void> {
    try {
      ws.close(code === 1005 ? 1000 : code, "closing");
    } catch {
      // already closed
    }
  }

  async webSocketError(ws: WebSocket): Promise<void> {
    try {
      ws.close(1011, "error");
    } catch {
      // ignore
    }
  }

  /** RPC: deliver an event to specific users, or to everyone connected when userIds is "all". */
  async publish(userIds: string[] | "all", event: RealtimeEvent): Promise<number> {
    const payload = JSON.stringify(event);
    const sockets =
      userIds === "all" ? this.ctx.getWebSockets() : Array.from(new Set(userIds)).flatMap((id) => this.ctx.getWebSockets(`user:${id}`));
    let delivered = 0;
    for (const ws of sockets) {
      if (!this.isLive(ws)) continue;
      try {
        ws.send(payload);
        delivered++;
      } catch {
        // socket went away; hibernation API cleans it up
      }
    }
    return delivered;
  }

  /** RPC: close every socket belonging to a user (removed from the club, sign-out everywhere, password reset). */
  async disconnectUser(userId: string): Promise<void> {
    for (const ws of this.ctx.getWebSockets(`user:${userId}`)) {
      try {
        ws.close(4001, "session ended");
      } catch {
        // ignore
      }
    }
  }

  /** RPC: close sockets opened with a specific session (sign-out, revoked session). */
  async disconnectSession(sessionId: string): Promise<void> {
    for (const ws of this.ctx.getWebSockets(`session:${sessionId}`)) {
      try {
        ws.close(4001, "session ended");
      } catch {
        // ignore
      }
    }
  }

  /** RPC (tests/diagnostics): number of open sockets for a user. */
  async connectionCount(userId: string): Promise<number> {
    return this.ctx.getWebSockets(`user:${userId}`).length;
  }

  private isLive(ws: WebSocket): boolean {
    const att = ws.deserializeAttachment() as SocketAttachment | null;
    if (!att || att.expiresAt < Date.now()) {
      try {
        ws.close(4001, "session expired");
      } catch {
        // ignore
      }
      return false;
    }
    return true;
  }
}

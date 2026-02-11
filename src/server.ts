import type { ServerWebSocket } from "bun";
import type { WebSocketData } from "./types";
import { handleMessage, handleDisconnect } from "./protocol/handler";
import { cleanupRateLimits } from "./middleware/rateLimit";
import { error as logError } from "./logger";

export interface ServerConfig {
  port: number;
  hostname?: string;
  tls?: {
    keyPath: string;
    certPath: string;
  };
  allowedOrigins?: string[];
}

export function createServer(config: ServerConfig) {
  const tlsConfig = config.tls
    ? {
        key: Bun.file(config.tls.keyPath),
        cert: Bun.file(config.tls.certPath),
      }
    : undefined;

  // Periodic cleanup of rate limits
  setInterval(cleanupRateLimits, 60000);

  const server = Bun.serve<WebSocketData>({
    port: config.port,
    hostname: config.hostname || "0.0.0.0",
    tls: tlsConfig,

    fetch(req, server) {
      // Upgrade HTTP request to WebSocket
      const url = new URL(req.url);

      if (url.pathname === "/health") {
        return new Response("OK", { status: 200 });
      }

      // Validate origin if allowedOrigins is configured
      if (config.allowedOrigins && config.allowedOrigins.length > 0) {
        const origin = req.headers.get("origin");
        if (!origin || !config.allowedOrigins.includes(origin)) {
          logError("HTTP", `Invalid origin rejected (origin: ${origin ?? "missing"}, url: ${req.url})`);
          return new Response("Forbidden: Invalid origin", { status: 403 });
        }
      }

      const success = server.upgrade(req, {
        data: {
          sessionToken: null,
          username: null,
        },
      });

      if (success) {
        return undefined;
      }

      logError("HTTP", `WebSocket upgrade failed (url: ${req.url})`);
      return new Response("WebSocket upgrade failed", { status: 400 });
    },

    websocket: {
      open(ws: ServerWebSocket<WebSocketData>) {
        console.log(`[WebSocket] New connection`);
      },

      async message(ws: ServerWebSocket<WebSocketData>, message: string | Buffer) {
        const msgStr = typeof message === "string" ? message : message.toString();

        try {
          await handleMessage(ws, msgStr);
        } catch (err) {
          logError("WebSocket", `Error handling message (user: ${ws.data.username ?? "anonymous"}, preview: ${msgStr.slice(0, 100)})`, err);
          ws.send(
            JSON.stringify({
              type: "error",
              code: "INTERNAL_ERROR",
              message: "An internal error occurred",
            })
          );
        }
      },

      close(ws: ServerWebSocket<WebSocketData>, code: number, reason: string) {
        console.log(
          `[WebSocket] Connection closed: ${ws.data.username || "anonymous"} (${code}: ${reason})`
        );
        handleDisconnect(ws);
      },

      error(ws: ServerWebSocket<WebSocketData>, err: Error) {
        logError("WebSocket", `Connection error (user: ${ws.data.username ?? "anonymous"})`, err);
      },

      // Enable compression
      perMessageDeflate: true,

      // Max message size (1MB)
      maxPayloadLength: 1024 * 1024,

      // Idle timeout (5 minutes)
      idleTimeout: 300,
    },
  });

  return server;
}

/**
 * Gracefully shut down the server.
 */
export async function shutdownServer(server: ReturnType<typeof Bun.serve>): Promise<void> {
  console.log("[Server] Closing server...");
  
  // Stop accepting new connections
  server.stop();
  
  console.log("[Server] Server stopped");
}

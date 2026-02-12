import { createServer, shutdownServer } from "./server";
import { stopSessionCleanup } from "./auth/session";
import { stopInviteCleanup } from "./lobby/invite";
import { info as logInfo, error as logError } from "./logger";

// Configuration from environment variables
const PORT = parseInt(process.env.PORT || "3000", 10);
const HOSTNAME = process.env.SERVER_HOST || "0.0.0.0";
const TLS_KEY_PATH = process.env.TLS_KEY_PATH || "./certs/key.pem";
const TLS_CERT_PATH = process.env.TLS_CERT_PATH || "./certs/cert.pem";
const USE_TLS = process.env.USE_TLS !== "false";

async function main() {
  logInfo("Startup", "Starting Battleship Server...");
  logInfo("Startup", `Port: ${PORT}`);
  logInfo("Startup", `Hostname: ${HOSTNAME}`);
  logInfo("Startup", `TLS: ${USE_TLS ? "enabled" : "disabled"}`);

  // Check for TLS certificates if TLS is enabled
  if (USE_TLS) {
    const keyFile = Bun.file(TLS_KEY_PATH);
    const certFile = Bun.file(TLS_CERT_PATH);

    if (!(await keyFile.exists()) || !(await certFile.exists())) {
      logError(
        "Startup",
        `TLS certificates not found (key: ${TLS_KEY_PATH}, cert: ${TLS_CERT_PATH}). Generate with: openssl req -x509 -newkey rsa:4096 -keyout ${TLS_KEY_PATH} -out ${TLS_CERT_PATH} -days 365 -nodes -subj "/CN=localhost" or set USE_TLS=false`
      );
      process.exit(1);
    }
  }

  const server = createServer({
    port: PORT,
    hostname: HOSTNAME,
    tls: USE_TLS
      ? {
          keyPath: TLS_KEY_PATH,
          certPath: TLS_CERT_PATH,
        }
      : undefined,
  });

  const protocol = USE_TLS ? "wss" : "ws";
  logInfo("Startup", `Server running at ${protocol}://${HOSTNAME}:${PORT}`);
  logInfo("Startup", `Health check at: ${USE_TLS ? "https" : "http"}://localhost:${PORT}/health`);
  logInfo("Startup", "Press Ctrl+C to stop");

  // Handle graceful shutdown
  const shutdown = async (signal: string) => {
    logInfo("Shutdown", `${signal} received, shutting down gracefully...`);

    // Stop accepting new connections and close existing ones
    await shutdownServer(server);

    // Stop cleanup intervals
    stopSessionCleanup();
    stopInviteCleanup();

    logInfo("Shutdown", "Server shut down successfully");
    process.exit(0);
  };

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}

main().catch((err) => {
  logError("Startup", "Failed to start server", err);
  process.exit(1);
});

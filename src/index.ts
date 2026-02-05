import { createServer, shutdownServer } from "./server";
import { stopSessionCleanup } from "./auth/session";
import { stopInviteCleanup } from "./lobby/invite";

// Configuration from environment variables
const PORT = parseInt(process.env.PORT || "3000", 10);
const HOSTNAME = process.env.HOSTNAME || "0.0.0.0";
const TLS_KEY_PATH = process.env.TLS_KEY_PATH || "./certs/key.pem";
const TLS_CERT_PATH = process.env.TLS_CERT_PATH || "./certs/cert.pem";
const USE_TLS = process.env.USE_TLS !== "false";

async function main() {
  console.log("Starting Battleship Server...");
  console.log(`Port: ${PORT}`);
  console.log(`Hostname: ${HOSTNAME}`);
  console.log(`TLS: ${USE_TLS ? "enabled" : "disabled"}`);

  // Check for TLS certificates if TLS is enabled
  if (USE_TLS) {
    const keyFile = Bun.file(TLS_KEY_PATH);
    const certFile = Bun.file(TLS_CERT_PATH);

    if (!(await keyFile.exists()) || !(await certFile.exists())) {
      console.error("\nTLS certificates not found!");
      console.error("Please generate certificates with:");
      console.error(
        `  openssl req -x509 -newkey rsa:4096 -keyout ${TLS_KEY_PATH} -out ${TLS_CERT_PATH} -days 365 -nodes -subj "/CN=localhost"`
      );
      console.error("\nOr disable TLS by setting USE_TLS=false");
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
  console.log(`\nServer running at ${protocol}://${HOSTNAME}:${PORT}`);
  console.log("Health check at: http://localhost:" + PORT + "/health");
  console.log("\nPress Ctrl+C to stop");

  // Handle graceful shutdown
  const shutdown = async (signal: string) => {
    console.log(`\n${signal} received, shutting down gracefully...`);

    // Stop accepting new connections and close existing ones
    await shutdownServer(server);

    // Stop cleanup intervals
    stopSessionCleanup();
    stopInviteCleanup();

    console.log("Server shut down successfully");
    process.exit(0);
  };

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}

main().catch((error) => {
  console.error("Failed to start server:", error);
  process.exit(1);
});

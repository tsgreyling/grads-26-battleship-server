# Multi-platform: build with buildx for linux/amd64 + linux/arm64 (Mac) support.
# Example: docker buildx build --platform linux/amd64,linux/arm64 -t your-registry/battleship-server:latest --push .
FROM oven/bun:1-slim

RUN groupadd --system --gid 1001 bship && \
    useradd --system --uid 1001 --gid bship --create-home bship

WORKDIR /app

COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production

COPY tsconfig.json ./
COPY src/ ./src/

RUN mkdir -p /app/certs && chown -R bship:bship /app

USER bship

ENV PORT=3000
ENV SERVER_HOST=0.0.0.0
ENV USE_TLS=false
ENV TLS_KEY_PATH=/app/certs/key.pem
ENV TLS_CERT_PATH=/app/certs/cert.pem

EXPOSE 3000

# Use PORT so healthcheck matches Render (PORT=10000) and any runtime port
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD bun --eval "const port = process.env.PORT || '3000'; const r = await fetch('http://127.0.0.1:' + port + '/health').catch(() => null); process.exit(r && r.status === 200 ? 0 : 1);"

CMD ["bun", "run", "src/index.ts"]

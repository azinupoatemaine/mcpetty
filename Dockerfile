FROM node:lts-alpine AS builder
WORKDIR /app
RUN apk add --no-cache python3 make g++
COPY package*.json ./
RUN npm install
COPY . .
RUN npm run build

FROM node:lts-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=1234

# ── Subprocess MCP binaries ────────────────────────────────────────────────────
# Only needed for 'http' or 'stdio' transport entries in src/lib/mcp-catalog.ts.
# Native MCPs (wikijs, portainer, etc.) run as code inside the app — nothing here.

# Dashboard
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public

RUN mkdir -p /app/data
VOLUME ["/app/data"]

EXPOSE 1234
CMD ["node", "server.js"]

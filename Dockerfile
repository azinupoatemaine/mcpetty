FROM node:22-alpine AS builder
WORKDIR /app
RUN apk add --no-cache python3 make g++
COPY package*.json ./
RUN npm install
COPY . .

# Build metadata. The image is always tagged :latest (main) or :<branch>, so the tag cannot
# tell you which commit is running — this can. NEXT_PUBLIC_* is inlined by `next build` at
# build time, not read at runtime, so these must be set before the build step.
#
# Declared after COPY . . deliberately: the ENV invalidates every layer below it, and the
# source copy already changes on every commit, so nothing extra is lost. npm install stays
# cached above.
ARG BUILD_SHA=""
ARG BUILD_TIME=""
ARG BUILD_REF=""
ENV NEXT_PUBLIC_BUILD_SHA=$BUILD_SHA \
    NEXT_PUBLIC_BUILD_TIME=$BUILD_TIME \
    NEXT_PUBLIC_BUILD_REF=$BUILD_REF

RUN npm run build

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=1234

RUN apk add --no-cache tini

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
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "server.js"]

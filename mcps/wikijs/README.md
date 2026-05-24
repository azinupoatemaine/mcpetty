# wikijs-mcp

Runs inside the MCPetty container. Installed via `npm install -g wikijs-mcp` in the main Dockerfile.
Started by `start.sh` on container boot, listening on 127.0.0.1:8000.

## Required env vars (set in Portainer stack)

- `WIKIJS_URL` — your WikiJS instance URL
- `WIKIJS_API_KEY` — WikiJS API key

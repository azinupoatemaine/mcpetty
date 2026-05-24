export interface CatalogCredential {
  key:         string
  label:       string
  description: string
  type:        'url' | 'secret' | 'text'
  required:    boolean
}

export interface CatalogEntry {
  id:          string
  name:        string
  description: string
  builtin?:    boolean   // hides from Library, managed via Settings
  // 'native'     — handler runs as code inside MCPetty
  // 'http'       — subprocess listening on an internal HTTP port
  // 'stdio'      — subprocess speaking JSON-RPC over stdin/stdout
  // 'http-proxy' — proxies to an external MCP HTTP endpoint (credentials: MCP_URL + MCP_TOKEN)
  transport:   'native' | 'http' | 'stdio' | 'http-proxy'
  credentials: CatalogCredential[]
  // http / stdio only
  command?:      string
  // args support {{CRED_KEY}} placeholders — replaced with decrypted credential at spawn time
  args?:         string[]
  internalPort?: number       // http only
  transportEnv?: Record<string, string>  // extra env vars for the subprocess
}

// ─── Add new MCPs here ────────────────────────────────────────────────────────
// native  → add handler in src/lib/native/ and register in src/lib/native/index.ts
// http    → add `RUN npm install -g <package>` to Dockerfile
// stdio   → add binary download to Dockerfile

export const CATALOG: CatalogEntry[] = [
  {
    id:          'wikijs',
    name:        'WikiJS',
    description: 'Full WikiJS management — pages, users, and groups.',
    transport:   'native',
    credentials: [
      { key: 'WIKIJS_URL',     label: 'WikiJS URL', description: 'Base URL of your WikiJS instance',      type: 'url',    required: true },
      { key: 'WIKIJS_API_KEY', label: 'API Key',    description: 'WikiJS API token (Admin → API Access)', type: 'secret', required: true },
    ],
  },
  {
    id:          'portainer',
    name:        'Portainer',
    description: 'Manage Docker environments, stacks, and containers.',
    transport:   'native',
    credentials: [
      { key: 'PORTAINER_URL',   label: 'Portainer URL', description: 'e.g. http://10.10.10.1:9000', type: 'url',    required: true },
      { key: 'PORTAINER_TOKEN', label: 'API Token',     description: 'Admin API token from Portainer Settings → API', type: 'secret', required: true },
    ],
  },
  {
    id:          'karakeep',
    name:        'Karakeep',
    description: 'Bookmark manager — save, search, tag, and organise links and text.',
    transport:   'native',
    credentials: [
      { key: 'KARAKEEP_API_ADDR', label: 'Server URL', description: 'Base URL of your Karakeep instance e.g. http://192.168.1.10:3000', type: 'url',    required: true },
      { key: 'KARAKEEP_API_KEY',  label: 'API Key',    description: 'API key from Karakeep Settings → API Keys',                        type: 'secret', required: true },
    ],
  },
  {
    id:          'proxmox',
    name:        'Proxmox VE',
    description: 'Manage VMs, containers, snapshots, backups, and storage on Proxmox VE.',
    transport:   'native',
    credentials: [
      { key: 'PROXMOX_URL',         label: 'Proxmox URL',  description: 'Base URL e.g. https://192.168.1.100:8006',             type: 'url',    required: true },
      { key: 'PROXMOX_USER',        label: 'User',         description: 'API token owner e.g. root@pam or user@pve',            type: 'text',   required: true },
      { key: 'PROXMOX_TOKEN_NAME',  label: 'Token Name',   description: 'API token ID e.g. mytoken (Settings → API Tokens)',    type: 'text',   required: true },
      { key: 'PROXMOX_TOKEN_VALUE', label: 'Token Secret', description: 'API token secret UUID shown once at creation',         type: 'secret', required: true },
    ],
  },
  {
    id:          'wazuh',
    name:        'Wazuh',
    description: 'Security monitoring — agents, alerts, vulnerabilities, SCA, FIM, and active response.',
    transport:   'native',
    credentials: [
      { key: 'WAZUH_URL',           label: 'Wazuh API URL',      description: 'Wazuh manager REST API e.g. http://192.168.1.x:55000',  type: 'url',    required: true  },
      { key: 'WAZUH_USER',          label: 'API Username',        description: 'Wazuh API user e.g. wazuh or admin',                    type: 'text',   required: true  },
      { key: 'WAZUH_PASS',          label: 'API Password',        description: 'Password for the Wazuh API user',                       type: 'secret', required: true  },
      { key: 'WAZUH_INDEXER_URL',   label: 'Indexer URL',         description: 'Wazuh Indexer (OpenSearch) e.g. http://192.168.1.x:9200 — required for alerts and vulnerabilities', type: 'url',    required: false },
      { key: 'WAZUH_INDEXER_USER',  label: 'Indexer Username',    description: 'Indexer user (defaults to WAZUH_USER if blank)',         type: 'text',   required: false },
      { key: 'WAZUH_INDEXER_PASS',  label: 'Indexer Password',    description: 'Indexer password (defaults to WAZUH_PASS if blank)',     type: 'secret', required: false },
    ],
  },
  {
    id:          'homeassistant',
    name:        'Home Assistant',
    description: 'Control smart home devices, automations, and services.',
    transport:   'http-proxy',
    credentials: [
      { key: 'MCP_URL',   label: 'MCP Endpoint', description: 'e.g. http://192.168.99.2:8123/api/mcp', type: 'url',    required: true },
      { key: 'MCP_TOKEN', label: 'Bearer Token',  description: 'Long-Lived Access Token from HA Profile → Security', type: 'secret', required: true },
    ],
  },
  {
    id:          'mcpetty',
    name:        'MCPetty Meta',
    description: 'Read-only access to MCPetty itself — installed MCPs, call history, error patterns, and session data.',
    transport:   'native',
    builtin:     true,
    credentials: [],
  },
]

export function findCatalogEntry(id: string): CatalogEntry | undefined {
  return CATALOG.find((e) => e.id === id)
}

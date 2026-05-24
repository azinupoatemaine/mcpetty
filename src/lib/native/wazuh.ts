import { getCredential } from '../db'
import type { MCPTool } from '../mcp-client'
import { restFetch } from './http'

// ─── Tools ────────────────────────────────────────────────────────────────────

export const TOOLS: MCPTool[] = [
  // ── Manager ──────────────────────────────────────────────────────────────────
  {
    name: 'get_manager_info',
    description: 'Get Wazuh manager version, hostname, and build info.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'get_manager_status',
    description: 'Get the running status of all Wazuh manager daemons.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'get_manager_logs',
    description: 'Get recent Wazuh manager logs. Optionally filter by log level.',
    inputSchema: {
      type: 'object',
      properties: {
        level: { type: 'string', enum: ['info', 'error', 'warning', 'debug'], description: 'Log level filter' },
        limit: { type: 'number', description: 'Max entries (default 100)' },
      },
    },
  },
  {
    name: 'get_manager_stats',
    description: 'Get Wazuh manager event processing statistics.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'get_manager_configuration',
    description: 'Get the running Wazuh manager configuration (ossec.conf).',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'restart_manager',
    description: 'Restart the Wazuh manager process. Use only after configuration changes.',
    inputSchema: { type: 'object', properties: {} },
  },
  // ── Cluster ──────────────────────────────────────────────────────────────────
  {
    name: 'get_cluster_status',
    description: 'Get Wazuh cluster status — whether cluster is enabled and running.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'get_cluster_nodes',
    description: 'List all nodes in the Wazuh cluster with their types and status.',
    inputSchema: {
      type: 'object',
      properties: {
        type: { type: 'string', enum: ['master', 'worker'], description: 'Filter by node type' },
      },
    },
  },
  {
    name: 'get_cluster_healthcheck',
    description: 'Get detailed cluster health — connection status and sync info for each node.',
    inputSchema: { type: 'object', properties: {} },
  },
  // ── Agents ───────────────────────────────────────────────────────────────────
  {
    name: 'list_agents',
    description: 'List all registered Wazuh agents with their status, OS, and version.',
    inputSchema: {
      type: 'object',
      properties: {
        status:  { type: 'string', enum: ['active', 'pending', 'never_connected', 'disconnected'], description: 'Filter by connection status' },
        limit:   { type: 'number', description: 'Max agents to return (default 500)' },
        search:  { type: 'string', description: 'Search agents by name or IP' },
        os_type: { type: 'string', description: 'Filter by OS type e.g. linux, windows' },
      },
    },
  },
  {
    name: 'get_agent',
    description: 'Get detailed info for a specific Wazuh agent — IP, OS, version, last keepalive.',
    inputSchema: {
      type: 'object',
      properties: {
        agent_id: { type: 'string', description: 'Agent ID e.g. 001' },
      },
      required: ['agent_id'],
    },
  },
  {
    name: 'get_agent_key',
    description: 'Get the registration key for a Wazuh agent. Useful for re-enrolling an agent.',
    inputSchema: {
      type: 'object',
      properties: {
        agent_id: { type: 'string', description: 'Agent ID' },
      },
      required: ['agent_id'],
    },
  },
  {
    name: 'get_agents_summary',
    description: 'Get a count summary of agents by status: active, disconnected, never_connected, pending.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'get_outdated_agents',
    description: 'List agents running an outdated Wazuh agent version.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'restart_agent',
    description: 'Restart a specific Wazuh agent.',
    inputSchema: {
      type: 'object',
      properties: {
        agent_id: { type: 'string', description: 'Agent ID to restart' },
      },
      required: ['agent_id'],
    },
  },
  {
    name: 'restart_all_agents',
    description: 'Restart all active Wazuh agents.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'add_agent',
    description: 'Register a new Wazuh agent. Returns the agent ID and registration key.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Agent name (hostname)' },
        ip:   { type: 'string', description: 'Agent IP address, or "any" for dynamic IPs' },
      },
      required: ['name'],
    },
  },
  // ── Groups ───────────────────────────────────────────────────────────────────
  {
    name: 'list_groups',
    description: 'List all Wazuh agent groups.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'get_group_agents',
    description: 'List agents belonging to a specific group.',
    inputSchema: {
      type: 'object',
      properties: {
        group_id: { type: 'string', description: 'Group name e.g. default' },
      },
      required: ['group_id'],
    },
  },
  {
    name: 'add_agent_to_group',
    description: 'Add a Wazuh agent to a group.',
    inputSchema: {
      type: 'object',
      properties: {
        agent_id: { type: 'string', description: 'Agent ID' },
        group_id: { type: 'string', description: 'Group name' },
      },
      required: ['agent_id', 'group_id'],
    },
  },
  {
    name: 'remove_agent_from_group',
    description: 'Remove a Wazuh agent from a group (returns the agent to the default group).',
    inputSchema: {
      type: 'object',
      properties: {
        agent_id: { type: 'string', description: 'Agent ID' },
        group_id: { type: 'string', description: 'Group name' },
      },
      required: ['agent_id', 'group_id'],
    },
  },
  // ── Rules ─────────────────────────────────────────────────────────────────────
  {
    name: 'list_rules',
    description: 'List Wazuh detection rules, optionally filtered by group, level, or search term.',
    inputSchema: {
      type: 'object',
      properties: {
        group:  { type: 'string', description: 'Rule group e.g. sshd, web, windows' },
        level:  { type: 'number', description: 'Minimum rule level (1-15)' },
        search: { type: 'string', description: 'Search in rule descriptions' },
        limit:  { type: 'number', description: 'Max rules to return (default 100)' },
      },
    },
  },
  {
    name: 'get_rule',
    description: 'Get a specific Wazuh detection rule by ID.',
    inputSchema: {
      type: 'object',
      properties: {
        rule_id: { type: 'number', description: 'Rule ID e.g. 5710' },
      },
      required: ['rule_id'],
    },
  },
  {
    name: 'list_rule_groups',
    description: 'List all Wazuh rule group names.',
    inputSchema: { type: 'object', properties: {} },
  },
  // ── Decoders ─────────────────────────────────────────────────────────────────
  {
    name: 'list_decoders',
    description: 'List Wazuh log decoders with optional name search.',
    inputSchema: {
      type: 'object',
      properties: {
        search: { type: 'string', description: 'Filter by decoder name' },
        limit:  { type: 'number', description: 'Max decoders to return (default 100)' },
      },
    },
  },
  {
    name: 'get_decoder',
    description: 'Get details for a specific Wazuh log decoder by name.',
    inputSchema: {
      type: 'object',
      properties: {
        decoder_name: { type: 'string', description: 'Decoder name e.g. sshd' },
      },
      required: ['decoder_name'],
    },
  },
  // ── SCA ───────────────────────────────────────────────────────────────────────
  {
    name: 'get_sca_policies',
    description: 'List Security Configuration Assessment (SCA) policies for an agent.',
    inputSchema: {
      type: 'object',
      properties: {
        agent_id: { type: 'string', description: 'Agent ID' },
      },
      required: ['agent_id'],
    },
  },
  {
    name: 'get_sca_results',
    description: 'Get SCA result summary for a policy on an agent — pass/fail/not_applicable counts.',
    inputSchema: {
      type: 'object',
      properties: {
        agent_id:  { type: 'string', description: 'Agent ID' },
        policy_id: { type: 'string', description: 'SCA policy ID e.g. cis_debian10' },
      },
      required: ['agent_id', 'policy_id'],
    },
  },
  {
    name: 'get_sca_checks',
    description: 'Get individual SCA check results for a policy on an agent, optionally filtered by result.',
    inputSchema: {
      type: 'object',
      properties: {
        agent_id:  { type: 'string', description: 'Agent ID' },
        policy_id: { type: 'string', description: 'SCA policy ID' },
        result:    { type: 'string', enum: ['passed', 'failed', 'not_applicable'], description: 'Filter by check result' },
      },
      required: ['agent_id', 'policy_id'],
    },
  },
  // ── Syscollector ─────────────────────────────────────────────────────────────
  {
    name: 'get_agent_hardware',
    description: 'Get hardware inventory for an agent — CPU model, RAM, board info.',
    inputSchema: {
      type: 'object',
      properties: { agent_id: { type: 'string', description: 'Agent ID' } },
      required: ['agent_id'],
    },
  },
  {
    name: 'get_agent_os',
    description: 'Get OS inventory for an agent — distribution, kernel version, hostname.',
    inputSchema: {
      type: 'object',
      properties: { agent_id: { type: 'string', description: 'Agent ID' } },
      required: ['agent_id'],
    },
  },
  {
    name: 'get_agent_packages',
    description: 'Get installed software packages for an agent.',
    inputSchema: {
      type: 'object',
      properties: {
        agent_id: { type: 'string', description: 'Agent ID' },
        search:   { type: 'string', description: 'Filter packages by name' },
        limit:    { type: 'number', description: 'Max packages to return (default 100)' },
      },
      required: ['agent_id'],
    },
  },
  {
    name: 'get_agent_processes',
    description: 'Get running processes on an agent.',
    inputSchema: {
      type: 'object',
      properties: {
        agent_id: { type: 'string', description: 'Agent ID' },
        search:   { type: 'string', description: 'Filter processes by name' },
        limit:    { type: 'number', description: 'Max processes to return (default 100)' },
      },
      required: ['agent_id'],
    },
  },
  {
    name: 'get_agent_ports',
    description: 'Get open network ports on an agent.',
    inputSchema: {
      type: 'object',
      properties: {
        agent_id: { type: 'string', description: 'Agent ID' },
        protocol: { type: 'string', enum: ['tcp', 'udp'], description: 'Filter by protocol' },
      },
      required: ['agent_id'],
    },
  },
  {
    name: 'get_agent_hotfixes',
    description: 'Get installed Windows hotfixes/patches for an agent.',
    inputSchema: {
      type: 'object',
      properties: { agent_id: { type: 'string', description: 'Agent ID' } },
      required: ['agent_id'],
    },
  },
  {
    name: 'get_agent_network',
    description: 'Get network interface configuration for an agent — IPs, MACs, MTU.',
    inputSchema: {
      type: 'object',
      properties: { agent_id: { type: 'string', description: 'Agent ID' } },
      required: ['agent_id'],
    },
  },
  // ── FIM / Syscheck ────────────────────────────────────────────────────────────
  {
    name: 'get_fim_files',
    description: 'Get FIM (File Integrity Monitoring) database for an agent — monitored file hashes and metadata.',
    inputSchema: {
      type: 'object',
      properties: {
        agent_id: { type: 'string', description: 'Agent ID' },
        search:   { type: 'string', description: 'Filter by file path' },
        limit:    { type: 'number', description: 'Max files to return (default 100)' },
      },
      required: ['agent_id'],
    },
  },
  {
    name: 'get_fim_last_scan',
    description: 'Get the timestamp of the last FIM scan for an agent.',
    inputSchema: {
      type: 'object',
      properties: { agent_id: { type: 'string', description: 'Agent ID' } },
      required: ['agent_id'],
    },
  },
  {
    name: 'run_fim_scan',
    description: 'Trigger an immediate FIM scan on an agent.',
    inputSchema: {
      type: 'object',
      properties: { agent_id: { type: 'string', description: 'Agent ID' } },
      required: ['agent_id'],
    },
  },
  // ── Alerts (Wazuh Indexer) ────────────────────────────────────────────────────
  {
    name: 'search_alerts',
    description: 'Search Wazuh alerts with an Elasticsearch query string. Requires WAZUH_INDEXER_URL.',
    inputSchema: {
      type: 'object',
      properties: {
        query:     { type: 'string', description: 'Elasticsearch query string e.g. "rule.level:>=10 AND agent.name:webserver"' },
        size:      { type: 'number', description: 'Max results (default 50)' },
        sort_desc: { type: 'boolean', description: 'Sort newest first (default true)' },
      },
      required: ['query'],
    },
  },
  {
    name: 'get_recent_alerts',
    description: 'Get the most recent Wazuh alerts across all agents. Requires WAZUH_INDEXER_URL.',
    inputSchema: {
      type: 'object',
      properties: {
        size:  { type: 'number', description: 'Number of alerts to return (default 50)' },
        hours: { type: 'number', description: 'Look back this many hours (default 24)' },
      },
    },
  },
  {
    name: 'get_alerts_by_agent',
    description: 'Get recent alerts for a specific agent by hostname. Requires WAZUH_INDEXER_URL.',
    inputSchema: {
      type: 'object',
      properties: {
        agent_name: { type: 'string', description: 'Agent hostname' },
        size:       { type: 'number', description: 'Max results (default 50)' },
        hours:      { type: 'number', description: 'Look back this many hours (default 24)' },
      },
      required: ['agent_name'],
    },
  },
  {
    name: 'get_alerts_by_rule',
    description: 'Get alerts triggered by a specific rule ID. Requires WAZUH_INDEXER_URL.',
    inputSchema: {
      type: 'object',
      properties: {
        rule_id: { type: 'string', description: 'Rule ID e.g. 5710' },
        size:    { type: 'number', description: 'Max results (default 50)' },
        hours:   { type: 'number', description: 'Look back this many hours (default 24)' },
      },
      required: ['rule_id'],
    },
  },
  {
    name: 'get_critical_alerts',
    description: 'Get high-severity alerts (rule level >= 12) from the Indexer. Requires WAZUH_INDEXER_URL.',
    inputSchema: {
      type: 'object',
      properties: {
        size:  { type: 'number', description: 'Max results (default 50)' },
        hours: { type: 'number', description: 'Look back this many hours (default 24)' },
      },
    },
  },
  // ── Vulnerabilities (Wazuh Indexer) ──────────────────────────────────────────
  {
    name: 'get_vulnerabilities',
    description: 'Get all detected vulnerabilities across all agents. Requires WAZUH_INDEXER_URL.',
    inputSchema: {
      type: 'object',
      properties: {
        size: { type: 'number', description: 'Max results (default 100)' },
      },
    },
  },
  {
    name: 'get_vulnerabilities_by_agent',
    description: 'Get vulnerabilities detected on a specific agent by hostname. Requires WAZUH_INDEXER_URL.',
    inputSchema: {
      type: 'object',
      properties: {
        agent_name: { type: 'string', description: 'Agent hostname' },
        size:       { type: 'number', description: 'Max results (default 100)' },
      },
      required: ['agent_name'],
    },
  },
  {
    name: 'get_critical_vulnerabilities',
    description: 'Get critical or high severity CVEs from the Indexer. Requires WAZUH_INDEXER_URL.',
    inputSchema: {
      type: 'object',
      properties: {
        severity: { type: 'string', enum: ['Critical', 'High', 'Medium'], description: 'Severity level (default Critical)' },
        size:     { type: 'number', description: 'Max results (default 100)' },
      },
    },
  },
  // ── Active Response ───────────────────────────────────────────────────────────
  {
    name: 'ar_block_ip',
    description: 'Block a source IP on one or all agents using firewall-drop. The IP is dropped at the OS firewall level.',
    inputSchema: {
      type: 'object',
      properties: {
        ip:         { type: 'string', description: 'IP address to block' },
        agent_ids:  { type: 'string', description: 'Comma-separated agent IDs e.g. "001,002", or "all" for all agents' },
      },
      required: ['ip', 'agent_ids'],
    },
  },
  {
    name: 'ar_unblock_ip',
    description: 'Remove an IP block previously set by ar_block_ip (firewall-drop delete action).',
    inputSchema: {
      type: 'object',
      properties: {
        ip:        { type: 'string', description: 'IP address to unblock' },
        agent_ids: { type: 'string', description: 'Comma-separated agent IDs, or "all"' },
      },
      required: ['ip', 'agent_ids'],
    },
  },
  {
    name: 'ar_isolate_host',
    description: 'Isolate a host from the network using the host-isolation active response.',
    inputSchema: {
      type: 'object',
      properties: {
        agent_ids: { type: 'string', description: 'Comma-separated agent IDs to isolate, or "all"' },
      },
      required: ['agent_ids'],
    },
  },
  {
    name: 'ar_kill_process',
    description: 'Kill a process by PID on one or all agents.',
    inputSchema: {
      type: 'object',
      properties: {
        pid:       { type: 'number', description: 'Process ID to kill' },
        agent_ids: { type: 'string', description: 'Comma-separated agent IDs, or "all"' },
      },
      required: ['pid', 'agent_ids'],
    },
  },
  {
    name: 'ar_disable_account',
    description: 'Disable a user account on one or all agents.',
    inputSchema: {
      type: 'object',
      properties: {
        username:  { type: 'string', description: 'Username to disable' },
        agent_ids: { type: 'string', description: 'Comma-separated agent IDs, or "all"' },
      },
      required: ['username', 'agent_ids'],
    },
  },
  {
    name: 'ar_enable_account',
    description: 'Re-enable a user account previously disabled by ar_disable_account.',
    inputSchema: {
      type: 'object',
      properties: {
        username:  { type: 'string', description: 'Username to enable' },
        agent_ids: { type: 'string', description: 'Comma-separated agent IDs, or "all"' },
      },
      required: ['username', 'agent_ids'],
    },
  },
  {
    name: 'ar_quarantine_file',
    description: 'Quarantine a file on one or all agents.',
    inputSchema: {
      type: 'object',
      properties: {
        filepath:  { type: 'string', description: 'Absolute path to the file to quarantine' },
        agent_ids: { type: 'string', description: 'Comma-separated agent IDs, or "all"' },
      },
      required: ['filepath', 'agent_ids'],
    },
  },
  {
    name: 'ar_deny_host',
    description: 'Add a source IP to hosts.deny on one or all agents.',
    inputSchema: {
      type: 'object',
      properties: {
        ip:        { type: 'string', description: 'IP address to deny' },
        agent_ids: { type: 'string', description: 'Comma-separated agent IDs, or "all"' },
      },
      required: ['ip', 'agent_ids'],
    },
  },
  {
    name: 'ar_undeny_host',
    description: 'Remove an IP from hosts.deny previously added by ar_deny_host.',
    inputSchema: {
      type: 'object',
      properties: {
        ip:        { type: 'string', description: 'IP address to remove from hosts.deny' },
        agent_ids: { type: 'string', description: 'Comma-separated agent IDs, or "all"' },
      },
      required: ['ip', 'agent_ids'],
    },
  },
  {
    name: 'ar_restart_wazuh_agent',
    description: 'Restart the Wazuh agent service on one or all agents via active response.',
    inputSchema: {
      type: 'object',
      properties: {
        agent_ids: { type: 'string', description: 'Comma-separated agent IDs, or "all"' },
      },
      required: ['agent_ids'],
    },
  },
]

// ─── Credentials ──────────────────────────────────────────────────────────────

interface WazuhCfg {
  base:     string
  user:     string
  pass:     string
  idxBase:  string | null
  idxUser:  string
  idxPass:  string
}

function cfg(instanceId: string): WazuhCfg {
  const url  = getCredential(instanceId, 'WAZUH_URL')
  const user = getCredential(instanceId, 'WAZUH_USER')
  const pass = getCredential(instanceId, 'WAZUH_PASS')
  if (!url || !user || !pass) throw new Error('Wazuh credentials not configured. Set WAZUH_URL, WAZUH_USER, and WAZUH_PASS.')
  const idxUrl = getCredential(instanceId, 'WAZUH_INDEXER_URL')
  return {
    base:    url.replace(/\/$/, ''),
    user,
    pass,
    idxBase: idxUrl?.replace(/\/$/, '') ?? null,
    idxUser: getCredential(instanceId, 'WAZUH_INDEXER_USER') ?? user,
    idxPass: getCredential(instanceId, 'WAZUH_INDEXER_PASS') ?? pass,
  }
}

function requireIdx(c: WazuhCfg): { idxBase: string; idxUser: string; idxPass: string } {
  if (!c.idxBase) throw new Error('Wazuh Indexer URL not configured. Set WAZUH_INDEXER_URL for alert/vulnerability queries.')
  return { idxBase: c.idxBase, idxUser: c.idxUser, idxPass: c.idxPass }
}

// ─── JWT cache ────────────────────────────────────────────────────────────────

const jwtCache = new Map<string, { token: string; expiry: number }>()

async function getJWT(instanceId: string, base: string, user: string, pass: string): Promise<string> {
  const cached = jwtCache.get(instanceId)
  if (cached && cached.expiry > Date.now() + 60_000) return cached.token

  const b64  = Buffer.from(`${user}:${pass}`).toString('base64')
  const res  = await restFetch<{ data: { token: string } }>(
    base, '/security/user/authenticate', b64, 'Authorization', 'Basic',
    { method: 'POST' },
  )
  const token = res.data.token
  jwtCache.set(instanceId, { token, expiry: Date.now() + 14 * 60 * 1000 })
  return token
}

// ─── REST helper (JWT Bearer) ─────────────────────────────────────────────────

async function wz<T>(
  instanceId: string,
  base:       string,
  user:       string,
  pass:       string,
  path:       string,
  init?:      RequestInit,
): Promise<T> {
  const token = await getJWT(instanceId, base, user, pass)
  return restFetch<T>(base, path, token, 'Authorization', 'Bearer', init)
}

// ─── Indexer helper (Basic auth + POST) ───────────────────────────────────────

async function idx<T>(
  idxBase:  string,
  idxUser:  string,
  idxPass:  string,
  index:    string,
  body:     unknown,
): Promise<T> {
  const b64 = Buffer.from(`${idxUser}:${idxPass}`).toString('base64')
  return restFetch<T>(
    idxBase, `/${index}/_search`, b64, 'Authorization', 'Basic',
    { method: 'POST', body: JSON.stringify(body) },
  )
}

// ─── Active response helper ───────────────────────────────────────────────────

function safeAgentIds(ids: string): string {
  if (ids === 'all') return 'all'
  if (!/^\d+(,\d+)*$/.test(ids)) throw new Error(`Invalid agent_ids: "${ids}". Use comma-separated numeric IDs (e.g. "001,002") or "all".`)
  return ids
}

async function ar(
  instanceId: string,
  base:       string,
  user:       string,
  pass:       string,
  agentIds:   string,
  command:    string,
  args_:      string[],
): Promise<unknown> {
  const qs = agentIds === 'all' ? '' : `?agents_list=${encodeURIComponent(agentIds)}`
  return wz(instanceId, base, user, pass, `/active-response${qs}`, {
    method: 'PUT',
    body:   JSON.stringify({ command, arguments: args_ }),
  })
}

// ─── Input validation ─────────────────────────────────────────────────────────

function safeSeg(value: unknown, name: string): string {
  const s = String(value ?? '').trim()
  if (!s || /[/?#]/.test(s)) throw new Error(`Invalid ${name}: "${s}"`)
  return encodeURIComponent(s)
}

// ─── Ping (connectivity check) ────────────────────────────────────────────────

export async function ping(instanceId: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const { base, user, pass } = cfg(instanceId)
    await getJWT(instanceId, base, user, pass)
    await wz(instanceId, base, user, pass, '/manager/info')
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Unknown error' }
  }
}

// ─── Tool handler ─────────────────────────────────────────────────────────────

export async function call(
  instanceId: string,
  toolName:   string,
  args:       Record<string, unknown>,
): Promise<unknown> {
  const c = cfg(instanceId)
  const { base, user, pass } = c

  switch (toolName) {

    // ── Manager ────────────────────────────────────────────────────────────────

    case 'get_manager_info':
      return wz(instanceId, base, user, pass, '/manager/info')

    case 'get_manager_status':
      return wz(instanceId, base, user, pass, '/manager/status')

    case 'get_manager_logs': {
      const qs = new URLSearchParams({ limit: String(args.limit ?? 100) })
      if (args.level) qs.set('level', String(args.level))
      return wz(instanceId, base, user, pass, `/manager/logs?${qs}`)
    }

    case 'get_manager_stats':
      return wz(instanceId, base, user, pass, '/manager/stats')

    case 'get_manager_configuration':
      return wz(instanceId, base, user, pass, '/manager/configuration')

    case 'restart_manager':
      return wz(instanceId, base, user, pass, '/manager/restart', { method: 'PUT' })

    // ── Cluster ────────────────────────────────────────────────────────────────

    case 'get_cluster_status':
      return wz(instanceId, base, user, pass, '/cluster/status')

    case 'get_cluster_nodes': {
      const qs = args.type ? `?type=${encodeURIComponent(String(args.type))}` : ''
      return wz(instanceId, base, user, pass, `/cluster/nodes${qs}`)
    }

    case 'get_cluster_healthcheck':
      return wz(instanceId, base, user, pass, '/cluster/healthcheck')

    // ── Agents ─────────────────────────────────────────────────────────────────

    case 'list_agents': {
      const qs = new URLSearchParams({ limit: String(args.limit ?? 500) })
      if (args.status)  qs.set('status', String(args.status))
      if (args.search)  qs.set('search', String(args.search))
      if (args.os_type) qs.set('q', `os.type=${args.os_type}`)
      return wz(instanceId, base, user, pass, `/agents?${qs}`)
    }

    case 'get_agent':
      return wz(instanceId, base, user, pass, `/agents?agents_list=${safeSeg(args.agent_id, 'agent_id')}`)

    case 'get_agent_key':
      return wz(instanceId, base, user, pass, `/agents/${safeSeg(args.agent_id, 'agent_id')}/key`)

    case 'get_agents_summary':
      return wz(instanceId, base, user, pass, '/agents/summary/status')

    case 'get_outdated_agents':
      return wz(instanceId, base, user, pass, '/agents/outdated')

    case 'restart_agent':
      return wz(instanceId, base, user, pass, `/agents/${safeSeg(args.agent_id, 'agent_id')}/restart`, { method: 'PUT' })

    case 'restart_all_agents':
      return wz(instanceId, base, user, pass, '/agents/restart', { method: 'PUT' })

    case 'add_agent': {
      const body: Record<string, string> = { name: String(args.name) }
      if (args.ip) body.ip = String(args.ip)
      return wz(instanceId, base, user, pass, '/agents', { method: 'POST', body: JSON.stringify(body) })
    }

    // ── Groups ─────────────────────────────────────────────────────────────────

    case 'list_groups':
      return wz(instanceId, base, user, pass, '/groups')

    case 'get_group_agents':
      return wz(instanceId, base, user, pass, `/groups/${safeSeg(args.group_id, 'group_id')}/agents`)

    case 'add_agent_to_group':
      return wz(instanceId, base, user, pass,
        `/agents/${safeSeg(args.agent_id, 'agent_id')}/group/${safeSeg(args.group_id, 'group_id')}`,
        { method: 'PUT' },
      )

    case 'remove_agent_from_group':
      return wz(instanceId, base, user, pass,
        `/agents/${safeSeg(args.agent_id, 'agent_id')}/group/${safeSeg(args.group_id, 'group_id')}`,
        { method: 'DELETE' },
      )

    // ── Rules ──────────────────────────────────────────────────────────────────

    case 'list_rules': {
      const qs = new URLSearchParams({ limit: String(args.limit ?? 100) })
      if (args.group)  qs.set('group', String(args.group))
      if (args.level)  qs.set('level', String(args.level))
      if (args.search) qs.set('search', String(args.search))
      return wz(instanceId, base, user, pass, `/rules?${qs}`)
    }

    case 'get_rule':
      return wz(instanceId, base, user, pass, `/rules?rule_ids=${Number(args.rule_id)}`)

    case 'list_rule_groups':
      return wz(instanceId, base, user, pass, '/rules/groups')

    // ── Decoders ───────────────────────────────────────────────────────────────

    case 'list_decoders': {
      const qs = new URLSearchParams({ limit: String(args.limit ?? 100) })
      if (args.search) qs.set('search', String(args.search))
      return wz(instanceId, base, user, pass, `/decoders?${qs}`)
    }

    case 'get_decoder':
      return wz(instanceId, base, user, pass, `/decoders?name=${encodeURIComponent(String(args.decoder_name))}`)

    // ── SCA ────────────────────────────────────────────────────────────────────

    case 'get_sca_policies':
      return wz(instanceId, base, user, pass, `/sca/${safeSeg(args.agent_id, 'agent_id')}`)

    case 'get_sca_results':
      return wz(instanceId, base, user, pass,
        `/sca/${safeSeg(args.agent_id, 'agent_id')}/results/${safeSeg(args.policy_id, 'policy_id')}`,
      )

    case 'get_sca_checks': {
      const qs = args.result ? `?result=${encodeURIComponent(String(args.result))}` : ''
      return wz(instanceId, base, user, pass,
        `/sca/${safeSeg(args.agent_id, 'agent_id')}/checks/${safeSeg(args.policy_id, 'policy_id')}${qs}`,
      )
    }

    // ── Syscollector ───────────────────────────────────────────────────────────

    case 'get_agent_hardware':
      return wz(instanceId, base, user, pass, `/syscollector/${safeSeg(args.agent_id, 'agent_id')}/hardware`)

    case 'get_agent_os':
      return wz(instanceId, base, user, pass, `/syscollector/${safeSeg(args.agent_id, 'agent_id')}/os`)

    case 'get_agent_packages': {
      const qs = new URLSearchParams({ limit: String(args.limit ?? 100) })
      if (args.search) qs.set('search', String(args.search))
      return wz(instanceId, base, user, pass, `/syscollector/${safeSeg(args.agent_id, 'agent_id')}/packages?${qs}`)
    }

    case 'get_agent_processes': {
      const qs = new URLSearchParams({ limit: String(args.limit ?? 100) })
      if (args.search) qs.set('search', String(args.search))
      return wz(instanceId, base, user, pass, `/syscollector/${safeSeg(args.agent_id, 'agent_id')}/processes?${qs}`)
    }

    case 'get_agent_ports': {
      const qs = args.protocol ? `?protocol=${encodeURIComponent(String(args.protocol))}` : ''
      return wz(instanceId, base, user, pass, `/syscollector/${safeSeg(args.agent_id, 'agent_id')}/ports${qs}`)
    }

    case 'get_agent_hotfixes':
      return wz(instanceId, base, user, pass, `/syscollector/${safeSeg(args.agent_id, 'agent_id')}/hotfixes`)

    case 'get_agent_network':
      return wz(instanceId, base, user, pass, `/syscollector/${safeSeg(args.agent_id, 'agent_id')}/netiface`)

    // ── FIM / Syscheck ─────────────────────────────────────────────────────────

    case 'get_fim_files': {
      const qs = new URLSearchParams({ limit: String(args.limit ?? 100) })
      if (args.search) qs.set('search', String(args.search))
      return wz(instanceId, base, user, pass, `/syscheck/${safeSeg(args.agent_id, 'agent_id')}?${qs}`)
    }

    case 'get_fim_last_scan':
      return wz(instanceId, base, user, pass, `/syscheck/${safeSeg(args.agent_id, 'agent_id')}/last_scan`)

    case 'run_fim_scan':
      return wz(instanceId, base, user, pass, `/syscheck/${safeSeg(args.agent_id, 'agent_id')}`, { method: 'PUT' })

    // ── Alerts (Indexer) ───────────────────────────────────────────────────────

    case 'search_alerts': {
      const { idxBase, idxUser, idxPass } = requireIdx(c)
      const body = {
        size:  args.size ?? 50,
        sort:  [{ '@timestamp': { order: args.sort_desc === false ? 'asc' : 'desc' } }],
        query: { query_string: { query: String(args.query) } },
      }
      return idx(idxBase, idxUser, idxPass, 'wazuh-alerts-*', body)
    }

    case 'get_recent_alerts': {
      const { idxBase, idxUser, idxPass } = requireIdx(c)
      const body = {
        size:  args.size ?? 50,
        sort:  [{ '@timestamp': { order: 'desc' } }],
        query: { range: { '@timestamp': { gte: `now-${Number(args.hours ?? 24)}h` } } },
      }
      return idx(idxBase, idxUser, idxPass, 'wazuh-alerts-*', body)
    }

    case 'get_alerts_by_agent': {
      const { idxBase, idxUser, idxPass } = requireIdx(c)
      const body = {
        size:  args.size ?? 50,
        sort:  [{ '@timestamp': { order: 'desc' } }],
        query: {
          bool: {
            must: [
              { match: { 'agent.name': String(args.agent_name) } },
              { range: { '@timestamp': { gte: `now-${Number(args.hours ?? 24)}h` } } },
            ],
          },
        },
      }
      return idx(idxBase, idxUser, idxPass, 'wazuh-alerts-*', body)
    }

    case 'get_alerts_by_rule': {
      const { idxBase, idxUser, idxPass } = requireIdx(c)
      const body = {
        size:  args.size ?? 50,
        sort:  [{ '@timestamp': { order: 'desc' } }],
        query: {
          bool: {
            must: [
              { match: { 'rule.id': String(args.rule_id) } },
              { range: { '@timestamp': { gte: `now-${Number(args.hours ?? 24)}h` } } },
            ],
          },
        },
      }
      return idx(idxBase, idxUser, idxPass, 'wazuh-alerts-*', body)
    }

    case 'get_critical_alerts': {
      const { idxBase, idxUser, idxPass } = requireIdx(c)
      const body = {
        size:  args.size ?? 50,
        sort:  [{ '@timestamp': { order: 'desc' } }],
        query: {
          bool: {
            must: [
              { range: { 'rule.level': { gte: 12 } } },
              { range: { '@timestamp': { gte: `now-${Number(args.hours ?? 24)}h` } } },
            ],
          },
        },
      }
      return idx(idxBase, idxUser, idxPass, 'wazuh-alerts-*', body)
    }

    // ── Vulnerabilities (Indexer) ──────────────────────────────────────────────

    case 'get_vulnerabilities': {
      const { idxBase, idxUser, idxPass } = requireIdx(c)
      const body = {
        size:  args.size ?? 100,
        sort:  [{ '@timestamp': { order: 'desc' } }],
        query: { match_all: {} },
      }
      return idx(idxBase, idxUser, idxPass, 'wazuh-states-vulnerabilities-*', body)
    }

    case 'get_vulnerabilities_by_agent': {
      const { idxBase, idxUser, idxPass } = requireIdx(c)
      const body = {
        size:  args.size ?? 100,
        query: { match: { 'agent.name': String(args.agent_name) } },
      }
      return idx(idxBase, idxUser, idxPass, 'wazuh-states-vulnerabilities-*', body)
    }

    case 'get_critical_vulnerabilities': {
      const { idxBase, idxUser, idxPass } = requireIdx(c)
      const body = {
        size:  args.size ?? 100,
        query: { match: { 'vulnerability.severity': String(args.severity ?? 'Critical') } },
      }
      return idx(idxBase, idxUser, idxPass, 'wazuh-states-vulnerabilities-*', body)
    }

    // ── Active Response ────────────────────────────────────────────────────────

    case 'ar_block_ip':
      return ar(instanceId, base, user, pass,
        safeAgentIds(String(args.agent_ids)),
        '!firewall-drop',
        ['-srcip', String(args.ip)],
      )

    case 'ar_unblock_ip':
      return ar(instanceId, base, user, pass,
        safeAgentIds(String(args.agent_ids)),
        '!firewall-drop',
        ['delete', '-srcip', String(args.ip)],
      )

    case 'ar_isolate_host':
      return ar(instanceId, base, user, pass,
        safeAgentIds(String(args.agent_ids)),
        '!host-isolation',
        [],
      )

    case 'ar_kill_process':
      return ar(instanceId, base, user, pass,
        safeAgentIds(String(args.agent_ids)),
        '!kill-process',
        [String(Number(args.pid))],
      )

    case 'ar_disable_account':
      return ar(instanceId, base, user, pass,
        safeAgentIds(String(args.agent_ids)),
        '!disable-account',
        [String(args.username)],
      )

    case 'ar_enable_account':
      return ar(instanceId, base, user, pass,
        safeAgentIds(String(args.agent_ids)),
        '!enable-account',
        [String(args.username)],
      )

    case 'ar_quarantine_file':
      return ar(instanceId, base, user, pass,
        safeAgentIds(String(args.agent_ids)),
        '!quarantine',
        [String(args.filepath)],
      )

    case 'ar_deny_host':
      return ar(instanceId, base, user, pass,
        safeAgentIds(String(args.agent_ids)),
        '!host-deny',
        ['-srcip', String(args.ip)],
      )

    case 'ar_undeny_host':
      return ar(instanceId, base, user, pass,
        safeAgentIds(String(args.agent_ids)),
        '!host-deny',
        ['delete', '-srcip', String(args.ip)],
      )

    case 'ar_restart_wazuh_agent':
      return ar(instanceId, base, user, pass,
        safeAgentIds(String(args.agent_ids)),
        '!restart-wazuh',
        [],
      )

    default:
      throw new Error(`Unknown Wazuh tool: ${toolName}`)
  }
}

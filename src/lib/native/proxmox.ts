import { getCredential } from '../db'
import type { MCPTool } from '../mcp-client'
import { restFetch } from './http'

// ─── Tools ────────────────────────────────────────────────────────────────────

export const TOOLS: MCPTool[] = [
  // Cluster & Nodes
  { name: 'get_cluster_status',     description: 'Get Proxmox cluster health, quorum, and HA status.',                                                                                           inputSchema: { type: 'object', properties: {} } },
  { name: 'get_nodes',              description: 'List all nodes with status, CPU, and memory.',                                                                                                  inputSchema: { type: 'object', properties: {} } },
  { name: 'get_node_status',        description: 'Get detailed status for a specific node.',                                                                                                      inputSchema: { type: 'object', properties: { node: { type: 'string', description: 'Node name (e.g. pve)' } }, required: ['node'] } },
  { name: 'get_cluster_resources',  description: 'Get all cluster resources in one call — VMs, containers, nodes, and storage with current usage. Optionally filter by resource type.',          inputSchema: { type: 'object', properties: { type: { type: 'string', enum: ['vm', 'storage', 'node', 'sdn'], description: 'Filter by resource type (optional)' } } } },
  { name: 'get_node_network',       description: 'Get network interface configuration for a node — bridges, bonds, VLANs, IPs.',                                                                  inputSchema: { type: 'object', properties: { node: { type: 'string' } }, required: ['node'] } },
  { name: 'get_node_rrddata',       description: 'Get performance time-series data for a node (CPU, memory, network, disk I/O). Period: hour | day | week | month | year.',                       inputSchema: { type: 'object', properties: { node: { type: 'string' }, period: { type: 'string', enum: ['hour', 'day', 'week', 'month', 'year'], description: 'Time period (default hour)' } }, required: ['node'] } },

  // VMs
  { name: 'get_vms',     description: 'List all QEMU VMs across the cluster, optionally filtered by node.',                           inputSchema: { type: 'object', properties: { node: { type: 'string', description: 'Filter by node (optional)' } } } },
  { name: 'get_vm_config',  description: 'Get full QEMU VM configuration — disks, network interfaces, CPU type, memory, boot order, and all hardware settings.',                      inputSchema: { type: 'object', properties: { node: { type: 'string' }, vmid: { type: 'number' } }, required: ['node', 'vmid'] } },
  { name: 'get_vm_status',  description: 'Get detailed runtime status of a QEMU VM — CPU usage, memory, disk I/O, network I/O, uptime, PID, lock state.',                                inputSchema: { type: 'object', properties: { node: { type: 'string' }, vmid: { type: 'number' } }, required: ['node', 'vmid'] } },
  { name: 'get_vm_rrddata', description: 'Get performance time-series data for a QEMU VM (CPU, memory, disk, network throughput). Period: hour | day | week | month | year.',             inputSchema: { type: 'object', properties: { node: { type: 'string' }, vmid: { type: 'number' }, period: { type: 'string', enum: ['hour', 'day', 'week', 'month', 'year'], description: 'Time period (default hour)' } }, required: ['node', 'vmid'] } },
  { name: 'clone_vm',    description: 'Clone an existing VM. Returns UPID task ID.',                                                   inputSchema: { type: 'object', properties: { node: { type: 'string' }, vmid: { type: 'number', description: 'Source VM ID' }, newid: { type: 'number', description: 'New VM ID' }, name: { type: 'string' }, target: { type: 'string', description: 'Target node (optional)' }, full: { type: 'boolean', description: 'Full clone (default true)' }, storage: { type: 'string' }, pool: { type: 'string' }, snapname: { type: 'string', description: 'Clone from snapshot (optional)' } }, required: ['node', 'vmid', 'newid'] } },
  { name: 'start_vm',    description: 'Start a VM. Returns UPID task ID.',                                                            inputSchema: { type: 'object', properties: { node: { type: 'string' }, vmid: { type: 'number' } }, required: ['node', 'vmid'] } },
  { name: 'stop_vm',     description: 'Force stop a VM. Returns UPID task ID.',                                                       inputSchema: { type: 'object', properties: { node: { type: 'string' }, vmid: { type: 'number' } }, required: ['node', 'vmid'] } },
  { name: 'shutdown_vm', description: 'Gracefully shutdown a VM. Returns UPID task ID.',                                              inputSchema: { type: 'object', properties: { node: { type: 'string' }, vmid: { type: 'number' } }, required: ['node', 'vmid'] } },
  { name: 'reset_vm',    description: 'Hard reset (restart) a VM. Returns UPID task ID.',                                             inputSchema: { type: 'object', properties: { node: { type: 'string' }, vmid: { type: 'number' } }, required: ['node', 'vmid'] } },

  // LXC Containers
  { name: 'get_containers',             description: 'List all LXC containers across the cluster, optionally filtered by node.',      inputSchema: { type: 'object', properties: { node: { type: 'string', description: 'Filter by node (optional)' } } } },
  { name: 'start_container',            description: 'Start an LXC container. Returns UPID task ID.',                                 inputSchema: { type: 'object', properties: { node: { type: 'string' }, vmid: { type: 'number' } }, required: ['node', 'vmid'] } },
  { name: 'stop_container',             description: 'Stop an LXC container. Set graceful=true for clean shutdown. Returns UPID.',    inputSchema: { type: 'object', properties: { node: { type: 'string' }, vmid: { type: 'number' }, graceful: { type: 'boolean', description: 'Graceful shutdown instead of force stop (default false)' } }, required: ['node', 'vmid'] } },
  { name: 'restart_container',          description: 'Reboot an LXC container. Returns UPID task ID.',                                inputSchema: { type: 'object', properties: { node: { type: 'string' }, vmid: { type: 'number' } }, required: ['node', 'vmid'] } },
  { name: 'update_container_resources', description: 'Update CPU cores, memory, swap, or disk size for an LXC container.',            inputSchema: { type: 'object', properties: { node: { type: 'string' }, vmid: { type: 'number' }, cores: { type: 'number' }, memory: { type: 'number', description: 'Memory in MiB' }, swap: { type: 'number', description: 'Swap in MiB' }, disk_gb: { type: 'number', description: 'Additional whole GiB to add to disk (integer)' }, disk: { type: 'string', description: 'Disk identifier to resize (default rootfs)' } }, required: ['node', 'vmid'] } },
  { name: 'get_container_config',       description: 'Get full LXC container config (network, mounts, CPU, memory, features).',       inputSchema: { type: 'object', properties: { node: { type: 'string' }, vmid: { type: 'number' } }, required: ['node', 'vmid'] } },
  { name: 'get_container_ip',           description: 'Get current IP address(es) of a running LXC container (container must be running).',  inputSchema: { type: 'object', properties: { node: { type: 'string' }, vmid: { type: 'number' } }, required: ['node', 'vmid'] } },

  // Snapshots
  { name: 'list_snapshots',       description: 'List all snapshots for a VM or container.',                                                inputSchema: { type: 'object', properties: { node: { type: 'string' }, vmid: { type: 'number' }, vm_type: { type: 'string', enum: ['qemu', 'lxc'], description: 'qemu or lxc (default qemu)' } }, required: ['node', 'vmid'] } },
  { name: 'get_snapshot_config', description: 'Get the VM hardware configuration recorded at snapshot time.',                                   inputSchema: { type: 'object', properties: { node: { type: 'string' }, vmid: { type: 'number' }, snapname: { type: 'string', description: 'Snapshot name' }, vm_type: { type: 'string', enum: ['qemu', 'lxc'], description: 'qemu or lxc (default qemu)' } }, required: ['node', 'vmid', 'snapname'] } },
  { name: 'create_snapshot', description: 'Create a snapshot of a VM or container. Returns UPID task ID.',                            inputSchema: { type: 'object', properties: { node: { type: 'string' }, vmid: { type: 'number' }, snapname: { type: 'string', description: 'Snapshot name (no spaces, letters/numbers/dash/underscore)' }, description: { type: 'string' }, vmstate: { type: 'boolean', description: 'Include RAM state (VMs only, default false)' }, vm_type: { type: 'string', enum: ['qemu', 'lxc'], description: 'qemu or lxc (default qemu)' } }, required: ['node', 'vmid', 'snapname'] } },

  // Backups
  { name: 'list_backups',  description: 'List available backups on a node. Optionally filter by storage or vmid.',                   inputSchema: { type: 'object', properties: { node: { type: 'string' }, storage: { type: 'string', description: 'Limit to a specific storage (optional)' }, vmid: { type: 'number', description: 'Filter by VM/CT ID (optional)' } }, required: ['node'] } },
  { name: 'create_backup', description: 'Create a backup of a VM or container. Returns a UPID task ID.',                             inputSchema: { type: 'object', properties: { node: { type: 'string' }, vmid: { type: 'number' }, storage: { type: 'string' }, compress: { type: 'string', description: '0 | gzip | lz4 | zstd (default zstd)' }, mode: { type: 'string', description: 'snapshot | suspend | stop (default snapshot)' }, notes: { type: 'string' } }, required: ['node', 'vmid', 'storage'] } },

  // Storage
  { name: 'get_storage',         description: 'List storage pools. Provide node for usage stats, omit for global config.',                   inputSchema: { type: 'object', properties: { node: { type: 'string', description: 'Node name for usage stats (optional)' } } } },
  { name: 'get_storage_content', description: 'List all content in a storage pool — disk images, ISOs, backups, templates. Shows which VM each disk belongs to.', inputSchema: { type: 'object', properties: { node: { type: 'string' }, storage: { type: 'string', description: 'Storage name (e.g. local-lvm, local)' }, content: { type: 'string', description: 'Filter by content type: images | iso | vztmpl | backup | rootdir (optional)' } }, required: ['node', 'storage'] } },

  // ISOs & Templates
  { name: 'list_isos',      description: 'List available ISO images on a node.',                                                     inputSchema: { type: 'object', properties: { node: { type: 'string' }, storage: { type: 'string', description: 'Limit to a specific storage (optional)' } }, required: ['node'] } },
  { name: 'list_templates', description: 'List available LXC OS templates on a node.',                                               inputSchema: { type: 'object', properties: { node: { type: 'string' }, storage: { type: 'string', description: 'Limit to a specific storage (optional)' } }, required: ['node'] } },
  { name: 'download_iso',   description: 'Download an ISO or template from a URL to Proxmox storage. Returns a UPID task ID.',       inputSchema: { type: 'object', properties: { node: { type: 'string' }, storage: { type: 'string' }, url: { type: 'string', description: 'URL to download from' }, filename: { type: 'string' }, content: { type: 'string', enum: ['iso', 'vztmpl'], description: 'iso or vztmpl (default iso)' }, checksum: { type: 'string' }, checksum_algorithm: { type: 'string', enum: ['sha256', 'sha512', 'md5'], description: 'default sha256' } }, required: ['node', 'storage', 'url', 'filename'] } },
  { name: 'delete_iso',     description: 'Delete an ISO or template from storage.',                                                  inputSchema: { type: 'object', properties: { node: { type: 'string' }, storage: { type: 'string' }, volid: { type: 'string', description: 'Full volume ID from list_isos output (e.g. local:iso/ubuntu.iso)' } }, required: ['node', 'storage', 'volid'] } },

  // Jobs (Proxmox tasks)
  { name: 'list_jobs',  description: 'List recent Proxmox tasks. Optionally filter by node, vmid, or status. Sorted newest-first.',  inputSchema: { type: 'object', properties: { node: { type: 'string', description: 'Filter by node (optional — omit for all nodes)' }, vmid: { type: 'number', description: 'Filter by VM/CT ID (optional)' }, status: { type: 'string', enum: ['ok', 'error'], description: 'Filter by outcome (optional)' }, limit: { type: 'number', description: 'Max total results (default 50)' } } } },
  { name: 'get_job',    description: 'Get the current status of a Proxmox task by UPID.',                                            inputSchema: { type: 'object', properties: { upid: { type: 'string', description: 'Task UPID e.g. UPID:pve:00001234:...' } }, required: ['upid'] } },
  { name: 'poll_job',   description: 'Get the status AND latest log lines for a running Proxmox task. Use this to track progress.',   inputSchema: { type: 'object', properties: { upid: { type: 'string' } }, required: ['upid'] } },
  { name: 'cancel_job', description: 'Cancel a running Proxmox task.',                                                               inputSchema: { type: 'object', properties: { upid: { type: 'string' } }, required: ['upid'] } },
  { name: 'retry_job',  description: 'Look up a completed task by UPID and return its type/id so you can manually re-invoke it. Proxmox has no native retry API.',  inputSchema: { type: 'object', properties: { upid: { type: 'string' } }, required: ['upid'] } },
]

// ─── Credentials ──────────────────────────────────────────────────────────────

function cfg(instanceId: string) {
  const url        = getCredential(instanceId, 'PROXMOX_URL')
  const user       = getCredential(instanceId, 'PROXMOX_USER')
  const tokenName  = getCredential(instanceId, 'PROXMOX_TOKEN_NAME')
  const tokenValue = getCredential(instanceId, 'PROXMOX_TOKEN_VALUE')
  if (!url || !user || !tokenName || !tokenValue)
    throw new Error('Proxmox credentials not configured. Set PROXMOX_URL, PROXMOX_USER, PROXMOX_TOKEN_NAME, PROXMOX_TOKEN_VALUE.')
  const base = url.replace(/\/$/, '') + '/api2/json'
  // PVEAPIToken auth: scheme='' means restFetch uses the token as-is with no prefix+space
  const auth = `PVEAPIToken=${user}!${tokenName}=${tokenValue}`
  return { base, auth }
}

// ─── HTTP helpers ─────────────────────────────────────────────────────────────

// GET — Proxmox wraps all responses in { data: ... }
async function pve<T = unknown>(base: string, auth: string, path: string): Promise<T> {
  const res = await restFetch<{ data: T }>(base, path, auth, 'Authorization', '')
  return res.data
}

// POST / PUT / DELETE — Proxmox requires application/x-www-form-urlencoded for mutation bodies
async function pveMutate<T = unknown>(
  base: string, auth: string, path: string,
  method: 'POST' | 'PUT' | 'DELETE',
  data?: Record<string, unknown>,
): Promise<T> {
  const hasBody = data !== undefined && Object.keys(data).length > 0
  const init: RequestInit = { method }
  if (hasBody) {
    const p = new URLSearchParams()
    for (const [k, v] of Object.entries(data!)) {
      if (v !== undefined && v !== null) p.set(k, String(v))
    }
    init.body    = p.toString()
    init.headers = { 'Content-Type': 'application/x-www-form-urlencoded' }
  }
  const res = await restFetch<{ data: T }>(base, path, auth, 'Authorization', '', init)
  return res.data
}

// ─── Validation ───────────────────────────────────────────────────────────────

// Block path traversal in any value that goes into a URL segment
function safeSeg(val: unknown, name: string): string {
  const s = String(val)
  if (s.includes('..') || s.includes('/') || s.includes('\0'))
    throw new Error(`Invalid ${name}: "${s}" — path separators not allowed`)
  return s
}

function safeVmType(val: unknown): 'qemu' | 'lxc' {
  const t = String(val ?? 'qemu')
  if (t !== 'qemu' && t !== 'lxc') throw new Error(`vm_type must be "qemu" or "lxc", got "${t}"`)
  return t as 'qemu' | 'lxc'
}

// ─── UPID ─────────────────────────────────────────────────────────────────────

function parseUpid(raw: unknown): { node: string; encoded: string } {
  if (!raw) throw new Error('upid is required')
  const upid  = String(raw)
  const parts = upid.split(':')
  if (parts.length < 3 || parts[0] !== 'UPID' || !parts[1])
    throw new Error(`Invalid UPID format. Expected "UPID:nodename:..." — got "${upid}"`)
  return { node: parts[1], encoded: encodeURIComponent(upid) }
}

// ─── Aggregation helpers ──────────────────────────────────────────────────────

// Returns combined items from all nodes; propagates auth errors, skips unreachable nodes
async function fromAllNodes<T>(
  base: string, auth: string,
  pathFn: (node: string) => string,
  mapFn:  (items: T[], node: string) => T[] = (items) => items,
): Promise<T[]> {
  const nodes   = await pve<Array<{ node: string }>>(base, auth, '/nodes')
  const settled = await Promise.allSettled(
    nodes.map(n => pve<T[]>(base, auth, pathFn(n.node)).then(items => mapFn(items, n.node)))
  )
  for (const r of settled) {
    if (r.status === 'rejected' && r.reason instanceof Error) {
      if (/401|403/.test(r.reason.message)) throw r.reason  // auth failure = hard error
    }
  }
  return settled
    .filter((r): r is PromiseFulfilledResult<T[]> => r.status === 'fulfilled')
    .flatMap(r => r.value)
}

// Lists content items (iso/vztmpl/backup) across storages; throws if all fail
async function listContent(
  base: string, auth: string, node: string, contentType: string, storage?: string,
): Promise<Array<Record<string, unknown>>> {
  const n = safeSeg(node, 'node')
  if (storage) {
    return pve<Array<Record<string, unknown>>>(base, auth, `/nodes/${n}/storage/${safeSeg(storage, 'storage')}/content?content=${contentType}`)
  }
  const storages = await pve<Array<{ storage: string; content?: string }>>(base, auth, `/nodes/${n}/storage`)
  const matching = storages.filter(s => s.content?.split(',').includes(contentType))
  if (!matching.length) return []

  type ContentRow = Record<string, unknown>
  const settled = await Promise.allSettled(
    matching.map(s =>
      pve<ContentRow[]>(base, auth, `/nodes/${n}/storage/${s.storage}/content?content=${contentType}`)
        .then(items => items.map(i => ({ ...i, storage: s.storage })))
    )
  )
  const ok: ContentRow[]   = settled.flatMap(r => r.status === 'fulfilled' ? r.value : [])
  const fail: unknown[]    = settled.filter(r => r.status === 'rejected').map(r => (r as PromiseRejectedResult).reason)

  if (fail.length > 0 && ok.length === 0)
    throw new Error(`No accessible storage for ${contentType}: ${fail[0] instanceof Error ? fail[0].message : String(fail[0])}`)
  return ok
}

// ─── Ping ─────────────────────────────────────────────────────────────────────

export async function ping(instanceId: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const { base, auth } = cfg(instanceId)
    await pve(base, auth, '/version')
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Unknown error' }
  }
}

// ─── Tool handler ─────────────────────────────────────────────────────────────

export async function call(instanceId: string, toolName: string, args: Record<string, unknown>): Promise<unknown> {
  const { base, auth } = cfg(instanceId)

  switch (toolName) {

    // ── Cluster & Nodes ────────────────────────────────────────────────────────

    case 'get_cluster_status':
      return pve(base, auth, '/cluster/status')

    case 'get_nodes':
      return pve(base, auth, '/nodes')

    case 'get_node_status':
      return pve(base, auth, `/nodes/${safeSeg(args.node, 'node')}/status`)

    case 'get_cluster_resources': {
      const qs = args.type ? `?type=${encodeURIComponent(String(args.type))}` : ''
      return pve(base, auth, `/cluster/resources${qs}`)
    }

    case 'get_node_network':
      return pve(base, auth, `/nodes/${safeSeg(args.node, 'node')}/network`)

    case 'get_node_rrddata':
      return pve(base, auth, `/nodes/${safeSeg(args.node, 'node')}/rrddata?timeframe=${String(args.period ?? 'hour')}&cf=AVERAGE`)

    // ── VMs ────────────────────────────────────────────────────────────────────

    case 'get_vms':
      return args.node
        ? pve(base, auth, `/nodes/${safeSeg(args.node, 'node')}/qemu`)
        : fromAllNodes<Record<string, unknown>>(base, auth, n => `/nodes/${n}/qemu`, (vms, node) => vms.map(v => ({ ...v, node })))

    case 'get_vm_config':
      return pve(base, auth, `/nodes/${safeSeg(args.node, 'node')}/qemu/${Number(args.vmid)}/config`)

    case 'get_vm_status':
      return pve(base, auth, `/nodes/${safeSeg(args.node, 'node')}/qemu/${Number(args.vmid)}/status/current`)

    case 'get_vm_rrddata':
      return pve(base, auth, `/nodes/${safeSeg(args.node, 'node')}/qemu/${Number(args.vmid)}/rrddata?timeframe=${String(args.period ?? 'hour')}&cf=AVERAGE`)

    case 'clone_vm': {
      const body: Record<string, unknown> = {
        newid: Number(args.newid),
        full:  args.full !== undefined ? Boolean(args.full) : true,
      }
      if (args.name)     body.name     = args.name
      if (args.target)   body.target   = safeSeg(args.target, 'target')
      if (args.storage)  body.storage  = safeSeg(args.storage, 'storage')
      if (args.pool)     body.pool     = args.pool
      if (args.snapname) body.snapname = args.snapname
      return pveMutate(base, auth, `/nodes/${safeSeg(args.node, 'node')}/qemu/${Number(args.vmid)}/clone`, 'POST', body)
    }

    case 'start_vm':
      return pveMutate(base, auth, `/nodes/${safeSeg(args.node, 'node')}/qemu/${Number(args.vmid)}/status/start`, 'POST')

    case 'stop_vm':
      return pveMutate(base, auth, `/nodes/${safeSeg(args.node, 'node')}/qemu/${Number(args.vmid)}/status/stop`, 'POST')

    case 'shutdown_vm':
      return pveMutate(base, auth, `/nodes/${safeSeg(args.node, 'node')}/qemu/${Number(args.vmid)}/status/shutdown`, 'POST')

    case 'reset_vm':
      return pveMutate(base, auth, `/nodes/${safeSeg(args.node, 'node')}/qemu/${Number(args.vmid)}/status/reset`, 'POST')

    // ── LXC Containers ─────────────────────────────────────────────────────────

    case 'get_containers':
      return args.node
        ? pve(base, auth, `/nodes/${safeSeg(args.node, 'node')}/lxc`)
        : fromAllNodes<Record<string, unknown>>(base, auth, n => `/nodes/${n}/lxc`, (cts, node) => cts.map(c => ({ ...c, node })))

    case 'start_container':
      return pveMutate(base, auth, `/nodes/${safeSeg(args.node, 'node')}/lxc/${Number(args.vmid)}/status/start`, 'POST')

    case 'stop_container':
      return pveMutate(
        base, auth,
        `/nodes/${safeSeg(args.node, 'node')}/lxc/${Number(args.vmid)}/status/${args.graceful ? 'shutdown' : 'stop'}`,
        'POST',
      )

    case 'restart_container':
      return pveMutate(base, auth, `/nodes/${safeSeg(args.node, 'node')}/lxc/${Number(args.vmid)}/status/reboot`, 'POST')

    case 'update_container_resources': {
      const node    = safeSeg(args.node, 'node')
      const vmid    = Number(args.vmid)
      const applied: string[] = []

      if (args.disk_gb !== undefined) {
        const gb = Math.floor(Number(args.disk_gb))
        if (gb <= 0) throw new Error('disk_gb must be a positive integer')
        await pveMutate(base, auth, `/nodes/${node}/lxc/${vmid}/resize`, 'PUT', {
          disk: String(args.disk ?? 'rootfs'),
          size: `+${gb}G`,
        })
        applied.push(`disk +${gb}G`)
      }

      const config: Record<string, unknown> = {}
      if (args.cores  !== undefined) config.cores  = Number(args.cores)
      if (args.memory !== undefined) config.memory = Number(args.memory)
      if (args.swap   !== undefined) config.swap   = Number(args.swap)

      if (Object.keys(config).length > 0) {
        await pveMutate(base, auth, `/nodes/${node}/lxc/${vmid}/config`, 'PUT', config)
        applied.push(`config: ${Object.keys(config).join(', ')}`)
      }

      if (!applied.length) return { ok: false, message: 'No changes specified' }
      return { ok: true, applied }
    }

    case 'get_container_config':
      return pve(base, auth, `/nodes/${safeSeg(args.node, 'node')}/lxc/${Number(args.vmid)}/config`)

    case 'get_container_ip': {
      const node = safeSeg(args.node, 'node')
      const vmid = Number(args.vmid)
      try {
        return await pve(base, auth, `/nodes/${node}/lxc/${vmid}/interfaces`)
      } catch (e) {
        if (e instanceof Error && e.message.includes('500'))
          throw new Error(`Cannot retrieve interfaces for container ${vmid} — make sure it is running`)
        throw e
      }
    }

    // ── Snapshots ──────────────────────────────────────────────────────────────

    case 'list_snapshots': {
      const type = safeVmType(args.vm_type)
      return pve(base, auth, `/nodes/${safeSeg(args.node, 'node')}/${type}/${Number(args.vmid)}/snapshot`)
    }

    case 'get_snapshot_config': {
      const type = safeVmType(args.vm_type)
      return pve(base, auth, `/nodes/${safeSeg(args.node, 'node')}/${type}/${Number(args.vmid)}/snapshot/${safeSeg(args.snapname, 'snapname')}/config`)
    }

    case 'create_snapshot': {
      const type = safeVmType(args.vm_type)
      const body: Record<string, unknown> = { snapname: String(args.snapname) }
      if (args.description) body.description = args.description
      if (args.vmstate)     body.vmstate     = '1'  // Proxmox expects string '1' / '0' for booleans in form encoding
      return pveMutate(base, auth, `/nodes/${safeSeg(args.node, 'node')}/${type}/${Number(args.vmid)}/snapshot`, 'POST', body)
    }

    // ── Backups ────────────────────────────────────────────────────────────────

    case 'list_backups': {
      const node = safeSeg(args.node, 'node')
      let backups: Array<Record<string, unknown>>

      if (args.storage) {
        backups = await pve<Array<Record<string, unknown>>>(base, auth, `/nodes/${node}/storage/${safeSeg(args.storage, 'storage')}/content?content=backup`)
      } else {
        const storages       = await pve<Array<{ storage: string; content?: string }>>(base, auth, `/nodes/${node}/storage`)
        const backupStorages = storages.filter(s => s.content?.split(',').includes('backup'))
        type BackupRow = Record<string, unknown>
        const settled        = await Promise.allSettled(
          backupStorages.map(s =>
            pve<BackupRow[]>(base, auth, `/nodes/${node}/storage/${s.storage}/content?content=backup`)
              .then(items => items.map(i => ({ ...i, storage: s.storage })))
          )
        )
        const ok: BackupRow[]  = settled.flatMap(r => r.status === 'fulfilled' ? r.value : [])
        const fail: unknown[]  = settled.filter(r => r.status === 'rejected').map(r => (r as PromiseRejectedResult).reason)
        if (fail.length > 0 && ok.length === 0)
          throw new Error(`No accessible backup storage: ${fail[0] instanceof Error ? fail[0].message : String(fail[0])}`)
        backups = ok
      }

      if (args.vmid !== undefined) {
        const vmidStr = String(args.vmid)
        backups = backups.filter(b => String(b.vmid) === vmidStr)
      }
      return backups
    }

    case 'create_backup': {
      const body: Record<string, unknown> = {
        vmid:     Number(args.vmid),
        storage:  safeSeg(args.storage as string, 'storage'),
        compress: String(args.compress ?? 'zstd'),
        mode:     String(args.mode     ?? 'snapshot'),
      }
      if (args.notes) body.notes = String(args.notes)
      return pveMutate(base, auth, `/nodes/${safeSeg(args.node, 'node')}/vzdump`, 'POST', body)
    }

    // ── Storage ────────────────────────────────────────────────────────────────

    case 'get_storage':
      return args.node
        ? pve(base, auth, `/nodes/${safeSeg(args.node, 'node')}/storage`)
        : pve(base, auth, '/storage')

    case 'get_storage_content': {
      const node    = safeSeg(args.node, 'node')
      const storage = safeSeg(args.storage as string, 'storage')
      const qs      = args.content ? `?content=${encodeURIComponent(String(args.content))}` : ''
      return pve(base, auth, `/nodes/${node}/storage/${storage}/content${qs}`)
    }

    // ── ISOs & Templates ───────────────────────────────────────────────────────

    case 'list_isos':
      return listContent(base, auth, String(args.node), 'iso', args.storage ? String(args.storage) : undefined)

    case 'list_templates':
      return listContent(base, auth, String(args.node), 'vztmpl', args.storage ? String(args.storage) : undefined)

    case 'download_iso': {
      const rawUrl = String(args.url)
      try { new URL(rawUrl) } catch { throw new Error(`Invalid URL: "${rawUrl}"`) }
      const body: Record<string, unknown> = {
        url:      rawUrl,
        filename: String(args.filename),
        content:  String(args.content ?? 'iso'),
      }
      if (args.checksum) {
        body.checksum              = String(args.checksum)
        body['checksum-algorithm'] = String(args.checksum_algorithm ?? 'sha256')
      }
      return pveMutate(base, auth, `/nodes/${safeSeg(args.node, 'node')}/storage/${safeSeg(args.storage as string, 'storage')}/download-url`, 'POST', body)
    }

    case 'delete_iso':
      return pveMutate(
        base, auth,
        `/nodes/${safeSeg(args.node, 'node')}/storage/${safeSeg(args.storage as string, 'storage')}/content/${encodeURIComponent(String(args.volid))}`,
        'DELETE',
      )

    // ── Jobs (Proxmox tasks) ───────────────────────────────────────────────────

    case 'list_jobs': {
      const limit = args.limit !== undefined ? Number(args.limit) : 50
      const qs: string[] = [`limit=${limit}`]
      if (args.vmid   !== undefined) qs.push(`vmid=${Number(args.vmid)}`)
      if (args.status)               qs.push(`statusfilter=${args.status}`)
      const query = `?${qs.join('&')}`

      let tasks: Array<Record<string, unknown>>
      if (args.node) {
        tasks = await pve<Array<Record<string, unknown>>>(base, auth, `/nodes/${safeSeg(args.node, 'node')}/tasks${query}`)
      } else {
        // Fetch per-node with a higher per-node limit, then globally cap + sort
        const perNodeLimit = Math.min(limit * 3, 500)
        const perNodeQs    = [`limit=${perNodeLimit}`, ...qs.slice(1)].join('&')
        tasks = await fromAllNodes<Record<string, unknown>>(
          base, auth,
          n => `/nodes/${n}/tasks?${perNodeQs}`,
        )
        tasks.sort((a, b) => (Number(b.starttime) || 0) - (Number(a.starttime) || 0))
        tasks = tasks.slice(0, limit)
      }
      return tasks
    }

    case 'get_job': {
      const { node, encoded } = parseUpid(args.upid)
      return pve(base, auth, `/nodes/${node}/tasks/${encoded}/status`)
    }

    case 'poll_job': {
      const { node, encoded } = parseUpid(args.upid)
      const [status, log] = await Promise.all([
        pve<Record<string, unknown>>(base, auth, `/nodes/${node}/tasks/${encoded}/status`),
        pve<Array<{ n: number; t: string }>>(base, auth, `/nodes/${node}/tasks/${encoded}/log?limit=50&start=0`).catch(() => []),
      ])
      return { ...status, log: log.map(l => l.t) }
    }

    case 'cancel_job': {
      const { node, encoded } = parseUpid(args.upid)
      return pveMutate(base, auth, `/nodes/${node}/tasks/${encoded}`, 'DELETE')
    }

    case 'retry_job': {
      const { node, encoded } = parseUpid(args.upid)
      const status = await pve<Record<string, unknown>>(base, auth, `/nodes/${node}/tasks/${encoded}/status`)
      return {
        ...status,
        retry_note: 'Proxmox has no native retry API. Use the "type" and "id" fields above to re-invoke the original operation.',
      }
    }

    default:
      throw new Error(`Unknown Proxmox tool: ${toolName}`)
  }
}

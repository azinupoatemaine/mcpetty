import { getCredential } from '../db'
import type { MCPTool } from '../mcp-client'
import { restFetch } from './http'

// ─── Tool definitions ─────────────────────────────────────────────────────────

export const TOOLS: MCPTool[] = [
  // Access groups (endpoint groups)
  { name: 'list_access_groups',                description: 'List all access groups.',                         inputSchema: { type: 'object', properties: {} } },
  { name: 'create_access_group',               description: 'Create a new access group.',                      inputSchema: { type: 'object', properties: { name: { type: 'string' }, environmentIds: { type: 'array', description: 'Environment IDs to include' } }, required: ['name', 'environmentIds'] } },
  { name: 'update_access_group_name',          description: 'Rename an access group.',                         inputSchema: { type: 'object', properties: { id: { type: 'number' }, name: { type: 'string' } }, required: ['id', 'name'] } },
  { name: 'update_access_group_user_accesses', description: 'Set user access policies on an access group.',   inputSchema: { type: 'object', properties: { id: { type: 'number' }, userAccesses: { type: 'array', description: '[{ id, access }] access: environment_administrator|standard_user|readonly_user|operator_user|helpdesk_user' } }, required: ['id', 'userAccesses'] } },
  { name: 'update_access_group_team_accesses', description: 'Set team access policies on an access group.',   inputSchema: { type: 'object', properties: { id: { type: 'number' }, teamAccesses: { type: 'array', description: '[{ id, access }]' } }, required: ['id', 'teamAccesses'] } },
  { name: 'add_environment_to_access_group',   description: 'Add an environment to an access group.',         inputSchema: { type: 'object', properties: { id: { type: 'number', description: 'Access group ID' }, environmentId: { type: 'number' } }, required: ['id', 'environmentId'] } },
  { name: 'remove_environment_from_access_group', description: 'Remove an environment from an access group.', inputSchema: { type: 'object', properties: { id: { type: 'number', description: 'Access group ID' }, environmentId: { type: 'number' } }, required: ['id', 'environmentId'] } },

  // Environments (endpoints)
  { name: 'list_environments',              description: 'List all Docker/Kubernetes environments.',                inputSchema: { type: 'object', properties: {} } },
  { name: 'update_environment_tags',        description: 'Set tags on an environment.',                            inputSchema: { type: 'object', properties: { id: { type: 'number' }, tagIds: { type: 'array', description: 'Tag IDs to assign' } }, required: ['id', 'tagIds'] } },
  { name: 'update_environment_user_accesses', description: 'Set user access policies on an environment.',          inputSchema: { type: 'object', properties: { id: { type: 'number' }, userAccesses: { type: 'array', description: '[{ id, access }]' } }, required: ['id', 'userAccesses'] } },
  { name: 'update_environment_team_accesses', description: 'Set team access policies on an environment.',          inputSchema: { type: 'object', properties: { id: { type: 'number' }, teamAccesses: { type: 'array', description: '[{ id, access }]' } }, required: ['id', 'teamAccesses'] } },

  // Environment groups (edge groups)
  { name: 'list_environment_groups',             description: 'List all environment groups (edge groups).',        inputSchema: { type: 'object', properties: {} } },
  { name: 'create_environment_group',            description: 'Create a new environment group.',                   inputSchema: { type: 'object', properties: { name: { type: 'string' }, environmentIds: { type: 'array' } }, required: ['name', 'environmentIds'] } },
  { name: 'update_environment_group_name',       description: 'Rename an environment group.',                     inputSchema: { type: 'object', properties: { id: { type: 'number' }, name: { type: 'string' } }, required: ['id', 'name'] } },
  { name: 'update_environment_group_environments', description: 'Set which environments belong to a group.',      inputSchema: { type: 'object', properties: { id: { type: 'number' }, environmentIds: { type: 'array' } }, required: ['id', 'environmentIds'] } },
  { name: 'update_environment_group_tags',       description: 'Set tags on an environment group.',                inputSchema: { type: 'object', properties: { id: { type: 'number' }, tagIds: { type: 'array' } }, required: ['id', 'tagIds'] } },

  // Settings
  { name: 'get_settings', description: 'Get Portainer instance settings.', inputSchema: { type: 'object', properties: {} } },

  // Edge stacks
  { name: 'list_stacks',    description: 'List edge stacks (requires Edge compute feature). Returns disabled notice if not available — use list_local_stacks instead for regular Docker stacks.', inputSchema: { type: 'object', properties: {} } },
  { name: 'get_stack_file', description: 'Get docker-compose content of an edge stack.',  inputSchema: { type: 'object', properties: { id: { type: 'number' } }, required: ['id'] } },
  { name: 'create_stack',   description: 'Create a new edge stack (requires Edge compute).',  inputSchema: { type: 'object', properties: { name: { type: 'string' }, file: { type: 'string', description: 'docker-compose.yml content' }, environmentGroupIds: { type: 'array', description: 'Edge group IDs' } }, required: ['name', 'file', 'environmentGroupIds'] } },
  { name: 'update_stack',   description: 'Update an existing edge stack (requires Edge compute).', inputSchema: { type: 'object', properties: { id: { type: 'number' }, file: { type: 'string' }, environmentGroupIds: { type: 'array' } }, required: ['id', 'file', 'environmentGroupIds'] } },

  // Local stacks
  { name: 'list_local_stacks',    description: 'List all local (non-edge) stacks.',                               inputSchema: { type: 'object', properties: {} } },
  { name: 'get_local_stack_file', description: 'Get docker-compose content of a local stack.',                    inputSchema: { type: 'object', properties: { id: { type: 'number' } }, required: ['id'] } },
  { name: 'create_local_stack',   description: 'Create a local Docker Compose stack on a specific environment.',  inputSchema: { type: 'object', properties: { environmentId: { type: 'number' }, name: { type: 'string' }, file: { type: 'string', description: 'docker-compose.yml content' }, env: { type: 'array', description: '[{ name, value }] environment variables' } }, required: ['environmentId', 'name', 'file'] } },
  { name: 'update_local_stack',   description: 'Update a local stack with new compose content.',                  inputSchema: { type: 'object', properties: { id: { type: 'number' }, environmentId: { type: 'number' }, file: { type: 'string' }, env: { type: 'array', description: '[{ name, value }]' }, prune: { type: 'boolean' }, pullImage: { type: 'boolean' } }, required: ['id', 'environmentId', 'file'] } },
  { name: 'start_local_stack',    description: 'Start a stopped local stack.',                                    inputSchema: { type: 'object', properties: { id: { type: 'number' }, environmentId: { type: 'number' } }, required: ['id', 'environmentId'] } },
  { name: 'stop_local_stack',     description: 'Stop a running local stack.',                                     inputSchema: { type: 'object', properties: { id: { type: 'number' }, environmentId: { type: 'number' } }, required: ['id', 'environmentId'] } },
  { name: 'delete_local_stack',   description: 'Delete a local stack permanently.',                               inputSchema: { type: 'object', properties: { id: { type: 'number' }, environmentId: { type: 'number' } }, required: ['id', 'environmentId'] } },

  // Tags
  { name: 'list_environment_tags',  description: 'List all environment tags.',   inputSchema: { type: 'object', properties: {} } },
  { name: 'create_environment_tag', description: 'Create a new environment tag.', inputSchema: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] } },

  // Teams
  { name: 'list_teams',       description: 'List all teams.',                      inputSchema: { type: 'object', properties: {} } },
  { name: 'create_team',      description: 'Create a new team.',                   inputSchema: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] } },
  { name: 'update_team_name', description: 'Rename a team.',                       inputSchema: { type: 'object', properties: { id: { type: 'number' }, name: { type: 'string' } }, required: ['id', 'name'] } },
  { name: 'update_team_members', description: 'Set the full member list of a team (replaces existing).', inputSchema: { type: 'object', properties: { id: { type: 'number' }, userIds: { type: 'array', description: 'User IDs that should be in the team' } }, required: ['id', 'userIds'] } },

  // Users
  { name: 'list_users',       description: 'List all Portainer users.',          inputSchema: { type: 'object', properties: {} } },
  { name: 'update_user_role', description: 'Change a user\'s role.',             inputSchema: { type: 'object', properties: { id: { type: 'number' }, role: { type: 'string', description: 'admin | user | edge_admin' } }, required: ['id', 'role'] } },

  // Docker proxy
  { name: 'docker_proxy', description: 'Proxy any Docker API request through Portainer to an environment. Use this to manage containers, images, volumes, networks, etc.', inputSchema: { type: 'object', properties: { environmentId: { type: 'number' }, method: { type: 'string', description: 'GET | POST | PUT | DELETE' }, dockerAPIPath: { type: 'string', description: 'Docker API path with leading slash e.g. /containers/json' }, queryParams: { type: 'array', description: '[{ key, value }]' }, body: { type: 'string', description: 'JSON body string (optional)' } }, required: ['environmentId', 'method', 'dockerAPIPath'] } },

  // Kubernetes proxy
  { name: 'kubernetes_proxy', description: 'Proxy any Kubernetes API request through Portainer to an environment.', inputSchema: { type: 'object', properties: { environmentId: { type: 'number' }, method: { type: 'string', description: 'GET | POST | PUT | DELETE' }, kubernetesAPIPath: { type: 'string', description: 'K8s API path e.g. /api/v1/namespaces/default/pods' }, queryParams: { type: 'array', description: '[{ key, value }]' }, body: { type: 'string' } }, required: ['environmentId', 'method', 'kubernetesAPIPath'] } },
  { name: 'get_kubernetes_resource', description: 'GET a Kubernetes resource and strip verbose managedFields metadata from the response.', inputSchema: { type: 'object', properties: { environmentId: { type: 'number' }, kubernetesAPIPath: { type: 'string' }, queryParams: { type: 'array', description: '[{ key, value }]' } }, required: ['environmentId', 'kubernetesAPIPath'] } },
]

// ─── Helpers ──────────────────────────────────────────────────────────────────

function cfg(instanceId: string) {
  const url   = getCredential(instanceId, 'PORTAINER_URL')
  const token = getCredential(instanceId, 'PORTAINER_TOKEN')
  if (!url || !token) throw new Error('Portainer credentials not configured. Set PORTAINER_URL and PORTAINER_TOKEN.')
  return { base: url.replace(/\/$/, ''), token }
}

function api<T>(base: string, token: string, path: string, init?: RequestInit): Promise<T> {
  return restFetch<T>(base, `/api${path}`, token, 'X-API-Key', '', init)
}

// Edge compute endpoints return 503 when the feature is disabled — return empty instead of crashing
async function edgeApi<T extends object>(base: string, token: string, path: string, init?: RequestInit): Promise<T | { disabled: true; message: string }> {
  try {
    return await api<T>(base, token, path, init)
  } catch (e) {
    if (e instanceof Error && e.message.includes('503')) {
      return { disabled: true, message: 'Edge compute is disabled on this Portainer instance' }
    }
    throw e
  }
}

const ACCESS_ROLE: Record<string, number> = {
  environment_administrator: 1,
  standard_user:             2,
  readonly_user:             3,
  operator_user:             4,
  helpdesk_user:             5,
}

const USER_ROLE: Record<string, number> = { admin: 1, user: 2, edge_admin: 3 }

function accessPolicies(list: Array<{ id: number; access: string }>) {
  const out: Record<string, { RoleID: number }> = {}
  for (const { id, access } of list) out[String(id)] = { RoleID: ACCESS_ROLE[access] ?? 2 }
  return out
}

function qstr(params?: Array<{ key: string; value: string }>): string {
  if (!params?.length) return ''
  return '?' + params.map((p) => `${encodeURIComponent(p.key)}=${encodeURIComponent(p.value)}`).join('&')
}

function stripManagedFields(obj: unknown): unknown {
  if (Array.isArray(obj)) return obj.map(stripManagedFields)
  if (obj && typeof obj === 'object') {
    const o = obj as Record<string, unknown>
    delete o.managedFields
    for (const k of Object.keys(o)) o[k] = stripManagedFields(o[k])
  }
  return obj
}

// ─── Ping ─────────────────────────────────────────────────────────────────────

export async function ping(instanceId: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const { base, token } = cfg(instanceId)
    await api(base, token, '/endpoints?limit=1')
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Unknown error' }
  }
}

// ─── Tool handler ─────────────────────────────────────────────────────────────

export async function call(instanceId: string, toolName: string, args: Record<string, unknown>): Promise<unknown> {
  const { base, token } = cfg(instanceId)

  switch (toolName) {

    // ── Access groups ──────────────────────────────────────────────────────────

    case 'list_access_groups':
      return api(base, token, '/endpoint_groups')

    case 'create_access_group':
      return api(base, token, '/endpoint_groups', { method: 'POST', body: JSON.stringify({ Name: args.name, AssociatedEndpoints: args.environmentIds }) })

    case 'update_access_group_name': {
      const current = await api<Record<string, unknown>>(base, token, `/endpoint_groups/${Number(args.id)}`)
      return api(base, token, `/endpoint_groups/${Number(args.id)}`, { method: 'PUT', body: JSON.stringify({ ...current, Name: args.name }) })
    }

    case 'update_access_group_user_accesses': {
      const current = await api<Record<string, unknown>>(base, token, `/endpoint_groups/${Number(args.id)}`)
      return api(base, token, `/endpoint_groups/${Number(args.id)}`, { method: 'PUT', body: JSON.stringify({ ...current, UserAccessPolicies: accessPolicies(args.userAccesses as Array<{ id: number; access: string }>) }) })
    }

    case 'update_access_group_team_accesses': {
      const current = await api<Record<string, unknown>>(base, token, `/endpoint_groups/${Number(args.id)}`)
      return api(base, token, `/endpoint_groups/${Number(args.id)}`, { method: 'PUT', body: JSON.stringify({ ...current, TeamAccessPolicies: accessPolicies(args.teamAccesses as Array<{ id: number; access: string }>) }) })
    }

    case 'add_environment_to_access_group':
      return api(base, token, `/endpoint_groups/${Number(args.id)}/endpoints/${Number(args.environmentId)}`, { method: 'PUT' })

    case 'remove_environment_from_access_group':
      return api(base, token, `/endpoint_groups/${Number(args.id)}/endpoints/${Number(args.environmentId)}`, { method: 'DELETE' })

    // ── Environments ───────────────────────────────────────────────────────────

    case 'list_environments':
      return api(base, token, '/endpoints')

    case 'update_environment_tags': {
      const current = await api<Record<string, unknown>>(base, token, `/endpoints/${Number(args.id)}`)
      return api(base, token, `/endpoints/${Number(args.id)}`, { method: 'PUT', body: JSON.stringify({ ...current, TagIds: args.tagIds }) })
    }

    case 'update_environment_user_accesses': {
      const current = await api<Record<string, unknown>>(base, token, `/endpoints/${Number(args.id)}`)
      return api(base, token, `/endpoints/${Number(args.id)}`, { method: 'PUT', body: JSON.stringify({ ...current, UserAccessPolicies: accessPolicies(args.userAccesses as Array<{ id: number; access: string }>) }) })
    }

    case 'update_environment_team_accesses': {
      const current = await api<Record<string, unknown>>(base, token, `/endpoints/${Number(args.id)}`)
      return api(base, token, `/endpoints/${Number(args.id)}`, { method: 'PUT', body: JSON.stringify({ ...current, TeamAccessPolicies: accessPolicies(args.teamAccesses as Array<{ id: number; access: string }>) }) })
    }

    // ── Environment groups (edge groups — returns empty if edge compute disabled) ─

    case 'list_environment_groups':
      return edgeApi(base, token, '/edge_groups')

    case 'create_environment_group':
      return edgeApi(base, token, '/edge_groups', { method: 'POST', body: JSON.stringify({ Name: args.name, Dynamic: false, Endpoints: args.environmentIds }) })

    case 'update_environment_group_name': {
      const current = await edgeApi<Record<string, unknown>>(base, token, `/edge_groups/${Number(args.id)}`)
      if ('disabled' in current) return current
      return edgeApi(base, token, `/edge_groups/${Number(args.id)}`, { method: 'PUT', body: JSON.stringify({ ...current, Name: args.name }) })
    }

    case 'update_environment_group_environments': {
      const current = await edgeApi<Record<string, unknown>>(base, token, `/edge_groups/${Number(args.id)}`)
      if ('disabled' in current) return current
      return edgeApi(base, token, `/edge_groups/${Number(args.id)}`, { method: 'PUT', body: JSON.stringify({ ...current, Endpoints: args.environmentIds }) })
    }

    case 'update_environment_group_tags': {
      const current = await edgeApi<Record<string, unknown>>(base, token, `/edge_groups/${Number(args.id)}`)
      if ('disabled' in current) return current
      return edgeApi(base, token, `/edge_groups/${Number(args.id)}`, { method: 'PUT', body: JSON.stringify({ ...current, TagIds: args.tagIds, Dynamic: true }) })
    }

    // ── Settings ───────────────────────────────────────────────────────────────

    case 'get_settings':
      return api(base, token, '/settings')

    // ── Edge stacks (returns empty/disabled if edge compute not enabled) ────────

    case 'list_stacks':
      return edgeApi(base, token, '/edge_stacks')

    case 'get_stack_file':
      return edgeApi(base, token, `/edge_stacks/${Number(args.id)}/file`)

    case 'create_stack':
      return edgeApi(base, token, '/edge_stacks/create/string', { method: 'POST', body: JSON.stringify({ name: args.name, stackFileContent: args.file, edgeGroups: args.environmentGroupIds, deploymentType: 0 }) })

    case 'update_stack': {
      const current = await edgeApi<Record<string, unknown>>(base, token, `/edge_stacks/${Number(args.id)}`)
      if ('disabled' in current) return current
      return edgeApi(base, token, `/edge_stacks/${Number(args.id)}`, { method: 'PUT', body: JSON.stringify({ ...current, stackFileContent: args.file, edgeGroups: args.environmentGroupIds }) })
    }

    // ── Local stacks ───────────────────────────────────────────────────────────

    case 'list_local_stacks':
      return api(base, token, '/stacks')

    case 'get_local_stack_file':
      return api(base, token, `/stacks/${Number(args.id)}/file`)

    case 'create_local_stack':
      return api(base, token, `/stacks/create/standalone/string?endpointId=${Number(args.environmentId)}`, {
        method: 'POST',
        body: JSON.stringify({ name: args.name, stackFileContent: args.file, env: args.env ?? [] }),
      })

    case 'update_local_stack':
      return api(base, token, `/stacks/${Number(args.id)}?endpointId=${Number(args.environmentId)}`, {
        method: 'PUT',
        body: JSON.stringify({ stackFileContent: args.file, env: args.env ?? [], prune: args.prune ?? false, pullImage: args.pullImage ?? false }),
      })

    case 'start_local_stack':
      return api(base, token, `/stacks/${Number(args.id)}/start`, { method: 'POST' })

    case 'stop_local_stack':
      return api(base, token, `/stacks/${Number(args.id)}/stop`, { method: 'POST' })

    case 'delete_local_stack':
      return api(base, token, `/stacks/${Number(args.id)}?endpointId=${Number(args.environmentId)}`, { method: 'DELETE' })

    // ── Tags ───────────────────────────────────────────────────────────────────

    case 'list_environment_tags':
      return api(base, token, '/tags')

    case 'create_environment_tag':
      return api(base, token, '/tags', { method: 'POST', body: JSON.stringify({ name: args.name }) })

    // ── Teams ──────────────────────────────────────────────────────────────────

    case 'list_teams':
      return api(base, token, '/teams')

    case 'create_team':
      return api(base, token, '/teams', { method: 'POST', body: JSON.stringify({ name: args.name }) })

    case 'update_team_name':
      return api(base, token, `/teams/${Number(args.id)}`, { method: 'PUT', body: JSON.stringify({ name: args.name }) })

    case 'update_team_members': {
      const teamId     = Number(args.id)
      const wantedIds  = (args.userIds as number[]).map(Number)
      const memberships = await api<Array<{ Id: number; UserID: number }>>(base, token, `/team_memberships?teamID=${teamId}`)
      const currentIds  = memberships.map((m) => m.UserID)
      const toAdd       = wantedIds.filter((uid) => !currentIds.includes(uid))
      const toRemove    = memberships.filter((m) => !wantedIds.includes(m.UserID))
      await Promise.all([
        ...toAdd.map((uid) => api(base, token, '/team_memberships', { method: 'POST', body: JSON.stringify({ teamID: teamId, userID: uid, role: 2 }) })),
        ...toRemove.map((m) => api(base, token, `/team_memberships/${m.Id}`, { method: 'DELETE' })),
      ])
      return { ok: true, added: toAdd.length, removed: toRemove.length }
    }

    // ── Users ──────────────────────────────────────────────────────────────────

    case 'list_users':
      return api(base, token, '/users')

    case 'update_user_role': {
      const current = await api<Record<string, unknown>>(base, token, `/users/${Number(args.id)}`)
      return api(base, token, `/users/${Number(args.id)}`, { method: 'PUT', body: JSON.stringify({ ...current, role: USER_ROLE[args.role as string] ?? 2 }) })
    }

    // ── Docker proxy ───────────────────────────────────────────────────────────

    case 'docker_proxy': {
      const dockerPath = String(args.dockerAPIPath ?? '')
      if (dockerPath.includes('..') || /(?:%2e){2}|%2f/i.test(dockerPath))
        throw new Error('Invalid dockerAPIPath — path traversal not allowed')
      const method = String(args.method ?? 'GET').toUpperCase()
      if (!['GET', 'POST', 'PUT', 'DELETE'].includes(method))
        throw new Error(`HTTP method "${method}" not allowed — use GET, POST, PUT, or DELETE`)
      const rawBody = args.body as string | undefined
      if (rawBody !== undefined && rawBody !== '') {
        try { JSON.parse(rawBody) } catch { throw new Error('body must be valid JSON') }
      }
      const qs   = qstr(args.queryParams as Array<{ key: string; value: string }>)
      const path = `/endpoints/${Number(args.environmentId)}/docker${dockerPath}${qs}`
      return api(base, token, path, { method, body: rawBody })
    }

    // ── Kubernetes proxy ───────────────────────────────────────────────────────

    case 'kubernetes_proxy': {
      const k8sPath = String(args.kubernetesAPIPath ?? '')
      if (k8sPath.includes('..') || /(?:%2e){2}|%2f/i.test(k8sPath))
        throw new Error('Invalid kubernetesAPIPath — path traversal not allowed')
      const method = String(args.method ?? 'GET').toUpperCase()
      if (!['GET', 'POST', 'PUT', 'DELETE'].includes(method))
        throw new Error(`HTTP method "${method}" not allowed — use GET, POST, PUT, or DELETE`)
      const rawBody = args.body as string | undefined
      if (rawBody !== undefined && rawBody !== '') {
        try { JSON.parse(rawBody) } catch { throw new Error('body must be valid JSON') }
      }
      const qs   = qstr(args.queryParams as Array<{ key: string; value: string }>)
      const path = `/endpoints/${Number(args.environmentId)}/kubernetes${k8sPath}${qs}`
      return api(base, token, path, { method, body: rawBody })
    }

    case 'get_kubernetes_resource': {
      const k8sPath = String(args.kubernetesAPIPath ?? '')
      if (k8sPath.includes('..') || /(?:%2e){2}|%2f/i.test(k8sPath))
        throw new Error('Invalid kubernetesAPIPath — path traversal not allowed')
      const qs   = qstr(args.queryParams as Array<{ key: string; value: string }>)
      const path = `/endpoints/${Number(args.environmentId)}/kubernetes${k8sPath}${qs}`
      const data = await api<unknown>(base, token, path)
      return stripManagedFields(data)
    }

    default:
      throw new Error(`Unknown Portainer tool: ${toolName}`)
  }
}

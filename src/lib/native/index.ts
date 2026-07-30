import type { MCPTool } from '../mcp-client'
import * as wikijs      from './wikijs'
import * as portainer   from './portainer'
import * as karakeep    from './karakeep'
import * as proxmox     from './proxmox'
import * as wazuh       from './wazuh'
import * as firefly     from './firefly'
import * as mcpettyMeta from './mcpetty-meta'

// Which instances the caller is allowed to see. Only handlers that report on MCPetty
// itself need this — a normal handler talks to one backend and has nothing to scope.
// Absent means unrestricted (dashboard / approver context).
export interface CallScope {
  instanceIds: string[] | null  // null = all installed
}

export interface NativeHandler {
  tools: MCPTool[]
  ping(instanceId: string): Promise<{ ok: boolean; error?: string }>
  call(instanceId: string, toolName: string, args: Record<string, unknown>, scope?: CallScope): Promise<unknown>
}

export const NATIVE: Record<string, NativeHandler> = {
  wikijs: {
    tools: wikijs.TOOLS,
    ping:  wikijs.ping,
    call:  wikijs.call,
  },
  portainer: {
    tools: portainer.TOOLS,
    ping:  portainer.ping,
    call:  portainer.call,
  },
  karakeep: {
    tools: karakeep.TOOLS,
    ping:  karakeep.ping,
    call:  karakeep.call,
  },
  proxmox: {
    tools: proxmox.TOOLS,
    ping:  proxmox.ping,
    call:  proxmox.call,
  },
  wazuh: {
    tools: wazuh.TOOLS,
    ping:  wazuh.ping,
    call:  wazuh.call,
  },
  firefly: {
    tools: firefly.TOOLS,
    ping:  firefly.ping,
    call:  firefly.call,
  },
  mcpetty: {
    tools: mcpettyMeta.TOOLS,
    ping:  mcpettyMeta.ping,
    call:  mcpettyMeta.call,
  },
}

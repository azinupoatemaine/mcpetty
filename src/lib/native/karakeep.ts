import { getCredential } from '../db'
import type { MCPTool } from '../mcp-client'
import { restFetch } from './http'

// ─── Tools ────────────────────────────────────────────────────────────────────

export const TOOLS: MCPTool[] = [
  {
    name: 'search_bookmarks',
    description: 'Search bookmarks. Supports qualifiers: is:fav, is:archived, is:tagged, is:inlist, is:link, is:text, url:<value>, #<tag>, list:<name>, after:<YYYY-MM-DD>, before:<YYYY-MM-DD>. Negate with minus. Combine with AND/OR.',
    inputSchema: {
      type: 'object',
      properties: {
        query:      { type: 'string', description: 'Full-text or qualified search query' },
        limit:      { type: 'number', description: 'Max results (default 10)' },
        nextCursor: { type: 'string', description: 'Pagination cursor from previous call' },
      },
      required: ['query'],
    },
  },
  {
    name: 'get_bookmark',
    description: 'Get a bookmark by ID.',
    inputSchema: {
      type: 'object',
      properties: { bookmarkId: { type: 'string' } },
      required: ['bookmarkId'],
    },
  },
  {
    name: 'create_bookmark',
    description: 'Create a link or text bookmark.',
    inputSchema: {
      type: 'object',
      properties: {
        type:    { type: 'string', description: 'link | text' },
        content: { type: 'string', description: 'URL if type=link, text content if type=text' },
        title:   { type: 'string', description: 'Optional title' },
      },
      required: ['type', 'content'],
    },
  },
  {
    name: 'update_bookmark',
    description: 'Update fields on an existing bookmark. Only supplied fields are changed.',
    inputSchema: {
      type: 'object',
      properties: {
        bookmarkId:  { type: 'string' },
        title:       { type: 'string' },
        note:        { type: 'string' },
        summary:     { type: 'string' },
        archived:    { type: 'boolean' },
        favourited:  { type: 'boolean' },
        url:         { type: 'string', description: 'New URL for link bookmarks' },
        description: { type: 'string' },
        author:      { type: 'string' },
        publisher:   { type: 'string' },
      },
      required: ['bookmarkId'],
    },
  },
  {
    name: 'get_bookmark_content',
    description: 'Get the full content of a bookmark (HTML for links, plain text for text bookmarks).',
    inputSchema: {
      type: 'object',
      properties: { bookmarkId: { type: 'string' } },
      required: ['bookmarkId'],
    },
  },
  {
    name: 'get_lists',
    description: 'List all bookmark lists.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'create_list',
    description: 'Create a new bookmark list.',
    inputSchema: {
      type: 'object',
      properties: {
        name:     { type: 'string' },
        icon:     { type: 'string', description: 'Emoji icon' },
        parentId: { type: 'string', description: 'Parent list ID (optional)' },
      },
      required: ['name', 'icon'],
    },
  },
  {
    name: 'add_bookmark_to_list',
    description: 'Add a bookmark to a list.',
    inputSchema: {
      type: 'object',
      properties: {
        listId:     { type: 'string' },
        bookmarkId: { type: 'string' },
      },
      required: ['listId', 'bookmarkId'],
    },
  },
  {
    name: 'remove_bookmark_from_list',
    description: 'Remove a bookmark from a list.',
    inputSchema: {
      type: 'object',
      properties: {
        listId:     { type: 'string' },
        bookmarkId: { type: 'string' },
      },
      required: ['listId', 'bookmarkId'],
    },
  },
  {
    name: 'attach_tags',
    description: 'Attach one or more tags to a bookmark.',
    inputSchema: {
      type: 'object',
      properties: {
        bookmarkId:    { type: 'string' },
        tagsToAttach:  { type: 'array', description: 'Tag names to attach' },
      },
      required: ['bookmarkId', 'tagsToAttach'],
    },
  },
  {
    name: 'detach_tags',
    description: 'Detach one or more tags from a bookmark.',
    inputSchema: {
      type: 'object',
      properties: {
        bookmarkId:    { type: 'string' },
        tagsToDetach:  { type: 'array', description: 'Tag names to detach' },
      },
      required: ['bookmarkId', 'tagsToDetach'],
    },
  },
]

// ─── Credentials ──────────────────────────────────────────────────────────────

function cfg(instanceId: string) {
  const addr  = getCredential(instanceId, 'KARAKEEP_API_ADDR')
  const token = getCredential(instanceId, 'KARAKEEP_API_KEY')
  if (!addr || !token) throw new Error('Karakeep credentials not configured. Set KARAKEEP_API_ADDR and KARAKEEP_API_KEY.')
  return { base: `${addr.replace(/\/$/, '')}/api/v1`, token }
}

function api<T>(base: string, token: string, path: string, init?: RequestInit): Promise<T> {
  return restFetch<T>(base, path, token, undefined, undefined, init)
}

// ─── Ping ─────────────────────────────────────────────────────────────────────

export async function ping(instanceId: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const { base, token } = cfg(instanceId)
    await api(base, token, '/bookmarks/search?q=ping&limit=1')
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Unknown error' }
  }
}

// ─── Tool handler ─────────────────────────────────────────────────────────────

export async function call(instanceId: string, toolName: string, args: Record<string, unknown>): Promise<unknown> {
  const { base, token } = cfg(instanceId)

  switch (toolName) {

    case 'search_bookmarks': {
      const qs = new URLSearchParams({ q: args.query as string, limit: String(args.limit ?? 10), includeContent: 'false' })
      if (args.nextCursor) qs.set('cursor', args.nextCursor as string)
      return api(base, token, `/bookmarks/search?${qs}`)
    }

    case 'get_bookmark':
      return api(base, token, `/bookmarks/${args.bookmarkId}?includeContent=false`)

    case 'create_bookmark': {
      const body = args.type === 'link'
        ? { type: 'link', url: args.content, ...(args.title ? { title: args.title } : {}) }
        : { type: 'text', text: args.content, ...(args.title ? { title: args.title } : {}) }
      return api(base, token, '/bookmarks', { method: 'POST', body: JSON.stringify(body) })
    }

    case 'update_bookmark': {
      const { bookmarkId, ...fields } = args
      await api(base, token, `/bookmarks/${bookmarkId}`, { method: 'PATCH', body: JSON.stringify(fields) })
      return api(base, token, `/bookmarks/${bookmarkId}?includeContent=false`)
    }

    case 'get_bookmark_content': {
      const data = await api<{ content: Record<string, unknown> }>(base, token, `/bookmarks/${args.bookmarkId}?includeContent=true`)
      const c = data.content
      if (c.type === 'link')  return { type: 'link',  content: c.htmlContent }
      if (c.type === 'text')  return { type: 'text',  content: c.text }
      if (c.type === 'asset') return { type: 'asset', content: c.content }
      return data
    }

    case 'get_lists':
      return api(base, token, '/lists')

    case 'create_list':
      return api(base, token, '/lists', {
        method: 'POST',
        body: JSON.stringify({ name: args.name, icon: args.icon, ...(args.parentId ? { parentId: args.parentId } : {}) }),
      })

    case 'add_bookmark_to_list':
      return api(base, token, `/lists/${args.listId}/bookmarks/${args.bookmarkId}`, { method: 'PUT' })

    case 'remove_bookmark_from_list':
      return api(base, token, `/lists/${args.listId}/bookmarks/${args.bookmarkId}`, { method: 'DELETE' })

    case 'attach_tags':
      return api(base, token, `/bookmarks/${args.bookmarkId}/tags`, {
        method: 'POST',
        body: JSON.stringify({ tags: (args.tagsToAttach as string[]).map((t) => ({ tagName: t })) }),
      })

    case 'detach_tags':
      return api(base, token, `/bookmarks/${args.bookmarkId}/tags`, {
        method: 'DELETE',
        body: JSON.stringify({ tags: (args.tagsToDetach as string[]).map((t) => ({ tagName: t })) }),
      })

    default:
      throw new Error(`Unknown Karakeep tool: ${toolName}`)
  }
}

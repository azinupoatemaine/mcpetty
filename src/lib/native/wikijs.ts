import { getCredential } from '../db'
import type { MCPTool } from '../mcp-client'
import { gqlFetch } from './http'

export const TOOLS: MCPTool[] = [
  // ── Pages ────────────────────────────────────────────────────────────────────
  {
    name: 'search_pages',
    description: 'Search published wiki pages by keyword.',
    inputSchema: { type: 'object', properties: { query: { type: 'string' }, limit: { type: 'number', description: 'Max results (default 10)' } }, required: ['query'] },
  },
  {
    name: 'get_page',
    description: 'Get a wiki page (metadata + full content) by numeric ID.',
    inputSchema: { type: 'object', properties: { id: { type: 'number' } }, required: ['id'] },
  },
  {
    name: 'get_page_content',
    description: 'Get only the markdown content of a page by ID.',
    inputSchema: { type: 'object', properties: { id: { type: 'number' } }, required: ['id'] },
  },
  {
    name: 'get_page_by_path',
    description: 'Get a wiki page by its URL path and locale.',
    inputSchema: { type: 'object', properties: { path: { type: 'string' }, locale: { type: 'string', description: 'e.g. en' } }, required: ['path', 'locale'] },
  },
  {
    name: 'get_page_status',
    description: 'Get the publication status (published / unpublished) of a page.',
    inputSchema: { type: 'object', properties: { id: { type: 'number' } }, required: ['id'] },
  },
  {
    name: 'list_pages',
    description: 'List published pages in the wiki.',
    inputSchema: { type: 'object', properties: { limit: { type: 'number', description: 'Default 50' }, offset: { type: 'number', description: 'Default 0' } } },
  },
  {
    name: 'list_all_pages',
    description: 'List all pages including unpublished drafts.',
    inputSchema: { type: 'object', properties: { limit: { type: 'number', description: 'Default 100' } } },
  },
  {
    name: 'search_unpublished',
    description: 'Search pages that are not yet published.',
    inputSchema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
  },
  {
    name: 'create_page',
    description: 'Create a new wiki page.',
    inputSchema: {
      type: 'object',
      properties: {
        title:       { type: 'string' },
        content:     { type: 'string', description: 'Markdown content' },
        path:        { type: 'string', description: 'URL path e.g. docs/guide' },
        description: { type: 'string' },
        locale:      { type: 'string', description: 'Default: en' },
        isPublished: { type: 'boolean', description: 'Default: true' },
      },
      required: ['title', 'content', 'path'],
    },
  },
  {
    name: 'update_page',
    description: 'Update an existing page. Only supply fields you want to change.',
    inputSchema: {
      type: 'object',
      properties: {
        id:          { type: 'number' },
        content:     { type: 'string' },
        title:       { type: 'string' },
        description: { type: 'string' },
        isPublished: { type: 'boolean' },
      },
      required: ['id'],
    },
  },
  {
    name: 'publish_page',
    description: 'Publish an unpublished (draft) page.',
    inputSchema: { type: 'object', properties: { id: { type: 'number' } }, required: ['id'] },
  },
  {
    name: 'delete_page',
    description: 'Delete a published wiki page by ID.',
    inputSchema: { type: 'object', properties: { id: { type: 'number' } }, required: ['id'] },
  },
  {
    name: 'force_delete_page',
    description: 'Force-delete a page regardless of its publication state.',
    inputSchema: { type: 'object', properties: { id: { type: 'number' } }, required: ['id'] },
  },
  // ── Users ────────────────────────────────────────────────────────────────────
  {
    name: 'list_users',
    description: 'List all wiki users.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'search_users',
    description: 'Search users by name or email.',
    inputSchema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
  },
  {
    name: 'create_user',
    description: 'Create a new wiki user.',
    inputSchema: {
      type: 'object',
      properties: {
        email:           { type: 'string' },
        name:            { type: 'string' },
        password:        { type: 'string', description: 'Initial password' },
        providerKey:     { type: 'string', description: 'Auth provider (default: local)' },
        roleId:          { type: 'number', description: 'Role ID (default: 2 = guest)' },
        sendWelcome:     { type: 'boolean', description: 'Send welcome email (default: false)' },
      },
      required: ['email', 'name', 'password'],
    },
  },
  {
    name: 'update_user',
    description: 'Update an existing user.',
    inputSchema: {
      type: 'object',
      properties: {
        id:      { type: 'number' },
        name:    { type: 'string' },
        email:   { type: 'string' },
        newPassword: { type: 'string' },
      },
      required: ['id'],
    },
  },
  // ── Groups ───────────────────────────────────────────────────────────────────
  {
    name: 'list_groups',
    description: 'List all user groups.',
    inputSchema: { type: 'object', properties: {} },
  },
]

function cfg(instanceId: string) {
  const url   = getCredential(instanceId, 'WIKIJS_URL')
  const token = getCredential(instanceId, 'WIKIJS_API_KEY')
  if (!url || !token) throw new Error('WikiJS credentials not configured. Set WIKIJS_URL and WIKIJS_API_KEY.')
  return { base: url.replace(/\/$/, ''), token }
}

function gql<T>(base: string, token: string, query: string, variables: Record<string, unknown> = {}): Promise<T> {
  return gqlFetch<T>(base, token, query, variables)
}

export async function ping(instanceId: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const { base, token } = cfg(instanceId)
    await gql(base, token, `{ pages { list(limit: 1) { id } } }`)
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Unknown error' }
  }
}

type Page     = { id: number; path: string; title: string; description: string; isPublished: boolean; locale: string; createdAt: string; updatedAt: string }
type PageFull = Page & { content: string }
type RR       = { succeeded: boolean; message: string }

export async function call(instanceId: string, toolName: string, args: Record<string, unknown>): Promise<unknown> {
  const { base, token } = cfg(instanceId)

  switch (toolName) {

    case 'search_pages': {
      const data = await gql<{ pages: { search: { results?: Page[] } | Page[] } }>(
        base, token,
        `query($q: String!) { pages { search(query: $q) { results { id title path description locale } } } }`,
        { q: args.query as string }
      )
      const raw     = data.pages.search
      const results = Array.isArray(raw) ? raw : ((raw as { results?: Page[] }).results ?? [])
      return results.slice(0, Number(args.limit ?? 10))
    }

    case 'get_page': {
      const data = await gql<{ pages: { single: PageFull } }>(
        base, token,
        `query($id: Int!) { pages { single(id: $id) { id path title description content isPublished locale createdAt updatedAt } } }`,
        { id: Number(args.id) }
      )
      return data.pages.single
    }

    case 'get_page_content': {
      const data = await gql<{ pages: { single: { content: string } } }>(
        base, token,
        `query($id: Int!) { pages { single(id: $id) { content } } }`,
        { id: Number(args.id) }
      )
      return data.pages.single.content
    }

    case 'get_page_by_path': {
      const data = await gql<{ pages: { singleByPath: PageFull } }>(
        base, token,
        `query($path: String!, $locale: String!) { pages { singleByPath(path: $path, locale: $locale) { id path title description content isPublished locale createdAt updatedAt } } }`,
        { path: args.path as string, locale: args.locale as string }
      )
      return data.pages.singleByPath
    }

    case 'get_page_status': {
      const data = await gql<{ pages: { single: { id: number; isPublished: boolean; title: string } } }>(
        base, token,
        `query($id: Int!) { pages { single(id: $id) { id title isPublished } } }`,
        { id: Number(args.id) }
      )
      return data.pages.single
    }

    case 'list_pages': {
      const data = await gql<{ pages: { list: Page[] } }>(
        base, token,
        `query($limit: Int, $offset: Int) { pages { list(limit: $limit, offset: $offset) { id path title description isPublished locale } } }`,
        { limit: Number(args.limit ?? 50), offset: Number(args.offset ?? 0) }
      )
      return data.pages.list
    }

    case 'list_all_pages': {
      // Fetch a large batch; filter client-side to show all incl. unpublished
      const data = await gql<{ pages: { list: Page[] } }>(
        base, token,
        `query($limit: Int) { pages { list(limit: $limit) { id path title description isPublished locale } } }`,
        { limit: Number(args.limit ?? 100) }
      )
      return data.pages.list
    }

    case 'search_unpublished': {
      const data = await gql<{ pages: { search: { results?: Page[] } | Page[] } }>(
        base, token,
        `query($q: String!) { pages { search(query: $q) { results { id title path description isPublished locale } } } }`,
        { q: args.query as string }
      )
      const raw     = data.pages.search
      const results = Array.isArray(raw) ? raw : ((raw as { results?: Page[] }).results ?? [])
      return results.filter((p) => !p.isPublished)
    }

    case 'create_page': {
      const data = await gql<{ pages: { create: { responseResult: RR; page: { id: number; path: string } } } }>(
        base, token,
        `mutation($content: String!, $description: String!, $isPublished: Boolean!, $locale: String!, $path: String!, $title: String!) {
          pages {
            create(content: $content, description: $description, editor: "markdown", isPrivate: false, isPublished: $isPublished, locale: $locale, path: $path, publishEndDate: "", publishStartDate: "", scriptCss: "", scriptJs: "", tags: [], title: $title) {
              responseResult { succeeded errorCode message }
              page { id path }
            }
          }
        }`,
        {
          content:     args.content as string,
          description: (args.description as string) ?? '',
          isPublished: args.isPublished !== false,
          locale:      (args.locale as string) ?? 'en',
          path:        args.path as string,
          title:       args.title as string,
        }
      )
      if (!data.pages.create.responseResult.succeeded) throw new Error(data.pages.create.responseResult.message)
      return data.pages.create.page
    }

    case 'update_page': {
      const existing = await gql<{ pages: { single: PageFull } }>(
        base, token,
        `query($id: Int!) { pages { single(id: $id) { content title description isPublished locale path } } }`,
        { id: Number(args.id) }
      )
      const p    = existing.pages.single
      const data = await gql<{ pages: { update: { responseResult: RR } } }>(
        base, token,
        `mutation($id: Int!, $content: String!, $description: String!, $isPublished: Boolean!, $locale: String!, $path: String!, $title: String!) {
          pages {
            update(id: $id, content: $content, description: $description, editor: "markdown", isPrivate: false, isPublished: $isPublished, locale: $locale, path: $path, publishEndDate: "", publishStartDate: "", scriptCss: "", scriptJs: "", tags: [], title: $title) {
              responseResult { succeeded errorCode message }
            }
          }
        }`,
        {
          id:          Number(args.id),
          content:     (args.content     as string)  ?? p.content,
          title:       (args.title       as string)  ?? p.title,
          description: (args.description as string)  ?? p.description,
          isPublished: (args.isPublished as boolean) ?? p.isPublished,
          locale:      p.locale,
          path:        p.path,
        }
      )
      if (!data.pages.update.responseResult.succeeded) throw new Error(data.pages.update.responseResult.message)
      return { ok: true }
    }

    case 'publish_page': {
      const existing = await gql<{ pages: { single: PageFull } }>(
        base, token,
        `query($id: Int!) { pages { single(id: $id) { content title description locale path } } }`,
        { id: Number(args.id) }
      )
      const p    = existing.pages.single
      const data = await gql<{ pages: { update: { responseResult: RR } } }>(
        base, token,
        `mutation($id: Int!, $content: String!, $description: String!, $locale: String!, $path: String!, $title: String!) {
          pages {
            update(id: $id, content: $content, description: $description, editor: "markdown", isPrivate: false, isPublished: true, locale: $locale, path: $path, publishEndDate: "", publishStartDate: "", scriptCss: "", scriptJs: "", tags: [], title: $title) {
              responseResult { succeeded errorCode message }
            }
          }
        }`,
        { id: Number(args.id), content: p.content, description: p.description, locale: p.locale, path: p.path, title: p.title }
      )
      if (!data.pages.update.responseResult.succeeded) throw new Error(data.pages.update.responseResult.message)
      return { ok: true, published: true }
    }

    case 'delete_page':
    case 'force_delete_page': {
      const data = await gql<{ pages: { delete: { responseResult: RR } } }>(
        base, token,
        `mutation($id: Int!) { pages { delete(id: $id) { responseResult { succeeded message } } } }`,
        { id: Number(args.id) }
      )
      if (!data.pages.delete.responseResult.succeeded) throw new Error(data.pages.delete.responseResult.message)
      return { ok: true }
    }

    case 'list_users': {
      const data = await gql<{ users: { list: unknown[] } }>(
        base, token,
        `{ users { list { id name email } } }`
      )
      return data.users.list
    }

    case 'search_users': {
      const data = await gql<{ users: { search: unknown[] } }>(
        base, token,
        `query($q: String!) { users { search(query: $q) { id name email } } }`,
        { q: args.query as string }
      )
      return data.users.search
    }

    case 'create_user': {
      const data = await gql<{ users: { create: { responseResult: RR } } }>(
        base, token,
        `mutation($email: String!, $name: String!, $password: String!, $providerKey: String!, $roleId: Int!, $sendWelcome: Boolean!) {
          users {
            create(email: $email, name: $name, passwordRaw: $password, providerKey: $providerKey, roleId: $roleId, sendWelcomeEmail: $sendWelcome) {
              responseResult { succeeded errorCode message }
            }
          }
        }`,
        {
          email:       args.email as string,
          name:        args.name as string,
          password:    args.password as string,
          providerKey: (args.providerKey as string) ?? 'local',
          roleId:      Number(args.roleId ?? 2),
          sendWelcome: (args.sendWelcome as boolean) ?? false,
        }
      )
      if (!data.users.create.responseResult.succeeded) throw new Error(data.users.create.responseResult.message)
      return { ok: true }
    }

    case 'update_user': {
      const data = await gql<{ users: { update: { responseResult: RR } } }>(
        base, token,
        `mutation($id: Int!, $name: String, $email: String, $newPassword: String) {
          users {
            update(id: $id, name: $name, email: $email, newPassword: $newPassword) {
              responseResult { succeeded errorCode message }
            }
          }
        }`,
        {
          id:          Number(args.id),
          name:        args.name ?? null,
          email:       args.email ?? null,
          newPassword: args.newPassword ?? null,
        }
      )
      if (!data.users.update.responseResult.succeeded) throw new Error(data.users.update.responseResult.message)
      return { ok: true }
    }

    case 'list_groups': {
      const data = await gql<{ groups: { list: unknown[] } }>(
        base, token,
        `{ groups { list { id name isSystem } } }`
      )
      return data.groups.list
    }

    default:
      throw new Error(`Unknown WikiJS tool: ${toolName}`)
  }
}

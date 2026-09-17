import { getCredential } from '../db'
import type { MCPTool } from '../mcp-client'
import { restFetch, multipartFetch } from './http'

// ─── Shared field fragments ────────────────────────────────────────────────────

const PAGINATION = {
  page:      { type: 'number', description: 'Page number (default 1)' },
  page_size: { type: 'number', description: 'Results per page (default 25)' },
}

const MATCHING = {
  match:               { type: 'string', description: 'Matching pattern (plain text, or a regex when matching_algorithm=4)' },
  matching_algorithm:  { type: 'number', description: 'How match is applied: 0=none, 1=any word, 2=all words, 3=exact match, 4=regex, 5=fuzzy, 6=auto' },
  is_insensitive:      { type: 'boolean', description: 'Case-insensitive matching' },
}

const CUSTOM_FIELD_VALUE = {
  type: 'object',
  properties: {
    field: { type: 'number', description: 'Custom field ID' },
    value: { description: 'Value to set — string, number, boolean, array of IDs, or null, depending on the field\'s data_type' },
  },
  required: ['field'],
}

// ─── Tools ────────────────────────────────────────────────────────────────────

export const TOOLS: MCPTool[] = [
  // ── Documents ────────────────────────────────────────────────────────────────
  {
    name: 'list_documents',
    description: 'List and filter documents. To resolve a name to an ID first, use list_tags/list_correspondents/list_document_types/list_storage_paths — ID filters are far more reliable than guessing. Content is omitted from results; use get_document_content for that.',
    inputSchema: {
      type: 'object',
      properties: {
        ...PAGINATION,
        search:              { type: 'string', description: 'Basic substring search across title/correspondent/content' },
        correspondent:       { type: 'number', description: 'Filter by correspondent ID' },
        document_type:       { type: 'number', description: 'Filter by document type ID' },
        tag:                 { type: 'number', description: 'Filter by tag ID' },
        storage_path:        { type: 'number', description: 'Filter by storage path ID' },
        created__date__gte:  { type: 'string', description: 'Only documents created on/after this date (YYYY-MM-DD)' },
        created__date__lte:  { type: 'string', description: 'Only documents created on/before this date (YYYY-MM-DD)' },
        ordering:            { type: 'string', description: "Sort field, e.g. '-created', 'title'" },
        more_like_id:        { type: 'number', description: 'Find documents similar to this document ID' },
        custom_field_query:  { type: 'string', description: "Filter by custom field values, e.g. '[\"custom_field_id\", \"exact\", \"value\"]'" },
      },
    },
  },
  {
    name: 'get_document',
    description: 'Get full details of one document by ID — correspondent, type, tags, custom fields. Content is omitted; use get_document_content for that.',
    inputSchema: { type: 'object', properties: { id: { type: 'number', description: 'Document ID' } }, required: ['id'] },
  },
  {
    name: 'get_document_content',
    description: 'Get the extracted OCR text content of a document by ID.',
    inputSchema: { type: 'object', properties: { id: { type: 'number', description: 'Document ID' } }, required: ['id'] },
  },
  {
    name: 'search_documents',
    description: "Full-text search using Paperless-NGX's query syntax — field prefixes (tag:, type:, correspondent:), boolean operators (AND/OR), date ranges (created:[2020 to 2024]), wildcards (prod*). For plain field filtering (by tag/correspondent/type ID), use list_documents instead.",
    inputSchema: {
      type: 'object',
      properties: { query: { type: 'string', description: 'Full-text query' }, ...PAGINATION },
      required: ['query'],
    },
  },
  {
    name: 'create_document',
    description: 'Upload a new document. Consumption is asynchronous — this returns a task_id; check its status with get_task or list_tasks (the document is only assigned an ID once the consumer finishes OCR/indexing).',
    inputSchema: {
      type: 'object',
      properties: {
        file:                  { type: 'string', description: 'Base64-encoded file content' },
        filename:              { type: 'string', description: "Original filename with extension, e.g. 'invoice.pdf'" },
        title:                 { type: 'string', description: 'Document title (optional)' },
        created:               { type: 'string', description: 'Document date, YYYY-MM-DD (optional)' },
        correspondent:         { type: 'number', description: 'Correspondent ID (optional)' },
        document_type:         { type: 'number', description: 'Document type ID (optional)' },
        storage_path:          { type: 'number', description: 'Storage path ID (optional)' },
        tags:                  { type: 'array', items: { type: 'number' }, description: 'Tag IDs (optional)' },
        archive_serial_number: { type: 'number', description: 'Archive serial number (optional)' },
        custom_fields:         { type: 'array', items: { type: 'number' }, description: 'Custom field IDs to pre-attach (optional)' },
      },
      required: ['file', 'filename'],
    },
  },
  {
    name: 'update_document',
    description: 'Update fields on ONE document (PATCH — only supplied fields change). Editable: title, correspondent, document_type, storage_path, tags (replaces the array), content, created, archive_serial_number, owner, custom_fields. For the same change across many documents, use bulk_edit_documents.',
    inputSchema: {
      type: 'object',
      properties: {
        id:                    { type: 'number', description: 'Document ID' },
        title:                 { type: 'string', description: 'Title (max 128 chars)' },
        correspondent:         { type: 'number', description: 'Correspondent ID (null clears it)' },
        document_type:         { type: 'number', description: 'Document type ID (null clears it)' },
        storage_path:          { type: 'number', description: 'Storage path ID (null clears it)' },
        tags:                  { type: 'array', items: { type: 'number' }, description: 'Tag IDs — replaces the full set' },
        content:               { type: 'string', description: 'Raw searchable text content' },
        created:               { type: 'string', description: 'Document date, YYYY-MM-DD' },
        archive_serial_number: { type: 'number', description: 'Archive serial number' },
        owner:                 { type: 'number', description: 'Owning user ID (null clears it)' },
        custom_fields:         { type: 'array', items: CUSTOM_FIELD_VALUE, description: 'Custom field values to set' },
      },
      required: ['id'],
    },
  },
  {
    name: 'delete_document',
    description: 'Move a document to the trash (soft-delete, recoverable). Use restore_from_trash to undo, or empty_trash to purge permanently.',
    inputSchema: { type: 'object', properties: { id: { type: 'number', description: 'Document ID' } }, required: ['id'] },
  },
  {
    name: 'get_document_metadata',
    description: 'Get file metadata for a document — checksums, file sizes, archival info.',
    inputSchema: { type: 'object', properties: { id: { type: 'number', description: 'Document ID' } }, required: ['id'] },
  },
  {
    name: 'get_document_suggestions',
    description: "Get Paperless's AI-powered suggestions for a document's correspondent, tags, and document type based on its content.",
    inputSchema: { type: 'object', properties: { id: { type: 'number', description: 'Document ID' } }, required: ['id'] },
  },
  {
    name: 'list_document_notes',
    description: 'List notes (comments/annotations) on a document.',
    inputSchema: { type: 'object', properties: { id: { type: 'number', description: 'Document ID' } }, required: ['id'] },
  },
  {
    name: 'create_document_note',
    description: "Append a note to a document. Notes are separate from the document's searchable content — use update_document to change that.",
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'number', description: 'Document ID' }, note: { type: 'string', description: 'Note text' } },
      required: ['id', 'note'],
    },
  },
  {
    name: 'delete_document_note',
    description: 'Delete a note from a document.',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'number', description: 'Document ID' }, note_id: { type: 'number', description: 'Note ID' } },
      required: ['id', 'note_id'],
    },
  },
  {
    name: 'bulk_edit_documents',
    description: "Apply ONE operation to MANY documents at once. Methods: set_correspondent, set_document_type, set_storage_path (each takes the matching *_id arg, or null to clear), add_tag/remove_tag (takes tag), modify_tags (takes add_tags/remove_tags), modify_custom_fields (takes add_custom_fields/remove_custom_field_ids), set_permissions (takes owner/view_users/view_groups/change_users/change_groups/merge_permissions), delete, reprocess, merge (takes metadata_document_id, delete_originals), split (takes pages, delete_originals), rotate (takes degrees), delete_pages (takes pages). ⚠️ 'delete' permanently deletes; 'remove_tag' only unlinks the tag from these documents (the tag itself survives) — see delete_tag to remove it system-wide.",
    inputSchema: {
      type: 'object',
      properties: {
        documents:              { type: 'array', items: { type: 'number' }, description: 'Document IDs to operate on' },
        method: {
          type: 'string',
          enum: ['set_correspondent', 'set_document_type', 'set_storage_path', 'add_tag', 'remove_tag', 'modify_tags', 'modify_custom_fields', 'delete', 'reprocess', 'set_permissions', 'merge', 'split', 'rotate', 'delete_pages'],
        },
        correspondent_id:       { type: 'number', description: 'set_correspondent' },
        document_type_id:       { type: 'number', description: 'set_document_type' },
        storage_path_id:        { type: 'number', description: 'set_storage_path' },
        tag:                    { type: 'number', description: 'add_tag / remove_tag' },
        add_tags:               { type: 'array', items: { type: 'number' }, description: 'modify_tags' },
        remove_tags:            { type: 'array', items: { type: 'number' }, description: 'modify_tags' },
        add_custom_fields:       { type: 'array', items: CUSTOM_FIELD_VALUE, description: 'modify_custom_fields' },
        remove_custom_field_ids: { type: 'array', items: { type: 'number' }, description: 'modify_custom_fields' },
        owner:                   { type: 'number', description: 'set_permissions — user ID, or null to clear' },
        view_users:              { type: 'array', items: { type: 'number' }, description: 'set_permissions' },
        view_groups:             { type: 'array', items: { type: 'number' }, description: 'set_permissions' },
        change_users:            { type: 'array', items: { type: 'number' }, description: 'set_permissions' },
        change_groups:           { type: 'array', items: { type: 'number' }, description: 'set_permissions' },
        merge_permissions:       { type: 'boolean', description: 'set_permissions — merge with existing instead of replacing' },
        metadata_document_id:    { type: 'number', description: 'merge — source document to copy metadata from' },
        delete_originals:        { type: 'boolean', description: 'merge / split — delete the source documents afterward' },
        pages:                   { type: 'string', description: "split / delete_pages — page spec e.g. '1,3,5-7'" },
        degrees:                 { type: 'number', description: 'rotate — 90, 180, or 270' },
      },
      required: ['documents', 'method'],
    },
  },
  {
    name: 'get_next_asn',
    description: 'Get the next available Archive Serial Number for document filing.',
    inputSchema: { type: 'object', properties: {} },
  },

  // ── Tags ─────────────────────────────────────────────────────────────────────
  {
    name: 'list_tags',
    description: 'List all tags.',
    inputSchema: { type: 'object', properties: { ...PAGINATION, name__icontains: { type: 'string', description: 'Filter by name substring' }, ordering: { type: 'string' } } },
  },
  { name: 'get_tag', description: 'Get a tag by ID.', inputSchema: { type: 'object', properties: { id: { type: 'number' } }, required: ['id'] } },
  {
    name: 'create_tag',
    description: 'Create a new tag, with optional color and auto-matching rule.',
    inputSchema: {
      type: 'object',
      properties: { name: { type: 'string' }, color: { type: 'string', description: 'Hex color e.g. #ff4444' }, ...MATCHING, parent: { type: 'number', description: 'Parent tag ID for hierarchy' } },
      required: ['name'],
    },
  },
  {
    name: 'update_tag',
    description: 'Update fields on ONE tag (PATCH). To add/remove this tag on documents, use bulk_edit_documents instead.',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'number' }, name: { type: 'string' }, color: { type: 'string' }, ...MATCHING, parent: { type: 'number' } },
      required: ['id'],
    },
  },
  { name: 'delete_tag', description: '⚠️ Permanently deletes a tag system-wide, removing it from every document that uses it.', inputSchema: { type: 'object', properties: { id: { type: 'number' } }, required: ['id'] } },

  // ── Correspondents ─────────────────────────────────────────────────────────
  {
    name: 'list_correspondents',
    description: 'List all correspondents (senders/receivers of documents).',
    inputSchema: { type: 'object', properties: { ...PAGINATION, name__icontains: { type: 'string' }, ordering: { type: 'string' } } },
  },
  { name: 'get_correspondent', description: 'Get a correspondent by ID.', inputSchema: { type: 'object', properties: { id: { type: 'number' } }, required: ['id'] } },
  {
    name: 'create_correspondent',
    description: 'Create a new correspondent, with optional auto-matching rule.',
    inputSchema: { type: 'object', properties: { name: { type: 'string' }, ...MATCHING }, required: ['name'] },
  },
  {
    name: 'update_correspondent',
    description: 'Update fields on ONE correspondent (PATCH). To assign it to documents, use bulk_edit_documents or update_document.',
    inputSchema: { type: 'object', properties: { id: { type: 'number' }, name: { type: 'string' }, ...MATCHING }, required: ['id'] },
  },
  { name: 'delete_correspondent', description: '⚠️ Permanently deletes a correspondent system-wide.', inputSchema: { type: 'object', properties: { id: { type: 'number' } }, required: ['id'] } },

  // ── Document types ─────────────────────────────────────────────────────────
  {
    name: 'list_document_types',
    description: 'List all document types.',
    inputSchema: { type: 'object', properties: { ...PAGINATION, name__icontains: { type: 'string' }, ordering: { type: 'string' } } },
  },
  { name: 'get_document_type', description: 'Get a document type by ID.', inputSchema: { type: 'object', properties: { id: { type: 'number' } }, required: ['id'] } },
  {
    name: 'create_document_type',
    description: 'Create a new document type, with optional auto-matching rule.',
    inputSchema: { type: 'object', properties: { name: { type: 'string' }, ...MATCHING }, required: ['name'] },
  },
  {
    name: 'update_document_type',
    description: 'Update fields on ONE document type (PATCH). To assign it to documents, use bulk_edit_documents or update_document.',
    inputSchema: { type: 'object', properties: { id: { type: 'number' }, name: { type: 'string' }, ...MATCHING }, required: ['id'] },
  },
  { name: 'delete_document_type', description: '⚠️ Permanently deletes a document type system-wide.', inputSchema: { type: 'object', properties: { id: { type: 'number' } }, required: ['id'] } },

  // ── Storage paths ─────────────────────────────────────────────────────────
  {
    name: 'list_storage_paths',
    description: 'List all storage paths (folder-layout templates).',
    inputSchema: { type: 'object', properties: { ...PAGINATION, name__icontains: { type: 'string' }, ordering: { type: 'string' } } },
  },
  { name: 'get_storage_path', description: 'Get a storage path by ID.', inputSchema: { type: 'object', properties: { id: { type: 'number' } }, required: ['id'] } },
  {
    name: 'create_storage_path',
    description: "Create a new storage path. 'path' is a template e.g. '{{ created_year }}/{{ correspondent }}/{{ title }}'.",
    inputSchema: { type: 'object', properties: { name: { type: 'string' }, path: { type: 'string' }, ...MATCHING }, required: ['name', 'path'] },
  },
  {
    name: 'update_storage_path',
    description: 'Update fields on ONE storage path (PATCH). To assign it to documents, use bulk_edit_documents or update_document.',
    inputSchema: { type: 'object', properties: { id: { type: 'number' }, name: { type: 'string' }, path: { type: 'string' }, ...MATCHING }, required: ['id'] },
  },
  { name: 'delete_storage_path', description: '⚠️ Permanently deletes a storage path system-wide.', inputSchema: { type: 'object', properties: { id: { type: 'number' } }, required: ['id'] } },

  // ── Custom fields ─────────────────────────────────────────────────────────
  {
    name: 'list_custom_fields',
    description: 'List all custom field definitions.',
    inputSchema: { type: 'object', properties: { ...PAGINATION, ordering: { type: 'string' } } },
  },
  { name: 'get_custom_field', description: 'Get a custom field definition by ID.', inputSchema: { type: 'object', properties: { id: { type: 'number' } }, required: ['id'] } },
  {
    name: 'create_custom_field',
    description: 'Create a new custom field. Monetary values must use a currency-code prefix (e.g. USD10.00), not a trailing symbol.',
    inputSchema: {
      type: 'object',
      properties: {
        name:      { type: 'string' },
        data_type: { type: 'string', enum: ['string', 'url', 'date', 'boolean', 'integer', 'float', 'monetary', 'documentlink', 'select'] },
        extra_data: { type: 'object', description: "e.g. { select_options: ['a','b'] } for data_type=select" },
      },
      required: ['name', 'data_type'],
    },
  },
  {
    name: 'update_custom_field',
    description: '⚠️ Update ONE custom field definition (PATCH). Changing data_type on a field already in use on documents can make existing values unreadable.',
    inputSchema: {
      type: 'object',
      properties: {
        id:         { type: 'number' },
        name:       { type: 'string' },
        data_type:  { type: 'string', enum: ['string', 'url', 'date', 'boolean', 'integer', 'float', 'monetary', 'documentlink', 'select'] },
        extra_data: { type: 'object' },
      },
      required: ['id'],
    },
  },
  { name: 'delete_custom_field', description: '⚠️ Permanently deletes a custom field system-wide, removing its values from every document.', inputSchema: { type: 'object', properties: { id: { type: 'number' } }, required: ['id'] } },

  // ── Saved views ─────────────────────────────────────────────────────────────
  { name: 'list_saved_views', description: 'List saved views (stored filter/sort configurations).', inputSchema: { type: 'object', properties: { ...PAGINATION } } },
  { name: 'get_saved_view', description: 'Get a saved view by ID, including its filter rules.', inputSchema: { type: 'object', properties: { id: { type: 'number' } }, required: ['id'] } },

  // ── Share links ───────────────────────────────────────────────────────────
  { name: 'list_share_links', description: 'List all public share links.', inputSchema: { type: 'object', properties: { ...PAGINATION, ordering: { type: 'string' } } } },
  {
    name: 'create_share_link',
    description: 'Create a public share link for a document.',
    inputSchema: {
      type: 'object',
      properties: {
        document:     { type: 'number', description: 'Document ID to share' },
        expiration:   { type: 'string', description: 'ISO expiration date-time, or omit for no expiry' },
        file_version: { type: 'string', enum: ['archive', 'original'], description: 'Which version to share (default archive)' },
      },
      required: ['document'],
    },
  },
  { name: 'delete_share_link', description: 'Delete a share link — the shared URL stops working.', inputSchema: { type: 'object', properties: { id: { type: 'number' } }, required: ['id'] } },

  // ── System ───────────────────────────────────────────────────────────────────
  { name: 'get_statistics', description: 'Get system statistics — document counts, inbox status, file type breakdown, storage.', inputSchema: { type: 'object', properties: {} } },
  {
    name: 'list_tasks',
    description: 'List background tasks (document consumption, etc). Filter by task_id to track a specific upload.',
    inputSchema: { type: 'object', properties: { task_id: { type: 'string', description: 'Filter to one task by its UUID' }, ordering: { type: 'string' } } },
  },
  { name: 'get_task', description: 'Get one background task by its numeric ID (not its UUID — use list_tasks with task_id to look that up first).', inputSchema: { type: 'object', properties: { id: { type: 'number' } }, required: ['id'] } },

  // ── Trash ────────────────────────────────────────────────────────────────────
  { name: 'list_trash', description: 'List documents currently in the trash.', inputSchema: { type: 'object', properties: { ...PAGINATION } } },
  {
    name: 'restore_from_trash',
    description: 'Restore documents out of the trash back into the system.',
    inputSchema: { type: 'object', properties: { documents: { type: 'array', items: { type: 'number' }, description: 'Document IDs to restore' } }, required: ['documents'] },
  },
  {
    name: 'empty_trash',
    description: '⚠️ Permanently and irreversibly delete documents from the trash. Omit documents to empty the entire trash.',
    inputSchema: { type: 'object', properties: { documents: { type: 'array', items: { type: 'number' }, description: 'Document IDs to purge — omit to purge everything in the trash' } } },
  },
]

// ─── Credentials ──────────────────────────────────────────────────────────────

function cfg(instanceId: string) {
  const url   = getCredential(instanceId, 'PAPERLESS_URL')
  const token = getCredential(instanceId, 'PAPERLESS_TOKEN')
  if (!url || !token) throw new Error('Paperless-NGX credentials not configured. Set PAPERLESS_URL and PAPERLESS_TOKEN.')
  return { base: url.replace(/\/$/, ''), token }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function qs(params: Record<string, unknown>): string {
  const p = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null) continue
    if (Array.isArray(v)) { for (const item of v) p.append(k, String(item)) }
    else p.set(k, String(v))
  }
  const s = p.toString()
  return s ? `?${s}` : ''
}

function api<T>(base: string, token: string, path: string, init?: RequestInit): Promise<T> {
  return restFetch<T>(base, `/api${path}`, token, 'Authorization', 'Token', init)
}

function withoutUndefined<T extends Record<string, unknown>>(obj: T): Partial<T> {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined)) as Partial<T>
}

function bulkEditParameters(a: Record<string, unknown>): Record<string, unknown> {
  switch (a.method) {
    // Not `?? null`: an omitted id must stay omitted so Paperless rejects the request —
    // defaulting to null here would turn a caller's forgotten argument into a silent
    // mass-clear of correspondent/type/storage-path across every targeted document.
    case 'set_correspondent': return { correspondent: a.correspondent_id }
    case 'set_document_type': return { document_type: a.document_type_id }
    case 'set_storage_path':  return { storage_path: a.storage_path_id }
    case 'add_tag':
    case 'remove_tag':        return { tag: a.tag }
    case 'modify_tags':       return { add_tags: a.add_tags ?? [], remove_tags: a.remove_tags ?? [] }
    case 'modify_custom_fields': {
      const add = (a.add_custom_fields as Array<{ field: number; value?: unknown }> | undefined) ?? []
      return {
        add_custom_fields:    Object.fromEntries(add.map((cf) => [String(cf.field), cf.value ?? null])),
        remove_custom_fields: a.remove_custom_field_ids ?? [],
      }
    }
    case 'set_permissions': {
      const params: Record<string, unknown> = {
        set_permissions: {
          view:   { users: a.view_users ?? [], groups: a.view_groups ?? [] },
          change: { users: a.change_users ?? [], groups: a.change_groups ?? [] },
        },
      }
      if (a.owner !== undefined) params.owner = a.owner
      if (a.merge_permissions !== undefined) params.merge = a.merge_permissions
      return params
    }
    case 'merge':         return withoutUndefined({ metadata_document_id: a.metadata_document_id, delete_originals: a.delete_originals })
    case 'split':         return withoutUndefined({ pages: a.pages, delete_originals: a.delete_originals })
    case 'rotate':        return { degrees: a.degrees }
    case 'delete_pages':  return { pages: a.pages }
    default:              return {}
  }
}

// ─── Ping ─────────────────────────────────────────────────────────────────────

export async function ping(instanceId: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const { base, token } = cfg(instanceId)
    await api(base, token, '/documents/?page_size=1')
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Unknown error' }
  }
}

// ─── Tool handler ─────────────────────────────────────────────────────────────

export async function call(instanceId: string, toolName: string, args: Record<string, unknown>): Promise<unknown> {
  const { base, token } = cfg(instanceId)
  const a = args

  switch (toolName) {

    // ── Documents ──────────────────────────────────────────────────────────────

    case 'list_documents':
      return api(base, token, `/documents/${qs({
        page: a.page, page_size: a.page_size, search: a.search,
        correspondent__id: a.correspondent, document_type__id: a.document_type,
        tags__id: a.tag, storage_path__id: a.storage_path,
        created__date__gte: a.created__date__gte, created__date__lte: a.created__date__lte,
        ordering: a.ordering, more_like_id: a.more_like_id, custom_field_query: a.custom_field_query,
      })}`)

    case 'get_document':
      return api(base, token, `/documents/${Number(a.id)}/`)

    case 'get_document_content': {
      const doc = await api<{ id: number; title: string; content: string }>(base, token, `/documents/${Number(a.id)}/`)
      return { id: doc.id, title: doc.title, content: doc.content }
    }

    case 'search_documents':
      return api(base, token, `/documents/${qs({ query: a.query, page: a.page, page_size: a.page_size })}`)

    case 'create_document': {
      const buffer = Buffer.from(String(a.file), 'base64')
      const form   = new FormData()
      form.append('document', new Blob([buffer]), String(a.filename))
      if (a.title !== undefined) form.append('title', String(a.title))
      if (a.created !== undefined) form.append('created', String(a.created))
      if (a.correspondent !== undefined) form.append('correspondent', String(a.correspondent))
      if (a.document_type !== undefined) form.append('document_type', String(a.document_type))
      if (a.storage_path !== undefined) form.append('storage_path', String(a.storage_path))
      if (a.archive_serial_number !== undefined) form.append('archive_serial_number', String(a.archive_serial_number))
      for (const t of (a.tags as number[] | undefined) ?? []) form.append('tags', String(t))
      for (const f of (a.custom_fields as number[] | undefined) ?? []) form.append('custom_fields', String(f))

      const taskId = await multipartFetch<string>(base, '/api/documents/post_document/', token, form, 'Authorization', 'Token')
      return { task_id: taskId, message: 'Upload queued for consumption. Check progress with get_task or list_tasks using this task_id.' }
    }

    case 'update_document': {
      const { id, ...body } = a
      return api(base, token, `/documents/${Number(id)}/`, { method: 'PATCH', body: JSON.stringify(withoutUndefined(body)) })
    }

    case 'delete_document':
      return api(base, token, `/documents/${Number(a.id)}/`, { method: 'DELETE' })

    case 'get_document_metadata':
      return api(base, token, `/documents/${Number(a.id)}/metadata/`)

    case 'get_document_suggestions':
      return api(base, token, `/documents/${Number(a.id)}/suggestions/`)

    case 'list_document_notes':
      return api(base, token, `/documents/${Number(a.id)}/notes/`)

    case 'create_document_note':
      return api(base, token, `/documents/${Number(a.id)}/notes/`, { method: 'POST', body: JSON.stringify({ note: a.note }) })

    case 'delete_document_note':
      return api(base, token, `/documents/${Number(a.id)}/notes/${Number(a.note_id)}/`, { method: 'DELETE' })

    case 'bulk_edit_documents':
      return api(base, token, '/documents/bulk_edit/', {
        method: 'POST',
        body: JSON.stringify({ documents: a.documents, method: a.method, parameters: bulkEditParameters(a) }),
      })

    case 'get_next_asn':
      return api(base, token, '/documents/next_asn/')

    // ── Tags ───────────────────────────────────────────────────────────────────

    case 'list_tags':
      return api(base, token, `/tags/${qs({ page: a.page, page_size: a.page_size, name__icontains: a.name__icontains, ordering: a.ordering })}`)

    case 'get_tag':
      return api(base, token, `/tags/${Number(a.id)}/`)

    case 'create_tag':
      return api(base, token, '/tags/', { method: 'POST', body: JSON.stringify(withoutUndefined(a)) })

    case 'update_tag': {
      const { id, ...body } = a
      return api(base, token, `/tags/${Number(id)}/`, { method: 'PATCH', body: JSON.stringify(withoutUndefined(body)) })
    }

    case 'delete_tag':
      return api(base, token, `/tags/${Number(a.id)}/`, { method: 'DELETE' })

    // ── Correspondents ─────────────────────────────────────────────────────────

    case 'list_correspondents':
      return api(base, token, `/correspondents/${qs({ page: a.page, page_size: a.page_size, name__icontains: a.name__icontains, ordering: a.ordering })}`)

    case 'get_correspondent':
      return api(base, token, `/correspondents/${Number(a.id)}/`)

    case 'create_correspondent':
      return api(base, token, '/correspondents/', { method: 'POST', body: JSON.stringify(withoutUndefined(a)) })

    case 'update_correspondent': {
      const { id, ...body } = a
      return api(base, token, `/correspondents/${Number(id)}/`, { method: 'PATCH', body: JSON.stringify(withoutUndefined(body)) })
    }

    case 'delete_correspondent':
      return api(base, token, `/correspondents/${Number(a.id)}/`, { method: 'DELETE' })

    // ── Document types ─────────────────────────────────────────────────────────

    case 'list_document_types':
      return api(base, token, `/document_types/${qs({ page: a.page, page_size: a.page_size, name__icontains: a.name__icontains, ordering: a.ordering })}`)

    case 'get_document_type':
      return api(base, token, `/document_types/${Number(a.id)}/`)

    case 'create_document_type':
      return api(base, token, '/document_types/', { method: 'POST', body: JSON.stringify(withoutUndefined(a)) })

    case 'update_document_type': {
      const { id, ...body } = a
      return api(base, token, `/document_types/${Number(id)}/`, { method: 'PATCH', body: JSON.stringify(withoutUndefined(body)) })
    }

    case 'delete_document_type':
      return api(base, token, `/document_types/${Number(a.id)}/`, { method: 'DELETE' })

    // ── Storage paths ─────────────────────────────────────────────────────────

    case 'list_storage_paths':
      return api(base, token, `/storage_paths/${qs({ page: a.page, page_size: a.page_size, name__icontains: a.name__icontains, ordering: a.ordering })}`)

    case 'get_storage_path':
      return api(base, token, `/storage_paths/${Number(a.id)}/`)

    case 'create_storage_path':
      return api(base, token, '/storage_paths/', { method: 'POST', body: JSON.stringify(withoutUndefined(a)) })

    case 'update_storage_path': {
      const { id, ...body } = a
      return api(base, token, `/storage_paths/${Number(id)}/`, { method: 'PATCH', body: JSON.stringify(withoutUndefined(body)) })
    }

    case 'delete_storage_path':
      return api(base, token, `/storage_paths/${Number(a.id)}/`, { method: 'DELETE' })

    // ── Custom fields ─────────────────────────────────────────────────────────

    case 'list_custom_fields':
      return api(base, token, `/custom_fields/${qs({ page: a.page, page_size: a.page_size, ordering: a.ordering })}`)

    case 'get_custom_field':
      return api(base, token, `/custom_fields/${Number(a.id)}/`)

    case 'create_custom_field':
      return api(base, token, '/custom_fields/', { method: 'POST', body: JSON.stringify(withoutUndefined(a)) })

    case 'update_custom_field': {
      const { id, ...body } = a
      return api(base, token, `/custom_fields/${Number(id)}/`, { method: 'PATCH', body: JSON.stringify(withoutUndefined(body)) })
    }

    case 'delete_custom_field':
      return api(base, token, `/custom_fields/${Number(a.id)}/`, { method: 'DELETE' })

    // ── Saved views ─────────────────────────────────────────────────────────────

    case 'list_saved_views':
      return api(base, token, `/saved_views/${qs({ page: a.page, page_size: a.page_size })}`)

    case 'get_saved_view':
      return api(base, token, `/saved_views/${Number(a.id)}/`)

    // ── Share links ───────────────────────────────────────────────────────────

    case 'list_share_links':
      return api(base, token, `/share_links/${qs({ page: a.page, page_size: a.page_size, ordering: a.ordering })}`)

    case 'create_share_link':
      return api(base, token, '/share_links/', { method: 'POST', body: JSON.stringify(withoutUndefined(a)) })

    case 'delete_share_link':
      return api(base, token, `/share_links/${Number(a.id)}/`, { method: 'DELETE' })

    // ── System ─────────────────────────────────────────────────────────────────

    case 'get_statistics':
      return api(base, token, '/statistics/')

    case 'list_tasks':
      return api(base, token, `/tasks/${qs({ task_id: a.task_id, ordering: a.ordering })}`)

    case 'get_task':
      return api(base, token, `/tasks/${Number(a.id)}/`)

    // ── Trash ──────────────────────────────────────────────────────────────────

    case 'list_trash':
      return api(base, token, `/trash/${qs({ page: a.page, page_size: a.page_size })}`)

    case 'restore_from_trash':
      return api(base, token, '/trash/', { method: 'POST', body: JSON.stringify({ documents: a.documents, action: 'restore' }) })

    case 'empty_trash':
      return api(base, token, '/trash/', { method: 'POST', body: JSON.stringify({ action: 'empty', ...(a.documents ? { documents: a.documents } : {}) }) })

    default:
      throw new Error(`Unknown Paperless-NGX tool: ${toolName}`)
  }
}

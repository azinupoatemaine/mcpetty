import { getCredential } from '../db'
import type { MCPTool } from '../mcp-client'
import { restFetch } from './http'

// ─── Tools ────────────────────────────────────────────────────────────────────

export const TOOLS: MCPTool[] = [
  // ── Accounts ─────────────────────────────────────────────────────────────────
  {
    name: 'list_accounts',
    description: 'List all accounts. Optionally filter by type (asset, expense, revenue, liability, etc.).',
    inputSchema: {
      type: 'object',
      properties: {
        type:  { type: 'string', enum: ['all','asset','cash','expense','revenue','liability','liabilities','loan','debt','mortgage'], description: 'Account type filter' },
        page:  { type: 'number', description: 'Page number (default 1)' },
        limit: { type: 'number', description: 'Results per page (default 50)' },
        date:  { type: 'string', description: 'ISO date — returns balance as of this date for asset/liability accounts' },
      },
    },
  },
  {
    name: 'get_account',
    description: 'Get a single account by ID.',
    inputSchema: {
      type: 'object',
      properties: {
        id:   { type: 'string', description: 'Account ID' },
        date: { type: 'string', description: 'ISO date for balance calculation' },
      },
      required: ['id'],
    },
  },
  {
    name: 'create_account',
    description: 'Create a new account.',
    inputSchema: {
      type: 'object',
      properties: {
        name:              { type: 'string', description: 'Account name' },
        type:              { type: 'string', enum: ['asset','expense','revenue','liability','loan','debt','mortgage'], description: 'Account type' },
        currency_code:     { type: 'string', description: 'Currency code e.g. USD, EUR' },
        iban:              { type: 'string', description: 'IBAN (optional)' },
        bic:               { type: 'string', description: 'BIC/SWIFT (optional)' },
        account_number:    { type: 'string', description: 'Account number (optional)' },
        virtual_balance:   { type: 'string', description: 'Virtual balance (optional)' },
        opening_balance:   { type: 'string', description: 'Opening balance (optional)' },
        opening_balance_date: { type: 'string', description: 'Date of opening balance (optional)' },
        notes:             { type: 'string', description: 'Notes (optional)' },
      },
      required: ['name', 'type'],
    },
  },
  {
    name: 'update_account',
    description: 'Update an existing account.',
    inputSchema: {
      type: 'object',
      properties: {
        id:               { type: 'string', description: 'Account ID' },
        name:             { type: 'string', description: 'Account name' },
        currency_code:    { type: 'string', description: 'Currency code' },
        iban:             { type: 'string', description: 'IBAN' },
        virtual_balance:  { type: 'string', description: 'Virtual balance' },
        opening_balance:  { type: 'string', description: 'Opening balance' },
        opening_balance_date: { type: 'string', description: 'Date of opening balance' },
        notes:            { type: 'string', description: 'Notes' },
      },
      required: ['id'],
    },
  },
  {
    name: 'delete_account',
    description: 'Delete an account by ID.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Account ID' },
      },
      required: ['id'],
    },
  },
  {
    name: 'list_account_transactions',
    description: 'List transactions for a specific account.',
    inputSchema: {
      type: 'object',
      properties: {
        id:    { type: 'string', description: 'Account ID' },
        page:  { type: 'number', description: 'Page number' },
        limit: { type: 'number', description: 'Results per page' },
        start: { type: 'string', description: 'Start date (YYYY-MM-DD)' },
        end:   { type: 'string', description: 'End date (YYYY-MM-DD)' },
        type:  { type: 'string', enum: ['all','withdrawal','deposit','transfer','reconciliation','opening_balance'], description: 'Transaction type filter' },
      },
      required: ['id'],
    },
  },

  // ── Transactions ──────────────────────────────────────────────────────────────
  {
    name: 'list_transactions',
    description: 'List transactions with optional date range and type filter.',
    inputSchema: {
      type: 'object',
      properties: {
        page:  { type: 'number', description: 'Page number' },
        limit: { type: 'number', description: 'Results per page' },
        start: { type: 'string', description: 'Start date (YYYY-MM-DD)' },
        end:   { type: 'string', description: 'End date (YYYY-MM-DD)' },
        type:  { type: 'string', enum: ['all','withdrawal','deposit','transfer','reconciliation','opening_balance'], description: 'Transaction type filter' },
      },
    },
  },
  {
    name: 'get_transaction',
    description: 'Get a single transaction by ID.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Transaction ID' },
      },
      required: ['id'],
    },
  },
  {
    name: 'create_transaction',
    description: 'Create a new transaction. For splits, provide multiple entries in the transactions array.',
    inputSchema: {
      type: 'object',
      properties: {
        group_title: { type: 'string', description: 'Title for split transactions' },
        transactions: {
          type: 'array',
          description: 'One or more transaction splits',
          items: {
            type: 'object',
            properties: {
              type:             { type: 'string', enum: ['withdrawal','deposit','transfer','reconciliation','opening_balance'], description: 'Transaction type' },
              date:             { type: 'string', description: 'Date (YYYY-MM-DD or ISO 8601)' },
              amount:           { type: 'string', description: 'Amount (positive, as string)' },
              description:      { type: 'string', description: 'Transaction description' },
              source_id:        { type: 'string', description: 'Source account ID (preferred over name)' },
              source_name:      { type: 'string', description: 'Source account name' },
              destination_id:   { type: 'string', description: 'Destination account ID' },
              destination_name: { type: 'string', description: 'Destination account name' },
              currency_code:    { type: 'string', description: 'Currency code e.g. EUR' },
              category_name:    { type: 'string', description: 'Category name (auto-created if new)' },
              budget_name:      { type: 'string', description: 'Budget name' },
              tags:             { type: 'array', items: { type: 'string' }, description: 'Tags to attach' },
              notes:            { type: 'string', description: 'Notes' },
              reconciled:       { type: 'boolean', description: 'Mark as reconciled' },
            },
            required: ['type', 'date', 'amount', 'description'],
          },
        },
      },
      required: ['transactions'],
    },
  },
  {
    name: 'update_transaction',
    description: 'Update an existing transaction group.',
    inputSchema: {
      type: 'object',
      properties: {
        id:           { type: 'string', description: 'Transaction group ID' },
        group_title:  { type: 'string', description: 'Group title for splits' },
        transactions: {
          type: 'array',
          description: 'Updated transaction splits',
          items: {
            type: 'object',
            properties: {
              transaction_journal_id: { type: 'string', description: 'Journal ID of the split to update' },
              type:             { type: 'string', enum: ['withdrawal','deposit','transfer','reconciliation','opening_balance'] },
              date:             { type: 'string' },
              amount:           { type: 'string' },
              description:      { type: 'string' },
              source_id:        { type: 'string' },
              source_name:      { type: 'string' },
              destination_id:   { type: 'string' },
              destination_name: { type: 'string' },
              currency_code:    { type: 'string' },
              category_name:    { type: 'string' },
              budget_name:      { type: 'string' },
              tags:             { type: 'array', items: { type: 'string' } },
              notes:            { type: 'string' },
              reconciled:       { type: 'boolean' },
            },
          },
        },
      },
      required: ['id', 'transactions'],
    },
  },
  {
    name: 'delete_transaction',
    description: 'Delete a transaction group by ID.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Transaction group ID' },
      },
      required: ['id'],
    },
  },

  // ── Bills ─────────────────────────────────────────────────────────────────────
  {
    name: 'list_bills',
    description: 'List all bills (recurring expenses).',
    inputSchema: {
      type: 'object',
      properties: {
        page:  { type: 'number', description: 'Page number' },
        limit: { type: 'number', description: 'Results per page' },
        start: { type: 'string', description: 'Start date filter (YYYY-MM-DD)' },
        end:   { type: 'string', description: 'End date filter (YYYY-MM-DD)' },
      },
    },
  },
  {
    name: 'get_bill',
    description: 'Get a single bill by ID.',
    inputSchema: {
      type: 'object',
      properties: {
        id:    { type: 'string', description: 'Bill ID' },
        start: { type: 'string', description: 'Start date for linked transactions' },
        end:   { type: 'string', description: 'End date for linked transactions' },
      },
      required: ['id'],
    },
  },
  {
    name: 'create_bill',
    description: 'Create a new bill (recurring expense).',
    inputSchema: {
      type: 'object',
      properties: {
        name:          { type: 'string', description: 'Bill name' },
        amount_min:    { type: 'string', description: 'Minimum expected amount' },
        amount_max:    { type: 'string', description: 'Maximum expected amount' },
        date:          { type: 'string', description: 'First expected date (YYYY-MM-DD)' },
        currency_code: { type: 'string', description: 'Currency code' },
        repeat_freq:   { type: 'string', enum: ['weekly','monthly','quarterly','half-year','yearly'], description: 'How often the bill repeats' },
        skip:          { type: 'number', description: 'Skip N periods between occurrences' },
        notes:         { type: 'string', description: 'Notes' },
      },
      required: ['name', 'amount_min', 'amount_max', 'date', 'repeat_freq'],
    },
  },
  {
    name: 'update_bill',
    description: 'Update an existing bill.',
    inputSchema: {
      type: 'object',
      properties: {
        id:            { type: 'string', description: 'Bill ID' },
        name:          { type: 'string', description: 'Bill name' },
        amount_min:    { type: 'string', description: 'Minimum expected amount' },
        amount_max:    { type: 'string', description: 'Maximum expected amount' },
        date:          { type: 'string', description: 'First expected date' },
        currency_code: { type: 'string', description: 'Currency code' },
        repeat_freq:   { type: 'string', enum: ['weekly','monthly','quarterly','half-year','yearly'] },
        skip:          { type: 'number', description: 'Skip N periods' },
        active:        { type: 'boolean', description: 'Enable/disable the bill' },
        notes:         { type: 'string', description: 'Notes' },
      },
      required: ['id'],
    },
  },
  {
    name: 'delete_bill',
    description: 'Delete a bill by ID.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Bill ID' },
      },
      required: ['id'],
    },
  },

  // ── Categories ────────────────────────────────────────────────────────────────
  {
    name: 'list_categories',
    description: 'List all spending categories.',
    inputSchema: {
      type: 'object',
      properties: {
        page:  { type: 'number', description: 'Page number' },
        limit: { type: 'number', description: 'Results per page' },
      },
    },
  },
  {
    name: 'get_category',
    description: 'Get a single category by ID, with optional spending stats for a date range.',
    inputSchema: {
      type: 'object',
      properties: {
        id:    { type: 'string', description: 'Category ID' },
        start: { type: 'string', description: 'Start date for spending stats' },
        end:   { type: 'string', description: 'End date for spending stats' },
      },
      required: ['id'],
    },
  },
  {
    name: 'create_category',
    description: 'Create a new spending category.',
    inputSchema: {
      type: 'object',
      properties: {
        name:  { type: 'string', description: 'Category name' },
        notes: { type: 'string', description: 'Notes' },
      },
      required: ['name'],
    },
  },
  {
    name: 'update_category',
    description: 'Update a category name or notes.',
    inputSchema: {
      type: 'object',
      properties: {
        id:    { type: 'string', description: 'Category ID' },
        name:  { type: 'string', description: 'Category name' },
        notes: { type: 'string', description: 'Notes' },
      },
      required: ['id'],
    },
  },
  {
    name: 'delete_category',
    description: 'Delete a category by ID.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Category ID' },
      },
      required: ['id'],
    },
  },

  // ── Tags ──────────────────────────────────────────────────────────────────────
  {
    name: 'list_tags',
    description: 'List all transaction tags.',
    inputSchema: {
      type: 'object',
      properties: {
        page:  { type: 'number', description: 'Page number' },
        limit: { type: 'number', description: 'Results per page' },
      },
    },
  },
  {
    name: 'get_tag',
    description: 'Get a single tag by name or slug.',
    inputSchema: {
      type: 'object',
      properties: {
        tag: { type: 'string', description: 'Tag name or slug' },
      },
      required: ['tag'],
    },
  },
  {
    name: 'create_tag',
    description: 'Create a new tag.',
    inputSchema: {
      type: 'object',
      properties: {
        tag:         { type: 'string', description: 'Tag name' },
        date:        { type: 'string', description: 'Optional date associated with the tag' },
        description: { type: 'string', description: 'Tag description' },
      },
      required: ['tag'],
    },
  },
  {
    name: 'update_tag',
    description: 'Update an existing tag.',
    inputSchema: {
      type: 'object',
      properties: {
        tag:         { type: 'string', description: 'Tag name or slug to update' },
        new_tag:     { type: 'string', description: 'New tag name' },
        date:        { type: 'string', description: 'Date associated with the tag' },
        description: { type: 'string', description: 'Tag description' },
      },
      required: ['tag'],
    },
  },
  {
    name: 'delete_tag',
    description: 'Delete a tag by name or slug.',
    inputSchema: {
      type: 'object',
      properties: {
        tag: { type: 'string', description: 'Tag name or slug' },
      },
      required: ['tag'],
    },
  },

  // ── Search ────────────────────────────────────────────────────────────────────
  {
    name: 'search_transactions',
    description: 'Search transactions using Firefly III query syntax (e.g. "description:groceries category:food amount_more:50").',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search query — supports field:value syntax' },
        page:  { type: 'number', description: 'Page number' },
        limit: { type: 'number', description: 'Results per page' },
        op:    { type: 'string', enum: ['AND','OR'], description: 'Boolean operator for multiple terms (default AND)' },
      },
      required: ['query'],
    },
  },

  // ── Summary ───────────────────────────────────────────────────────────────────
  {
    name: 'get_summary',
    description: 'Get a financial summary for a date range — net worth, income, expenses, and balances by currency.',
    inputSchema: {
      type: 'object',
      properties: {
        start:         { type: 'string', description: 'Start date (YYYY-MM-DD)' },
        end:           { type: 'string', description: 'End date (YYYY-MM-DD)' },
        currency_code: { type: 'string', description: 'Filter to a specific currency code' },
      },
      required: ['start', 'end'],
    },
  },
]

// ─── Credentials ──────────────────────────────────────────────────────────────

function cfg(instanceId: string) {
  const url   = getCredential(instanceId, 'FIREFLY_URL')
  const token = getCredential(instanceId, 'FIREFLY_TOKEN')
  if (!url || !token) throw new Error('Firefly III credentials not configured. Set FIREFLY_URL and FIREFLY_TOKEN.')
  return { base: url.replace(/\/$/, ''), token }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function qs(params: Record<string, unknown>): string {
  const p = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null) p.set(k, String(v))
  }
  const s = p.toString()
  return s ? `?${s}` : ''
}

function seg(value: unknown): string {
  return encodeURIComponent(String(value))
}

function api<T>(base: string, token: string, path: string, init?: RequestInit): Promise<T> {
  return restFetch<T>(base, `/api/v1${path}`, token, undefined, undefined, init)
}

// ─── Ping ─────────────────────────────────────────────────────────────────────

export async function ping(instanceId: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const { base, token } = cfg(instanceId)
    await api(base, token, '/about')
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

    // Accounts
    case 'list_accounts':
      return api(base, token, `/accounts${qs({ type: a.type, page: a.page, limit: a.limit, date: a.date })}`)

    case 'get_account':
      return api(base, token, `/accounts/${seg(a.id)}${qs({ date: a.date })}`)

    case 'create_account':
      return api(base, token, '/accounts', {
        method: 'POST',
        body: JSON.stringify(a),
      })

    case 'update_account': {
      const { id, ...body } = a
      return api(base, token, `/accounts/${seg(id)}`, {
        method: 'PUT',
        body: JSON.stringify(body),
      })
    }

    case 'delete_account':
      return api(base, token, `/accounts/${seg(a.id)}`, { method: 'DELETE' })

    case 'list_account_transactions':
      return api(base, token, `/accounts/${seg(a.id)}/transactions${qs({ page: a.page, limit: a.limit, start: a.start, end: a.end, type: a.type })}`)

    // Transactions
    case 'list_transactions':
      return api(base, token, `/transactions${qs({ page: a.page, limit: a.limit, start: a.start, end: a.end, type: a.type })}`)

    case 'get_transaction':
      return api(base, token, `/transactions/${seg(a.id)}`)

    case 'create_transaction':
      return api(base, token, '/transactions', {
        method: 'POST',
        body: JSON.stringify(a),
      })

    case 'update_transaction': {
      const { id, ...body } = a
      return api(base, token, `/transactions/${seg(id)}`, {
        method: 'PUT',
        body: JSON.stringify(body),
      })
    }

    case 'delete_transaction':
      return api(base, token, `/transactions/${seg(a.id)}`, { method: 'DELETE' })

    // Bills
    case 'list_bills':
      return api(base, token, `/bills${qs({ page: a.page, limit: a.limit, start: a.start, end: a.end })}`)

    case 'get_bill':
      return api(base, token, `/bills/${seg(a.id)}${qs({ start: a.start, end: a.end })}`)

    case 'create_bill':
      return api(base, token, '/bills', {
        method: 'POST',
        body: JSON.stringify(a),
      })

    case 'update_bill': {
      const { id, ...body } = a
      return api(base, token, `/bills/${seg(id)}`, {
        method: 'PUT',
        body: JSON.stringify(body),
      })
    }

    case 'delete_bill':
      return api(base, token, `/bills/${seg(a.id)}`, { method: 'DELETE' })

    // Categories
    case 'list_categories':
      return api(base, token, `/categories${qs({ page: a.page, limit: a.limit })}`)

    case 'get_category':
      return api(base, token, `/categories/${seg(a.id)}${qs({ start: a.start, end: a.end })}`)

    case 'create_category':
      return api(base, token, '/categories', {
        method: 'POST',
        body: JSON.stringify(a),
      })

    case 'update_category': {
      const { id, ...body } = a
      return api(base, token, `/categories/${seg(id)}`, {
        method: 'PUT',
        body: JSON.stringify(body),
      })
    }

    case 'delete_category':
      return api(base, token, `/categories/${seg(a.id)}`, { method: 'DELETE' })

    // Tags
    case 'list_tags':
      return api(base, token, `/tags${qs({ page: a.page, limit: a.limit })}`)

    case 'get_tag':
      return api(base, token, `/tags/${seg(a.tag)}`)

    case 'create_tag':
      return api(base, token, '/tags', {
        method: 'POST',
        body: JSON.stringify(a),
      })

    case 'update_tag': {
      const { tag, new_tag, ...rest } = a
      return api(base, token, `/tags/${seg(tag)}`, {
        method: 'PUT',
        body: JSON.stringify({ tag: new_tag ?? tag, ...rest }),
      })
    }

    case 'delete_tag':
      return api(base, token, `/tags/${seg(a.tag)}`, { method: 'DELETE' })

    // Search
    case 'search_transactions':
      return api(base, token, `/search/transactions${qs({ query: a.query, page: a.page, limit: a.limit, op: a.op })}`)

    // Summary
    case 'get_summary':
      return api(base, token, `/summary/basic${qs({ start: a.start, end: a.end, currency_code: a.currency_code })}`)

    default:
      throw new Error(`Unknown Firefly III tool: ${toolName}`)
  }
}

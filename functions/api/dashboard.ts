type DashboardData = {
  version: 1
  updatedAt: string
  settings: {
    title: string
    theme: 'light' | 'dark' | 'system'
  }
  groups: Array<{
    id: string
    name: string
    links: Array<{
      id: string
      title: string
      url: string
      icon?: string
    }>
  }>
}

type KVNamespace = {
  get(key: string): Promise<string | null>
  put(
    key: string,
    value: string,
    options?: { metadata?: Record<string, unknown> },
  ): Promise<void>
  delete(key: string): Promise<void>
  list(options?: { prefix?: string; limit?: number }): Promise<{
    keys: Array<{ name: string }>
  }>
}

type Env = {
  STARTPAGE_KV?: KVNamespace
  ADMIN_TOKEN?: string
}

type PagesContext = {
  request: Request
  env: Env
  waitUntil: (promise: Promise<unknown>) => void
}

const DASHBOARD_KEY = 'dashboard'
const BACKUP_PREFIX = 'backup:'
const MAX_BODY_BYTES = 200_000
const MAX_GROUPS = 80
const MAX_LINKS_PER_GROUP = 300

const defaultDashboard: DashboardData = {
  version: 1,
  updatedAt: new Date().toISOString(),
  settings: {
    title: '我的导航',
    theme: 'system',
  },
  groups: [
    {
      id: 'daily',
      name: '常用',
      links: [
        {
          id: 'cloudflare',
          title: 'Cloudflare',
          url: 'https://dash.cloudflare.com',
        },
        {
          id: 'github',
          title: 'GitHub',
          url: 'https://github.com',
        },
      ],
    },
  ],
}

export async function onRequestGet({ env }: PagesContext) {
  if (!env.STARTPAGE_KV) {
    return json(defaultDashboard)
  }

  const raw = await env.STARTPAGE_KV.get(DASHBOARD_KEY)
  return json(raw ? JSON.parse(raw) : defaultDashboard)
}

export async function onRequestPut(context: PagesContext) {
  const { request, env } = context

  if (!env.STARTPAGE_KV) {
    return text('STARTPAGE_KV binding is not configured.', 500)
  }

  if (!env.ADMIN_TOKEN) {
    return text('ADMIN_TOKEN is not configured.', 500)
  }

  if (!isAuthorized(request, env.ADMIN_TOKEN)) {
    return text('Unauthorized.', 401)
  }

  const contentLength = Number(request.headers.get('content-length') || '0')
  if (contentLength > MAX_BODY_BYTES) {
    return text('Dashboard JSON is too large.', 413)
  }

  const body = await request.text()
  if (body.length > MAX_BODY_BYTES) {
    return text('Dashboard JSON is too large.', 413)
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(body)
  } catch {
    return text('Invalid JSON.', 400)
  }

  const validation = validateDashboard(parsed)
  if (!validation.ok) {
    return text(validation.error, 400)
  }

  const updatedAt = new Date().toISOString()
  const next = {
    ...validation.data,
    updatedAt,
  }
  const previous = await env.STARTPAGE_KV.get(DASHBOARD_KEY)

  if (previous) {
    await env.STARTPAGE_KV.put(`${BACKUP_PREFIX}${updatedAt.replace(/[:.]/g, '-')}`, previous)
    context.waitUntil(trimBackups(env.STARTPAGE_KV))
  }

  await env.STARTPAGE_KV.put(DASHBOARD_KEY, JSON.stringify(next), {
    metadata: { updatedAt },
  })

  return json({
    mode: 'cloud',
    updatedAt,
  })
}

function isAuthorized(request: Request, adminToken: string) {
  const expected = `Bearer ${adminToken}`
  return request.headers.get('authorization') === expected
}

function validateDashboard(input: unknown):
  | { ok: true; data: DashboardData }
  | { ok: false; error: string } {
  if (!input || typeof input !== 'object') {
    return { ok: false, error: 'Dashboard must be an object.' }
  }

  const record = input as Record<string, unknown>
  const groups = record.groups
  const settings = record.settings as Record<string, unknown> | undefined

  if (!Array.isArray(groups)) {
    return { ok: false, error: 'Dashboard groups must be an array.' }
  }

  if (groups.length > MAX_GROUPS) {
    return { ok: false, error: `Too many groups. Max is ${MAX_GROUPS}.` }
  }

  const theme = settings?.theme
  const data: DashboardData = {
    version: 1,
    updatedAt: typeof record.updatedAt === 'string' ? record.updatedAt : '',
    settings: {
      title: cleanText(settings?.title, 80) || '我的导航',
      theme: theme === 'light' || theme === 'dark' || theme === 'system' ? theme : 'system',
    },
    groups: [],
  }

  for (const group of groups) {
    if (!group || typeof group !== 'object') {
      return { ok: false, error: 'Each group must be an object.' }
    }

    const groupRecord = group as Record<string, unknown>
    const links = groupRecord.links

    if (!Array.isArray(links)) {
      return { ok: false, error: 'Each group needs a links array.' }
    }

    if (links.length > MAX_LINKS_PER_GROUP) {
      return {
        ok: false,
        error: `Too many links in one group. Max is ${MAX_LINKS_PER_GROUP}.`,
      }
    }

    const nextGroup: DashboardData['groups'][number] = {
      id: cleanText(groupRecord.id, 80) || crypto.randomUUID(),
      name: cleanText(groupRecord.name, 80) || '未命名分组',
      links: [],
    }

    for (const link of links) {
      if (!link || typeof link !== 'object') {
        return { ok: false, error: 'Each link must be an object.' }
      }

      const linkRecord = link as Record<string, unknown>
      const normalizedUrl = normalizeUrl(cleanText(linkRecord.url, 2048))
      const icon = cleanText(linkRecord.icon, 2048)

      if (!isSafeUrl(normalizedUrl)) {
        return {
          ok: false,
          error: `Invalid URL: ${cleanText(linkRecord.title, 80) || normalizedUrl}`,
        }
      }

      if (icon && !isSafeUrl(icon)) {
        return {
          ok: false,
          error: `Invalid icon URL: ${cleanText(linkRecord.title, 80) || normalizedUrl}`,
        }
      }

      nextGroup.links.push({
        id: cleanText(linkRecord.id, 80) || crypto.randomUUID(),
        title: cleanText(linkRecord.title, 80) || hostnameFromUrl(normalizedUrl),
        url: normalizedUrl,
        icon: icon || undefined,
      })
    }

    data.groups.push(nextGroup)
  }

  return { ok: true, data }
}

function normalizeUrl(value: string) {
  const trimmed = value.trim()
  if (!trimmed) {
    return ''
  }

  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`
}

function isSafeUrl(value: string) {
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}

function hostnameFromUrl(value: string) {
  try {
    return new URL(value).hostname.replace(/^www\./, '')
  } catch {
    return '未命名网站'
  }
}

function cleanText(value: unknown, maxLength: number) {
  return typeof value === 'string' ? value.trim().slice(0, maxLength) : ''
}

async function trimBackups(kv: KVNamespace) {
  const list = await kv.list({ prefix: BACKUP_PREFIX, limit: 1000 })
  const stale = list.keys
    .map((key) => key.name)
    .sort()
    .slice(0, Math.max(0, list.keys.length - 20))

  await Promise.all(stale.map((key) => kv.delete(key)))
}

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'cache-control': 'no-store',
      'content-type': 'application/json; charset=utf-8',
    },
  })
}

function text(message: string, status: number) {
  return new Response(message, {
    status,
    headers: {
      'cache-control': 'no-store',
      'content-type': 'text/plain; charset=utf-8',
    },
  })
}

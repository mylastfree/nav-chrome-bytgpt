const DASHBOARD_KEY = 'dashboard'
const BACKUP_PREFIX = 'backup:'
const MAX_BODY_BYTES = 200000
const MAX_GROUPS = 80
const MAX_LINKS_PER_GROUP = 300

const defaultDashboard = {
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

export default {
  async fetch(request, env, context) {
    const url = new URL(request.url)

    if (url.pathname === '/api/dashboard' && request.method === 'GET') {
      return readDashboard(env)
    }

    if (url.pathname === '/api/dashboard' && request.method === 'PUT') {
      return writeDashboard(request, env, context)
    }

    if (url.pathname.startsWith('/api/')) {
      return text('Not found.', 404)
    }

    return env.ASSETS.fetch(request)
  },
}

async function readDashboard(env) {
  if (!env.STARTPAGE_KV) {
    return json(defaultDashboard)
  }

  const raw = await env.STARTPAGE_KV.get(DASHBOARD_KEY)
  return json(raw ? JSON.parse(raw) : defaultDashboard)
}

async function writeDashboard(request, env, context) {
  if (!env.STARTPAGE_KV) {
    return text('STARTPAGE_KV binding is not configured.', 500)
  }

  if (!env.ADMIN_TOKEN) {
    return text('ADMIN_TOKEN is not configured.', 500)
  }

  if (request.headers.get('authorization') !== `Bearer ${env.ADMIN_TOKEN}`) {
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

  let parsed
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
    await env.STARTPAGE_KV.put(
      `${BACKUP_PREFIX}${updatedAt.replace(/[:.]/g, '-')}`,
      previous,
    )
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

function validateDashboard(input) {
  if (!input || typeof input !== 'object') {
    return { ok: false, error: 'Dashboard must be an object.' }
  }

  const groups = input.groups
  const settings = input.settings || {}

  if (!Array.isArray(groups)) {
    return { ok: false, error: 'Dashboard groups must be an array.' }
  }

  if (groups.length > MAX_GROUPS) {
    return { ok: false, error: `Too many groups. Max is ${MAX_GROUPS}.` }
  }

  const data = {
    version: 1,
    updatedAt: typeof input.updatedAt === 'string' ? input.updatedAt : '',
    settings: {
      title: cleanText(settings.title, 80) || '我的导航',
      theme: ['light', 'dark', 'system'].includes(settings.theme)
        ? settings.theme
        : 'system',
    },
    groups: [],
  }

  for (const group of groups) {
    if (!group || typeof group !== 'object') {
      return { ok: false, error: 'Each group must be an object.' }
    }

    if (!Array.isArray(group.links)) {
      return { ok: false, error: 'Each group needs a links array.' }
    }

    if (group.links.length > MAX_LINKS_PER_GROUP) {
      return {
        ok: false,
        error: `Too many links in one group. Max is ${MAX_LINKS_PER_GROUP}.`,
      }
    }

    const nextGroup = {
      id: cleanText(group.id, 80) || crypto.randomUUID(),
      name: cleanText(group.name, 80) || '未命名分组',
      links: [],
    }

    for (const link of group.links) {
      if (!link || typeof link !== 'object') {
        return { ok: false, error: 'Each link must be an object.' }
      }

      const normalizedUrl = normalizeUrl(cleanText(link.url, 2048))
      const icon = cleanText(link.icon, 2048)

      if (!isSafeUrl(normalizedUrl)) {
        return {
          ok: false,
          error: `Invalid URL: ${cleanText(link.title, 80) || normalizedUrl}`,
        }
      }

      if (icon && !isSafeUrl(icon)) {
        return {
          ok: false,
          error: `Invalid icon URL: ${cleanText(link.title, 80) || normalizedUrl}`,
        }
      }

      nextGroup.links.push({
        id: cleanText(link.id, 80) || crypto.randomUUID(),
        title: cleanText(link.title, 80) || hostnameFromUrl(normalizedUrl),
        url: normalizedUrl,
        icon: icon || undefined,
      })
    }

    data.groups.push(nextGroup)
  }

  return { ok: true, data }
}

function normalizeUrl(value) {
  const trimmed = value.trim()

  if (!trimmed) {
    return ''
  }

  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`
}

function isSafeUrl(value) {
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}

function hostnameFromUrl(value) {
  try {
    return new URL(value).hostname.replace(/^www\./, '')
  } catch {
    return '未命名网站'
  }
}

function cleanText(value, maxLength) {
  return typeof value === 'string' ? value.trim().slice(0, maxLength) : ''
}

async function trimBackups(kv) {
  const list = await kv.list({ prefix: BACKUP_PREFIX, limit: 1000 })
  const stale = list.keys
    .map((key) => key.name)
    .sort()
    .slice(0, Math.max(0, list.keys.length - 20))

  await Promise.all(stale.map((key) => kv.delete(key)))
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'cache-control': 'no-store',
      'content-type': 'application/json; charset=utf-8',
    },
  })
}

function text(message, status) {
  return new Response(message, {
    status,
    headers: {
      'cache-control': 'no-store',
      'content-type': 'text/plain; charset=utf-8',
    },
  })
}

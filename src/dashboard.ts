import type { DashboardData, LinkGroup, LinkItem } from './types'

export const LOCAL_DASHBOARD_KEY = 'nav-bygpt-dashboard'

export const sampleDashboard: DashboardData = {
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
          id: 'chatgpt',
          title: 'ChatGPT',
          url: 'https://chatgpt.com',
        },
        {
          id: 'github',
          title: 'GitHub',
          url: 'https://github.com',
        },
        {
          id: 'gmail',
          title: 'Gmail',
          url: 'https://mail.google.com',
        },
      ],
    },
    {
      id: 'tools',
      name: '工具',
      links: [
        {
          id: 'workers-docs',
          title: 'Workers Docs',
          url: 'https://developers.cloudflare.com/workers/',
        },
        {
          id: 'pages-docs',
          title: 'Pages Docs',
          url: 'https://developers.cloudflare.com/pages/',
        },
      ],
    },
  ],
}

export function createId(prefix: string) {
  const random =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID().slice(0, 8)
      : Math.random().toString(36).slice(2, 10)

  return `${prefix}-${random}`
}

export function normalizeUrl(value: string) {
  const trimmed = value.trim()

  if (!trimmed) {
    return ''
  }

  if (/^https?:\/\//i.test(trimmed)) {
    return trimmed
  }

  return `https://${trimmed}`
}

export function getHostname(value: string) {
  try {
    return new URL(normalizeUrl(value)).hostname.replace(/^www\./, '')
  } catch {
    return ''
  }
}

export function faviconUrl(value: string) {
  const hostname = getHostname(value)

  if (!hostname) {
    return ''
  }

  return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(
    hostname,
  )}&sz=64`
}

export function createEmptyGroup(): LinkGroup {
  return {
    id: createId('group'),
    name: '新分组',
    links: [],
  }
}

export function createEmptyLink(): LinkItem {
  return {
    id: createId('link'),
    title: '新网站',
    url: 'https://example.com',
  }
}

export function moveItem<T>(items: T[], fromIndex: number, direction: -1 | 1) {
  const targetIndex = fromIndex + direction

  if (targetIndex < 0 || targetIndex >= items.length) {
    return items
  }

  const next = [...items]
  const [item] = next.splice(fromIndex, 1)
  next.splice(targetIndex, 0, item)

  return next
}

export function sanitizeDashboard(input: DashboardData): DashboardData {
  const groups = Array.isArray(input.groups) ? input.groups : []
  const title = input.settings?.title?.trim() || '我的导航'
  const theme = input.settings?.theme

  return {
    version: 1,
    updatedAt: input.updatedAt || new Date().toISOString(),
    settings: {
      title,
      theme: theme === 'light' || theme === 'dark' || theme === 'system' ? theme : 'system',
    },
    groups: groups.map((group) => ({
      id: group.id || createId('group'),
      name: group.name?.trim() || '未命名分组',
      links: Array.isArray(group.links)
        ? group.links
            .map((link) => ({
              id: link.id || createId('link'),
              title: link.title?.trim() || getHostname(link.url) || '未命名网站',
              url: normalizeUrl(link.url),
              icon: link.icon?.trim() || undefined,
            }))
        : [],
    })),
  }
}

export function isSafeUrl(value: string) {
  try {
    const url = new URL(normalizeUrl(value))
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}

export function findInvalidLinks(input: DashboardData) {
  return input.groups.flatMap((group) =>
    group.links
      .filter((link) => !isSafeUrl(link.url))
      .map((link) => `${group.name} / ${link.title || link.url || '未命名网站'}`),
  )
}

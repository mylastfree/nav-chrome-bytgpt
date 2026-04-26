import { describe, expect, test } from 'vitest'
import {
  findDuplicateLinkIds,
  findDuplicateLinks,
  moveLinksToGroup,
  nextThemePreference,
  reorderLinkInGroup,
} from './dashboard'
import { parseDashboardImport } from './importers'
import type { DashboardData } from './types'

function dashboardWithDuplicates(): DashboardData {
  return {
    version: 1,
    updatedAt: '2026-04-26T00:00:00.000Z',
    settings: {
      title: 'Test nav',
      theme: 'system',
    },
    groups: [
      {
        id: 'daily',
        name: 'Daily',
        links: [
          {
            id: 'github-a',
            title: 'GitHub A',
            url: 'https://github.com',
          },
          {
            id: 'openai',
            title: 'OpenAI',
            url: 'https://openai.com/',
          },
        ],
      },
      {
        id: 'work',
        name: 'Work',
        links: [
          {
            id: 'github-b',
            title: 'GitHub B',
            url: 'https://github.com/',
          },
        ],
      },
    ],
  }
}

describe('import parsing', () => {
  test('parses the app dashboard JSON directly', () => {
    const dashboard = dashboardWithDuplicates()
    const result = parseDashboardImport('backup.json', JSON.stringify(dashboard))

    expect(result.source).toBe('dashboard')
    expect(result.dashboard.groups).toHaveLength(2)
    expect(result.linkCount).toBe(3)
    expect(result.skipped).toEqual([])
  })

  test('converts iTab backups into dashboard data and flattens folders', () => {
    const itab = {
      baseConfig: {},
      navConfig: [
        {
          id: 'home',
          name: 'Home',
          children: [
            {
              id: 'component',
              name: 'Weather',
              type: 'component',
            },
            {
              id: 'github',
              name: 'GitHub',
              url: 'https://github.com',
              type: 'icon',
              src: 'https://example.com/github.png',
            },
            {
              id: 'internal',
              name: 'History',
              url: 'chrome://history/',
              type: 'icon',
            },
            {
              id: 'folder',
              name: 'Tools',
              url: 'https://folder.example.com',
              type: 'folder',
              children: [
                {
                  id: 'tool',
                  name: 'Tool',
                  url: 'https://tool.example.com',
                  type: 'text',
                  src: '',
                },
              ],
            },
          ],
        },
      ],
    }

    const result = parseDashboardImport('itab.itabdata', JSON.stringify(itab))

    expect(result.source).toBe('itab')
    expect(result.dashboard.groups.map((group) => group.name)).toEqual([
      'Home',
      'Home / Tools',
    ])
    expect(result.dashboard.groups[0].links).toEqual([
      {
        id: 'github',
        title: 'GitHub',
        url: 'https://github.com',
        icon: 'https://example.com/github.png',
        clickCount: 0,
      },
    ])
    expect(result.dashboard.groups[1].links[0]).toMatchObject({
      id: 'tool',
      title: 'Tool',
      url: 'https://tool.example.com',
    })
    expect(result.linkCount).toBe(2)
    expect(result.skipped).toEqual([
      {
        group: 'Home',
        name: 'History',
        url: 'chrome://history/',
        reason: 'only http/https URLs are importable',
      },
    ])
  })
})

describe('dashboard organization helpers', () => {
  test('detects duplicate URLs after normalizing trailing slashes', () => {
    const duplicates = findDuplicateLinks(dashboardWithDuplicates())

    expect(duplicates).toHaveLength(1)
    expect(duplicates[0].url).toBe('https://github.com/')
    expect(duplicates[0].occurrences.map((item) => item.link.title)).toEqual([
      'GitHub A',
      'GitHub B',
    ])
  })

  test('returns every duplicated link id for editor highlighting', () => {
    const duplicateIds = findDuplicateLinkIds(findDuplicateLinks(dashboardWithDuplicates()))

    expect([...duplicateIds].sort()).toEqual(['github-a', 'github-b'])
  })

  test('moves selected links into the target group without duplicating target links', () => {
    const moved = moveLinksToGroup(dashboardWithDuplicates(), new Set(['github-a']), 'work')

    expect(moved.groups[0].links.map((link) => link.id)).toEqual(['openai'])
    expect(moved.groups[1].links.map((link) => link.id)).toEqual([
      'github-b',
      'github-a',
    ])
  })

  test('reorders links inside the same group by dragged and target link ids', () => {
    const moved = reorderLinkInGroup(dashboardWithDuplicates(), 'daily', 'openai', 'github-a')

    expect(moved.groups[0].links.map((link) => link.id)).toEqual(['openai', 'github-a'])
    expect(moved.groups[1].links.map((link) => link.id)).toEqual(['github-b'])
  })
})

describe('dashboard preference helpers', () => {
  test('toggles front theme preference between light and dark', () => {
    expect(nextThemePreference('dark')).toBe('light')
    expect(nextThemePreference('light')).toBe('dark')
    expect(nextThemePreference('system')).toBe('dark')
  })
})

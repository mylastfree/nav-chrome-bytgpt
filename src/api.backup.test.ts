import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import {
  BACKUP_DASHBOARD_KEY,
  loadDashboardBackups,
  saveDashboard,
} from './api'
import { LOCAL_DASHBOARD_KEY } from './dashboard'
import type { DashboardData } from './types'

function dashboardWith(id: string, url = 'https://example.com'): DashboardData {
  return {
    version: 1,
    updatedAt: `2026-04-26T00:00:0${id}.000Z`,
    settings: {
      title: `Dashboard ${id}`,
      theme: 'system',
    },
    groups: [
      {
        id: 'daily',
        name: 'Daily',
        links: [
          {
            id: `link-${id}`,
            title: `Link ${id}`,
            url,
          },
        ],
      },
    ],
  }
}

function stubChromeStorage(store: Record<string, unknown>) {
  vi.stubGlobal('chrome', {
    runtime: {},
    storage: {
      local: {
        get(key: string, callback: (items: Record<string, unknown>) => void) {
          callback({ [key]: store[key] })
        },
        set(items: Record<string, unknown>, callback?: () => void) {
          Object.assign(store, items)
          callback?.()
        },
      },
    },
  })
}

describe('dashboard backups', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-04-26T00:00:10.000Z'))
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  test('saves the previous dashboard as a backup before overwriting chrome storage', async () => {
    const chromeStore: Record<string, unknown> = {
      [LOCAL_DASHBOARD_KEY]: dashboardWith('1'),
    }
    stubChromeStorage(chromeStore)

    await saveDashboard(dashboardWith('2'))

    const backups = chromeStore[BACKUP_DASHBOARD_KEY] as Array<{
      dashboard: DashboardData
    }>

    expect(backups).toHaveLength(1)
    expect(backups[0].dashboard.settings.title).toBe('Dashboard 1')
    expect((chromeStore[LOCAL_DASHBOARD_KEY] as DashboardData).settings.title).toBe(
      'Dashboard 2',
    )
  })

  test('loads backups newest first', async () => {
    const chromeStore: Record<string, unknown> = {
      [BACKUP_DASHBOARD_KEY]: [
        {
          id: 'old',
          createdAt: '2026-04-26T00:00:01.000Z',
          dashboard: dashboardWith('1'),
        },
        {
          id: 'new',
          createdAt: '2026-04-26T00:00:02.000Z',
          dashboard: dashboardWith('2'),
        },
      ],
    }
    stubChromeStorage(chromeStore)

    const backups = await loadDashboardBackups()

    expect(backups.map((backup) => backup.id)).toEqual(['new', 'old'])
  })

  test('ignores damaged backup entries', async () => {
    const chromeStore: Record<string, unknown> = {
      [BACKUP_DASHBOARD_KEY]: [
        {
          id: 'broken',
          createdAt: '2026-04-26T00:00:03.000Z',
          dashboard: null,
        },
        {
          id: 'valid',
          createdAt: '2026-04-26T00:00:02.000Z',
          dashboard: dashboardWith('2'),
        },
      ],
    }
    stubChromeStorage(chromeStore)

    const backups = await loadDashboardBackups()

    expect(backups.map((backup) => backup.id)).toEqual(['valid'])
  })

  test('keeps only the latest 20 backups', async () => {
    const chromeStore: Record<string, unknown> = {
      [LOCAL_DASHBOARD_KEY]: dashboardWith('1'),
      [BACKUP_DASHBOARD_KEY]: Array.from({ length: 25 }, (_, index) => ({
        id: `backup-${index}`,
        createdAt: `2026-04-26T00:00:${String(index).padStart(2, '0')}.000Z`,
        dashboard: dashboardWith('2'),
      })),
    }
    stubChromeStorage(chromeStore)

    await saveDashboard(dashboardWith('3'))

    expect(chromeStore[BACKUP_DASHBOARD_KEY]).toHaveLength(20)
  })
})

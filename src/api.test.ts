import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { LOCAL_DASHBOARD_KEY } from './dashboard'
import { BACKUP_DASHBOARD_KEY, loadDashboard, saveDashboard, saveDashboardSnapshot } from './api'
import type { DashboardData } from './types'

function dashboardWith(url: string): DashboardData {
  return {
    version: 1,
    updatedAt: '2026-04-25T00:00:00.000Z',
    settings: {
      title: 'Stored nav',
      theme: 'system',
    },
    groups: [
      {
        id: 'daily',
        name: 'Daily',
        links: [
          {
            id: 'github',
            title: 'GitHub',
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

function stubLocalStorage(store: Record<string, string>) {
  vi.stubGlobal('localStorage', {
    getItem(key: string) {
      return store[key] ?? null
    },
    setItem(key: string, value: string) {
      store[key] = value
    },
    removeItem(key: string) {
      delete store[key]
    },
  })
}

describe('local dashboard storage', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-04-26T00:00:00.000Z'))
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  test('loads dashboard data from chrome.storage.local without fetching a server API', async () => {
    const chromeStore: Record<string, unknown> = {
      [LOCAL_DASHBOARD_KEY]: dashboardWith('https://github.com'),
    }
    const fetchSpy = vi.fn()

    stubChromeStorage(chromeStore)
    vi.stubGlobal('fetch', fetchSpy)

    const data = await loadDashboard()

    expect(data.settings.title).toBe('Stored nav')
    expect(data.groups[0].links[0].url).toBe('https://github.com')
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  test('saves valid dashboard data into chrome.storage.local without an admin token', async () => {
    const chromeStore: Record<string, unknown> = {}

    stubChromeStorage(chromeStore)

    const result = await saveDashboard(dashboardWith('github.com'))

    expect(result).toEqual({
      mode: 'chrome',
      updatedAt: '2026-04-26T00:00:00.000Z',
    })
    expect(chromeStore[LOCAL_DASHBOARD_KEY]).toMatchObject({
      updatedAt: '2026-04-26T00:00:00.000Z',
      groups: [
        {
          links: [
            {
              url: 'https://github.com',
            },
          ],
        },
      ],
    })
  })

  test('falls back to localStorage when chrome.storage.local is unavailable', async () => {
    const localStore: Record<string, string> = {}

    stubLocalStorage(localStore)

    const result = await saveDashboard(dashboardWith('https://example.com'))
    const stored = JSON.parse(localStore[LOCAL_DASHBOARD_KEY]) as DashboardData

    expect(result.mode).toBe('local')
    expect(stored.groups[0].links[0].url).toBe('https://example.com')
  })

  test('saves dashboard snapshots without creating history backups', async () => {
    const chromeStore: Record<string, unknown> = {
      [LOCAL_DASHBOARD_KEY]: dashboardWith('https://old.example.com'),
    }

    stubChromeStorage(chromeStore)

    await saveDashboardSnapshot(dashboardWith('https://new.example.com'))

    expect((chromeStore[LOCAL_DASHBOARD_KEY] as DashboardData).groups[0].links[0].url).toBe(
      'https://new.example.com',
    )
    expect(chromeStore[BACKUP_DASHBOARD_KEY]).toBeUndefined()
  })

  test('rejects unsafe link URLs before saving', async () => {
    const chromeStore: Record<string, unknown> = {}

    stubChromeStorage(chromeStore)

    await expect(saveDashboard(dashboardWith('javascript:alert(1)'))).rejects.toThrow(
      '无效网址',
    )
    expect(chromeStore[LOCAL_DASHBOARD_KEY]).toBeUndefined()
  })
})

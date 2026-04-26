import {
  findInvalidLinks,
  LOCAL_DASHBOARD_KEY,
  sampleDashboard,
  sanitizeDashboard,
} from './dashboard'
import type { DashboardData, SaveResult } from './types'

type ChromeStorageArea = {
  get: (key: string, callback: (items: Record<string, unknown>) => void) => void
  set: (items: Record<string, unknown>, callback?: () => void) => void
}

type ChromeLike = {
  runtime?: {
    lastError?: {
      message?: string
    }
  }
  storage?: {
    local?: ChromeStorageArea
  }
}

function getChrome() {
  return (globalThis as typeof globalThis & { chrome?: ChromeLike }).chrome
}

function getChromeStorage() {
  return getChrome()?.storage?.local ?? null
}

function getChromeStorageError() {
  return getChrome()?.runtime?.lastError?.message
}

function loadChromeDashboard(): Promise<DashboardData | null> {
  const storage = getChromeStorage()

  if (!storage) {
    return Promise.resolve(null)
  }

  return new Promise((resolve, reject) => {
    storage.get(LOCAL_DASHBOARD_KEY, (items) => {
      const error = getChromeStorageError()

      if (error) {
        reject(new Error(error))
        return
      }

      const raw = items[LOCAL_DASHBOARD_KEY]
      resolve(raw ? sanitizeDashboard(raw as DashboardData) : null)
    })
  })
}

function saveChromeDashboard(dashboard: DashboardData): Promise<boolean> {
  const storage = getChromeStorage()

  if (!storage) {
    return Promise.resolve(false)
  }

  return new Promise((resolve, reject) => {
    storage.set({ [LOCAL_DASHBOARD_KEY]: dashboard }, () => {
      const error = getChromeStorageError()

      if (error) {
        reject(new Error(error))
        return
      }

      resolve(true)
    })
  })
}

export async function loadDashboard(): Promise<DashboardData> {
  try {
    const chromeData = await loadChromeDashboard()

    if (chromeData) {
      return chromeData
    }
  } catch {
    // Keep the page usable even if extension storage is temporarily unavailable.
  }

  return loadLocalDashboard() ?? sampleDashboard
}

export async function saveDashboard(dashboard: DashboardData): Promise<SaveResult> {
  const updated: DashboardData = sanitizeDashboard({
    ...dashboard,
    updatedAt: new Date().toISOString(),
  })

  const invalidLinks = findInvalidLinks(updated)
  if (invalidLinks.length > 0) {
    throw new Error(`存在无效网址：${invalidLinks[0]}`)
  }

  try {
    const savedToChrome = await saveChromeDashboard(updated)

    if (savedToChrome) {
      return {
        mode: 'chrome',
        updatedAt: updated.updatedAt,
      }
    }
  } catch {
    // Fall through to localStorage so local development still works.
  }

  saveLocalDashboard(updated)
  return {
    mode: 'local',
    updatedAt: updated.updatedAt,
  }
}

export function loadLocalDashboard() {
  try {
    if (typeof localStorage === 'undefined') {
      return null
    }

    const raw = localStorage.getItem(LOCAL_DASHBOARD_KEY)
    return raw ? sanitizeDashboard(JSON.parse(raw)) : null
  } catch {
    return null
  }
}

export function saveLocalDashboard(dashboard: DashboardData) {
  if (typeof localStorage === 'undefined') {
    return
  }

  localStorage.setItem(LOCAL_DASHBOARD_KEY, JSON.stringify(dashboard))
}

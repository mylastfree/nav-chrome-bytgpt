import {
  findInvalidLinks,
  LOCAL_DASHBOARD_KEY,
  sampleDashboard,
  sanitizeDashboard,
} from './dashboard'
import type { DashboardBackup, DashboardData, SaveResult } from './types'

export const BACKUP_DASHBOARD_KEY = `${LOCAL_DASHBOARD_KEY}-backups`
const MAX_BACKUPS = 10

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

function loadChromeValue<T>(key: string): Promise<T | null> {
  const storage = getChromeStorage()

  if (!storage) {
    return Promise.resolve(null)
  }

  return new Promise((resolve, reject) => {
    storage.get(key, (items) => {
      const error = getChromeStorageError()

      if (error) {
        reject(new Error(error))
        return
      }

      const raw = items[key]
      resolve(raw ? (raw as T) : null)
    })
  })
}

function saveChromeValue(key: string, value: unknown): Promise<boolean> {
  const storage = getChromeStorage()

  if (!storage) {
    return Promise.resolve(false)
  }

  return new Promise((resolve, reject) => {
    storage.set({ [key]: value }, () => {
      const error = getChromeStorageError()

      if (error) {
        reject(new Error(error))
        return
      }

      resolve(true)
    })
  })
}

async function loadChromeDashboard(): Promise<DashboardData | null> {
  const raw = await loadChromeValue<DashboardData>(LOCAL_DASHBOARD_KEY)
  return raw ? sanitizeDashboard(raw) : null
}

function saveChromeDashboard(dashboard: DashboardData): Promise<boolean> {
  return saveChromeValue(LOCAL_DASHBOARD_KEY, dashboard)
}

async function persistDashboard(dashboard: DashboardData): Promise<SaveResult> {
  try {
    const savedToChrome = await saveChromeDashboard(dashboard)

    if (savedToChrome) {
      return {
        mode: 'chrome',
        updatedAt: dashboard.updatedAt,
      }
    }
  } catch {
    // Fall through to localStorage so local development still works.
  }

  saveLocalDashboard(dashboard)
  return {
    mode: 'local',
    updatedAt: dashboard.updatedAt,
  }
}

async function loadStoredDashboard() {
  try {
    const chromeData = await loadChromeDashboard()

    if (chromeData) {
      return chromeData
    }
  } catch {
    // Keep save usable even if extension storage is temporarily unavailable.
  }

  return loadLocalDashboard()
}

export async function loadDashboard(): Promise<DashboardData> {
  return (await loadStoredDashboard()) ?? sampleDashboard
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

  const previous = await loadStoredDashboard()
  if (previous) {
    await saveDashboardBackup(previous)
  }

  return persistDashboard(updated)
}

export async function saveDashboardSnapshot(dashboard: DashboardData): Promise<SaveResult> {
  const updated: DashboardData = sanitizeDashboard({
    ...dashboard,
    updatedAt: new Date().toISOString(),
  })

  const invalidLinks = findInvalidLinks(updated)
  if (invalidLinks.length > 0) {
    throw new Error(`存在无效网址：${invalidLinks[0]}`)
  }

  return persistDashboard(updated)
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

function sanitizeBackups(input: unknown): DashboardBackup[] {
  if (!Array.isArray(input)) {
    return []
  }

  return input
    .filter((entry): entry is Partial<DashboardBackup> => {
      return Boolean(entry) && typeof entry === 'object'
    })
    .flatMap((entry) => {
      const createdAt =
        typeof entry.createdAt === 'string' ? entry.createdAt : new Date().toISOString()

      try {
        return [
          {
            id: typeof entry.id === 'string' ? entry.id : `backup-${createdAt}`,
            createdAt,
            dashboard: sanitizeDashboard(entry.dashboard as DashboardData),
          },
        ]
      } catch {
        return []
      }
    })
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, MAX_BACKUPS)
}

export async function loadDashboardBackups(): Promise<DashboardBackup[]> {
  try {
    const chromeBackups = await loadChromeValue<unknown>(BACKUP_DASHBOARD_KEY)

    if (chromeBackups) {
      return sanitizeBackups(chromeBackups)
    }
  } catch {
    // Fall through to localStorage for development and storage failures.
  }

  try {
    if (typeof localStorage === 'undefined') {
      return []
    }

    const raw = localStorage.getItem(BACKUP_DASHBOARD_KEY)
    return raw ? sanitizeBackups(JSON.parse(raw)) : []
  } catch {
    return []
  }
}

async function saveDashboardBackups(backups: DashboardBackup[]) {
  try {
    const savedToChrome = await saveChromeValue(BACKUP_DASHBOARD_KEY, backups)

    if (savedToChrome) {
      return
    }
  } catch {
    // Fall through to localStorage so local development still works.
  }

  if (typeof localStorage !== 'undefined') {
    localStorage.setItem(BACKUP_DASHBOARD_KEY, JSON.stringify(backups))
  }
}

export async function saveDashboardBackup(dashboard: DashboardData) {
  const createdAt = new Date().toISOString()
  const previousBackups = await loadDashboardBackups()
  const backup: DashboardBackup = {
    id: `backup-${Date.now()}`,
    createdAt,
    dashboard: sanitizeDashboard(dashboard),
  }

  await saveDashboardBackups([backup, ...previousBackups].slice(0, MAX_BACKUPS))
  return backup
}

export type LinkItem = {
  id: string
  title: string
  url: string
  icon?: string
  clickCount?: number
}

export type LinkGroup = {
  id: string
  name: string
  links: LinkItem[]
}

export type DashboardSettings = {
  title: string
  theme: 'light' | 'dark' | 'system'
}

export type DashboardData = {
  version: 1
  updatedAt: string
  groups: LinkGroup[]
  settings: DashboardSettings
}

export type DashboardBackup = {
  id: string
  createdAt: string
  dashboard: DashboardData
}

export type SaveResult = {
  mode: 'chrome' | 'local'
  updatedAt: string
}

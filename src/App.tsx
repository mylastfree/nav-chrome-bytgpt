import { useEffect, useMemo, useRef, useState } from 'react'
import type { DragEvent, KeyboardEvent, MouseEvent } from 'react'
import {
  loadDashboard,
  loadDashboardBackups,
  saveDashboard,
  saveDashboardBackup,
  saveDashboardSnapshot,
} from './api'
import {
  CARD_LAYOUT_OPTIONS,
  clearLinkIcons,
  createEmptyGroup,
  createEmptyLink,
  deleteLinks,
  faviconUrl,
  findDuplicateLinkIds,
  findDuplicateLinks,
  incrementLinkClickCount,
  isSafeUrl,
  moveItem,
  moveLinksToGroup,
  nextThemePreference,
  normalizeUrl,
  reorderLinkInGroup,
  GROUP_COLOR_OPTIONS,
  WALLPAPER_INTENSITY_OPTIONS,
  WALLPAPER_PRESET_OPTIONS,
} from './dashboard'
import { isImportFileTooLarge, parseDashboardImport } from './importers'
import type { ParsedDashboardImport } from './importers'
import { checkDashboardLinks } from './linkChecker'
import type { LinkCheckResult } from './linkChecker'
import {
  applyLinkCheckResults,
  confirmLinkCheckResult,
  createImportPreview,
  getDashboardHealth,
  getStoredLinkCheckResults,
  mergeImportedDashboard,
  removeDuplicateLinksByUrl,
} from './maintenance'
import type {
  CardLayout,
  DashboardBackup,
  DashboardData,
  GroupColor,
  LinkItem,
  WallpaperIntensity,
  WallpaperPreset,
} from './types'

type SearchScope = 'group' | 'all'
type ImportMode = 'merge' | 'replace'
type CheckFilter = 'issues' | 'broken' | 'limited' | 'ok' | 'all'

type UndoEntry = {
  label: string
  dashboard: DashboardData
}

const cardLayoutLabels: Record<CardLayout, string> = {
  comfortable: '舒适卡片',
  compact: '紧凑卡片',
  list: '列表模式',
}

const wallpaperPresetLabels: Record<WallpaperPreset, string> = {
  none: '无背景',
  paper: '柔和纸面',
  'dark-desk': '深色工作台',
  'blue-gray': '清晨蓝灰',
  'soft-green': '绿色护眼',
  'warm-gray': '暖灰',
}

const wallpaperIntensityLabels: Record<WallpaperIntensity, string> = {
  normal: '标准',
  soft: '更淡',
}

const groupColorLabels: Record<GroupColor, string> = {
  slate: '灰',
  blue: '蓝',
  green: '绿',
  amber: '黄',
  rose: '红',
  purple: '紫',
  teal: '青',
}

type VisibleLink = {
  groupId: string
  groupName: string
  groupColor: GroupColor
  link: LinkItem
  linkIndex: number
}

type QuickEditDraft =
  | {
      kind: 'group'
      groupId: string
      name: string
    }
  | {
      kind: 'link'
      groupId: string
      linkId: string
      title: string
      url: string
      icon: string
    }

function formatStorageSize(bytes: number) {
  if (bytes < 1024) {
    return `${bytes} B`
  }

  return `${(bytes / 1024).toFixed(1)} KB`
}

function App() {
  const [dashboard, setDashboard] = useState<DashboardData | null>(null)
  const [query, setQuery] = useState('')
  const [isEditing, setIsEditing] = useState(false)
  const [status, setStatus] = useState('正在加载...')
  const [isSaving, setIsSaving] = useState(false)
  const [activeGroupId, setActiveGroupId] = useState('')
  const [searchScope, setSearchScope] = useState<SearchScope>('group')
  const [selectedLinkIds, setSelectedLinkIds] = useState<Set<string>>(() => new Set())
  const [batchTargetGroupId, setBatchTargetGroupId] = useState('')
  const [backups, setBackups] = useState<DashboardBackup[]>([])
  const [pendingImport, setPendingImport] = useState<ParsedDashboardImport | null>(null)
  const [importMode, setImportMode] = useState<ImportMode>('merge')
  const [undoEntry, setUndoEntry] = useState<UndoEntry | null>(null)
  const [quickEdit, setQuickEdit] = useState<QuickEditDraft | null>(null)
  const [highlightedLinkId, setHighlightedLinkId] = useState('')
  const [isCheckingLinks, setIsCheckingLinks] = useState(false)
  const [checkFilter, setCheckFilter] = useState<CheckFilter>('issues')
  const [linkCheckProgress, setLinkCheckProgress] = useState({ done: 0, total: 0 })
  const [linkCheckResults, setLinkCheckResults] = useState<LinkCheckResult[]>([])
  const [draggingLinkId, setDraggingLinkId] = useState('')
  const [dragOverLinkId, setDragOverLinkId] = useState('')
  const [suppressedClickLinkId, setSuppressedClickLinkId] = useState('')
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  async function refreshBackups() {
    try {
      setBackups(await loadDashboardBackups())
    } catch {
      setBackups([])
    }
  }

  useEffect(() => {
    let isMounted = true

    loadDashboard()
      .then((data) => {
        if (!isMounted) {
          return
        }

        setDashboard(data)
        setStatus('已就绪')
        refreshBackups()
      })
      .catch(() => {
        if (isMounted) {
          setStatus('加载失败，请刷新重试')
        }
      })

    return () => {
      isMounted = false
    }
  }, [])

  useEffect(() => {
    if (dashboard) {
      document.documentElement.dataset.theme = dashboard.settings.theme
      document.documentElement.dataset.cardLayout =
        dashboard.settings.cardLayout ?? 'comfortable'
      document.documentElement.dataset.wallpaper =
        dashboard.settings.wallpaper?.preset ?? 'none'
      document.documentElement.dataset.wallpaperIntensity =
        dashboard.settings.wallpaper?.intensity ?? 'normal'
      document.title = dashboard.settings.title
    }
  }, [dashboard])

  useEffect(() => {
    if (!dashboard) {
      return
    }

    if (dashboard.groups.length === 0) {
      if (activeGroupId) {
        setActiveGroupId('')
      }
      return
    }

    if (!dashboard.groups.some((group) => group.id === activeGroupId)) {
      setActiveGroupId(dashboard.groups[0].id)
    }
  }, [activeGroupId, dashboard])

  useEffect(() => {
    if (!dashboard || dashboard.groups.length === 0) {
      if (batchTargetGroupId) {
        setBatchTargetGroupId('')
      }
      return
    }

    if (!dashboard.groups.some((group) => group.id === batchTargetGroupId)) {
      setBatchTargetGroupId(dashboard.groups[0].id)
    }
  }, [batchTargetGroupId, dashboard])

  const activeGroup = useMemo(() => {
    if (!dashboard || dashboard.groups.length === 0) {
      return null
    }

    return (
      dashboard.groups.find((group) => group.id === activeGroupId) ??
      dashboard.groups[0]
    )
  }, [activeGroupId, dashboard])

  const activeGroupIndex = useMemo(() => {
    if (!dashboard || !activeGroup) {
      return -1
    }

    return dashboard.groups.findIndex((group) => group.id === activeGroup.id)
  }, [activeGroup, dashboard])

  const visibleLinkItems = useMemo<VisibleLink[]>(() => {
    if (!dashboard || !activeGroup) {
      return []
    }

    const keyword = query.trim().toLocaleLowerCase()
    const sourceGroups =
      searchScope === 'all' && !isEditing && keyword ? dashboard.groups : [activeGroup]

    return sourceGroups.flatMap((group) =>
      group.links
        .map((link, linkIndex) => ({
          groupId: group.id,
          groupName: group.name,
          groupColor: group.color ?? 'slate',
          link,
          linkIndex,
        }))
        .filter((item) => {
          if (!keyword) {
            return true
          }

          return (
            item.link.title.toLocaleLowerCase().includes(keyword) ||
            item.link.url.toLocaleLowerCase().includes(keyword) ||
            item.groupName.toLocaleLowerCase().includes(keyword)
          )
        }),
    )
  }, [activeGroup, dashboard, isEditing, query, searchScope])

  const totalLinks = useMemo(() => {
    return dashboard?.groups.reduce((count, group) => count + group.links.length, 0) ?? 0
  }, [dashboard])

  const duplicateLinks = useMemo(() => {
    return dashboard ? findDuplicateLinks(dashboard) : []
  }, [dashboard])

  const duplicateLinkIds = useMemo(() => {
    return findDuplicateLinkIds(duplicateLinks)
  }, [duplicateLinks])

  const importPreview = useMemo(() => {
    return dashboard && pendingImport
      ? createImportPreview(dashboard, pendingImport.dashboard)
      : null
  }, [dashboard, pendingImport])

  const storedLinkCheckResults = useMemo(() => {
    return dashboard ? getStoredLinkCheckResults(dashboard) : []
  }, [dashboard])

  const visibleLinkCheckResults =
    linkCheckResults.length > 0 ? linkCheckResults : storedLinkCheckResults

  const brokenLinkResults = useMemo(() => {
    return visibleLinkCheckResults.filter((item) => item.status === 'broken')
  }, [visibleLinkCheckResults])

  const limitedLinkResults = useMemo(() => {
    return visibleLinkCheckResults.filter((item) => item.status === 'limited')
  }, [visibleLinkCheckResults])

  const okLinkCount = useMemo(() => {
    return visibleLinkCheckResults.filter((item) => item.status === 'ok').length
  }, [visibleLinkCheckResults])

  const filteredLinkCheckResults = useMemo(() => {
    if (checkFilter === 'all') {
      return visibleLinkCheckResults
    }

    if (checkFilter === 'issues') {
      return visibleLinkCheckResults.filter((item) => item.status !== 'ok')
    }

    return visibleLinkCheckResults.filter((item) => item.status === checkFilter)
  }, [checkFilter, visibleLinkCheckResults])

  const dashboardHealth = useMemo(() => {
    return dashboard ? getDashboardHealth(dashboard, backups) : null
  }, [backups, dashboard])

  const isGlobalSearch =
    !isEditing && searchScope === 'all' && query.trim().length > 0
  const canDragSortLinks = Boolean(activeGroup && !isEditing && !isGlobalSearch)
  const selectedCount = selectedLinkIds.size

  function updateDashboard(updater: (current: DashboardData) => DashboardData) {
    setDashboard((current) => {
      if (!current) {
        return current
      }

      return updater(current)
    })
    setStatus('有未保存修改')
  }

  function rememberUndo(
    label: string,
    previousDashboard: DashboardData,
    persistBackup = true,
  ) {
    setUndoEntry({
      label,
      dashboard: previousDashboard,
    })

    if (!persistBackup) {
      return
    }

    void saveDashboardBackup(previousDashboard)
      .then(refreshBackups)
      .catch(() => {
        // Undo still works for the current page even if the backup write fails.
      })
  }

  function updateDashboardWithUndo(
    label: string,
    updater: (current: DashboardData) => DashboardData,
  ) {
    if (!dashboard) {
      return
    }

    rememberUndo(label, dashboard)
    setDashboard(updater(dashboard))
    setStatus('有未保存修改')
  }

  async function undoLastChange() {
    if (!undoEntry) {
      return
    }

    const entry = undoEntry
    setUndoEntry(null)
    const saved = await saveDirectDashboard(entry.dashboard)

    if (saved) {
      setStatus(`已撤销：${entry.label}`)
    }
  }

  function startEditing() {
    setIsEditing(true)
    setStatus('已进入编辑模式')
  }

  function lockEditing() {
    setIsEditing(false)
    setStatus('已退出编辑模式')
  }

  async function handleSave() {
    if (!dashboard) {
      return
    }

    setIsSaving(true)
    setStatus('正在保存...')

    try {
      const result = await saveDashboard(dashboard)
      setDashboard((current) =>
        current
          ? {
              ...current,
              updatedAt: result.updatedAt,
            }
          : current,
      )
      refreshBackups()
      setStatus(result.mode === 'chrome' ? '已保存到 Chrome 本地存储' : '已保存到本机')
    } catch (error) {
      setStatus(error instanceof Error ? error.message : '保存失败')
    } finally {
      setIsSaving(false)
    }
  }

  async function saveDirectDashboard(nextDashboard: DashboardData, undoLabel?: string) {
    if (undoLabel && dashboard) {
      rememberUndo(undoLabel, dashboard, false)
    }

    setDashboard(nextDashboard)
    setIsSaving(true)
    setStatus('正在保存...')

    try {
      const result = await saveDashboard(nextDashboard)
      setDashboard((current) =>
        current
          ? {
              ...current,
              updatedAt: result.updatedAt,
            }
          : current,
      )
      refreshBackups()
      setStatus(result.mode === 'chrome' ? '已保存到 Chrome 本地存储' : '已保存到本机')
      return true
    } catch (error) {
      setStatus(error instanceof Error ? error.message : '保存失败')
      return false
    } finally {
      setIsSaving(false)
    }
  }

  function recordLinkClick(groupId: string, linkId: string) {
    if (!dashboard) {
      return
    }

    const nextDashboard = incrementLinkClickCount(dashboard, groupId, linkId)
    setDashboard(nextDashboard)

    void saveDashboardSnapshot(nextDashboard)
      .then((result) => {
        setDashboard((current) =>
          current
            ? {
                ...current,
                updatedAt: result.updatedAt,
              }
            : current,
        )
      })
      .catch(() => {
        setStatus('点击统计保存失败')
      })
  }

  function toggleFrontTheme() {
    if (!dashboard) {
      return
    }

    const theme = nextThemePreference(dashboard.settings.theme)
    const nextDashboard = {
      ...dashboard,
      settings: {
        ...dashboard.settings,
        theme,
      },
    }

    setDashboard(nextDashboard)
    setStatus(theme === 'dark' ? '已切换到深色' : '已切换到浅色')

    void saveDashboardSnapshot(nextDashboard)
      .then((result) => {
        setDashboard((current) =>
          current
            ? {
                ...current,
                updatedAt: result.updatedAt,
              }
            : current,
        )
      })
      .catch(() => {
        setStatus('主题保存失败')
      })
  }

  function startGroupQuickEdit(groupId: string) {
    const group = dashboard?.groups.find((item) => item.id === groupId)

    if (!group) {
      return
    }

    setQuickEdit({
      kind: 'group',
      groupId,
      name: group.name,
    })
  }

  function startLinkQuickEdit(groupId: string, linkId: string) {
    const link = dashboard?.groups
      .find((group) => group.id === groupId)
      ?.links.find((item) => item.id === linkId)

    if (!link) {
      return
    }

    setQuickEdit({
      kind: 'link',
      groupId,
      linkId,
      title: link.title,
      url: link.url,
      icon: link.icon || '',
    })
  }

  async function saveQuickEdit() {
    if (!dashboard || !quickEdit) {
      return
    }

    if (quickEdit.kind === 'group') {
      const saved = await saveDirectDashboard({
        ...dashboard,
        groups: dashboard.groups.map((group) =>
          group.id === quickEdit.groupId
            ? {
                ...group,
                name: quickEdit.name,
              }
            : group,
        ),
      })

      if (saved) {
        setQuickEdit(null)
      }
      return
    }

    if (!isSafeUrl(quickEdit.url)) {
      setStatus('只支持 http 或 https 地址')
      return
    }

    const saved = await saveDirectDashboard({
      ...dashboard,
      groups: dashboard.groups.map((group) =>
        group.id === quickEdit.groupId
          ? {
              ...group,
              links: group.links.map((link) =>
                link.id === quickEdit.linkId
                  ? {
                      ...link,
                      title: quickEdit.title,
                      url: normalizeUrl(quickEdit.url),
                      icon: quickEdit.icon.trim() || undefined,
                    }
                  : link,
              ),
            }
          : group,
      ),
    })

    if (saved) {
      setQuickEdit(null)
    }
  }

  function deleteGroupDirect(groupId: string) {
    if (!dashboard) {
      return
    }

    if (!confirm('删除这个分组和里面的所有网站？')) {
      return
    }

    void saveDirectDashboard(
      {
        ...dashboard,
        groups: dashboard.groups.filter((group) => group.id !== groupId),
      },
      '删除分组',
    )
  }

  function deleteLinkDirect(groupId: string, linkId: string) {
    if (!dashboard) {
      return false
    }

    if (!confirm('删除这个网站？')) {
      return false
    }

    void saveDirectDashboard(
      {
        ...dashboard,
        groups: dashboard.groups.map((group) =>
          group.id === groupId
            ? {
                ...group,
                links: group.links.filter((link) => link.id !== linkId),
              }
          : group,
        ),
      },
      '删除网址',
    )
    setLinkCheckResults((current) => current.filter((item) => item.linkId !== linkId))
    return true
  }

  function addGroup() {
    const group = createEmptyGroup()

    updateDashboard((current) => ({
      ...current,
      groups: [...current.groups, group],
    }))
    setActiveGroupId(group.id)
  }

  function updateGroupName(groupId: string, name: string) {
    updateDashboard((current) => ({
      ...current,
      groups: current.groups.map((group) =>
        group.id === groupId
          ? {
              ...group,
              name,
            }
          : group,
      ),
    }))
  }

  function deleteGroup(groupId: string) {
    if (!confirm('删除这个分组和里面的所有网站？')) {
      return
    }

    updateDashboardWithUndo('删除分组', (current) => ({
      ...current,
      groups: current.groups.filter((group) => group.id !== groupId),
    }))
  }

  function moveGroup(groupIndex: number, direction: -1 | 1) {
    updateDashboardWithUndo('调整分组排序', (current) => ({
      ...current,
      groups: moveItem(current.groups, groupIndex, direction),
    }))
  }

  function addLink(groupId: string) {
    updateDashboard((current) => ({
      ...current,
      groups: current.groups.map((group) =>
        group.id === groupId
          ? {
              ...group,
              links: [...group.links, createEmptyLink()],
            }
          : group,
      ),
    }))
  }

  function updateLink(groupId: string, linkId: string, patch: Partial<LinkItem>) {
    updateDashboard((current) => ({
      ...current,
      groups: current.groups.map((group) =>
        group.id === groupId
          ? {
              ...group,
              links: group.links.map((link) =>
                link.id === linkId
                  ? {
                      ...link,
                      ...patch,
                    }
                  : link,
              ),
            }
          : group,
      ),
    }))
  }

  function deleteLink(groupId: string, linkId: string) {
    updateDashboardWithUndo('删除网址', (current) => ({
      ...current,
      groups: current.groups.map((group) =>
        group.id === groupId
          ? {
              ...group,
              links: group.links.filter((link) => link.id !== linkId),
            }
          : group,
      ),
    }))
  }

  function moveLink(groupId: string, linkIndex: number, direction: -1 | 1) {
    updateDashboardWithUndo('调整网址排序', (current) => ({
      ...current,
      groups: current.groups.map((group) =>
        group.id === groupId
          ? {
              ...group,
              links: moveItem(group.links, linkIndex, direction),
            }
          : group,
      ),
    }))
  }

  function updateSetting<K extends keyof DashboardData['settings']>(
    key: K,
    value: DashboardData['settings'][K],
  ) {
    updateDashboard((current) => ({
      ...current,
      settings: {
        ...current.settings,
        [key]: value,
      },
    }))
  }

  function updateWallpaper<K extends keyof NonNullable<DashboardData['settings']['wallpaper']>>(
    key: K,
    value: NonNullable<DashboardData['settings']['wallpaper']>[K],
  ) {
    updateDashboard((current) => ({
      ...current,
      settings: {
        ...current.settings,
        wallpaper: {
          preset: current.settings.wallpaper?.preset ?? 'none',
          intensity: current.settings.wallpaper?.intensity ?? 'normal',
          [key]: value,
        },
      },
    }))
  }

  function updateGroupColor(groupId: string, color: GroupColor) {
    updateDashboard((current) => ({
      ...current,
      groups: current.groups.map((group) =>
        group.id === groupId
          ? {
              ...group,
              color,
            }
          : group,
      ),
    }))
  }

  function exportJson() {
    if (!dashboard) {
      return
    }

    const blob = new Blob([JSON.stringify(dashboard, null, 2)], {
      type: 'application/json',
    })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `startpage-backup-${new Date().toISOString().slice(0, 10)}.json`
    link.click()
    URL.revokeObjectURL(url)
    setStatus('已导出 JSON 备份')
  }

  async function importJson(file: File | undefined) {
    if (!file) {
      return
    }

    try {
      if (isImportFileTooLarge(file)) {
        setStatus('导入文件超过 10MB，请先拆分或精简后再导入')
        return
      }

      const text = await file.text()
      const imported = parseDashboardImport(file.name, text)
      setPendingImport(imported)
      setImportMode('merge')
      setStatus(
        `已读取${imported.source === 'itab' ? ' iTab' : ' JSON'}：${imported.groupCount} 个分组，${imported.linkCount} 个网站`,
      )
    } catch {
      setStatus('导入失败，请检查 JSON 或 iTab 备份文件')
    } finally {
      if (fileInputRef.current) {
        fileInputRef.current.value = ''
      }
    }
  }

  async function confirmImport() {
    if (!dashboard || !pendingImport) {
      return
    }

    const nextDashboard =
      importMode === 'merge'
        ? mergeImportedDashboard(dashboard, pendingImport.dashboard)
        : pendingImport.dashboard

    try {
      await saveDashboardBackup(dashboard)
      await refreshBackups()
    } catch {
      // Import still remains local to the page until the user saves.
    }

    rememberUndo('导入数据', dashboard, false)
    setDashboard(nextDashboard)
    setActiveGroupId(nextDashboard.groups[0]?.id ?? '')
    setSelectedLinkIds(new Set())
    setLinkCheckResults([])
    setPendingImport(null)
    setStatus('已导入，点击保存后写入本地存储')
  }

  function cancelImport() {
    setPendingImport(null)
    setStatus('已取消导入')
  }

  function restoreBackup(backup: DashboardBackup | undefined) {
    if (!backup || !dashboard) {
      return
    }

    if (!confirm(`恢复 ${new Date(backup.createdAt).toLocaleString()} 的备份？当前未保存修改会被覆盖。`)) {
      return
    }

    rememberUndo('恢复备份', dashboard, false)
    setDashboard(backup.dashboard)
    setActiveGroupId(backup.dashboard.groups[0]?.id ?? '')
    setSelectedLinkIds(new Set())
    setStatus('已恢复备份，点击保存后写入本地存储')
  }

  function toggleLinkSelection(linkId: string) {
    setSelectedLinkIds((current) => {
      const next = new Set(current)

      if (next.has(linkId)) {
        next.delete(linkId)
      } else {
        next.add(linkId)
      }

      return next
    })
  }

  function moveSelectedLinks() {
    if (!batchTargetGroupId || selectedLinkIds.size === 0) {
      return
    }

    updateDashboardWithUndo('移动选中网址', (current) =>
      moveLinksToGroup(current, selectedLinkIds, batchTargetGroupId),
    )
    setActiveGroupId(batchTargetGroupId)
    setSelectedLinkIds(new Set())
  }

  function deleteSelectedLinks() {
    if (selectedLinkIds.size === 0) {
      return
    }

    if (!confirm(`删除选中的 ${selectedLinkIds.size} 个网站？`)) {
      return
    }

    updateDashboardWithUndo('删除选中网址', (current) =>
      deleteLinks(current, selectedLinkIds),
    )
    setSelectedLinkIds(new Set())
  }

  function clearSelectedIcons() {
    if (selectedLinkIds.size === 0) {
      return
    }

    updateDashboardWithUndo('清空选中图标', (current) =>
      clearLinkIcons(current, selectedLinkIds),
    )
    setSelectedLinkIds(new Set())
  }

  function handleSearchKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Escape') {
      setQuery('')
      return
    }

    if (event.key !== 'Enter' || isEditing) {
      return
    }

    const first = visibleLinkItems[0]
    if (first) {
      recordLinkClick(first.groupId, first.link.id)
      window.open(normalizeUrl(first.link.url), '_blank', 'noopener,noreferrer')
    }
  }

  function resetLinkDrag() {
    setDraggingLinkId('')
    setDragOverLinkId('')
  }

  function handleLinkDragStart(
    event: DragEvent<HTMLElement>,
    groupId: string,
    linkId: string,
  ) {
    if (!canDragSortLinks || groupId !== activeGroup?.id) {
      event.preventDefault()
      return
    }

    setDraggingLinkId(linkId)
    setDragOverLinkId('')
    event.dataTransfer.effectAllowed = 'move'
    event.dataTransfer.setData('text/plain', linkId)
  }

  function handleLinkDragOver(
    event: DragEvent<HTMLElement>,
    groupId: string,
    linkId: string,
  ) {
    if (
      !canDragSortLinks ||
      groupId !== activeGroup?.id ||
      !draggingLinkId ||
      draggingLinkId === linkId
    ) {
      return
    }

    event.preventDefault()
    event.dataTransfer.dropEffect = 'move'
    setDragOverLinkId(linkId)
  }

  function handleLinkDrop(
    event: DragEvent<HTMLElement>,
    groupId: string,
    targetLinkId: string,
  ) {
    event.preventDefault()

    if (!dashboard || !canDragSortLinks || groupId !== activeGroup?.id) {
      resetLinkDrag()
      return
    }

    const draggedLinkId = event.dataTransfer.getData('text/plain') || draggingLinkId
    resetLinkDrag()

    if (!draggedLinkId || draggedLinkId === targetLinkId) {
      return
    }

    const nextDashboard = reorderLinkInGroup(
      dashboard,
      groupId,
      draggedLinkId,
      targetLinkId,
    )

    if (nextDashboard === dashboard) {
      return
    }

    setSuppressedClickLinkId(draggedLinkId)
    window.setTimeout(() => {
      setSuppressedClickLinkId((current) =>
        current === draggedLinkId ? '' : current,
      )
    }, 250)
    rememberUndo('调整网址排序', dashboard)
    setDashboard(nextDashboard)
    setStatus('正在保存排序...')

    void saveDashboardSnapshot(nextDashboard)
      .then((result) => {
        setDashboard((current) =>
          current
            ? {
                ...current,
                updatedAt: result.updatedAt,
              }
            : current,
        )
        setStatus(result.mode === 'chrome' ? '排序已保存到 Chrome 本地存储' : '排序已保存到本机')
      })
      .catch(() => {
        setStatus('排序保存失败')
      })
  }

  function handleLinkCardClick(
    event: MouseEvent<HTMLAnchorElement>,
    groupId: string,
    linkId: string,
  ) {
    if (suppressedClickLinkId === linkId || draggingLinkId === linkId) {
      event.preventDefault()
      return
    }

    recordLinkClick(groupId, linkId)
  }

  function locateLink(groupId: string, linkId: string) {
    setIsEditing(true)
    setActiveGroupId(groupId)
    setSearchScope('group')
    setQuery('')
    setHighlightedLinkId(linkId)

    window.setTimeout(() => {
      document
        .getElementById(`link-editor-${linkId}`)
        ?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }, 80)

    window.setTimeout(() => {
      setHighlightedLinkId((current) => (current === linkId ? '' : current))
    }, 2600)
  }

  async function runLinkCheck() {
    if (!dashboard || isCheckingLinks) {
      return
    }

    setIsCheckingLinks(true)
    setLinkCheckResults([])
    setLinkCheckProgress({ done: 0, total: totalLinks })
    setStatus('正在批量检测网址...')

    try {
      const results = await checkDashboardLinks(dashboard, {
        concurrency: 5,
        timeoutMs: 8000,
        onProgress: (done, total) => setLinkCheckProgress({ done, total }),
      })
      const checkedAt = new Date().toISOString()
      const nextDashboard = applyLinkCheckResults(dashboard, results, checkedAt)
      const brokenCount = results.filter((item) => item.status === 'broken').length
      const limitedCount = results.filter((item) => item.status === 'limited').length

      setDashboard(nextDashboard)
      setLinkCheckResults(results)
      void saveDashboardSnapshot(nextDashboard).catch(() => {
        setStatus('检测结果保存失败')
      })
      setStatus(`检测完成：${brokenCount} 个疑似失效，${limitedCount} 个受限或异常`)
    } catch {
      setStatus('批量检测失败，请稍后重试')
    } finally {
      setIsCheckingLinks(false)
    }
  }

  function confirmCheckResultAsOk(item: LinkCheckResult) {
    if (!dashboard) {
      return
    }

    const confirmedAt = new Date().toISOString()
    const nextDashboard = confirmLinkCheckResult(dashboard, item.linkId, confirmedAt)

    setDashboard(nextDashboard)
    setLinkCheckResults((current) =>
      current.map((result) =>
        result.linkId === item.linkId
          ? {
              ...result,
              status: 'ok',
              reason: '手动确认正常',
            }
          : result,
      ),
    )
    void saveDashboardSnapshot(nextDashboard).catch(() => {
      setStatus('检测结果保存失败')
    })
  }

  function renderCheckResult(item: LinkCheckResult) {
    return (
      <article className={`check-result is-${item.status}`} key={item.linkId}>
        <div className="check-result-main">
          <strong>{item.title}</strong>
          <span>
            {item.groupName} · {item.url}
          </span>
        </div>
        <span className="check-reason">{item.reason}</span>
        <div className="row-actions check-actions">
          <button
            type="button"
            className="ghost-button"
            onClick={() => locateLink(item.groupId, item.linkId)}
          >
            定位
          </button>
          <button
            type="button"
            className="ghost-button"
            onClick={() => {
              locateLink(item.groupId, item.linkId)
              startLinkQuickEdit(item.groupId, item.linkId)
            }}
          >
            编辑
          </button>
          <button
            type="button"
            className="ghost-button danger"
            onClick={() => deleteLinkDirect(item.groupId, item.linkId)}
          >
            删除
          </button>
          <button
            type="button"
            className="ghost-button"
            onClick={() => confirmCheckResultAsOk(item)}
          >
            确认正常
          </button>
          <button
            type="button"
            className="ghost-button"
            onClick={() =>
              window.open(normalizeUrl(item.url), '_blank', 'noopener,noreferrer')
            }
          >
            打开
          </button>
        </div>
      </article>
    )
  }

  if (!dashboard) {
    return (
      <main className="page-shell">
        <section className="loading-panel">{status}</section>
      </main>
    )
  }

  return (
    <main className="page-shell">
      <header className="topbar">
        <div className="brand">
          {isEditing ? (
            <input
              className="title-input"
              value={dashboard.settings.title}
              onChange={(event) => updateSetting('title', event.target.value)}
              aria-label="站点标题"
            />
          ) : (
            <h1>{dashboard.settings.title}</h1>
          )}
          <span className="status">
            {status} · {dashboard.groups.length} 个分组 · {totalLinks} 个网站
          </span>
        </div>

        <div className="toolbar">
          <input
            className="search-input"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={handleSearchKeyDown}
            placeholder="搜索网站"
            aria-label="搜索网站"
          />
          <select
            className="select-input compact-select"
            value={searchScope}
            onChange={(event) => setSearchScope(event.target.value as SearchScope)}
            aria-label="搜索范围"
            disabled={isEditing}
          >
            <option value="group">当前分组</option>
            <option value="all">全部分组</option>
          </select>
          <button
            type="button"
            className="icon-button theme-toggle-button"
            onClick={toggleFrontTheme}
            aria-label={dashboard.settings.theme === 'dark' ? '切换浅色' : '切换深色'}
            title={dashboard.settings.theme === 'dark' ? '切换浅色' : '切换深色'}
          >
            {dashboard.settings.theme === 'dark' ? '☀' : '☾'}
          </button>

          {isEditing ? (
            <>
              <select
                className="select-input"
                value={dashboard.settings.theme}
                onChange={(event) =>
                  updateSetting(
                    'theme',
                    event.target.value as DashboardData['settings']['theme'],
                  )
                }
                aria-label="主题"
              >
                <option value="system">跟随系统</option>
                <option value="light">浅色</option>
                <option value="dark">深色</option>
              </select>
              <button type="button" className="ghost-button" onClick={exportJson}>
                导出
              </button>
              <button
                type="button"
                className="ghost-button"
                onClick={() => fileInputRef.current?.click()}
              >
                导入
              </button>
              <button
                type="button"
                className="ghost-button"
                onClick={() => restoreBackup(backups[0])}
                disabled={backups.length === 0}
              >
                恢复上次备份
              </button>
              <button
                type="button"
                className="primary-button"
                onClick={handleSave}
                disabled={isSaving}
              >
                {isSaving ? '保存中' : '保存'}
              </button>
              <button type="button" className="ghost-button" onClick={lockEditing}>
                完成
              </button>
            </>
          ) : (
            <button type="button" className="primary-button" onClick={startEditing}>
              编辑
            </button>
          )}
        </div>
      </header>

      {undoEntry ? (
        <section className="notice-panel compact-notice undo-panel">
          <div>
            <strong>可以撤销最近一次操作</strong>
            <span>{undoEntry.label}</span>
          </div>
          <div className="row-actions">
            <button
              type="button"
              className="primary-button"
              onClick={() => void undoLastChange()}
              disabled={isSaving}
            >
              撤销
            </button>
            <button
              type="button"
              className="ghost-button"
              onClick={() => setUndoEntry(null)}
            >
              忽略
            </button>
          </div>
        </section>
      ) : null}

      {isEditing ? (
        <section className="editor-actions">
          <button type="button" className="ghost-button" onClick={addGroup}>
            新增分组
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="application/json,.json,.itabdata"
            hidden
            onChange={(event) => importJson(event.target.files?.[0])}
          />
          {selectedCount > 0 ? (
            <div className="batch-actions">
              <span className="batch-status">已选 {selectedCount} 个网站</span>
              <select
                className="select-input"
                value={batchTargetGroupId}
                onChange={(event) => setBatchTargetGroupId(event.target.value)}
                aria-label="移动到分组"
              >
                {dashboard.groups.map((group) => (
                  <option value={group.id} key={group.id}>
                    {group.name}
                  </option>
                ))}
              </select>
              <button type="button" className="ghost-button" onClick={moveSelectedLinks}>
                移动
              </button>
              <button type="button" className="ghost-button" onClick={clearSelectedIcons}>
                清空图标
              </button>
              <button type="button" className="ghost-button danger" onClick={deleteSelectedLinks}>
                删除
              </button>
            </div>
          ) : null}
        </section>
      ) : null}

      {isEditing ? (
        <section className="notice-panel appearance-panel">
          <div className="maintenance-heading">
            <div>
              <strong>外观</strong>
              <span>调整卡片密度、背景和当前分组颜色。</span>
            </div>
          </div>
          <div className="appearance-grid">
            <label className="field-label">
              卡片布局
              <select
                className="select-input"
                value={dashboard.settings.cardLayout ?? 'comfortable'}
                onChange={(event) =>
                  updateSetting('cardLayout', event.target.value as CardLayout)
                }
              >
                {CARD_LAYOUT_OPTIONS.map((layout) => (
                  <option value={layout} key={layout}>
                    {cardLayoutLabels[layout]}
                  </option>
                ))}
              </select>
            </label>
            <label className="field-label">
              背景
              <select
                className="select-input"
                value={dashboard.settings.wallpaper?.preset ?? 'none'}
                onChange={(event) =>
                  updateWallpaper('preset', event.target.value as WallpaperPreset)
                }
              >
                {WALLPAPER_PRESET_OPTIONS.map((preset) => (
                  <option value={preset} key={preset}>
                    {wallpaperPresetLabels[preset]}
                  </option>
                ))}
              </select>
            </label>
            <label className="field-label">
              背景强度
              <select
                className="select-input"
                value={dashboard.settings.wallpaper?.intensity ?? 'normal'}
                onChange={(event) =>
                  updateWallpaper('intensity', event.target.value as WallpaperIntensity)
                }
              >
                {WALLPAPER_INTENSITY_OPTIONS.map((intensity) => (
                  <option value={intensity} key={intensity}>
                    {wallpaperIntensityLabels[intensity]}
                  </option>
                ))}
              </select>
            </label>
            {activeGroup ? (
              <div className="field-label">
                当前分组颜色
                <div className="color-swatch-row" role="group" aria-label="当前分组颜色">
                  {GROUP_COLOR_OPTIONS.map((color) => (
                    <button
                      type="button"
                      className={`color-swatch is-color-${color} ${
                        (activeGroup.color ?? 'slate') === color ? 'is-selected' : ''
                      }`}
                      onClick={() => updateGroupColor(activeGroup.id, color)}
                      aria-label={`设置分组颜色：${groupColorLabels[color]}`}
                      title={groupColorLabels[color]}
                      key={color}
                    />
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        </section>
      ) : null}

      {isEditing && dashboardHealth ? (
        <section className="notice-panel health-panel">
          <div className="maintenance-heading">
            <div>
              <strong>数据健康</strong>
              <span>
                最近备份：
                {dashboardHealth.lastBackupAt
                  ? new Date(dashboardHealth.lastBackupAt).toLocaleString()
                  : '暂无'}
              </span>
            </div>
            <button
              type="button"
              className="ghost-button"
              onClick={() => restoreBackup(backups[0])}
              disabled={backups.length === 0}
            >
              恢复最近备份
            </button>
          </div>
          <div className="health-grid">
            <span>分组 {dashboardHealth.groupCount}</span>
            <span>网址 {dashboardHealth.linkCount}</span>
            <span>重复组 {dashboardHealth.duplicateGroupCount}</span>
            <span>多余重复 {dashboardHealth.duplicateLinkCount}</span>
            <span>失效 {dashboardHealth.brokenCount}</span>
            <span>受限 {dashboardHealth.limitedCount}</span>
            <span>本地约 {formatStorageSize(dashboardHealth.storageBytes)}</span>
          </div>
          {backups.length > 0 ? (
            <div className="backup-list">
              {backups.slice(0, 5).map((backup) => (
                <article className="backup-card" key={backup.id}>
                  <span>{new Date(backup.createdAt).toLocaleString()}</span>
                  <button
                    type="button"
                    className="ghost-button"
                    onClick={() => restoreBackup(backup)}
                  >
                    恢复
                  </button>
                </article>
              ))}
            </div>
          ) : null}
        </section>
      ) : null}

      {pendingImport ? (
        <section className="notice-panel">
          <div>
            <strong>
              准备导入 {pendingImport.source === 'itab' ? 'iTab 备份' : 'JSON 备份'}
            </strong>
            <span>
              {pendingImport.groupCount} 个分组 · {pendingImport.linkCount} 个网站
              {pendingImport.skipped.length > 0
                ? ` · 跳过 ${pendingImport.skipped.length} 个内部或无效地址`
                : ''}
            </span>
          </div>
          {pendingImport.skipped.length > 0 ? (
            <ul className="compact-list">
              {pendingImport.skipped.slice(0, 6).map((item) => (
                <li key={`${item.group}-${item.name}-${item.url}`}>
                  {item.group} / {item.name}：{item.url}
                </li>
              ))}
            </ul>
          ) : null}
          {importPreview ? (
            <div className="import-preview-grid">
              <span>导入分组 {importPreview.importedGroupCount}</span>
              <span>导入网址 {importPreview.importedLinkCount}</span>
              <span>重复网址 {importPreview.duplicateUrlCount}</span>
              <span>合并后网址 {importPreview.mergeLinkCount}</span>
            </div>
          ) : null}
          <label className="field-label compact-label">
            导入方式
            <select
              className="select-input"
              value={importMode}
              onChange={(event) => setImportMode(event.target.value as ImportMode)}
            >
              <option value="merge">合并导入，跳过已有网址</option>
              <option value="replace">覆盖当前全部数据</option>
            </select>
          </label>
          <div className="row-actions">
            <button type="button" className="primary-button" onClick={confirmImport}>
              确认导入
            </button>
            <button type="button" className="ghost-button" onClick={cancelImport}>
              取消
            </button>
          </div>
        </section>
      ) : null}

      {isEditing ? (
        <section className="notice-panel maintenance-panel">
          <div className="maintenance-heading">
            <div>
              <strong>网址维护</strong>
              <span>
                {visibleLinkCheckResults.length > 0
                  ? `最近检测：正常 ${okLinkCount} 个，疑似失效 ${brokenLinkResults.length} 个，受限或异常 ${limitedLinkResults.length} 个`
                  : '批量检测当前全部网址，集中查看疑似失效链接。'}
              </span>
            </div>
            <div className="row-actions">
              <select
                className="select-input compact-select"
                value={checkFilter}
                onChange={(event) => setCheckFilter(event.target.value as CheckFilter)}
                aria-label="检测结果筛选"
              >
                <option value="issues">只看问题</option>
                <option value="broken">失效</option>
                <option value="limited">受限</option>
                <option value="ok">正常</option>
                <option value="all">全部</option>
              </select>
              <button
                type="button"
                className="primary-button"
                onClick={runLinkCheck}
                disabled={isCheckingLinks || totalLinks === 0}
              >
                {isCheckingLinks ? '检测中' : '批量检测网址'}
              </button>
            </div>
          </div>

          {isCheckingLinks ? (
            <span className="check-progress">
              正在检测 {linkCheckProgress.done} / {linkCheckProgress.total}
            </span>
          ) : null}

          {visibleLinkCheckResults.length > 0 ? (
            <div className="check-results">
              <section className="check-result-section">
                <h3>检测结果</h3>
                {filteredLinkCheckResults.length > 0 ? (
                  <div className="check-result-list">
                    {filteredLinkCheckResults.map((item) => renderCheckResult(item))}
                  </div>
                ) : (
                  <span className="check-empty">当前筛选没有需要处理的链接。</span>
                )}
              </section>
            </div>
          ) : null}
        </section>
      ) : null}

      <section className="dashboard-layout">
        <aside className="group-sidebar" aria-label="分组">
          <div className="sidebar-label">分组</div>
          <div className="group-tabs">
            {dashboard.groups.map((group) => (
              <div
                className={`group-tab is-color-${group.color ?? 'slate'} ${
                  group.id === activeGroup?.id ? 'is-active' : ''
                }`}
                key={group.id}
              >
                <button
                  type="button"
                  className="group-tab-main"
                  onClick={() => setActiveGroupId(group.id)}
                >
                  <span className="group-tab-name">{group.name}</span>
                  <span className="group-tab-count">{group.links.length}</span>
                </button>
                <div className="quick-actions">
                  <button
                    type="button"
                    className="quick-icon-button"
                    onClick={() => startGroupQuickEdit(group.id)}
                    aria-label={`编辑分组 ${group.name}`}
                    title="编辑分组"
                  >
                    ✎
                  </button>
                  <button
                    type="button"
                    className="quick-icon-button danger"
                    onClick={() => deleteGroupDirect(group.id)}
                    aria-label={`删除分组 ${group.name}`}
                    title="删除分组"
                  >
                    ×
                  </button>
                </div>
              </div>
            ))}
          </div>
        </aside>

        {activeGroup ? (
          <section
            className={`group-section active-group-panel is-color-${
              activeGroup.color ?? 'slate'
            }`}
          >
            <div className="group-header">
              <div className="group-title-area">
                {isEditing ? (
                  <label className="field-label compact-label">
                    分组名称
                    <input
                      className="group-input"
                      value={activeGroup.name}
                      onChange={(event) =>
                        updateGroupName(activeGroup.id, event.target.value)
                      }
                      aria-label="分组名称"
                    />
                  </label>
                ) : (
                  <>
                    <h2>{isGlobalSearch ? '全部搜索结果' : activeGroup.name}</h2>
                    <span className="group-meta">
                      {isGlobalSearch
                        ? `${visibleLinkItems.length} 个匹配网站`
                        : `${activeGroup.links.length} 个网站`}
                    </span>
                  </>
                )}
              </div>

              {isEditing ? (
                <div className="row-actions">
                  <button
                    type="button"
                    className="icon-button"
                    onClick={() => moveGroup(activeGroupIndex, -1)}
                    disabled={activeGroupIndex <= 0}
                    aria-label="上移分组"
                    title="上移分组"
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    className="icon-button"
                    onClick={() => moveGroup(activeGroupIndex, 1)}
                    disabled={activeGroupIndex === dashboard.groups.length - 1}
                    aria-label="下移分组"
                    title="下移分组"
                  >
                    ↓
                  </button>
                  <button
                    type="button"
                    className="icon-button danger"
                    onClick={() => deleteGroup(activeGroup.id)}
                    aria-label="删除分组"
                    title="删除分组"
                  >
                    ×
                  </button>
                </div>
              ) : null}
            </div>

            {isEditing && duplicateLinks.length > 0 ? (
              <section className="notice-panel compact-notice duplicate-panel">
                <div>
                  <strong>发现 {duplicateLinks.length} 组重复网址</strong>
                  <span>重复卡片已高亮，先定位确认，再手动删除或批量整理。</span>
                </div>
                <div className="duplicate-list">
                  {duplicateLinks.map((duplicate) => (
                    <article className="duplicate-card" key={duplicate.url}>
                      <div className="duplicate-url">{duplicate.url}</div>
                      {duplicate.occurrences.map((item) => (
                        <div className="duplicate-occurrence" key={item.link.id}>
                          <span>
                            {item.groupName} / {item.link.title}
                          </span>
                          <button
                            type="button"
                            className="ghost-button"
                            onClick={() => locateLink(item.groupId, item.link.id)}
                          >
                            定位
                          </button>
                        </div>
                      ))}
                      <div className="row-actions">
                        <button
                          type="button"
                          className="ghost-button danger"
                          onClick={() =>
                            updateDashboardWithUndo('整理重复网址', (current) =>
                              removeDuplicateLinksByUrl(current, duplicate.url),
                            )
                          }
                        >
                          保留第一个，删除其它
                        </button>
                      </div>
                    </article>
                  ))}
                </div>
              </section>
            ) : null}

            <div className="link-grid">
              {visibleLinkItems.map(({ groupId, groupName, groupColor, link, linkIndex }) =>
                isEditing ? (
                  <article
                    id={`link-editor-${link.id}`}
                    className={`link-editor ${
                      duplicateLinkIds.has(link.id) ? 'is-duplicate' : ''
                    } ${highlightedLinkId === link.id ? 'is-located' : ''}`}
                    key={link.id}
                  >
                    {duplicateLinkIds.has(link.id) ? (
                      <span className="editor-badge">重复</span>
                    ) : null}
                    <div className="editor-line">
                      <label className="select-link">
                        <input
                          type="checkbox"
                          checked={selectedLinkIds.has(link.id)}
                          onChange={() => toggleLinkSelection(link.id)}
                          aria-label={`选择 ${link.title}`}
                        />
                        选择
                      </label>
                      <label className="field-label">
                        网站名称
                        <input
                          value={link.title}
                          onChange={(event) =>
                            updateLink(groupId, link.id, {
                              title: event.target.value,
                            })
                          }
                          placeholder="例如：GitHub"
                          aria-label="网站名称"
                        />
                      </label>
                      <div className="row-actions">
                        <button
                          type="button"
                          className="icon-button"
                          onClick={() => moveLink(groupId, linkIndex, -1)}
                          disabled={linkIndex === 0}
                          aria-label="上移网站"
                          title="上移网站"
                        >
                          ↑
                        </button>
                        <button
                          type="button"
                          className="icon-button"
                          onClick={() => moveLink(groupId, linkIndex, 1)}
                          disabled={linkIndex === activeGroup.links.length - 1}
                          aria-label="下移网站"
                          title="下移网站"
                        >
                          ↓
                        </button>
                        <button
                          type="button"
                          className="icon-button danger"
                          onClick={() => deleteLink(groupId, link.id)}
                          aria-label="删除网站"
                          title="删除网站"
                        >
                          ×
                        </button>
                      </div>
                    </div>
                    <label className="field-label">
                      网站地址
                      <input
                        value={link.url}
                        onChange={(event) =>
                          updateLink(groupId, link.id, {
                            url: event.target.value,
                          })
                        }
                        placeholder="例如：https://github.com"
                        aria-label="网站地址"
                      />
                    </label>
                    <label className="field-label">
                      图标地址
                      <input
                        value={link.icon || ''}
                        onChange={(event) =>
                          updateLink(groupId, link.id, {
                            icon: event.target.value,
                          })
                        }
                        placeholder="可留空，默认自动获取 favicon"
                        aria-label="图标地址"
                      />
                    </label>
                    {!isSafeUrl(link.url) ? (
                      <span className="field-error">只支持 http 或 https 地址</span>
                    ) : null}
                  </article>
                ) : (
                  <article
                    className={`link-card-shell is-color-${groupColor} ${
                      canDragSortLinks ? 'is-sortable' : ''
                    } ${draggingLinkId === link.id ? 'is-dragging' : ''} ${
                      dragOverLinkId === link.id ? 'is-drag-over' : ''
                    }`}
                    draggable={canDragSortLinks}
                    key={link.id}
                    onDragStart={(event) => handleLinkDragStart(event, groupId, link.id)}
                    onDragOver={(event) => handleLinkDragOver(event, groupId, link.id)}
                    onDrop={(event) => handleLinkDrop(event, groupId, link.id)}
                    onDragEnd={resetLinkDrag}
                    onDragLeave={() => {
                      if (dragOverLinkId === link.id) {
                        setDragOverLinkId('')
                      }
                    }}
                  >
                    <a
                      className="link-card"
                      href={normalizeUrl(link.url)}
                      target="_blank"
                      rel="noreferrer noopener"
                      draggable={false}
                      onClick={(event) => handleLinkCardClick(event, groupId, link.id)}
                    >
                      <img
                        src={link.icon || faviconUrl(link.url)}
                        alt=""
                        draggable={false}
                        onError={(event) => {
                          event.currentTarget.style.visibility = 'hidden'
                        }}
                      />
                      <span>{link.title}</span>
                      <small>{normalizeUrl(link.url).replace(/^https?:\/\//, '')}</small>
                      <strong className="click-count">{link.clickCount ?? 0}</strong>
                      {isGlobalSearch ? (
                        <em className="link-group-name">{groupName}</em>
                      ) : null}
                    </a>
                    <div className="card-actions">
                      <button
                        type="button"
                        className="quick-icon-button"
                        onClick={() => startLinkQuickEdit(groupId, link.id)}
                        aria-label={`编辑网站 ${link.title}`}
                        title="编辑网站"
                      >
                        ✎
                      </button>
                      <button
                        type="button"
                        className="quick-icon-button danger"
                        onClick={() => deleteLinkDirect(groupId, link.id)}
                        aria-label={`删除网站 ${link.title}`}
                        title="删除网站"
                      >
                        ×
                      </button>
                    </div>
                  </article>
                ),
              )}
            </div>

            {isEditing ? (
              <button
                type="button"
                className="add-link-button"
                onClick={() => addLink(activeGroup.id)}
              >
                新增网站
              </button>
            ) : null}

            {visibleLinkItems.length === 0 ? (
              <section className="empty-panel">
                {query.trim()
                  ? isGlobalSearch
                    ? '全部分组没有匹配的网站'
                    : '当前分组没有匹配的网站'
                  : '当前分组还没有网站'}
              </section>
            ) : null}
          </section>
        ) : (
          <section className="empty-panel">还没有分组，进入编辑模式后新增分组</section>
        )}
      </section>

      {quickEdit ? (
        <div className="modal-backdrop">
          <form
            className="quick-edit-dialog"
            role="dialog"
            aria-modal="true"
            aria-label={quickEdit.kind === 'group' ? '编辑分组' : '编辑网站'}
            onSubmit={(event) => {
              event.preventDefault()
              void saveQuickEdit()
            }}
          >
            <div className="quick-edit-heading">
              <h2>{quickEdit.kind === 'group' ? '编辑分组' : '编辑网站'}</h2>
              <button
                type="button"
                className="quick-icon-button"
                onClick={() => setQuickEdit(null)}
                aria-label="关闭"
                title="关闭"
              >
                ×
              </button>
            </div>

            {quickEdit.kind === 'group' ? (
              <label className="field-label">
                分组名称
                <input
                  value={quickEdit.name}
                  onChange={(event) =>
                    setQuickEdit((current) =>
                      current?.kind === 'group'
                        ? {
                            ...current,
                            name: event.target.value,
                          }
                        : current,
                    )
                  }
                  aria-label="分组名称"
                  autoFocus
                />
              </label>
            ) : (
              <>
                <label className="field-label">
                  网站名称
                  <input
                    value={quickEdit.title}
                    onChange={(event) =>
                      setQuickEdit((current) =>
                        current?.kind === 'link'
                          ? {
                              ...current,
                              title: event.target.value,
                            }
                          : current,
                      )
                    }
                    aria-label="网站名称"
                    autoFocus
                  />
                </label>
                <label className="field-label">
                  网站地址
                  <input
                    value={quickEdit.url}
                    onChange={(event) =>
                      setQuickEdit((current) =>
                        current?.kind === 'link'
                          ? {
                              ...current,
                              url: event.target.value,
                            }
                          : current,
                      )
                    }
                    aria-label="网站地址"
                  />
                </label>
                <label className="field-label">
                  图标地址
                  <input
                    value={quickEdit.icon}
                    onChange={(event) =>
                      setQuickEdit((current) =>
                        current?.kind === 'link'
                          ? {
                              ...current,
                              icon: event.target.value,
                            }
                          : current,
                      )
                    }
                    placeholder="可留空，默认自动获取 favicon"
                    aria-label="图标地址"
                  />
                </label>
                {!isSafeUrl(quickEdit.url) ? (
                  <span className="field-error">只支持 http 或 https 地址</span>
                ) : null}
              </>
            )}

            <div className="row-actions modal-actions">
              <button type="submit" className="primary-button" disabled={isSaving}>
                {isSaving ? '保存中' : '保存'}
              </button>
              <button
                type="button"
                className="ghost-button"
                onClick={() => setQuickEdit(null)}
              >
                取消
              </button>
            </div>
          </form>
        </div>
      ) : null}
    </main>
  )
}

export default App

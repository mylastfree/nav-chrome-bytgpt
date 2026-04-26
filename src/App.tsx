import { useEffect, useMemo, useRef, useState } from 'react'
import type { KeyboardEvent } from 'react'
import {
  loadDashboard,
  loadDashboardBackups,
  saveDashboard,
  saveDashboardBackup,
  saveDashboardSnapshot,
} from './api'
import {
  clearLinkIcons,
  createEmptyGroup,
  createEmptyLink,
  deleteLinks,
  faviconUrl,
  findDuplicateLinks,
  incrementLinkClickCount,
  isSafeUrl,
  moveItem,
  moveLinksToGroup,
  normalizeUrl,
} from './dashboard'
import { parseDashboardImport } from './importers'
import type { ParsedDashboardImport } from './importers'
import type { DashboardBackup, DashboardData, LinkItem } from './types'

type SearchScope = 'group' | 'all'

type VisibleLink = {
  groupId: string
  groupName: string
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
  const [quickEdit, setQuickEdit] = useState<QuickEditDraft | null>(null)
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

  const isGlobalSearch =
    !isEditing && searchScope === 'all' && query.trim().length > 0
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

  async function saveDirectDashboard(nextDashboard: DashboardData) {
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

    void saveDirectDashboard({
      ...dashboard,
      groups: dashboard.groups.filter((group) => group.id !== groupId),
    })
  }

  function deleteLinkDirect(groupId: string, linkId: string) {
    if (!dashboard) {
      return
    }

    if (!confirm('删除这个网站？')) {
      return
    }

    void saveDirectDashboard({
      ...dashboard,
      groups: dashboard.groups.map((group) =>
        group.id === groupId
          ? {
              ...group,
              links: group.links.filter((link) => link.id !== linkId),
            }
          : group,
      ),
    })
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

    updateDashboard((current) => ({
      ...current,
      groups: current.groups.filter((group) => group.id !== groupId),
    }))
  }

  function moveGroup(groupIndex: number, direction: -1 | 1) {
    updateDashboard((current) => ({
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
    updateDashboard((current) => ({
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
    updateDashboard((current) => ({
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
      const text = await file.text()
      const imported = parseDashboardImport(file.name, text)
      setPendingImport(imported)
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

    try {
      await saveDashboardBackup(dashboard)
      await refreshBackups()
    } catch {
      // Import still remains local to the page until the user saves.
    }

    setDashboard(pendingImport.dashboard)
    setActiveGroupId(pendingImport.dashboard.groups[0]?.id ?? '')
    setSelectedLinkIds(new Set())
    setPendingImport(null)
    setStatus('已导入，点击保存后写入本地存储')
  }

  function cancelImport() {
    setPendingImport(null)
    setStatus('已取消导入')
  }

  function restoreBackup(backup: DashboardBackup | undefined) {
    if (!backup) {
      return
    }

    if (!confirm(`恢复 ${new Date(backup.createdAt).toLocaleString()} 的备份？当前未保存修改会被覆盖。`)) {
      return
    }

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

    updateDashboard((current) => moveLinksToGroup(current, selectedLinkIds, batchTargetGroupId))
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

    updateDashboard((current) => deleteLinks(current, selectedLinkIds))
    setSelectedLinkIds(new Set())
  }

  function clearSelectedIcons() {
    if (selectedLinkIds.size === 0) {
      return
    }

    updateDashboard((current) => clearLinkIcons(current, selectedLinkIds))
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

      <section className="dashboard-layout">
        <aside className="group-sidebar" aria-label="分组">
          <div className="sidebar-label">分组</div>
          <div className="group-tabs">
            {dashboard.groups.map((group) => (
              <div
                className={`group-tab ${
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
          <section className="group-section active-group-panel">
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
              <section className="notice-panel compact-notice">
                <div>
                  <strong>发现 {duplicateLinks.length} 组重复网址</strong>
                  <span>先定位确认，再手动删除或批量整理。</span>
                </div>
                <ul className="compact-list">
                  {duplicateLinks.slice(0, 5).map((duplicate) => (
                    <li key={duplicate.url}>
                      {duplicate.occurrences.map((item) => item.groupName).join(' / ')}：
                      {duplicate.occurrences[0].link.title}
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}

            <div className="link-grid">
              {visibleLinkItems.map(({ groupId, groupName, link, linkIndex }) =>
                isEditing ? (
                  <article className="link-editor" key={link.id}>
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
                  <article className="link-card-shell" key={link.id}>
                    <a
                      className="link-card"
                      href={normalizeUrl(link.url)}
                      target="_blank"
                      rel="noreferrer noopener"
                      onClick={() => recordLinkClick(groupId, link.id)}
                    >
                      <img
                        src={link.icon || faviconUrl(link.url)}
                        alt=""
                        onError={(event) => {
                          event.currentTarget.style.display = 'none'
                        }}
                      />
                      <span>{link.title}</span>
                      <small>{normalizeUrl(link.url).replace(/^https?:\/\//, '')}</small>
                      <strong className="click-count">点击 {link.clickCount ?? 0} 次</strong>
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

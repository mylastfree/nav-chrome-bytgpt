import { readFileSync } from 'node:fs'
import { describe, expect, test } from 'vitest'

const source = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8')

function functionBody(name: string, nextName: string) {
  const start = source.indexOf(`function ${name}`)
  const end = source.indexOf(`function ${nextName}`, start)

  expect(start).toBeGreaterThanOrEqual(0)
  expect(end).toBeGreaterThan(start)

  return source.slice(start, end)
}

describe('backup recovery flow', () => {
  test('saves the current dashboard before restoring a backup', () => {
    const body = functionBody('restoreBackup', 'toggleLinkSelection')

    expect(body).toContain('await saveDashboardBackup(dashboard)')
    expect(body.indexOf('await saveDashboardBackup(dashboard)')).toBeLessThan(
      body.indexOf('setDashboard(backup.dashboard)'),
    )
    expect(body).toContain('恢复前备份失败，请先导出当前数据再重试')
  })

  test('offers exporting current data before confirming an import', () => {
    expect(source).toContain('先导出当前数据')
  })
})

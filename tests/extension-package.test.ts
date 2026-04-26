import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, test } from 'vitest'

const manifest = JSON.parse(
  readFileSync(new URL('../public/manifest.json', import.meta.url), 'utf8'),
) as {
  version: string
  icons?: Record<string, string>
}
const packageJson = JSON.parse(
  readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
) as {
  version: string
}

describe('extension package metadata', () => {
  test('keeps npm and Chrome extension versions in sync', () => {
    expect(manifest.version).toBe(packageJson.version)
  })

  test('declares installable Chrome extension PNG icons', () => {
    expect(manifest.icons).toEqual({
      '16': 'icons/icon16.png',
      '32': 'icons/icon32.png',
      '48': 'icons/icon48.png',
      '128': 'icons/icon128.png',
    })

    Object.values(manifest.icons ?? {}).forEach((iconPath) => {
      expect(
        existsSync(new URL(`../public/${iconPath}`, import.meta.url)),
      ).toBe(true)
    })
  })
})

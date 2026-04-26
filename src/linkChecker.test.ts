import { afterEach, describe, expect, test, vi } from 'vitest'
import { checkLinkUrl, classifyLinkResponse, dismissLinkCheckResult } from './linkChecker'

describe('link checker', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  test('classifies successful and redirected responses as ok', () => {
    expect(classifyLinkResponse(200)).toEqual({ status: 'ok', reason: '200' })
    expect(classifyLinkResponse(302)).toEqual({ status: 'ok', reason: '302' })
  })

  test('classifies blocked responses as limited', () => {
    expect(classifyLinkResponse(403)).toEqual({ status: 'limited', reason: '受限 403' })
    expect(classifyLinkResponse(429)).toEqual({ status: 'limited', reason: '受限 429' })
  })

  test('classifies missing and server error responses as broken', () => {
    expect(classifyLinkResponse(404)).toEqual({ status: 'broken', reason: '失效 404' })
    expect(classifyLinkResponse(410)).toEqual({ status: 'broken', reason: '失效 410' })
    expect(classifyLinkResponse(500)).toEqual({ status: 'broken', reason: '异常 500' })
  })

  test('falls back to GET when HEAD is not allowed', async () => {
    const methods: string[] = []
    const fakeFetch: typeof fetch = async (_input, init) => {
      const method = init?.method?.toString() || 'GET'
      methods.push(method)

      return new Response(null, {
        status: method === 'HEAD' ? 405 : 204,
      })
    }

    await expect(
      checkLinkUrl('https://example.com', {
        fetchImpl: fakeFetch,
        timeoutMs: 1000,
      }),
    ).resolves.toEqual({ status: 'ok', reason: '204' })
    expect(methods).toEqual(['HEAD', 'GET'])
  })

  test('uses the Chrome extension background transport when available', async () => {
    const fetchSpy = vi.fn(async () => new Response(null, { status: 500 }))
    const messages: unknown[] = []

    vi.stubGlobal('fetch', fetchSpy)
    vi.stubGlobal('chrome', {
      runtime: {
        id: 'extension-id',
        sendMessage: (message: unknown, callback: (response: unknown) => void) => {
          messages.push(message)
          callback({ ok: true, status: 204 })
        },
      },
    })

    await expect(
      checkLinkUrl('https://panel.bbn.one/server/bac077ef', {
        timeoutMs: 1000,
      }),
    ).resolves.toEqual({ status: 'ok', reason: '204' })
    expect(fetchSpy).not.toHaveBeenCalled()
    expect(messages).toEqual([
      {
        type: 'nav-bygpt:check-link-status',
        url: 'https://panel.bbn.one/server/bac077ef',
        method: 'HEAD',
        timeoutMs: 1000,
      },
    ])
  })

  test('dismisses one result without changing other check results', () => {
    const results = [
      {
        linkId: 'a',
        groupId: 'daily',
        groupName: 'Daily',
        title: 'A',
        url: 'https://a.example',
        status: 'broken' as const,
        reason: '失效 404',
      },
      {
        linkId: 'b',
        groupId: 'daily',
        groupName: 'Daily',
        title: 'B',
        url: 'https://b.example',
        status: 'limited' as const,
        reason: '受限 403',
      },
    ]

    expect(dismissLinkCheckResult(results, 'a')).toEqual([results[1]])
  })
})

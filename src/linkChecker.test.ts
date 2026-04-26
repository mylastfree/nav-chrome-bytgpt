import { describe, expect, test } from 'vitest'
import { checkLinkUrl, classifyLinkResponse } from './linkChecker'

describe('link checker', () => {
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
})

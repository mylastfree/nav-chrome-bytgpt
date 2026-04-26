import { isSafeUrl, normalizeUrl } from './dashboard'
import type { DashboardData } from './types'

export type LinkCheckStatus = 'ok' | 'limited' | 'broken'

export type LinkCheckSummary = {
  status: LinkCheckStatus
  reason: string
}

export type LinkCheckResult = LinkCheckSummary & {
  linkId: string
  groupId: string
  groupName: string
  title: string
  url: string
}

type LinkCheckOptions = {
  concurrency?: number
  timeoutMs?: number
  onProgress?: (done: number, total: number) => void
  fetchImpl?: typeof fetch
}

type LinkCheckTarget = {
  linkId: string
  groupId: string
  groupName: string
  title: string
  url: string
}

type ChromeRuntime = {
  id?: string
  lastError?: {
    message?: string
  }
  sendMessage?: (message: unknown, callback: (response: unknown) => void) => void
}

type ChromeLike = {
  runtime?: ChromeRuntime
}

type LinkStatusResponse =
  | {
      ok: true
      status: number
    }
  | {
      ok: false
      error?: string
    }

const DEFAULT_CONCURRENCY = 5
const DEFAULT_TIMEOUT_MS = 8000
const CHECK_LINK_STATUS_MESSAGE = 'nav-bygpt:check-link-status'

export function classifyLinkResponse(status: number): LinkCheckSummary {
  if (status >= 200 && status < 400) {
    return { status: 'ok', reason: String(status) }
  }

  if (status === 401 || status === 403 || status === 429) {
    return { status: 'limited', reason: `受限 ${status}` }
  }

  if (status === 404 || status === 410) {
    return { status: 'broken', reason: `失效 ${status}` }
  }

  if (status >= 500) {
    return { status: 'broken', reason: `异常 ${status}` }
  }

  return { status: 'limited', reason: `异常 ${status}` }
}

export async function checkLinkUrl(
  value: string,
  options: Pick<LinkCheckOptions, 'fetchImpl' | 'timeoutMs'> = {},
): Promise<LinkCheckSummary> {
  if (!isSafeUrl(value)) {
    return { status: 'broken', reason: '地址无效' }
  }

  const url = normalizeUrl(value)
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS

  if (!hasStatusTransport(options.fetchImpl)) {
    return { status: 'broken', reason: '当前环境不支持检测' }
  }

  try {
    const status = await requestStatus(url, 'HEAD', timeoutMs, options.fetchImpl)

    if (status !== 405 && status !== 501) {
      return classifyLinkResponse(status)
    }
  } catch (error) {
    if (isAbortError(error)) {
      return { status: 'broken', reason: '超时' }
    }
  }

  try {
    const status = await requestStatus(url, 'GET', timeoutMs, options.fetchImpl)
    return classifyLinkResponse(status)
  } catch (error) {
    return { status: 'broken', reason: isAbortError(error) ? '超时' : '网络错误' }
  }
}

export async function checkDashboardLinks(
  dashboard: DashboardData,
  options: LinkCheckOptions = {},
): Promise<LinkCheckResult[]> {
  const targets = dashboard.groups.flatMap((group) =>
    group.links.map((link) => ({
      linkId: link.id,
      groupId: group.id,
      groupName: group.name,
      title: link.title,
      url: link.url,
    })),
  )
  const total = targets.length
  const results = new Array<LinkCheckResult>(total)
  const concurrency = Math.max(1, Math.floor(options.concurrency ?? DEFAULT_CONCURRENCY))
  let nextIndex = 0
  let done = 0

  async function worker() {
    while (nextIndex < total) {
      const index = nextIndex
      nextIndex += 1
      const target = targets[index]
      const summary = await checkLinkUrl(target.url, {
        fetchImpl: options.fetchImpl,
        timeoutMs: options.timeoutMs,
      })

      results[index] = toResult(target, summary)
      done += 1
      options.onProgress?.(done, total)
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, total) }, () => worker()),
  )

  return results
}

export function dismissLinkCheckResult(
  results: LinkCheckResult[],
  linkId: string,
): LinkCheckResult[] {
  return results.filter((item) => item.linkId !== linkId)
}

function toResult(target: LinkCheckTarget, summary: LinkCheckSummary): LinkCheckResult {
  return {
    ...target,
    ...summary,
  }
}

function hasStatusTransport(fetchImpl?: typeof fetch) {
  return Boolean(fetchImpl || getExtensionRuntime() || globalThis.fetch)
}

async function requestStatus(
  url: string,
  method: 'HEAD' | 'GET',
  timeoutMs: number,
  fetchImpl?: typeof fetch,
) {
  const runtime = getExtensionRuntime()

  if (!fetchImpl && runtime) {
    return requestStatusFromBackground(runtime, url, method, timeoutMs)
  }

  const actualFetch = fetchImpl ?? globalThis.fetch
  if (typeof actualFetch !== 'function') {
    throw new Error('No link checker transport available')
  }

  return fetchStatus(actualFetch, url, method, timeoutMs)
}

function getExtensionRuntime() {
  const chromeLike = (globalThis as typeof globalThis & { chrome?: ChromeLike }).chrome
  const runtime = chromeLike?.runtime

  return runtime?.id && typeof runtime.sendMessage === 'function' ? runtime : null
}

function requestStatusFromBackground(
  runtime: ChromeRuntime,
  url: string,
  method: 'HEAD' | 'GET',
  timeoutMs: number,
) {
  return new Promise<number>((resolve, reject) => {
    const timeout = globalThis.setTimeout(() => {
      reject(createAbortError())
    }, timeoutMs + 1000)

    runtime.sendMessage?.(
      {
        type: CHECK_LINK_STATUS_MESSAGE,
        url,
        method,
        timeoutMs,
      },
      (response) => {
        globalThis.clearTimeout(timeout)

        const error = runtime.lastError?.message
        if (error) {
          reject(new Error(error))
          return
        }

        if (isLinkStatusResponse(response) && response.ok) {
          resolve(response.status)
          return
        }

        if (isLinkStatusResponse(response) && !response.ok) {
          reject(new Error(response.error || 'Link check failed'))
          return
        }

        reject(new Error('Link check failed'))
      },
    )
  })
}

async function fetchStatus(
  fetchImpl: typeof fetch,
  url: string,
  method: 'HEAD' | 'GET',
  timeoutMs: number,
) {
  const controller = new AbortController()
  const timeout = globalThis.setTimeout(() => controller.abort(), timeoutMs)

  try {
    const response = await fetchImpl(url, {
      method,
      redirect: 'follow',
      signal: controller.signal,
      cache: 'no-store',
    })

    return response.status
  } finally {
    globalThis.clearTimeout(timeout)
  }
}

function isLinkStatusResponse(value: unknown): value is LinkStatusResponse {
  if (!value || typeof value !== 'object') {
    return false
  }

  const response = value as Partial<LinkStatusResponse>
  return response.ok === true
    ? typeof response.status === 'number'
    : response.ok === false
}

function isAbortError(error: unknown) {
  return error instanceof Error && error.name === 'AbortError'
}

function createAbortError() {
  try {
    return new DOMException('The operation was aborted.', 'AbortError')
  } catch {
    const error = new Error('The operation was aborted.')
    error.name = 'AbortError'
    return error
  }
}

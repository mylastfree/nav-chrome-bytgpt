const CHECK_LINK_STATUS_MESSAGE = 'nav-bygpt:check-link-status'
const DEFAULT_TIMEOUT_MS = 8000

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!isCheckLinkStatusMessage(message)) {
    return false
  }

  const controller = new AbortController()
  const timeoutMs = normalizeTimeout(message.timeoutMs)
  const timeout = setTimeout(() => controller.abort(), timeoutMs)

  fetch(message.url, {
    method: message.method,
    redirect: 'follow',
    signal: controller.signal,
    cache: 'no-store',
  })
    .then((response) => {
      sendResponse({
        ok: true,
        status: response.status,
      })
    })
    .catch((error) => {
      sendResponse({
        ok: false,
        error: error instanceof Error ? error.name : 'NetworkError',
      })
    })
    .finally(() => {
      clearTimeout(timeout)
    })

  return true
})

function isCheckLinkStatusMessage(message) {
  return Boolean(
    message &&
      message.type === CHECK_LINK_STATUS_MESSAGE &&
      (message.method === 'HEAD' || message.method === 'GET') &&
      isHttpUrl(message.url),
  )
}

function isHttpUrl(value) {
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}

function normalizeTimeout(value) {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? Math.floor(value)
    : DEFAULT_TIMEOUT_MS
}

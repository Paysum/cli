const VERSION = '1.0.0'

export class ApiError extends Error {
  constructor(status, code, message) {
    super(message)
    this.status = status
    this.code = code
  }
}

export function createClient({ key, api }) {
  const base = `${api.replace(/\/$/, '')}/api/store-api`

  async function request(method, path, body) {
    let response
    try {
      response = await fetch(`${base}${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${key}`,
          'User-Agent': `paysum-cli/${VERSION} node/${process.versions.node}`,
          ...(body ? { 'Content-Type': 'application/json' } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(90_000),
      })
    } catch (error) {
      const reason = error?.cause?.code || error?.name || 'network error'
      throw new ApiError(0, 'network_error', `Could not reach ${api} (${reason})`)
    }
    const text = await response.text()
    let data = null
    try {
      data = text ? JSON.parse(text) : null
    } catch {
    }
    if (!response.ok) {
      throw new ApiError(
        response.status,
        data?.error || 'http_error',
        data?.message || `Request failed with status ${response.status}`,
      )
    }
    return data
  }

  return {
    store: () => request('GET', '/store'),
    files: (content = true) => request('GET', `/theme/files${content ? '' : '?content=false'}`),
    writeFiles: (files, deleted = []) => request('PUT', '/theme/files', { files, deleted }),
    preview: () => request('POST', '/theme/preview'),
    publish: () => request('POST', '/theme/publish'),
    portTheme: (archive, includeArchive = false) =>
      request('POST', '/theme/port', { archive_base64: archive, include_archive: includeArchive }),
    versions: () => request('GET', '/theme/versions'),
  }
}

export { VERSION }

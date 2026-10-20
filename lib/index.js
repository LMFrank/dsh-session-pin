/**
 * dsh-session-pin — host half.
 *
 * Owns the durable pinned-session registry (`<DSH_HOME>/dsh-session-pin.json`)
 * and the `/dsh-session-pin` JSON routes the browser half drives. Pinning is a
 * pure presentation fact (which sessions the operator wants grouped at the top
 * of the sidebar), so nothing here touches session logs: a pinned id that later
 * disappears from the live list is kept in the file and simply skipped by the
 * client, which means re-creating/renaming sessions never corrupts the set.
 *
 * Export shape follows the dsh-host plugin convention: a function plugin with
 * `name` / `inject` / `apply` and NO default export.
 *
 * @module dsh-session-pin
 */
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

/** Cordis plugin name. */
export const name = 'dsh-session-pin'

/**
 * Required host services. `webServer` is optional in practice (headless
 * profiles have no browser), so it is injected through `ctx.inject` in `apply`
 * rather than declared here.
 */
export const inject = []

/** Registry file name under DSH_HOME. */
export const STATE_FILE = 'dsh-session-pin.json'

/** Route prefix serving the browser half. */
export const ROUTE_PREFIX = '/dsh-session-pin'

/** On-disk shape. */
const SCHEMA_VERSION = 1

/**
 * Resolve `<DSH_HOME>/<name>`.
 * @param segments - path segments appended to the DSH home directory.
 * @returns absolute path.
 */
function dshHomePath(...segments) {
  const home = process.env.DSH_HOME && process.env.DSH_HOME.length > 0
    ? process.env.DSH_HOME
    : join(homedir(), '.dsh')
  return join(home, ...segments)
}

/**
 * Validate and normalize one persisted file body.
 * @param body - parsed JSON of unknown shape.
 * @returns the ordered pinned ids, or an empty list when the body is invalid.
 */
function parseState(body) {
  if (body === null || typeof body !== 'object') return []
  if (body.schemaVersion !== SCHEMA_VERSION) return []
  if (!Array.isArray(body.pinned)) return []
  const seen = new Set()
  const pinned = []
  for (const entry of body.pinned) {
    if (typeof entry !== 'string' || entry.length === 0 || seen.has(entry)) continue
    seen.add(entry)
    pinned.push(entry)
  }
  return pinned
}

/** Ordered pinned session ids with crash-safe persistence. */
class PinStore {
  /** @type {string} */
  #file
  /** @type {string[]} */
  #pinned = []

  /** @param {string} file - absolute registry path. */
  constructor(file) {
    this.#file = file
    this.#load()
  }

  /** Read the registry, tolerating a missing or corrupt file (empty set). */
  #load() {
    try {
      this.#pinned = parseState(JSON.parse(readFileSync(this.#file, 'utf8')))
    } catch {
      // Missing file = first run; corrupt file = start empty. Neither is fatal:
      // the pinned set is a convenience, never a source of truth.
      this.#pinned = []
    }
  }

  /** Write the registry through a temp file plus rename. */
  #persist() {
    const temp = `${this.#file}.tmp-${process.pid}`
    mkdirSync(dirname(this.#file), { recursive: true })
    writeFileSync(temp, `${JSON.stringify({ schemaVersion: SCHEMA_VERSION, pinned: this.#pinned }, null, 2)}\n`, 'utf8')
    renameSync(temp, this.#file)
  }

  /** @returns {readonly string[]} the ordered pinned ids. */
  list() {
    return this.#pinned
  }

  /**
   * Pin one session at the head (or before an anchor).
   * @param {string} sessionId - session to pin; re-pinning moves it.
   * @param {string} [beforeId] - existing pinned id to insert before.
   * @returns {readonly string[]} the new ordered set.
   */
  pin(sessionId, beforeId) {
    const rest = this.#pinned.filter((id) => id !== sessionId)
    const index = beforeId === undefined ? 0 : rest.indexOf(beforeId)
    if (index < 0) rest.unshift(sessionId)
    else rest.splice(index, 0, sessionId)
    this.#pinned = rest
    this.#persist()
    return this.#pinned
  }

  /**
   * Unpin one session.
   * @param {string} sessionId - session to unpin (missing ids are a no-op).
   * @returns {readonly string[]} the new ordered set.
   */
  unpin(sessionId) {
    const next = this.#pinned.filter((id) => id !== sessionId)
    if (next.length !== this.#pinned.length) {
      this.#pinned = next
      this.#persist()
    }
    return this.#pinned
  }

  /**
   * Replace the whole ordering (drag/move support).
   * @param {readonly string[]} order - ids that are currently pinned, in order.
   * @returns {readonly string[]} the normalized set.
   */
  reorder(order) {
    const current = new Set(this.#pinned)
    const next = []
    const seen = new Set()
    for (const id of order) {
      if (typeof id !== 'string' || !current.has(id) || seen.has(id)) continue
      seen.add(id)
      next.push(id)
    }
    // Ids the caller omitted keep their previous relative order at the tail.
    for (const id of this.#pinned) if (!seen.has(id)) next.push(id)
    this.#pinned = next
    this.#persist()
    return this.#pinned
  }
}

/**
 * Read a JSON request body.
 * @param {import('node:http').IncomingMessage} req - the request.
 * @returns {Promise<unknown>} the parsed body, or undefined.
 */
async function readJson(req) {
  const chunks = []
  for await (const chunk of req) chunks.push(chunk)
  if (chunks.length === 0) return undefined
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'))
  } catch {
    return undefined
  }
}

/**
 * Write one JSON response.
 * @param {import('node:http').ServerResponse} res - the response.
 * @param {number} status - HTTP status.
 * @param {unknown} body - JSON body.
 */
function sendJson(res, status, body) {
  const payload = JSON.stringify(body)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'content-length': Buffer.byteLength(payload),
  })
  res.end(payload)
}

/**
 * Mount the host half.
 * @param {import('@deepseek-ai/cordis').Context} ctx - host context.
 */
export function apply(ctx) {
  const store = new PinStore(dshHomePath(STATE_FILE))
  const ok = (value) => ({ ok: true, value })

  ctx.inject(['webServer'], (webCtx) => {
    /**
     * @param {import('node:http').IncomingMessage} req
     * @param {import('node:http').ServerResponse} res
     */
    const handler = async (req, res) => {
      const url = new URL(req.url ?? '/', 'http://localhost')
      const path = url.pathname
      try {
        if (path === ROUTE_PREFIX || path === `${ROUTE_PREFIX}/`) {
          sendJson(res, 200, ok({ pinned: store.list() }))
          return
        }
        if (path === `${ROUTE_PREFIX}/state`) {
          sendJson(res, 200, ok({ pinned: store.list() }))
          return
        }
        if (path === `${ROUTE_PREFIX}/pin` && req.method === 'POST') {
          const body = await readJson(req)
          const sessionId = typeof body?.sessionId === 'string' ? body.sessionId : ''
          if (sessionId.length === 0) {
            sendJson(res, 400, { ok: false, error: { code: 'invalid-request', message: 'sessionId is required' } })
            return
          }
          const beforeId = typeof body?.beforeId === 'string' && body.beforeId.length > 0 ? body.beforeId : undefined
          sendJson(res, 200, ok({ pinned: store.pin(sessionId, beforeId) }))
          return
        }
        if (path === `${ROUTE_PREFIX}/unpin` && req.method === 'POST') {
          const body = await readJson(req)
          const sessionId = typeof body?.sessionId === 'string' ? body.sessionId : ''
          if (sessionId.length === 0) {
            sendJson(res, 400, { ok: false, error: { code: 'invalid-request', message: 'sessionId is required' } })
            return
          }
          sendJson(res, 200, ok({ pinned: store.unpin(sessionId) }))
          return
        }
        if (path === `${ROUTE_PREFIX}/reorder` && req.method === 'POST') {
          const body = await readJson(req)
          if (!Array.isArray(body?.order)) {
            sendJson(res, 400, { ok: false, error: { code: 'invalid-request', message: 'order must be an array of session ids' } })
            return
          }
          sendJson(res, 200, ok({ pinned: store.reorder(body.order) }))
          return
        }
        sendJson(res, 404, { ok: false, error: { code: 'not-found', message: `no route ${req.method ?? 'GET'} ${path}` } })
      } catch (error) {
        sendJson(res, 500, { ok: false, error: { code: 'internal', message: String(error?.message ?? error) } })
      }
    }
    webCtx.effect(
      () => webCtx.webServer.register({ kind: 'prefix', path: ROUTE_PREFIX, handler }),
      'dsh-session-pin: routes',
    )
  })
}

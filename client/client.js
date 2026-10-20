/**
 * dsh-session-pin — browser half.
 *
 * Adds a Codex-style "pinned" group directly above the sidebar's workspace
 * browser — between the global panel rows and the workspace header. The shell
 * declares no slot there, so the section is a plain-DOM child of the sidebar
 * root: insertion is anchor-based (immediately before the region area) and
 * self-heals on React re-renders, the same approach other sidebar plugins use.
 *
 * Division of labour:
 * - the host half owns the durable pinned set (`/dsh-session-pin/*`), so the
 *   group survives restarts and profile reloads;
 * - the runtime `sessions` service owns row metadata (title / updatedAt), so
 *   the group never caches titles;
 * - the runtime `uiWorkspace` service owns navigation (`openSession`).
 *
 * Pinning is offered from the session row context menu (right click), which
 * keeps the untouched native row menu intact; unpinning is available on each
 * pinned row, in the same menu, and in the pinned header.
 *
 * Failure policy: mounting problems are logged, never thrown — the web shell
 * fails the whole boot when a plugin apply throws.
 *
 * @module dsh-session-pin/client
 */
window.__ModuleLoader__.load({
  id: 'dsh-session-pin',
  factory: () => {
    var module = { exports: {} }
    var exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })

    /** Host route prefix (kept in sync with lib/index.js). */
    const ROUTE = '/dsh-session-pin'
    /** Collapse state key; purely local presentation, so localStorage is enough. */
    const COLLAPSED_KEY = 'dsh-session-pin:collapsed'
    /** Section marker attribute. */
    const SECTION_ATTR = 'data-dsh-session-pin'
    /** Row marker used for the pin context menu. */
    const ROW_ATTR = 'data-dsh-session-pin-row'

    const zh = () => (document.documentElement.lang || navigator.language || '').toLowerCase().startsWith('zh')
    const t = (key) => {
      const table = {
        pinned: ['置顶', 'Pinned'],
        pin: ['置顶会话', 'Pin session'],
        unpin: ['取消置顶', 'Unpin session'],
        empty: ['右键会话可置顶', 'Right-click a session to pin'],
        unpinTitle: ['取消置顶', 'Unpin'],
        countTitle: ['置顶会话数', 'Pinned sessions'],
        collapse: ['收起置顶区', 'Collapse pinned section'],
        expand: ['展开置顶区', 'Expand pinned section'],
      }
      const entry = table[key]
      if (entry === undefined) return key
      return zh() ? entry[0] : entry[1]
    }

    /** Sidebar shell class the collapse state lives on. */
    const COLLAPSED_CLASS = 'collapsed'
    /** Anchor classes inside the shell (CSS-module hashed: match by substring). */
    const REGION_SELECTOR = '[class*="regionArea"]'
    const LOGO_SELECTOR = '[class*="logoRow"]'
    const SESSION_ROW_SELECTOR = '[role="treeitem"][class*="sessionRow"]'

    /** Relative time label matching the native rows (minutes / hours / days). */
    function timeLabel(updatedAt) {
      if (typeof updatedAt !== 'number' || !Number.isFinite(updatedAt)) return ''
      const delta = Date.now() - updatedAt
      if (delta < 60_000) return zh() ? '刚刚' : 'just now'
      const minutes = Math.floor(delta / 60_000)
      if (minutes < 60) return zh() ? `${minutes} 分钟` : `${minutes}m`
      const hours = Math.floor(minutes / 60)
      if (hours < 24) return zh() ? `${hours} 小时` : `${hours}h`
      const days = Math.floor(hours / 24)
      return zh() ? `${days} 天` : `${days}d`
    }

    /** Inject the stylesheet once (idempotent across HMR reloads). */
    function injectStyles() {
      const id = 'dsh-session-pin/styles'
      if (document.querySelector(`style[data-plugin-css="${id}"]`) !== null) return
      const style = document.createElement('style')
      style.dataset.plugin = 'dsh-session-pin'
      style.dataset.pluginCss = id
      style.textContent = `
.dsh-spin{box-sizing:border-box;flex:none;display:flex;flex-direction:column;gap:2px;padding:0 2px;margin-bottom:6px;font-size:14px;color:var(--dsw-alias-label-primary)}
.dsh-spin[data-collapsed="true"] .dsh-spin-list{display:none}
.dsh-spin-header{box-sizing:border-box;display:flex;align-items:center;gap:6px;height:28px;padding:0 6px;border-radius:8px;background:0 0;border:none;color:var(--dsw-alias-label-secondary);font:inherit;font-size:12px;line-height:20px;cursor:pointer;text-align:left;width:100%}
.dsh-spin-header:hover{background:var(--dsw-alias-interactive-bg-hover)}
.dsh-spin-chevron{display:inline-flex;align-items:center;justify-content:center;width:12px;height:12px;flex:none;transition:transform .15s var(--ds-ease-in-out);color:var(--dsw-alias-label-caption)}
.dsh-spin[data-collapsed="true"] .dsh-spin-chevron{transform:rotate(-90deg)}
.dsh-spin-heading{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;letter-spacing:.02em}
.dsh-spin-count{flex:none;color:var(--dsw-alias-label-tertiary);font-size:11px;font-variant-numeric:tabular-nums}
.dsh-spin-list{display:flex;flex-direction:column;gap:0}
.dsh-spin-row{box-sizing:border-box;display:flex;align-items:center;gap:6px;height:32px;padding:0 8px 0 14px;border-radius:8px;cursor:pointer;color:var(--dsw-alias-label-primary);user-select:none}
.dsh-spin-row:hover,.dsh-spin-row.dsh-spin-selected{background:var(--dsw-alias-interactive-bg-hover)}
.dsh-spin-title{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:14px;line-height:20px}
.dsh-spin-time{flex:none;font-size:12px;line-height:20px;color:var(--dsw-alias-label-tertiary)}
.dsh-spin-row:hover .dsh-spin-time{display:none}
.dsh-spin-unpin{flex:none;display:none;align-items:center;justify-content:center;width:20px;height:20px;padding:0;border:none;border-radius:4px;background:0 0;color:var(--dsw-alias-label-tertiary);cursor:pointer;font-size:13px;line-height:1}
.dsh-spin-row:hover .dsh-spin-unpin{display:inline-flex}
.dsh-spin-unpin:hover{color:var(--dsw-alias-label-primary);background:var(--dsw-alias-interactive-bg-active)}
.dsh-spin-empty{padding:2px 14px 6px;font-size:12px;line-height:16px;color:var(--dsw-alias-label-tertiary)}
.dsh-spin-menu{position:fixed;z-index:2147483000;min-width:150px;padding:4px;border-radius:10px;border:.5px solid var(--dsw-alias-border-l3);background:var(--dsw-alias-button-elevated-fill);box-shadow:0 8px 24px rgba(0,0,0,.18);display:flex;flex-direction:column;gap:2px}
.dsh-spin-menu-item{display:flex;align-items:center;gap:8px;height:30px;padding:0 8px;border:none;border-radius:6px;background:0 0;color:var(--dsw-alias-label-primary);font:inherit;font-size:13px;text-align:left;cursor:pointer}
.dsh-spin-menu-item:hover{background:var(--dsw-alias-interactive-bg-hover)}
`
      document.head.appendChild(style)
    }

    /**
     * Resolve one session id off a rendered sidebar row.
     *
     * The row carries no id in the DOM, so the value comes from the React fiber
     * that rendered it: the anchor div's fiber chain reaches `SessionNodeItem`,
     * whose props hold the session node. Every step is guarded — a shell change
     * makes the context menu inert instead of throwing.
     * @param {HTMLElement} row - a `[role="treeitem"]` session row.
     * @returns {string | undefined} the session id.
     */
    function sessionIdOf(row) {
      const direct = row.getAttribute('data-session-id')
      if (typeof direct === 'string' && direct.length > 0) return direct
      const fiberKey = Object.keys(row).find((key) => key.startsWith('__reactFiber$') || key.startsWith('__reactInternalInstance$'))
      if (fiberKey === undefined) return undefined
      let fiber = row[fiberKey]
      for (let depth = 0; fiber !== null && fiber !== undefined && depth < 24; depth++) {
        const props = fiber.memoizedProps
        if (props !== null && typeof props === 'object') {
          const node = props.node
          if (node !== null && typeof node === 'object' && typeof node.id === 'string' && node.id.length > 0) return node.id
          if (typeof props.sessionId === 'string' && props.sessionId.length > 0) return props.sessionId
        }
        fiber = fiber.return
      }
      return undefined
    }

    /** Same-origin JSON client for the host routes; failures resolve to null. */
    async function call(path, body) {
      try {
        const res = await fetch(`${ROUTE}${path}`, body === undefined
          ? { signal: undefined }
          : {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify(body),
            })
        const text = await res.text()
        if (text.trim().length === 0) return null
        const parsed = JSON.parse(text)
        if (parsed === null || typeof parsed !== 'object' || parsed.ok !== true) return null
        return parsed.value
      } catch (error) {
        console.warn('dsh-session-pin: request failed', path, error)
        return null
      }
    }

    /** Client plugin name. */
    exports.name = 'dsh-session-pin/client'
    /** Session data is read lazily; no hard service dependency (see apply). */
    exports.inject = []

    /**
     * Mount the pinned section.
     * @param {object} ctx - the cordis client context.
     */
    exports.apply = function apply(ctx) {
      try {
        injectStyles()
      } catch (error) {
        console.warn('dsh-session-pin: styles failed', error)
      }

      /** Current pinned ids in display order. */
      let pinned = []
      /** Collapse state (local presentation only). */
      let collapsed = false
      try {
        collapsed = window.localStorage.getItem(COLLAPSED_KEY) === '1'
      } catch {
        collapsed = false
      }

      /** The live section element (rebuilt on every render tick). */
      const section = document.createElement('div')
      section.className = 'dsh-spin'
      section.setAttribute(SECTION_ATTR, '')
      section.dataset.collapsed = collapsed ? 'true' : 'false'

      /** Currently open context menu, if any. */
      let menu = null

      /** Read the runtime session list snapshot (lazily; services may mount late). */
      const sessionsService = () => {
        try {
          return ctx.get?.('sessions')
        } catch {
          return undefined
        }
      }

      /** Read the runtime navigation owner (0.1.6+). */
      const workspaceService = () => {
        try {
          return ctx.get?.('uiWorkspace')
        } catch {
          return undefined
        }
      }

      /** Open one session through whichever navigation entry this runtime ships. */
      const openSession = (sessionId) => {
        const ui = workspaceService()
        if (ui !== undefined && typeof ui.openSession === 'function') {
          ui.openSession(sessionId)
          return
        }
        const sessions = sessionsService()
        if (sessions !== undefined && typeof sessions.open === 'function') sessions.open(sessionId)
      }

      /**
       * Resolve pinned ids to live rows, dropping ids the list no longer knows
       * (deleted sessions stay in the durable file on purpose).
       * @returns {Array<{ id: string, title: string, updatedAt: number, blank: boolean }>}
       */
      const resolveRows = () => {
        const sessions = sessionsService()
        if (sessions === undefined) return []
        let snapshot
        try {
          snapshot = sessions.list.getSnapshot()
        } catch {
          return []
        }
        const byId = snapshot?.byId ?? {}
        const current = snapshot?.current
        const rows = []
        for (const id of pinned) {
          const summary = byId[id]
          if (summary === undefined) continue
          rows.push({
            id,
            title: typeof summary.displayTitle === 'string' && summary.displayTitle.length > 0
              ? summary.displayTitle
              : (typeof summary.title === 'string' && summary.title.length > 0 ? summary.title : id),
            updatedAt: summary.updatedAt,
            blank: summary.blank === true,
            selected: current === id,
          })
        }
        return rows
      }

      /** Close the context menu, if open. */
      const closeMenu = () => {
        if (menu === null) return
        menu.remove()
        menu = null
        window.removeEventListener('pointerdown', onMenuPointerDown, true)
        window.removeEventListener('keydown', onMenuKeyDown, true)
      }

      /** @param {PointerEvent} event */
      function onMenuPointerDown(event) {
        if (menu !== null && !menu.contains(/** @type {Node} */ (event.target))) closeMenu()
      }

      /** @param {KeyboardEvent} event */
      function onMenuKeyDown(event) {
        if (event.key === 'Escape') closeMenu()
      }

      /** Apply a host-returned ordering locally and re-render. */
      const adopt = (value) => {
        if (value === null || !Array.isArray(value.pinned)) return
        pinned = value.pinned
        render()
      }

      /** Pin one session at the top of the group. */
      const pin = async (sessionId) => {
        const next = pinned.filter((id) => id !== sessionId)
        next.unshift(sessionId)
        pinned = next
        render()
        adopt(await call('/pin', { sessionId }))
      }

      /** Remove one session from the group. */
      const unpin = async (sessionId) => {
        pinned = pinned.filter((id) => id !== sessionId)
        render()
        adopt(await call('/unpin', { sessionId }))
      }

      /**
       * Show the pin/unpin menu at a point for one session.
       * @param {number} x - viewport x.
       * @param {number} y - viewport y.
       * @param {string} sessionId - target session.
       */
      const showMenu = (x, y, sessionId) => {
        closeMenu()
        const isPinned = pinned.includes(sessionId)
        const panel = document.createElement('div')
        panel.className = 'dsh-spin-menu'
        const item = document.createElement('button')
        item.type = 'button'
        item.className = 'dsh-spin-menu-item'
        item.textContent = isPinned ? t('unpin') : t('pin')
        item.addEventListener('click', () => {
          closeMenu()
          if (isPinned) void unpin(sessionId)
          else void pin(sessionId)
        })
        panel.appendChild(item)
        document.body.appendChild(panel)
        const rect = panel.getBoundingClientRect()
        panel.style.left = `${Math.min(x, window.innerWidth - rect.width - 8)}px`
        panel.style.top = `${Math.min(y, window.innerHeight - rect.height - 8)}px`
        menu = panel
        window.addEventListener('pointerdown', onMenuPointerDown, true)
        window.addEventListener('keydown', onMenuKeyDown, true)
      }

      /** Build the section content from the current state. */
      const render = () => {
        const rows = resolveRows()
        const header = document.createElement('button')
        header.type = 'button'
        header.className = 'dsh-spin-header'
        header.title = collapsed ? t('expand') : t('collapse')
        header.addEventListener('click', () => {
          collapsed = !collapsed
          section.dataset.collapsed = collapsed ? 'true' : 'false'
          try {
            window.localStorage.setItem(COLLAPSED_KEY, collapsed ? '1' : '0')
          } catch {
            // Private mode / storage disabled: collapse just does not persist.
          }
          render()
        })
        const chevron = document.createElement('span')
        chevron.className = 'dsh-spin-chevron'
        chevron.textContent = '▾'
        const heading = document.createElement('span')
        heading.className = 'dsh-spin-heading'
        heading.textContent = t('pinned')
        const count = document.createElement('span')
        count.className = 'dsh-spin-count'
        count.textContent = String(pinned.length)
        count.title = t('countTitle')
        header.append(chevron, heading, count)

        const list = document.createElement('div')
        list.className = 'dsh-spin-list'
        for (const row of rows) {
          const element = document.createElement('div')
          element.className = row.selected === true ? 'dsh-spin-row dsh-spin-selected' : 'dsh-spin-row'
          element.setAttribute('role', 'treeitem')
          element.setAttribute(ROW_ATTR, row.id)
          element.setAttribute('aria-selected', row.selected === true ? 'true' : 'false')
          element.title = row.title
          const title = document.createElement('span')
          title.className = 'dsh-spin-title'
          title.textContent = row.title
          element.append(title)
          if (row.blank !== true) {
            const time = document.createElement('span')
            time.className = 'dsh-spin-time'
            time.textContent = timeLabel(row.updatedAt)
            element.append(time)
          }
          const unpinButton = document.createElement('button')
          unpinButton.type = 'button'
          unpinButton.className = 'dsh-spin-unpin'
          unpinButton.title = t('unpinTitle')
          unpinButton.setAttribute('aria-label', t('unpinTitle'))
          unpinButton.textContent = '✕'
          unpinButton.addEventListener('click', (event) => {
            event.stopPropagation()
            void unpin(row.id)
          })
          element.append(unpinButton)
          element.addEventListener('click', () => {
            openSession(row.id)
          })
          element.addEventListener('contextmenu', (event) => {
            event.preventDefault()
            event.stopPropagation()
            showMenu(event.clientX, event.clientY, row.id)
          })
          list.append(element)
        }
        if (rows.length === 0) {
          const empty = document.createElement('div')
          empty.className = 'dsh-spin-empty'
          empty.textContent = t('empty')
          list.append(empty)
        }
        section.replaceChildren(header, list)
        section.dataset.count = String(rows.length)
      }

      /** Find the sidebar shell root (the logo row's parent). */
      const sidebarRoot = () => {
        const column = document.querySelector('[data-pane="sidebar"], [class*="sidebarCol"], .dshDesktopUpstreamSidebar, .dshDesktopSidebarSurface')
        if (column === null) return undefined
        const logoOwner = column.querySelector(LOGO_SELECTOR)?.parentElement
        return logoOwner ?? (column.firstElementChild instanceof HTMLElement ? column.firstElementChild : undefined)
      }

      /**
       * Place the section right before the workspace region (the reference
       * position: under the panel rows, above the "工作区" header).
       * @param {HTMLElement} root - sidebar shell root.
       * @returns {boolean} whether placement succeeded.
       */
      const place = (root) => {
        const region = root.querySelector(REGION_SELECTOR)
        // No append-to-end fallback: the region is the contract anchor, and the
        // end of the shell is the foot area — landing there would put the group
        // under Settings. A shell without the region is simply not ours to fill.
        if (region === null || region.parentElement !== root) return false
        if (section.parentElement !== root || section.nextElementSibling !== region) {
          root.insertBefore(section, region)
        }
        return true
      }

      /** Hide in the collapsed rail and re-sync the collapse class reading. */
      const syncVisibility = (root) => {
        const isRail = typeof root.className === 'string' && root.className.includes(COLLAPSED_CLASS)
        section.style.display = isRail ? 'none' : ''
      }

      /** Probe for the sessions service; re-render once it appears. */
      let subscribedStore = null
      let unsubscribeStore = null
      const bindSessions = () => {
        const sessions = sessionsService()
        if (sessions === undefined) return false
        const store = sessions.list
        if (store !== subscribedStore && typeof store?.subscribe === 'function') {
          if (typeof unsubscribeStore === 'function') {
            try {
              unsubscribeStore()
            } catch {
              // Already detached by the service owner; nothing to undo.
            }
          }
          subscribedStore = store
          unsubscribeStore = store.subscribe(() => {
            render()
            syncSelection()
          })
        }
        return true
      }

      /** Keep the pinned row highlight aligned with the current session. */
      const syncSelection = () => {
        const sessions = sessionsService()
        if (sessions === undefined) return
        let current
        try {
          current = sessions.list.getSnapshot()?.current
        } catch {
          return
        }
        const elements = section.querySelectorAll('.dsh-spin-row')
        let index = 0
        for (const id of pinned) {
          const summary = (() => {
            try {
              return sessions.list.getSnapshot()?.byId?.[id]
            } catch {
              return undefined
            }
          })()
          if (summary === undefined) continue
          const element = elements[index]
          index++
          if (!(element instanceof HTMLElement)) continue
          const selected = current === id
          element.classList.toggle('dsh-spin-selected', selected)
          element.setAttribute('aria-selected', selected ? 'true' : 'false')
        }
      }

      /** Wire the row context menu at the shell level (delegated, self-healing). */
      const onContextMenu = (event) => {
        const target = event.target
        if (!(target instanceof Element)) return
        const row = target.closest(SESSION_ROW_SELECTOR)
        if (!(row instanceof HTMLElement)) return
        if (row.closest(`[${SECTION_ATTR}]`) !== null) return
        const sessionId = sessionIdOf(row)
        if (sessionId === undefined) return
        event.preventDefault()
        event.stopPropagation()
        showMenu(event.clientX, event.clientY, sessionId)
      }

      /** Current shell root, or null while not mounted (never undefined). */
      let root = null
      let placed = false

      const tryPlace = () => {
        if (root !== null && !root.isConnected) {
          rootObserver.disconnect()
          root = null
          placed = false
        }
        if (placed && root !== null && document.body.contains(section)) {
          syncVisibility(root)
          return
        }
        if (root === null) {
          // Assign only on a hit: `root ??= sidebarRoot()` would store undefined
          // and turn the null check above into a TypeError on the next tick.
          root = sidebarRoot() ?? null
        }
        if (root === null) return
        placed = place(root)
        if (placed) {
          syncVisibility(root)
          rootObserver.observe(root, { childList: true, subtree: true })
        }
      }

      const rootObserver = new MutationObserver(() => {
        if (root === null || !root.isConnected) {
          placed = false
          tryPlace()
          return
        }
        if (!root.contains(section)) {
          placed = place(root)
          return
        }
        syncVisibility(root)
      })

      const waitObserver = new MutationObserver(() => {
        bindSessions()
        tryPlace()
      })
      waitObserver.observe(document.body, { childList: true, subtree: true })

      // Right-click pinning: one document-level listener, no per-row wiring.
      document.addEventListener('contextmenu', onContextMenu, true)

      // Late mounts that produce no further mutations still get retries.
      const retry = setInterval(() => {
        bindSessions()
        tryPlace()
      }, 2_000)

      // Initial data + first paint.
      render()
      tryPlace()
      void call('/state').then((value) => {
        if (value !== null && Array.isArray(value.pinned)) {
          pinned = value.pinned
          render()
          syncSelection()
        }
      }).catch(() => {})
      bindSessions()

      ctx.effect?.(() => () => {
        clearInterval(retry)
        waitObserver.disconnect()
        rootObserver.disconnect()
        document.removeEventListener('contextmenu', onContextMenu, true)
        closeMenu()
        if (typeof unsubscribeStore === 'function') {
          try {
            unsubscribeStore()
          } catch {
            // Service already disposed: its listeners went with it.
          }
        }
        section.remove()
      }, 'dsh-session-pin: sidebar section')
    }

    return module.exports
  },
})

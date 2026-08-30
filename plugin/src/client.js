/**
 * DeepSeek Harness 桌面端插件 —— Client 半部。
 *
 * 注册三项设置：
 *   1. settings.section   id=user      「用户」板块（API key / 余额 / 充值）
 *   2. settings.section   id=about     「关于」板块（创作者/时间/版本/检查更新+进度条）
 *   3. settings.general.item id=background 「背景」偏好行（导入图片覆盖主界面+侧边栏）
 *
 * 与 Host 通信走同源 fetch('/api/desktop/*')，因此动态插件与分发版通用。
 *
 * 说明：本文件是「纯 JS 源」。运行时 React 作为全局提供（动态客户端上下文）；
 * 打包进 monorepo 的 tsdown 客户端时，把 `React` 引用换成 `import React from 'react'` 即可。
 * 背景图持久化：桌面端走 Electron IPC（userData 文件），浏览器回退 localStorage；
 * CSS 用 styles.insert() 注入全局 CSS。
 */

export const inject = ['slots']

const BG_KEY = 'desktop:background'

// 持久化：桌面端优先走 Electron IPC 存到 userData 文件，浏览器模式回退 localStorage。
// 不能用 localStorage：dsh web 用 --port 0 每次随机端口，localStorage 按 origin（含端口）
// 隔离，重启后端口变了，上次存的背景就读不回来。
function getStoredBg() {
  if (window.desktopApp && typeof window.desktopApp.getBackground === 'function') {
    return window.desktopApp.getBackground().then((v) => v || null).catch(() => null)
  }
  return Promise.resolve(localStorage.getItem(BG_KEY) || null)
}
function setStoredBg(dataUrl) {
  if (window.desktopApp && typeof window.desktopApp.setBackground === 'function') {
    window.desktopApp.setBackground(dataUrl).catch(() => {})
  } else {
    localStorage.setItem(BG_KEY, dataUrl)
  }
}
function clearStoredBg() {
  if (window.desktopApp && typeof window.desktopApp.clearBackground === 'function') {
    window.desktopApp.clearBackground().catch(() => {})
  } else {
    localStorage.removeItem(BG_KEY)
  }
}

function e(type, props, ...children) {
  return React.createElement(type, props, ...children)
}

/** 拉取一个 JSON 端点，返回 { data, loading, error }。 */
function useJson(url) {
  const [state, setState] = React.useState({ data: null, loading: true, error: null })
  React.useEffect(() => {
    let alive = true
    setState((s) => ({ ...s, loading: true }))
    fetch(url)
      .then((r) => r.json())
      .then((data) => { if (alive) setState({ data, loading: false, error: null }) })
      .catch((error) => { if (alive) setState({ data: null, loading: false, error: String(error && error.message || error) }) })
    return () => { alive = false }
  }, [url])
  return state
}

const box = {
  fontFamily: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
  color: 'var(--ds-color-text, inherit)',
  padding: '8px 0',
}
const row = { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 0', gap: '12px' }
const label = { opacity: 0.75, fontSize: '13px' }
const value = { fontSize: '14px', fontWeight: 500, wordBreak: 'break-all' }
const btn = {
  display: 'inline-block', padding: '6px 12px', borderRadius: '6px', cursor: 'pointer',
  border: '1px solid var(--ds-color-border, rgba(128,128,128,0.4))',
  background: 'transparent', color: 'var(--ds-color-text, inherit)', fontSize: '13px',
}
const primaryBtn = { ...btn, borderColor: 'transparent', background: 'var(--ds-color-accent, #4a7dff)', color: '#fff' }

function openExternal(url) {
  if (window.desktopApp && typeof window.desktopApp.recharge === 'function' && url.indexOf('top_up') !== -1) {
    window.desktopApp.recharge()
  } else if (url) {
    window.open(url, '_blank')
  }
}

// ────────────────────────────────────────────────────────────────────────────
// 用户
// ────────────────────────────────────────────────────────────────────────────

function UserSection() {
  const { data, loading, error } = useJson('/api/desktop/user')
  const [reveal, setReveal] = React.useState(false)

  if (loading) return e('div', { style: box }, '加载中…')
  if (error || !data) return e('div', { style: box }, '无法读取用户信息：', String(error || '无数据'))

  const balanceInfos = data.balance && Array.isArray(data.balance.balance_infos) ? data.balance.balance_infos : []

  return e('div', { style: box },
    e('div', { style: row },
      e('span', { style: label }, 'API Key'),
      e('span', { style: value },
        data.hasKey
          ? (reveal ? '已配置（见「模型」设置查看完整值）' : data.maskedKey)
          : '未配置（请到「模型」设置添加）'),
    ),
    e('div', { style: row },
      e('span', { style: label }, '账户状态'),
      e('span', { style: value }, data.configured ? '已配置' : '未配置'),
    ),
    balanceInfos.map((b, i) => e('div', { key: i, style: row },
      e('span', { style: label }, `余额（${b.currency || ''}）`),
      e('span', { style: value }, `${b.total_balance ?? '—'}`),
    )),
    data.balanceError ? e('div', { style: row },
      e('span', { style: label }, '余额读取'),
      e('span', { style: value }, `失败：${data.balanceError}`),
    ) : null,
    e('div', { style: row },
      e('span', null),
      e('span', null,
        e('button', { style: btn, onClick: () => setReveal((v) => !v) }, reveal ? '隐藏' : '显示'),
        e('button', { style: { ...primaryBtn, marginLeft: '8px' }, onClick: () => openExternal(data.rechargeUrl) }, '去充值'),
      ),
    ),
  )
}

// ────────────────────────────────────────────────────────────────────────────
// 关于 + 检查更新（进度条）
// ────────────────────────────────────────────────────────────────────────────

function AboutSection() {
  const about = useJson('/api/desktop/about')
  const [check, setCheck] = React.useState(null)     // { current, latest, updateAvailable, url }
  const [checking, setChecking] = React.useState(false)
  const [progress, setProgress] = React.useState(null) // { received, total, pct }

  const runCheck = async () => {
    setChecking(true)
    setProgress(null)
    try {
      const r = await fetch('/api/desktop/update/check')
      setCheck(await r.json())
    } finally {
      setChecking(false)
    }
  }

  const download = async () => {
    if (!check || !check.url) return
    setProgress({ received: 0, total: null, pct: 0 })
    try {
      const resp = await fetch(`/api/desktop/update/download?url=${encodeURIComponent(check.url)}`)
      const total = Number(resp.headers.get('content-length')) || null
      const reader = resp.body.getReader()
      const chunks = []
      let received = 0
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        chunks.push(value)
        received += value.length
        setProgress({ received, total, pct: total ? Math.round((received / total) * 100) : null })
      }
      const blob = new Blob(chunks)
      const a = document.createElement('a')
      a.href = URL.createObjectURL(blob)
      a.download = `dsh-update-${check.latest}.tgz`
      a.click()
      URL.revokeObjectURL(a.href)
      setProgress(null)
    } catch (err) {
      setProgress(null)
      window.alert('下载失败：' + String(err && err.message || err))
    }
  }

  const info = about.data || {}
  const pct = progress && progress.pct

  return e('div', { style: box },
    e('div', { style: row }, e('span', { style: label }, '创作者'), e('span', { style: value }, info.creator || 'Adrain Lin')),
    e('div', { style: row }, e('span', { style: label }, '创作时间'), e('span', { style: value }, info.createdAt || '2024-11-04')),
    e('div', { style: row }, e('span', { style: label }, '版本号'), e('span', { style: value }, info.version || '—')),
    e('div', { style: row },
      e('span', { style: label }, '更新'),
      e('span', { style: value }, check
        ? (check.updateAvailable ? `发现新版本 ${check.latest}` : '已是最新版本')
        : ''),
    ),
    e('div', { style: row },
      e('span', null),
      e('span', null,
        e('button', { style: btn, onClick: runCheck, disabled: checking }, checking ? '检查中…' : '检查更新'),
        check && check.updateAvailable
          ? e('button', { style: { ...primaryBtn, marginLeft: '8px' }, onClick: download }, '下载更新')
          : null,
      ),
    ),
    progress ? e('div', { style: { marginTop: '8px' } },
      e('div', { style: { height: '8px', borderRadius: '4px', background: 'rgba(128,128,128,0.2)', overflow: 'hidden' } },
        e('div', { style: { height: '100%', width: `${pct ?? 0}%`, background: 'var(--ds-color-accent, #4a7dff)', transition: 'width .15s' } }),
      ),
      e('div', { style: { fontSize: '12px', opacity: 0.75, marginTop: '4px' } },
        pct != null ? `${pct}%` : `已下载 ${Math.round((progress.received || 0) / 1024)} KB`),
    ) : null,
  )
}

// ────────────────────────────────────────────────────────────────────────────
// 背景
// ────────────────────────────────────────────────────────────────────────────

const BG_INPUT_ID = 'desktop-bg-input'

function BackgroundRow(props) {
  const styles = props.styles
  const [hasBg, setHasBg] = React.useState(false)

  React.useEffect(() => {
    getStoredBg().then((dataUrl) => setHasBg(Boolean(dataUrl)))
  }, [])

  const applyCss = (css) => {
    if (styles && typeof styles.insert === 'function') {
      return styles.insert(css)
    }
    // 回退：直接注入 style 标签（动态客户端无 styles 服务时）
    const tag = document.createElement('style')
    tag.setAttribute('data-desktop-bg', '1')
    tag.textContent = css
    document.head.appendChild(tag)
    return () => tag.remove()
  }

  const setBackground = (dataUrl) => {
    document.querySelectorAll('style[data-desktop-bg]').forEach((n) => n.remove())
    const css = [
      'html, body {',
      '  background-image: url("' + dataUrl + '") !important;',
      '  background-size: cover !important;',
      '  background-position: center !important;',
      '  background-attachment: fixed !important;',
      '}',
      'body::before { content:""; position:fixed; inset:0; z-index:-1;',
      '  background-image: url("' + dataUrl + '"); background-size:cover; background-position:center; }',
    ].join('\n')
    applyCss(css)
    setStoredBg(dataUrl)
    setHasBg(true)
  }

  const clearBackground = () => {
    document.querySelectorAll('style[data-desktop-bg]').forEach((n) => n.remove())
    clearStoredBg()
    setHasBg(false)
  }

  const onPick = (event) => {
    const file = event.target.files && event.target.files[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => setBackground(String(reader.result))
    reader.readAsDataURL(file)
  }

  return e('div', { style: row },
    e('span', { style: label }, hasBg ? '背景已启用' : '背景（覆盖主界面与侧边栏）'),
    e('span', null,
      e('input', { id: BG_INPUT_ID, type: 'file', accept: 'image/*', style: { display: 'none' }, onChange: onPick }),
      e('button', { style: btn, onClick: () => { const n = document.getElementById(BG_INPUT_ID); if (n) n.click() } }, '导入图片'),
      hasBg ? e('button', { style: { ...btn, marginLeft: '8px' }, onClick: clearBackground }, '清除') : null,
    ),
  )
}

// ────────────────────────────────────────────────────────────────────────────

export function apply(ctx) {
  const slots = ctx.get('slots')
  if (slots === undefined) return
  const styles = ctx.get('styles')

  // 恢复上次持久化的背景（桌面端走 IPC 文件，浏览器回退 localStorage）
  getStoredBg().then((dataUrl) => {
    if (!dataUrl) return
    const css = [
      'html, body {',
      '  background-image: url("' + dataUrl + '") !important;',
      '  background-size: cover !important;',
      '  background-position: center !important;',
      '  background-attachment: fixed !important;',
      '}',
      'body::before { content:""; position:fixed; inset:0; z-index:-1;',
      '  background-image: url("' + dataUrl + '"); background-size:cover; background-position:center; }',
    ].join('\n')
    if (styles && typeof styles.insert === 'function') {
      styles.insert(css)
    } else {
      const tag = document.createElement('style')
      tag.setAttribute('data-desktop-bg', '1')
      tag.textContent = css
      document.head.appendChild(tag)
    }
  })

  slots.inject('settings.section', () => slots.register(
    { name: 'settings.section', id: 'user', order: 5, label: '用户' },
    () => e(UserSection),
  ))

  slots.inject('settings.section', () => slots.register(
    { name: 'settings.section', id: 'about', order: 30, label: '关于' },
    () => e(AboutSection),
  ))

  slots.inject('settings.general.item', () => slots.register(
    { name: 'settings.general.item', id: 'background', order: 13, label: '背景' },
    () => e(BackgroundRow, { styles }),
  ))
}

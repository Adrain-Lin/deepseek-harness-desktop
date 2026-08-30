/**
 * DeepSeek Harness 桌面端插件 —— Host 半部。
 *
 * 纯 JS ESM（无需构建），通过已确认的稳定接口扩展：
 *   - webServer.register()  注册 /api/desktop/* HTTP 路由
 *   - credentials.resolve() 读取 DeepSeek API Key
 *
 * 提供的能力（客户端通过同源 fetch 调用）：
 *   GET /api/desktop/about          关于：创作者/时间/版本
 *   GET /api/desktop/user           用户：脱敏 key + 余额 + 充值地址
 *   GET /api/desktop/update/check   检查更新（DSH_UPDATE_MANIFEST_URL 发布清单，未配置则提示）
 */

export const name = 'desktop-plugin'

const ABOUT = {
  creator: 'Adrain Lin',
  createdAt: '2024-11-04',
  version: '0.1.0',
}

const RECHARGE_URL = 'https://platform.deepseek.com/top_up'
const BALANCE_API = 'https://api.deepseek.com/user/balance'

function json(res, code, body) {
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify(body))
}

function currentVersion() {
  return process.env.DSH_DESKTOP_VERSION || ABOUT.version
}

async function readApiKey(credentials) {
  const resolved = await credentials.resolve('DEEPSEEK_API_KEY')
  return resolved ? resolved.value : undefined
}

function maskKey(key) {
  if (!key) return ''
  if (key.length <= 8) return '****'
  return `${key.slice(0, 4)}${'*'.repeat(Math.min(key.length - 8, 12))}${key.slice(-4)}`
}

async function fetchBalance(key) {
  const res = await fetch(BALANCE_API, {
    headers: { Authorization: `Bearer ${key}` },
  })
  if (!res.ok) throw new Error(`balance API responded ${res.status}`)
  return res.json()
}

export function apply(ctx) {
  ctx.inject(['credentials', 'webServer'], (c) => {
    const { credentials, webServer } = c

    webServer.register({
      kind: 'exact',
      path: '/api/desktop/about',
      handler: async (_req, res) => {
        json(res, 200, { ...ABOUT, version: currentVersion() })
      },
    })

    webServer.register({
      kind: 'exact',
      path: '/api/desktop/user',
      handler: async (_req, res) => {
        const base = { rechargeUrl: RECHARGE_URL }
        try {
          const key = await readApiKey(credentials)
          if (!key) {
            return json(res, 200, { ...base, configured: false, maskedKey: '', hasKey: false, balance: null })
          }
          let balance = null
          let balanceError = null
          try {
            balance = await fetchBalance(key)
          } catch (err) {
            balanceError = String(err.message || err)
          }
          json(res, 200, {
            ...base,
            configured: true,
            hasKey: true,
            maskedKey: maskKey(key),
            balance,
            balanceError,
          })
        } catch (err) {
          json(res, 200, { ...base, configured: false, maskedKey: '', hasKey: false, balance: null, error: String(err.message || err) })
        }
      },
    })

    webServer.register({
      kind: 'exact',
      path: '/api/desktop/update/check',
      handler: async (_req, res) => {
        const current = currentVersion()
        const manifestUrl = process.env.DSH_UPDATE_MANIFEST_URL
        if (!manifestUrl) {
          return json(res, 200, { current, latest: null, updateAvailable: false, message: '未配置更新源（桌面应用自动更新需发布渠道，可设置 DSH_UPDATE_MANIFEST_URL）' })
        }
        try {
          const r = await fetch(manifestUrl)
          const manifest = await r.json()
          const latest = manifest && manifest.version
          json(res, 200, {
            current,
            latest: latest || null,
            updateAvailable: Boolean(latest && latest !== current),
            url: (manifest && manifest.url) || null,
          })
        } catch (err) {
          json(res, 200, { current, latest: null, updateAvailable: false, error: String(err.message || err) })
        }
      },
    })
  })
}

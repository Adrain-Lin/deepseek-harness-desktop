/*
 * 桌面端插件 —— Client 半部（已构建的可分发 bundle）。
 *
 * 这是手写的「factory 形式」客户端 bundle，格式与 monorepo tsdown 产物一致：
 *   window.__ModuleLoader__.load({ id, factory(require) { ...; return module.exports } })
 *
 * `require('react')` 命中 shell 的平台种子词（seed），`slots` 通过 Cordis 服务注入
 * （`exports.inject = ['slots']`），因此无需任何内部 workspace 包即可在浏览器运行。
 *
 * 注册的设置：
 *   1. settings.section  id=user      用户（API key / 余额 / 充值）
 *   2. settings.section  id=about     关于（创作者/时间/版本/检查更新）
 *   3. settings.general.item id=background  背景（导入图片，半透明覆盖主界面+侧边栏）
 */
window.__ModuleLoader__.load({
	id: "@adrainlin/dsh-desktop-plugin",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;

		var React = require("react");

		var BG_KEY = "desktop:background";
		var BG_INPUT_ID = "desktop-bg-input";

		var bgTokenDisposer = null;

		function e(type, props) {
			var children = Array.prototype.slice.call(arguments, 2);
			return React.createElement.apply(React, [type, props].concat(children));
		}

		/* 拉取 JSON 端点 */
		function useJson(url) {
			var state = React.useState({ data: null, loading: true, error: null });
			var setState = state[1];
			React.useEffect(function () {
				var alive = true;
				setState(function (s) { return Object.assign({}, s, { loading: true }); });
				fetch(url)
					.then(function (r) { return r.json(); })
					.then(function (data) { if (alive) setState({ data: data, loading: false, error: null }); })
					.catch(function (error) { if (alive) setState({ data: null, loading: false, error: String((error && error.message) || error) }); });
				return function () { alive = false; };
			}, [url]);
			return state[0];
		}

		var box = { fontFamily: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif', color: 'var(--ds-color-text, inherit)', padding: '8px 0' };
		var row = { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 0', gap: '12px' };
		var label = { opacity: 0.75, fontSize: '13px' };
		var value = { fontSize: '14px', fontWeight: 500, wordBreak: 'break-all' };
		var btn = { display: 'inline-block', padding: '6px 12px', borderRadius: '6px', cursor: 'pointer', border: '1px solid var(--ds-color-border, rgba(128,128,128,0.4))', background: 'transparent', color: 'var(--ds-color-text, inherit)', fontSize: '13px' };
		var primaryBtn = { display: 'inline-block', padding: '6px 12px', borderRadius: '6px', cursor: 'pointer', border: '1px solid transparent', background: 'var(--ds-color-accent, #4a7dff)', color: '#fff', fontSize: '13px' };

		function openExternal(url) {
			if (window.desktopApp && typeof window.desktopApp.recharge === 'function' && url && url.indexOf('top_up') !== -1) {
				window.desktopApp.recharge();
			} else if (url) {
				window.open(url, '_blank');
			}
		}

		/* ── 用户 ── */
		function UserSection() {
			var data = useJson('/api/desktop/user');
			var reveal = React.useState(false);
			var setReveal = reveal[1];
			if (data.loading) return e('div', { style: box }, '加载中…');
			if (data.error || !data.data) return e('div', { style: box }, '无法读取用户信息：', String(data.error || '无数据'));
			var d = data.data;
			var infos = d.balance && Array.isArray(d.balance.balance_infos) ? d.balance.balance_infos : [];
			return e('div', { style: box },
				e('div', { style: row }, e('span', { style: label }, 'API Key'), e('span', { style: value }, d.hasKey ? (reveal[0] ? '已配置（完整值见「模型」设置）' : d.maskedKey) : '未配置（请到「模型」设置添加）')),
				e('div', { style: row }, e('span', { style: label }, '账户状态'), e('span', { style: value }, d.configured ? '已配置' : '未配置')),
				infos.map(function (b, i) {
					return e('div', { key: i, style: row }, e('span', { style: label }, '余额（' + (b.currency || '') + '）'), e('span', { style: value }, String(b.total_balance != null ? b.total_balance : '—')));
				}),
				d.balanceError ? e('div', { style: row }, e('span', { style: label }, '余额读取'), e('span', { style: value }, '失败：' + d.balanceError)) : null,
				e('div', { style: row }, e('span', null), e('span', null,
					e('button', { style: btn, onClick: function () { setReveal(function (v) { return !v; }); } }, reveal[0] ? '隐藏' : '显示'),
					e('button', { style: Object.assign({}, primaryBtn, { marginLeft: '8px' }), onClick: function () { openExternal(d.rechargeUrl); } }, '去充值')
				))
			);
		}

		/* ── 关于 + 检查更新 ── */
		function AboutSection() {
			var about = useJson('/api/desktop/about');
			var checkState = React.useState(null); var check = checkState[0]; var setCheck = checkState[1];
			var checkingState = React.useState(false); var checking = checkingState[0]; var setChecking = checkingState[1];
			var progressState = React.useState(null); var progress = progressState[0]; var setProgress = progressState[1];
			var installingState = React.useState(false); var installing = installingState[0]; var setInstalling = installingState[1];

			var runCheck = function () {
				setChecking(true); setProgress(null);
				var done = function () { setChecking(false); };
				if (window.desktopApp && typeof window.desktopApp.checkUpdates === 'function') {
					window.desktopApp.checkUpdates().then(function (v) { setCheck(v); }).catch(function () {}).finally(done);
				} else {
					fetch('/api/desktop/update/check')
						.then(function (r) { return r.json(); })
						.then(function (v) { setCheck(v); })
						.catch(function () {})
						.finally(done);
				}
			};

			var install = function () {
				if (!check || !check.url) return;
				if (!(window.desktopApp && typeof window.desktopApp.installUpdate === 'function')) {
					window.alert('当前在浏览器中运行，无法自动安装更新；请在桌面端里执行。');
					return;
				}
				setInstalling(true);
				setProgress({ pct: 0 });
				var off = window.desktopApp.onUpdateProgress
					? window.desktopApp.onUpdateProgress(function (p) { setProgress(p); })
					: function () {};
				window.desktopApp.installUpdate(check.url)
					.then(function (r) {
						off();
						if (r && r.ok) {
							setProgress({ pct: 100 });
							window.alert('更新已下载，即将启动安装程序，请按提示完成安装。');
						} else {
							setProgress(null);
							window.alert('更新失败：' + ((r && r.error) || '未知错误'));
						}
					})
					.catch(function (err) {
						off(); setProgress(null);
						window.alert('更新失败：' + String((err && err.message) || err));
					})
					.finally(function () { setInstalling(false); });
			};

			var info = about.data || {};
			var statusText = '';
			if (check) {
				statusText = check.message
					? check.message
					: (check.updateAvailable ? '发现新版本 ' + check.latest : '已是最新版本');
			}
			var pct = progress && progress.pct;

			return e('div', { style: box },
				e('div', { style: row }, e('span', { style: label }, '创作者'), e('span', { style: value }, info.creator || 'Adrain Lin')),
				e('div', { style: row }, e('span', { style: label }, '创作时间'), e('span', { style: value }, info.createdAt || '2024-11-04')),
				e('div', { style: row }, e('span', { style: label }, '版本号'), e('span', { style: value }, info.version || '—')),
				e('div', { style: row }, e('span', { style: label }, '更新'), e('span', { style: value }, statusText)),
				e('div', { style: row }, e('span', null), e('span', null,
					e('button', { style: btn, onClick: runCheck, disabled: checking }, checking ? '检查中…' : '检查更新'),
					check && check.updateAvailable && check.url ? e('button', { style: Object.assign({}, primaryBtn, { marginLeft: '8px' }), onClick: install, disabled: installing }, installing ? '下载中…' : '更新') : null
				)),
				progress ? e('div', { style: { marginTop: '8px' } },
					e('div', { style: { height: '8px', borderRadius: '4px', background: 'rgba(128,128,128,0.2)', overflow: 'hidden' } },
						e('div', { style: { height: '100%', width: (pct != null ? pct : 0) + '%', background: 'var(--ds-color-accent, #4a7dff)', transition: 'width .15s' } })
					),
					e('div', { style: { fontSize: '12px', opacity: 0.75, marginTop: '4px' } }, pct != null ? pct + '%' : '正在下载…')
				) : null
			);
		}

		/* ── 背景 ── */
		function backgroundCss(dataUrl) {
			return [
				'html, body {',
				'  background-image: url("' + dataUrl + '") !important;',
				'  background-size: cover !important;',
				'  background-position: center !important;',
				'  background-attachment: fixed !important;',
				'}'
			].join('\n');
		}

		// 把应用表面的背景 token 改为半透明，让底下的背景图透出来（约 75% 透明度）。
		function backgroundTokens(theme) {
			if (bgTokenDisposer) { bgTokenDisposer(); bgTokenDisposer = null; }
			if (!theme || typeof theme.overrideTokens !== 'function') return;
			bgTokenDisposer = theme.overrideTokens('desktop-background', {
				'--dsw-alias-bg-base': { light: 'rgba(255,255,255,0.22)', dark: 'rgba(15,15,19,0.22)' },
				'--dsw-alias-bg-layer-1': { light: 'rgba(255,255,255,0.28)', dark: 'rgba(21,21,27,0.28)' },
				'--dsw-alias-bg-layer-2': { light: 'rgba(255,255,255,0.34)', dark: 'rgba(28,28,35,0.34)' },
				'--dsw-specific-sidebar-fill': { light: 'rgba(247,247,249,0.24)', dark: 'rgba(11,11,15,0.24)' }
			});
		}

		function injectStyle(css, attr) {
			var tag = document.createElement('style');
			tag.setAttribute(attr, '1');
			tag.textContent = css;
			document.head.appendChild(tag);
			return tag;
		}

		function removeInjected(attr) {
			document.querySelectorAll('style[' + attr + ']').forEach(function (n) { n.remove(); });
		}

		// 持久化：桌面端优先走 Electron IPC 存到 userData 文件，浏览器模式回退 localStorage。
		// 不能只用 localStorage：dsh web 用 --port 0 每次随机端口，localStorage 按 origin（含端口）
		// 隔离，重启后端口变了，上次存的背景就读不回来。
		function getStoredBg() {
			if (window.desktopApp && typeof window.desktopApp.getBackground === 'function') {
				return window.desktopApp.getBackground().then(function (v) { return v || null; }).catch(function () { return null; });
			}
			return Promise.resolve(localStorage.getItem(BG_KEY) || null);
		}
		function setStoredBg(dataUrl) {
			if (window.desktopApp && typeof window.desktopApp.setBackground === 'function') {
				window.desktopApp.setBackground(dataUrl).catch(function () {});
			} else {
				localStorage.setItem(BG_KEY, dataUrl);
			}
		}
		function clearStoredBg() {
			if (window.desktopApp && typeof window.desktopApp.clearBackground === 'function') {
				window.desktopApp.clearBackground().catch(function () {});
			} else {
				localStorage.removeItem(BG_KEY);
			}
		}

		function setBackground(dataUrl, theme) {
			removeInjected('data-desktop-bg');
			injectStyle(backgroundCss(dataUrl), 'data-desktop-bg');
			backgroundTokens(theme);
			setStoredBg(dataUrl);
		}

		function clearBackground(theme) {
			removeInjected('data-desktop-bg');
			if (bgTokenDisposer) { bgTokenDisposer(); bgTokenDisposer = null; }
			clearStoredBg();
		}

		function BackgroundRow(props) {
			var theme = props.theme;
			var hasBg = React.useState(false);
			var setHasBg = hasBg[1];

			React.useEffect(function () {
				getStoredBg().then(function (dataUrl) { setHasBg(Boolean(dataUrl)); });
			}, []);

			var onPick = function (event) {
				var file = event.target.files && event.target.files[0];
				if (!file) return;
				var reader = new FileReader();
				reader.onload = function () {
					setBackground(String(reader.result), theme);
					setHasBg(true);
				};
				reader.readAsDataURL(file);
			};

			return e('div', { style: row },
				e('span', { style: label }, hasBg[0] ? '背景已启用' : '背景'),
				e('span', null,
					e('input', { id: BG_INPUT_ID, type: 'file', accept: 'image/*', style: { display: 'none' }, onChange: onPick }),
					e('button', { style: btn, onClick: function () { var n = document.getElementById(BG_INPUT_ID); if (n) n.click(); } }, '导入图片'),
					hasBg[0] ? e('button', { style: Object.assign({}, btn, { marginLeft: '8px' }), onClick: function () { clearBackground(theme); setHasBg(false); } }, '清除') : null
				)
			);
		}

		function apply(ctx) {
			var slots = ctx.get('slots');
			if (slots === undefined) return;
			var theme = ctx.get('theme');

			// 恢复上次持久化的背景（异步从桌面端 userData / localStorage 读取）
			getStoredBg().then(function (savedBg) {
				if (savedBg) { injectStyle(backgroundCss(savedBg), 'data-desktop-bg'); backgroundTokens(theme); }
			});

			slots.inject('settings.section', function () {
				return slots.register({ name: 'settings.section', id: 'user', order: 5, label: '用户' }, function () { return e(UserSection); });
			});
			slots.inject('settings.section', function () {
				return slots.register({ name: 'settings.section', id: 'about', order: 30, label: '关于' }, function () { return e(AboutSection); });
			});
			slots.inject('settings.general.item', function () {
				return slots.register({ name: 'settings.general.item', id: 'background', order: 13, label: '背景' }, function () { return e(BackgroundRow, { theme: theme }); });
			});
		}

		exports.inject = ["slots"];
		exports.apply = apply;

		return module.exports;
	}
});

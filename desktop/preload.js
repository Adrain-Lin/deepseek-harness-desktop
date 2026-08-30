/**
 * 渲染进程桥：把主进程的「关于 / 更新 / 充值」能力暴露给 dsh 前端页面。
 * 通过 contextBridge 注入到 window.desktopApp，页面（DSH 客户端插件）可用：
 *   window.desktopApp.about()            -> { creator, createdAt, version }
 *   window.desktopApp.checkUpdates()     -> { current, latest, updateAvailable, url, message? }
 *   window.desktopApp.installUpdate(url) -> 下载并运行安装包（返回 { ok, path, error? }）
 *   window.desktopApp.onUpdateProgress(cb) -> 订阅下载进度 { received, total, pct }，返回取消函数
 *   window.desktopApp.recharge()         -> { url }
 */

'use strict'

const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('desktopApp', {
  about: () => ipcRenderer.invoke('desktop:about'),
  checkUpdates: () => ipcRenderer.invoke('desktop:update:check'),
  installUpdate: (url) => ipcRenderer.invoke('desktop:update:install', url),
  onUpdateProgress: (cb) => {
    const listener = (_event, progress) => cb(progress)
    ipcRenderer.on('update:progress', listener)
    return () => ipcRenderer.removeListener('update:progress', listener)
  },
  recharge: () => ipcRenderer.invoke('desktop:recharge'),
})

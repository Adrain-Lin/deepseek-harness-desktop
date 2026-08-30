// 把 DeepSeek 官方鲸鱼 favicon.svg 栅格化为 512px PNG（Windows 应用图标用）
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
const require = createRequire('E:/Deepseek Harness_Work/creat_app/desktop/resources/dsh/package.json')
const sharp = require('sharp')
const svg = readFileSync('E:/DeepSeek Harness/apps/web/public/favicon.svg', 'utf8')
// 鲸鱼默认黑色；透明背景（不再 flatten 成白底）。
await sharp(Buffer.from(svg), { density: 512 })
  .resize(512, 512)
  .png()
  .toFile('E:/Deepseek Harness_Work/creat_app/desktop/build/icon.png')
console.log('icon.png written')

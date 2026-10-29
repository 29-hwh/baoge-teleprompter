#!/usr/bin/env node
/**
 * 把任意本地 HTML 截成整页 PNG（用 CDP 精确视口 + 整页截屏）。
 * 用于检查交付报告的实际排版，而不是靠想象。
 *
 * 用法：node tools/guide_fit/shot_page.js <html路径> <输出png> [宽] [高]
 */
'use strict'
const fs = require('fs')
const os = require('os')
const path = require('path')
const { spawn } = require('child_process')

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const [htmlPath, outPath, wIn = 1040, hIn = 800, dprIn = 1] = process.argv.slice(2)
if (!htmlPath || !outPath) {
  console.error('用法：node tools/guide_fit/shot_page.js <html> <out.png> [宽] [高]')
  process.exit(1)
}
const W = +wIn
const H = +hIn

const udd = fs.mkdtempSync(path.join(os.tmpdir(), 'shotpage-'))
const proc = spawn(
  CHROME,
  ['--headless=new', '--disable-gpu', '--no-sandbox', '--hide-scrollbars', '--no-first-run',
   '--no-default-browser-check', '--remote-debugging-port=0', `--user-data-dir=${udd}`, 'about:blank'],
  { stdio: 'ignore' }
)
const portFile = path.join(udd, 'DevToolsActivePort')
const deadline = Date.now() + 20000
while (!fs.existsSync(portFile) || fs.readFileSync(portFile, 'utf8').trim().split('\n').length < 2) {
  if (Date.now() > deadline) throw new Error('Chrome 启动超时')
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 20)
}
const port = +fs.readFileSync(portFile, 'utf8').trim().split('\n')[0]

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

;(async () => {
  let wsUrl
  for (let i = 0; i < 100; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()
      const p = list.find((t) => t.type === 'page')
      if (p) { wsUrl = p.webSocketDebuggerUrl; break }
    } catch {}
    await sleep(50)
  }
  const ws = new WebSocket(wsUrl)
  await new Promise((res, rej) => {
    ws.addEventListener('open', res)
    ws.addEventListener('error', () => rej(new Error('WS 失败')))
  })
  let id = 0
  const pending = new Map()
  ws.addEventListener('message', (ev) => {
    let m
    try { m = JSON.parse(ev.data) } catch { return }
    if (m.id && pending.has(m.id)) {
      const { resolve, reject } = pending.get(m.id)
      pending.delete(m.id)
      m.error ? reject(new Error(JSON.stringify(m.error))) : resolve(m.result)
    }
  })
  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const mid = ++id
      pending.set(mid, { resolve, reject })
      ws.send(JSON.stringify({ id: mid, method, params }))
      setTimeout(() => { if (pending.has(mid)) { pending.delete(mid); reject(new Error(method + ' 超时')) } }, 20000)
    })

  await send('Page.enable')
  await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: +dprIn || 1, mobile: false })
  await send('Page.navigate', { url: 'file://' + path.resolve(htmlPath) })
  await sleep(700)
  const { data } = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true })
  fs.writeFileSync(outPath, Buffer.from(data, 'base64'))
  const { result } = await send('Runtime.evaluate', { expression: 'document.body.scrollHeight', returnByValue: true })
  console.log(`已截图 ${outPath}（页面高 ${result.value}px，视口 ${W}px 宽）`)
  ws.close()
  proc.kill()
  // Chrome 退出时还在写 Default/ 目录，立刻 rmSync 会 ENOTEMPTY；
  // 以前这个异常被当成截图失败（exit 1），批量截图脚本因此中断。
  await sleep(250)
  try { fs.rmSync(udd, { recursive: true, force: true, maxRetries: 3, retryDelay: 120 }) } catch {}
  process.exit(0)
})().catch((e) => {
  console.error('失败:', e.message)
  try { proc.kill() } catch {}
  try { fs.rmSync(udd, { recursive: true, force: true }) } catch {}
  process.exit(1)
})

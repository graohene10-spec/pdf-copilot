/**
 * 专用机翻：谷歌（免 key 的公开接口）与有道智云（需要应用 ID 与密钥）。比让大模型翻译快得多。
 * 桌面版经 Rust 发请求（transportFetch），不受浏览器跨域限制。
 */
import { transportFetch } from './transport.mjs'

export type Target = 'zh' | 'en' | 'ja'
const GOOGLE: Record<Target, string> = { zh: 'zh-CN', en: 'en', ja: 'ja' }
const YOUDAO: Record<Target, string> = { zh: 'zh-CHS', en: 'en', ja: 'ja' }

/** 长文按段落切成不超过 limit 字的几块，逐块翻译后拼回（段落之间保留空行）。 */
export function chunks(text: string, limit = 4500): string[] {
  const out: string[] = []
  let current = ''
  for (const paragraph of text.split(/\n\s*\n/)) {
    for (let start = 0; start < paragraph.length; start += limit) {
      const piece = paragraph.slice(start, start + limit)
      if (current && current.length + piece.length + 2 > limit) { out.push(current); current = '' }
      current = current ? `${current}\n\n${piece}` : piece
    }
  }
  if (current) out.push(current)
  return out
}

/** 谷歌翻译的回复是嵌套数组：第一项里每一段是 [译文, 原文, …]。 */
export function parseGoogle(data: unknown): string {
  if (!Array.isArray(data) || !Array.isArray(data[0])) throw new Error('谷歌翻译返回的结果无法识别')
  return data[0].map((segment: any) => Array.isArray(segment) && typeof segment[0] === 'string' ? segment[0] : '').join('')
}

/** 一次请求最多等这么久：直连谷歌被墙时不必傻等。 */
const TIMEOUT = 12_000
async function post(url: string, signal: AbortSignal, init: RequestInit, service: string): Promise<Response> {
  const timer = AbortSignal.timeout(TIMEOUT)
  try {
    return await transportFetch(url, { ...init, method: 'POST', signal: AbortSignal.any([signal, timer]) })
  } catch (error: any) {
    if (signal.aborted) throw error
    if (timer.aborted) throw new Error(`${service}：${TIMEOUT / 1000} 秒内没有响应。直连多半被墙了，开代理后再试。`)
    throw new Error(`${service}：连不上（${String(error?.message || error).slice(0, 80)}）`)
  }
}

/** 免密钥的公开接口：谷歌按出口 IP 限流，代理节点很多人共用一个 IP 时常被拒（429）。 */
async function google(text: string, target: Target, signal: AbortSignal) {
  const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=${GOOGLE[target]}&dt=t`
  const response = await post(url, signal, { headers: { 'content-type': 'application/x-www-form-urlencoded;charset=UTF-8' }, body: `q=${encodeURIComponent(text)}` }, '谷歌')
  if (response.status === 429 || response.status === 403) throw new Error(`谷歌拒绝了这次请求（HTTP ${response.status}）：免密钥接口按出口 IP 限流，共用的代理节点常被限。换个节点，或改用「谷歌云」（自己的 API 密钥）/「有道」。`)
  if (!response.ok) throw new Error(`谷歌返回了错误（HTTP ${response.status}）`)
  return parseGoogle(await response.json())
}

/** 官方 Cloud Translation（v2）：用自己的 API 密钥，按密钥计量，不受共用 IP 限流影响。 */
export function parseGoogleCloud(data: any): string {
  if (data?.error) throw new Error(`谷歌云：${data.error.message || data.error.status || data.error.code}`)
  const list = data?.data?.translations
  if (!Array.isArray(list)) throw new Error('谷歌云返回的结果无法识别')
  return list.map((item: any) => decodeEntities(String(item.translatedText || ''))).join('\n')
}
const decodeEntities = (text: string) => text.replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code))).replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
async function googleCloud(text: string, target: Target, signal: AbortSignal, key: string) {
  if (!key) throw new Error('请先在翻译栏底部填好谷歌云的 API 密钥。')
  const response = await post(`https://translation.googleapis.com/language/translate/v2?key=${encodeURIComponent(key)}`, signal, { headers: { 'content-type': 'application/json' }, body: JSON.stringify({ q: [text], target: GOOGLE[target], format: 'text' }) }, '谷歌云')
  const data = await response.json().catch(() => null)
  if (!response.ok && !data?.error) throw new Error(`谷歌云返回了错误（HTTP ${response.status}）`)
  return parseGoogleCloud(data)
}

const YOUDAO_ERRORS: Record<string, string> = {
  '101': '缺少必填参数', '102': '不支持的语言', '108': '应用 ID 无效', '110': '这个应用没有开通文本翻译服务', '111': '开发者账号无效',
  '113': '要翻译的内容为空', '202': '签名校验失败：请检查应用密钥', '206': '时间戳无效：请检查电脑时间', '401': '有道账户已欠费', '411': '访问太频繁，请稍后再试', '412': '长请求过于频繁，请稍后再试',
}
/** 有道 v3 签名用的 input：20 字以内用原文，更长时取前 10 字 + 长度 + 后 10 字（按字符计）。 */
export function youdaoInput(text: string) {
  const chars = [...text]
  return chars.length <= 20 ? text : `${chars.slice(0, 10).join('')}${chars.length}${chars.slice(-10).join('')}`
}
async function sha256(text: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('')
}
async function youdao(text: string, target: Target, signal: AbortSignal, credential: string) {
  const [appKey, secret] = credential.split('\n')
  if (!appKey || !secret) throw new Error('请先在翻译栏底部填好有道的应用 ID 与应用密钥。')
  const salt = crypto.randomUUID(), curtime = String(Math.floor(Date.now() / 1000))
  const sign = await sha256(appKey + youdaoInput(text) + salt + curtime + secret)
  const body = new URLSearchParams({ q: text, from: 'auto', to: YOUDAO[target], appKey, salt, sign, signType: 'v3', curtime })
  const response = await post('https://openapi.youdao.com/api', signal, { headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: body.toString() }, '有道')
  const data: any = await response.json().catch(() => null)
  if (!data) throw new Error(`有道翻译返回了错误（HTTP ${response.status}）`)
  if (data.errorCode !== '0') throw new Error(`有道翻译：${YOUDAO_ERRORS[data.errorCode] || `错误 ${data.errorCode}`}`)
  return (Array.isArray(data.translation) ? data.translation : []).join('\n')
}

/** 按块翻译，每翻完一块就回调一次已有的全部译文（翻译栏里逐段出现）。 */
export type MachineEngine = 'google' | 'google-api' | 'youdao'
export async function machineTranslate(engine: MachineEngine, text: string, target: Target, signal: AbortSignal, credential = '', onPartial?: (all: string) => void) {
  const parts: string[] = []
  for (const chunk of chunks(text)) {
    signal.throwIfAborted()
    parts.push(engine === 'google' ? await google(chunk, target, signal) : engine === 'google-api' ? await googleCloud(chunk, target, signal, credential) : await youdao(chunk, target, signal, credential))
    onPartial?.(parts.join('\n\n'))
  }
  return parts.join('\n\n')
}

// 放不下的一行字（书名、对话标题）：平时从左边开始显示、末尾省略；指上去时文字从左往右走到头，再弹回左边循环。
import type { Directive } from 'vue'

const SPEED = 42 // px/s

function start(host: HTMLElement) {
  const text = host.querySelector<HTMLElement>('.marquee-text')
  if (!text) return
  const shift = text.scrollWidth - text.clientWidth
  if (shift <= 2) return
  host.style.setProperty('--marquee-shift', `${-shift}px`)
  host.style.setProperty('--marquee-duration', `${(Math.max(3.4, shift / SPEED / .66)).toFixed(2)}s`)
  host.classList.add('marquee-run')
}
function stop(host: HTMLElement) { host.classList.remove('marquee-run') }

export const vMarquee: Directive<HTMLElement> = {
  mounted(host) {
    host.addEventListener('pointerenter', () => start(host))
    host.addEventListener('pointerleave', () => stop(host))
    host.addEventListener('focus', () => start(host))
    host.addEventListener('blur', () => stop(host))
  },
}

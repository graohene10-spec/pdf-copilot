/**
 * 单选组的方向键：焦点在组里时，按左右（或上下）在选项之间移动——选中下一个，并把焦点带过去，到头了绕回另一头。
 * 挂在 role="radiogroup" 容器的 keydown 上；选项是里面的 role="radio"，选中的那个带 aria-checked="true"。
 * 「选中」就是点它一下，各处自己的点击处理照常生效。
 */
export function radioKeys(event: KeyboardEvent) {
  const step = event.key === 'ArrowRight' || event.key === 'ArrowDown' ? 1 : event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : 0
  if (!step || event.altKey || event.ctrlKey || event.metaKey) return
  const group = event.currentTarget as HTMLElement
  const items = [...group.querySelectorAll<HTMLElement>('[role="radio"]:not(:disabled)')]
  if (items.length < 2) return
  const checked = items.findIndex(item => item.getAttribute('aria-checked') === 'true')
  const from = checked >= 0 ? checked : Math.max(0, items.indexOf(document.activeElement as HTMLElement))
  const next = items[(from + step + items.length) % items.length]!
  // 拦下来：不让方向键再去翻页。
  event.preventDefault(); event.stopPropagation()
  next.click(); next.focus()
}

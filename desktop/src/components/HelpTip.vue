<script setup lang="ts">
// 设置项的补充说明：平时只是一个小问号，指上去或按 Tab 停在上面才显示那段话。
// 说明不写死在页面上——要看的人看得到，不看的人眼前是干净的。
// 点一下问号钉住它（触屏上也能看），再点一下、点别处或按 Esc 收起。
import { onBeforeUnmount, ref } from 'vue'
defineOptions({ inheritAttrs: false })

const root = ref<HTMLElement>(), pop = ref<HTMLElement>()
// open：点出来钉住了。shut：刚点掉或按了 Esc，指针还停在上面也先不冒出来，移开、失焦以后恢复。
const open = ref(false), shut = ref(false)
/** 窄的容器里别伸出左右边：量一下最近一层会裁切的祖先（没有就是窗口），往里挪。 */
function fit() {
  const tip = root.value, box = pop.value
  if (!tip || !box) return
  let left = 0, right = window.innerWidth
  for (let el = tip.parentElement; el; el = el.parentElement) {
    if (getComputedStyle(el).overflowX === 'visible') continue
    const rect = el.getBoundingClientRect(); left = Math.max(left, rect.left); right = Math.min(right, rect.right); break
  }
  box.style.maxWidth = `${Math.max(160, right - left - 16)}px`
  const at = tip.getBoundingClientRect().left, width = box.offsetWidth
  let shift = 0
  if (at + width > right - 8) shift = right - 8 - width - at
  if (at + shift < left + 8) shift = left + 8 - at
  box.style.left = `${Math.round(shift)}px`
}
function away(event: PointerEvent) { if (!root.value?.contains(event.target as Node)) close() }
function close() { open.value = false; document.removeEventListener('pointerdown', away, true) }
function toggle() {
  if (open.value) { close(); shut.value = true; return }
  fit(); open.value = true; shut.value = false
  document.addEventListener('pointerdown', away, true)
}
function key(event: KeyboardEvent) {
  if (event.key !== 'Escape' || shut.value) return
  const el = root.value
  if (!open.value && !el?.matches(':hover') && !el?.querySelector(':focus-visible')) return
  // 只收起说明，不连带关掉外面的设置窗口。
  event.preventDefault(); event.stopPropagation(); close(); shut.value = true
}
onBeforeUnmount(close)
</script>

<template>
  <span ref="root" class="help-tip" :class="{ open, shut }" @pointerenter="fit" @pointerleave="shut = false" @focusin="fit" @focusout="shut = false" @keydown="key">
    <button type="button" class="help-dot" aria-label="说明" :aria-expanded="open" @click="toggle">?</button>
    <span ref="pop" class="help-pop" role="tooltip" v-bind="$attrs"><slot /></span>
  </span>
</template>

<style scoped>
.help-tip{position:relative;display:inline-flex;margin-top:4px;vertical-align:middle}
.help-dot{display:grid;place-items:center;width:17px;height:17px;min-height:0;padding:0;border:1px solid var(--separator,var(--hairline));border-radius:50%;background:none;box-shadow:none;color:var(--muted);font-family:var(--font-formal,system-ui);font-size:11px;font-weight:600;line-height:1;cursor:help}
.help-tip:hover .help-dot,.help-dot:focus-visible,.help-tip.open .help-dot{border-color:color-mix(in srgb,var(--ink) 45%,transparent);color:var(--ink)}
.help-pop{position:absolute;left:0;bottom:calc(100% + 6px);z-index:20;width:min(360px,70vw);padding:9px 12px;border:1px solid var(--hairline,var(--separator));border-radius:10px;background:var(--popup-glass,var(--surface,var(--canvas)));box-shadow:0 12px 30px -14px rgb(0 0 0 / .45);color:var(--secondary);font-family:var(--font-formal,system-ui);font-size:12.5px;font-weight:400;line-height:1.65;letter-spacing:0;white-space:normal;text-align:left;opacity:0;visibility:hidden;translate:0 4px;transition:opacity var(--dur-1,.12s) var(--ease-out,ease-out),translate var(--dur-2,.18s) var(--ease-out,ease-out),visibility 0s linear var(--dur-2,.18s);pointer-events:none}
/* 鼠标点过问号不算键盘焦点：用 :focus-visible，免得点掉之后它因为还有焦点又一直开着。 */
.help-tip:hover .help-pop,.help-tip:has(:focus-visible) .help-pop,.help-tip.open .help-pop{opacity:1;visibility:visible;translate:0 0;transition-delay:0s;pointer-events:auto}
.help-tip.shut .help-pop{opacity:0;visibility:hidden;translate:0 4px;transition-delay:0s,0s,var(--dur-2,.18s);pointer-events:none}
:root[data-style='sketch'] .help-dot{border:1.3px solid var(--pencil);border-radius:50%;rotate:none}
:root[data-style='sketch'] .help-pop{border:1.4px solid var(--pencil);border-radius:var(--r-control);background:var(--paper);box-shadow:2px 3px 0 color-mix(in srgb,var(--pencil) 22%,transparent)}
</style>

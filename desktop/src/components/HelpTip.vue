<script setup lang="ts">
// 设置项的补充说明：平时只是一个小问号，指上去或按 Tab 停在上面才显示那段话。
// 说明不写死在页面上——要看的人看得到，不看的人眼前是干净的。
defineOptions({ inheritAttrs: false })
</script>

<template>
  <span class="help-tip">
    <button type="button" class="help-dot" aria-label="说明">?</button>
    <span class="help-pop" role="tooltip" v-bind="$attrs"><slot /></span>
  </span>
</template>

<style scoped>
.help-tip{position:relative;display:inline-flex;margin-top:4px;vertical-align:middle}
.help-dot{display:grid;place-items:center;width:17px;height:17px;min-height:0;padding:0;border:1px solid var(--separator,var(--hairline));border-radius:50%;background:none;box-shadow:none;color:var(--muted);font-family:var(--font-formal,system-ui);font-size:11px;font-weight:600;line-height:1;cursor:help}
.help-tip:hover .help-dot,.help-dot:focus-visible{border-color:color-mix(in srgb,var(--ink) 45%,transparent);color:var(--ink)}
.help-pop{position:absolute;left:0;bottom:calc(100% + 6px);z-index:20;width:min(360px,70vw);padding:9px 12px;border:1px solid var(--hairline,var(--separator));border-radius:10px;background:var(--popup-glass,var(--surface,var(--canvas)));box-shadow:0 12px 30px -14px rgb(0 0 0 / .45);color:var(--secondary);font-family:var(--font-formal,system-ui);font-size:12.5px;font-weight:400;line-height:1.65;letter-spacing:0;white-space:normal;text-align:left;opacity:0;visibility:hidden;translate:0 4px;transition:opacity var(--dur-1,.12s) var(--ease-out,ease-out),translate var(--dur-2,.18s) var(--ease-out,ease-out),visibility 0s linear var(--dur-2,.18s);pointer-events:none}
.help-tip:hover .help-pop,.help-tip:focus-within .help-pop{opacity:1;visibility:visible;translate:0 0;transition-delay:0s;pointer-events:auto}
:root[data-style='sketch'] .help-dot{border:1.3px solid var(--pencil);border-radius:50%;rotate:none}
:root[data-style='sketch'] .help-pop{border:1.4px solid var(--pencil);border-radius:var(--r-control);background:var(--paper);box-shadow:2px 3px 0 color-mix(in srgb,var(--pencil) 22%,transparent)}
</style>

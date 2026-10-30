<script setup lang="ts">
// Floating liquid-glass palette shown while markup mode is on.
import InkIcon from './InkIcon.vue'
import { INK_COLORS, type InkMode, type InkTool } from '../../reader/ink/model.ts'
import { useSettings, shortcutLabel, type ShortcutAction } from '../../settings'

const props = defineProps<{ mode: InkMode; colors: Record<InkTool, string>; lastTool: InkTool; canUndo: boolean; pageHasInk: boolean; selected?: number; status?: string; clearLabel?: string }>()
const emit = defineEmits<{ mode: [value: InkMode]; color: [value: string]; undo: []; clear: []; close: []; deleteSelected: [] }>()
const tools: { mode: InkMode; label: string; tip: string }[] = [
  { mode: 'pen', label: '笔', tip: '笔：随手写字、画圈' },
  { mode: 'highlighter', label: '荧光笔', tip: '荧光笔：半透明涂抹文字' },
  { mode: 'underline', label: '划线', tip: '划线：拖动画一条手写横线' },
  { mode: 'eraser', label: '橡皮', tip: '橡皮：点按或拖过笔迹即擦除' },
  { mode: 'select', label: '框选笔迹', tip: '框选：拖出一个框选中笔迹，再一起删除或换颜色（Shift 追加、Ctrl 反选、Ctrl+A 全选）' },
]
const activeColor = () => props.colors[props.lastTool]
const selecting = () => props.mode === 'select' && !!props.selected
// 悬停提示里带上每支笔的快捷键（设置 → 快捷键里可以改）。
const { preferences } = useSettings()
const SHORTCUT: Partial<Record<InkMode, ShortcutAction>> = { pen: 'inkPen', highlighter: 'inkHighlighter', underline: 'inkUnderline' }
const keyFor = (mode: InkMode) => { const action = SHORTCUT[mode]; const binding = action ? preferences.value.shortcuts[action] : ''; return binding ? shortcutLabel(binding) : undefined }
</script>

<template>
  <div class="ink-palette" role="toolbar" aria-label="标记工具">
    <div class="ink-group">
      <button v-for="tool in tools" :key="tool.mode" type="button" class="ink-tool" :class="{ on: mode === tool.mode }" :aria-label="tool.label" :aria-pressed="mode === tool.mode" :data-tip="tool.tip" :data-tip-key="keyFor(tool.mode)" @click="emit('mode', tool.mode)">
        <InkIcon :name="tool.mode" />
        <i v-if="tool.mode !== 'eraser' && tool.mode !== 'select'" class="ink-tip" :style="{ background: colors[tool.mode as InkTool] }" aria-hidden="true" />
      </button>
    </div>
    <span class="ink-separator" aria-hidden="true" />
    <div class="ink-group" role="group" aria-label="颜色">
      <button v-for="color in INK_COLORS" :key="color.value" type="button" class="ink-swatch" :class="{ on: !selecting() && mode !== 'eraser' && activeColor() === color.value }" :aria-label="`颜色：${color.label}`" :aria-pressed="!selecting() && mode !== 'eraser' && activeColor() === color.value" :data-tip="selecting() ? `所选笔迹改为${color.label}` : color.label" @click="emit('color', color.value)"><i :style="{ background: color.value }" /></button>
    </div>
    <span class="ink-separator" aria-hidden="true" />
    <div class="ink-group">
      <button v-if="mode === 'select'" type="button" class="ink-tool ink-delete" aria-label="删除所选笔迹" :data-tip="selected ? `删除所选的 ${selected} 笔` : '先框选要删除的笔迹'" data-tip-key="Delete" :disabled="!selected" @click="emit('deleteSelected')"><InkIcon name="eraser" /><b v-if="selected" class="ink-count">{{ selected }}</b></button>
      <button type="button" class="ink-tool" aria-label="撤销" data-tip="撤销" data-tip-key="Ctrl + Z" :disabled="!canUndo" @click="emit('undo')"><InkIcon name="undo" /></button>
      <button type="button" class="ink-tool" :aria-label="clearLabel ? '清除全部标记' : '清除本页'" :data-tip="clearLabel || '清除本页标记（可撤销）'" :disabled="!pageHasInk" @click="emit('clear')"><InkIcon name="clear" /></button>
      <button type="button" class="ink-tool" aria-label="退出标记" data-tip="退出标记" data-tip-key="Esc" @click="emit('close')"><InkIcon name="close" /></button>
    </div>
    <p v-if="status" class="ink-status" role="status">{{ status }}</p>
  </div>
</template>

<style scoped>
.ink-palette {
  position: absolute;
  top: 10px;
  left: 50%;
  z-index: 6;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: center;
  gap: 4px;
  max-width: calc(100% - 24px);
  padding: 5px;
  border-radius: var(--r-lg);
  background-color: var(--popup-glass);
  background-image: var(--popup-sheen);
  --lens-blur: var(--popup-blur);
  --lens-saturate: var(--glass-sat);
  -webkit-backdrop-filter: var(--refraction, blur(var(--popup-blur)) saturate(var(--glass-sat)));
  backdrop-filter: var(--refraction, blur(var(--popup-blur)) saturate(var(--glass-sat)));
  border: 1px solid var(--glass-outline);
  box-shadow: 0 14px 34px -14px rgb(0 0 0 / .32), var(--glass-edge);
  color: var(--surface-ink);
  font-family: var(--font-ui);
  transform: translateX(-50%);
  transform-origin: 50% 0;
  animation: ink-pop var(--dur-3) var(--spring-snappy) both;
}
@keyframes ink-pop { from { opacity: 0; transform: translateX(-50%) scale(.9); } to { opacity: 1; transform: translateX(-50%); } }
.ink-group { display: flex; align-items: center; gap: 2px; }
.ink-separator { width: 1px; height: 20px; margin: 0 3px; background: var(--line-soft); }
button {
  position: relative;
  display: grid;
  place-items: center;
  width: 34px;
  height: 34px;
  padding: 0;
  border: 0;
  border-radius: calc(var(--r-lg) - 5px);
  background: none;
  box-shadow: none;
  color: inherit;
  cursor: pointer;
}
button::before { content: none; }
button:hover:not(:disabled), button:focus-visible { background: color-mix(in srgb, var(--surface-ink) 8%, transparent); outline: none; }
button:focus-visible { box-shadow: 0 0 0 2px var(--accent-ring); }
button:disabled { opacity: .38; cursor: default; }
.ink-tool.on, .ink-tool.on:hover { background: color-mix(in srgb, var(--accent) 16%, transparent); color: var(--surface-ink); box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--accent) 38%, transparent); }
.ink-tip { position: absolute; left: 50%; bottom: 4px; width: 12px; height: 3px; border-radius: 2px; transform: translateX(-50%); box-shadow: inset 0 0 0 .5px rgb(0 0 0 / .18); }
.ink-tool svg { margin-bottom: 3px; }
.ink-tool:not(:has(.ink-tip)) svg { margin-bottom: 0; }
.ink-swatch { width: 28px; }
.ink-swatch i { width: 16px; height: 16px; border-radius: 50%; box-shadow: inset 0 0 0 1px rgb(0 0 0 / .16), 0 1px 2px rgb(0 0 0 / .12); transition: transform var(--dur-1) ease; }
.ink-swatch.on i { transform: scale(1.12); box-shadow: 0 0 0 2px var(--popup-glass), 0 0 0 3.5px var(--accent); }
.ink-count { position: absolute; top: 1px; right: 1px; min-width: 15px; height: 15px; padding: 0 3px; border-radius: 8px; background: var(--accent); color: var(--accent-on, #fff); font-size: 10px; font-weight: 650; line-height: 15px; }
.ink-status { flex: 1 1 100%; margin: 2px 6px 3px; font-size: 11.5px; color: var(--danger); text-align: center; }
</style>

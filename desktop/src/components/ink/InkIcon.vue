<script setup lang="ts">
// Markup icons, drawn in the AppIcon style (24px grid, 1.65 stroke, round joins).
withDefaults(defineProps<{ name: string; size?: number }>(), { size: 18 })
const paths: Record<string, string> = {
  markup: 'M14.6 4.4l3 3L8.8 16.2l-3.7.7.7-3.7z M12.6 6.4l3 3 M3.5 20.5c2.2-1.4 3.9-1.6 5.6-.7 1.9 1 3.8.9 6-.3 1.6-.9 3.2-1.1 5.4-.4',
  pen: 'M15.2 3.8l5 5L9.6 19.4l-5.9 1 1-5.9z M13 6l5 5 M4.7 15.5l3.8 3.8',
  highlighter: 'M9.2 11.3 15.6 4.9a1.8 1.8 0 0 1 2.5 0l1 1a1.8 1.8 0 0 1 0 2.5l-6.4 6.4z M9.2 11.3l-2 4.4 1.1 1.1 4.4-2 M7.2 15.7 4 19h4.5l.9-.9',
  underline: 'M7 4v6.2a5 5 0 0 0 10 0V4 M3.5 20.2c2.6-1.1 4.9-1.2 7.4-.4 2.6.8 5.2.7 9.6-.6',
  eraser: 'M8.2 20 3.7 15.5a1.6 1.6 0 0 1 0-2.3l8.9-8.9a1.6 1.6 0 0 1 2.3 0l5 5a1.6 1.6 0 0 1 0 2.3L12.4 20z M8.6 9.4l7 7 M8.2 20H20.5',
  select: 'M4 8.5V5.5A1.5 1.5 0 0 1 5.5 4h3 M12 4h2 M4 12v2 M8.5 20h-3A1.5 1.5 0 0 1 4 18.5v-1 M20 8.5v-3A1.5 1.5 0 0 0 18.5 4h-1 M12.5 12.5l8 3-3.4 1.2-1.2 3.4z',
  undo: 'M9 14 4 9l5-5 M4 9h10.5a5.5 5.5 0 0 1 0 11H11',
  clear: 'M4 6h16 M9.5 6V3.8h5V6 M6 6l1 14.2h10L18 6 M10 10.5v6 M14 10.5v6',
  close: 'M6 6l12 12 M18 6 6 18',
}
</script>

<template><svg :width="size" :height="size" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path :d="paths[name]" /></svg></template>

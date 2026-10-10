<script setup lang="ts">
withDefaults(defineProps<{ name: string; size?: number }>(), { size: 20 })
const paths: Record<string, string> = {
  book: 'M4 4h6a3 3 0 0 1 3 3v13a3 3 0 0 0-3-3H4z M20 4h-5a2 2 0 0 0-2 2v14a3 3 0 0 1 3-3h4z',
  library: 'M4 4v16 M9 4v16 M14 4v16 M18 4l3 16',
  search: 'M10.5 17a6.5 6.5 0 1 0 0-13 6.5 6.5 0 0 0 0 13z M16 16l5 5',
  plus: 'M12 5v14 M5 12h14',
  arrow: 'M14 6l-6 6 6 6',
  clock: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z M12 7v5l3 2',
  star: 'm12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-3-5.6 3 1.1-6.2L3 9.6l6.2-.9z',
  tag: 'M3 4h8l10 10-7 7L3 10z M7 7h.01',
  file: 'M14 3H5v18h14V8z M14 3v5h5 M8 13h8 M8 17h6',
  markdown: 'M3 5h18v14H3z M6 15V9l3 3 3-3v6 M15 12l2 3 2-3 M17 9v6',
  sparkle: 'm12 3 2.3 6.7L21 12l-6.7 2.3L12 21l-2.3-6.7L3 12l6.7-2.3z M20 3v4 M18 5h4',
  settings: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z M9 3h6l1 3 3 1 2 5-2 5-3 1-1 3H9l-1-3-3-1-2-5 2-5 3-1z',
  sun: 'M12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8z M12 2v2 M12 20v2 M2 12h2 M20 12h2 M5 5l1.5 1.5 M17.5 17.5 1.5 1.5 M5 19l1.5-1.5 M17.5 6.5 1.5-1.5',
  moon: 'M20.5 14a9 9 0 0 1-10.5-10.5A9 9 0 1 0 20.5 14z',
  grid: 'M3 3h7v7H3z M14 3h7v7h-7z M3 14h7v7H3z M14 14h7v7h-7z',
  list: 'M8 5h13 M8 12h13 M8 19h13 M3 5h.01 M3 12h.01 M3 19h.01',
  close: 'M6 6l12 12 M18 6 6 18',
  down: 'm6 9 6 6 6-6',
  trash: 'M3 6h18 M9 6V3h6v3 M5 6l1 15h12l1-15 M10 10v7 M14 10v7',
  import: 'M12 3v12 M7 10l5 5 5-5 M4 15v6h16v-6',
  panel: 'M3 4h18v16H3z M15 4v16',
  check: 'm5 12 4 4 10-10',
  crop: 'M7 3v14h14 M3 7h14v14',
  send: 'm3 3 18 9-18 9 4-9z M7 12h14',
  stop: 'M6 6h12v12H6z',
  external: 'M14 3h7v7 M21 3 11 13 M10 3H3v18h18v-7',
}
</script>

<template><svg :width="size" :height="size" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path :d="paths[name] || paths.file" /></svg></template>

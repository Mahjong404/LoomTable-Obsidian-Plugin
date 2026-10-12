import { defineConfig } from 'vitepress';

// Only the same-source showcase is a website. Canonical specs stay in docs/ui.
export default defineConfig({
  title: 'Loom UI',
  description: 'Production Native DOM component showcase',
  srcDir: '.vitepress/pages',
  themeConfig: { outline: false },
});

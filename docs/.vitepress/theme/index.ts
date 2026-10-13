import DefaultTheme from 'vitepress/theme';
import type { Theme } from 'vitepress';
import LoomControls from './LoomControls.vue';
import '../../../styles.css';
import '../../../tests/gallery/control-showcase.css';

export default {
  extends: DefaultTheme,
  enhanceApp({ app }) {
    app.component('LoomControls', LoomControls);
  },
} satisfies Theme;

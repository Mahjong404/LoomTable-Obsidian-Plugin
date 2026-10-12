// Development fixture shared by Gallery and the Vue documentation adapter.
// Every interactive surface mounts the production Native DOM implementation.
import { createLoomButton, type LoomButtonHandle } from '../../src/ui/loom-button';
import { createToolbarToggle, type ToolbarToggleHandle } from '../../src/ui/toolbar-toggle';
import { openContextMenu } from '../../src/ui/context-menu';

export function mountControlShowcase(host: HTMLElement): { dispose(): void } {
  const wrapper = document.createElement('div');
  wrapper.className = 'loom-control-showcase';
  host.append(wrapper);
  const controls: Array<LoomButtonHandle | ToolbarToggleHandle> = [];
  let closeMenu: (() => void) | undefined;
  for (const theme of ['light', 'dark'] as const) {
    const section = document.createElement('section');
    section.className = 'loom-root loom-showcase-theme';
    section.dataset.theme = theme;
    wrapper.append(section);
    const heading = document.createElement('h3');
    heading.textContent = theme === 'light' ? 'Light' : 'Dark';
    section.append(heading);
    const row = (title: string): HTMLElement => {
      const caption = document.createElement('p');
      caption.textContent = title;
      const content = document.createElement('div');
      content.className = 'loom-showcase-row';
      section.append(caption, content);
      return content;
    };
    for (const size of ['compact', 'default'] as const) {
      const content = row(`${size} — Quiet / Neutral / Primary / Danger`);
      for (const variant of ['quiet', 'neutral', 'primary', 'danger'] as const) {
        const control = createLoomButton({ label: '操作', variant, size, onActivate: () => {} });
        controls.push(control);
        content.append(control.element);
      }
    }
    const states = row('Disabled / Busy / Leading / Trailing');
    for (const state of [
      { disabled: true },
      { busy: true, reserveBusySpace: true },
      { leadingIcon: 'tool-create' as const },
      { trailingIcon: 'caret-down' as const },
    ]) {
      const control = createLoomButton({
        label: '操作',
        size: 'compact',
        variant: 'primary',
        ...state,
        onActivate: () => {},
      });
      controls.push(control);
      states.append(control.element);
    }
    const toggles = row('Default / Open / Active / Open+Active');
    for (const [open, count] of [
      [false, 0],
      [true, 0],
      [false, 1],
      [true, 1],
    ] as const) {
      const control = createToolbarToggle({
        label: '筛选',
        icon: 'tool-filter',
        open,
        count,
        accessibleLabel: `筛选，${count}`,
        onActivate: () => {},
      });
      controls.push(control);
      toggles.append(control.element);
    }
    const narrow = row('Narrow / long label / native Enter + Space');
    narrow.classList.add('loom-showcase-narrow');
    let activations = 0;
    const live = createLoomButton({
      label: '很长的按钮名称用于检查窄容器中的文本截断与图标保留',
      leadingIcon: 'tool-filter',
      onActivate: () => {
        activations += 1;
        output.textContent = `Activations: ${activations}`;
      },
    });
    const output = document.createElement('output');
    output.textContent = 'Activations: 0';
    controls.push(live);
    narrow.append(live.element, output);
    const menuRow = row('Command / Radio / Checkbox / Disabled / Danger');
    const menu = createLoomButton({
      label: '菜单',
      onActivate: () => {
        if (menu.element.getAttribute('aria-expanded') === 'true') {
          closeMenu?.();
          return;
        }
        const rect = menu.element.getBoundingClientRect();
        closeMenu = openContextMenu({
          host: section,
          trigger: menu.element,
          x: rect.left,
          y: rect.bottom + 4,
          label: '菜单',
          items: [
            { label: '操作', icon: 'tool-create', action: () => {} },
            { label: '单选', checkable: 'radio', checked: true, action: () => {} },
            { label: '多选', checkable: 'checkbox', checked: true, action: () => {} },
            { label: '不可用', disabled: true, action: () => {} },
            'separator',
            { label: '删除', danger: true, action: () => {} },
          ],
        });
      },
    });
    menu.element.setAttribute('aria-haspopup', 'menu');
    controls.push(menu);
    menuRow.append(menu.element);
  }
  return {
    dispose() {
      closeMenu?.();
      for (const control of controls) control.dispose();
      wrapper.remove();
    },
  };
}

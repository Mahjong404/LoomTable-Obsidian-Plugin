import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

const styles = readFileSync('styles.css', 'utf8');
const themeVariablePattern = /var\(--(?:background|text|interactive|color|size|radius|font)-/;
const fixedColorPattern = /#[0-9a-f]{3,8}|rgba?\(/i;

function tokenRoot(): string {
  const start = styles.indexOf('.loom-root {');
  const end = styles.indexOf('\n}\n\n.loom-status', start);
  if (start < 0 || end < 0) throw new Error('Expected the Loom token root.');
  return styles.slice(start, end + 2);
}

describe('LoomTable CSS contract', () => {
  it('keeps theme mappings in the Loom token root', () => {
    const root = tokenRoot();
    const componentStyles = styles.slice(root.length);

    expect(root).toContain('--loom-bg-primary: var(--background-primary');
    expect(root).toContain('--loom-accent: var(--interactive-accent');
    expect(componentStyles).not.toMatch(themeVariablePattern);
    expect(componentStyles).not.toMatch(fixedColorPattern);
  });

  it('keeps Leaflet and controls inside the plugin namespace', () => {
    const selectorLines = styles
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.startsWith('.'));

    expect(selectorLines.every((line) => line.startsWith('.loom-'))).toBe(true);
    expect(styles).not.toMatch(/^\s*\.leaflet-/m);
    expect(styles).not.toMatch(/^\s*(?:button|input|textarea|select|\.workspace)\b/m);
  });

  it('defines reduced-motion and narrow-layout contracts for every existing surface', () => {
    expect(styles).toContain('@media (prefers-reduced-motion: reduce)');
    expect(styles).toContain('animation-duration: 0.01ms');
    expect(styles).toContain('transition-duration: 0.01ms');
    expect(styles).not.toMatch(/transition\s*:\s*all\b/);
    expect(styles).toContain('@media (max-width: 40rem)');
    expect(styles).toContain('.loom-grid-select select');
    expect(styles).toContain('.loom-record-detail');
    expect(styles).toContain('.loom-map-container');
    expect(styles).toContain('.loom-settings .setting-item-control');
  });

  it('retains non-color state and visible focus contracts', () => {
    expect(styles).toContain("[data-status='error']");
    expect(styles).toContain("[data-status='conflict']");
    expect(styles).toContain("[data-edit-state='queued']");
    expect(styles).toContain('.loom-grid-cell:focus-visible');
    expect(styles).toContain('box-shadow: inset 0 0 0 2px var(--loom-focus)');
    expect(styles).toContain('outline: 2px solid var(--loom-focus)');
  });
});

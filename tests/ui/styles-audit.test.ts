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

  it('defines a shared namespaced control geometry contract', () => {
    expect(tokenRoot()).toContain('--loom-control-min-height: 2rem');
    expect(tokenRoot()).toContain('--loom-control-padding-block: var(--loom-space-1)');
    expect(tokenRoot()).toContain('--loom-control-padding-inline: var(--loom-space-2)');
    expect(styles).toContain('min-height: var(--loom-control-min-height)');
    expect(styles).toContain('box-sizing: border-box');
    expect(styles).toContain('.loom-root input:focus-visible');
    expect(styles).toContain('.loom-root select:focus-visible');
    expect(styles).toContain('.loom-root textarea:focus-visible');
    expect(styles).not.toMatch(/^\s*(?:button|input|textarea|select)\b/m);
  });

  it('uses a Loom danger variant and a namespaced zoom hit target', () => {
    expect(styles).toContain(".loom-button[data-variant='danger']");
    expect(styles).toContain('.loom-button-danger');
    expect(styles).toContain('--loom-map-control-size: 2rem');
    expect(styles).toContain('width: var(--loom-map-control-size)');
    expect(styles).toContain('height: var(--loom-map-control-size)');
    expect(styles).toContain('.loom-map-shell .leaflet-control-zoom a:focus-visible');
    expect(styles).not.toContain('mod-warning');
  });

  it('keeps field Chips structured, namespaced, and readable without color-only state', () => {
    expect(styles).toContain('.loom-field-value-chips');
    expect(styles).toContain('.loom-field-value-chip');
    expect(styles).toContain(".loom-field-value-chip[data-chip-state='deleted']");
    expect(styles).toContain('border-style: dashed');
    expect(styles).toContain('var(--loom-radius-sm)');
    expect(styles).toContain('.loom-map-cluster-record-label');
  });
});

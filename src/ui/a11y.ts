let loomLabelCounter = 0;

/**
 * Names a non-interactive container for assistive technology without exposing
 * the label to Obsidian's aria-label tooltip delegation. Obsidian renders any
 * `aria-label` as a hover tooltip; on containers (regions, toolbars, tablists,
 * forms) that produces misplaced floating chips over the UI.
 */
export function labelContainer(host: HTMLElement, text: string): void {
  const label = document.createElement('span');
  label.id = `loom-a11y-label-${++loomLabelCounter}`;
  label.className = 'loom-visually-hidden';
  label.textContent = text;
  host.append(label);
  host.setAttribute('aria-labelledby', label.id);
}

/**
 * Gives every unlabeled button under `root` an `aria-label` equal to its
 * visible text. Obsidian's tooltip delegation renders `aria-label` on hover,
 * so this keeps tooltips consistent across text buttons as well as icon-only
 * controls. Buttons that already carry `aria-label` (including dynamically
 * updated pending labels) are untouched.
 */
export function ensureButtonLabels(root: HTMLElement): void {
  root.querySelectorAll<HTMLElement>('button:not([aria-label])').forEach((button) => {
    const text = button.textContent?.trim();
    if (text !== undefined && text !== '') button.setAttribute('aria-label', text);
  });
}

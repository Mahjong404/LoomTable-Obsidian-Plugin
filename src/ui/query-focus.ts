export interface QueryControlFocus {
  readonly role: string;
  readonly path?: string;
  readonly sortIndex?: string;
  readonly caret?: number;
}

export function captureQueryControlFocus(scope: ParentNode | null): QueryControlFocus | null {
  const active = document.activeElement;
  if (!(active instanceof HTMLElement) || scope === null || !scope.contains(active)) {
    return null;
  }
  const role = active.dataset.role;
  if (role === undefined) return null;
  const path = active.closest<HTMLElement>('[data-path]')?.dataset.path;
  const sortIndex = active.closest<HTMLElement>('[data-sort-index]')?.dataset.sortIndex;
  const caret =
    active instanceof HTMLInputElement ? (active.selectionStart ?? undefined) : undefined;
  return {
    role,
    ...(path === undefined ? {} : { path }),
    ...(sortIndex === undefined ? {} : { sortIndex }),
    ...(caret === undefined ? {} : { caret }),
  };
}

export function restoreQueryControlFocus(
  scope: ParentNode,
  ref: QueryControlFocus | null,
): boolean {
  if (ref === null) return false;
  const host =
    ref.path !== undefined
      ? scope.querySelector<HTMLElement>(`[data-path="${ref.path}"]`)
      : ref.sortIndex !== undefined
        ? scope.querySelector<HTMLElement>(`[data-sort-index="${ref.sortIndex}"]`)
        : scope instanceof HTMLElement
          ? scope
          : null;
  const target = host?.querySelector<HTMLElement>(`[data-role="${ref.role}"]`) ?? null;
  if (target === null || !target.isConnected) return false;
  target.focus();
  if (ref.caret !== undefined && target instanceof HTMLInputElement) {
    target.setSelectionRange(ref.caret, ref.caret);
  }
  return true;
}

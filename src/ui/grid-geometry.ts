/**
 * The single resolved Grid geometry model (Wave 1.5 C / W15-05).
 *
 * Header, body rows, the add tail, the aggregate footer, frozen offsets,
 * canvas sizing, range/selection math and hit targets all derive from this
 * model — no consumer keeps its own track literals.
 *
 * Approved anatomy (Figma 205:34361 / 205:33044 / 205:35622):
 * - system track 88 (desktop) = 2 + 28 + 28 + 28 + 2; 132 (coarse) =
 *   44 + 44 + 44, no outer inset.
 * - Header and aggregate Footer: 36px regardless of row density.
 * - Add tail: 56px. Header More: 28px. Resize rail: 8px.
 */
export interface GridGeometry {
  /** True for coarse pointers — widens the system track and its slots. */
  readonly coarse: boolean;
  /** Left system track width in px: 88 desktop, 132 coarse pointer. */
  readonly systemTrack: number;
  /** Transparent hit slot inside the system track (three per track). */
  readonly systemSlot: number;
  /** Inset on each side of the three slots. */
  readonly systemInset: number;
  /** Column header height — independent of row density. */
  readonly headerHeight: number;
  /** Aggregate footer height — independent of row density. */
  readonly footerHeight: number;
  /** Body row height: 30 compact / 36 standard / 44 comfortable. */
  readonly rowHeight: number;
  /** Add-field tail track appended to header and footer templates. */
  readonly addTail: number;
  /** Header column-menu hit target. */
  readonly moreTarget: number;
  /** Column-resize rail hit width. */
  readonly resizeRail: number;
}

export const GRID_HEADER_HEIGHT = 36;
export const GRID_FOOTER_HEIGHT = 36;
export const GRID_ADD_TAIL_WIDTH = 56;
export const GRID_HEADER_MORE_TARGET = 28;
export const GRID_RESIZE_RAIL_WIDTH = 8;

export const GRID_ROW_HEIGHTS = {
  compact: 30,
  standard: 36,
  comfortable: 44,
} as const;

export function resolveGridGeometry(options: {
  readonly rowHeight: number;
  readonly coarse?: boolean;
}): GridGeometry {
  const coarse = options.coarse === true;
  const systemSlot = coarse ? 44 : 28;
  // Approved anatomy: 88 = 2 + 28 + 28 + 28 + 2 (desktop);
  // 132 = 44 + 44 + 44 (coarse, no outer inset).
  const systemInset = coarse ? 0 : 2;
  return {
    coarse,
    systemTrack: systemInset * 2 + systemSlot * 3,
    systemSlot,
    systemInset,
    headerHeight: GRID_HEADER_HEIGHT,
    footerHeight: GRID_FOOTER_HEIGHT,
    rowHeight: options.rowHeight,
    addTail: GRID_ADD_TAIL_WIDTH,
    moreTarget: GRID_HEADER_MORE_TARGET,
    resizeRail: GRID_RESIZE_RAIL_WIDTH,
  };
}

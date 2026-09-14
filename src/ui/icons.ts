const SVG_NS = 'http://www.w3.org/2000/svg';

export type IconPart = readonly [string, Readonly<Record<string, string>>];

export function buildIcon(parts: readonly IconPart[], className: string): HTMLElement {
  const span = document.createElement('span');
  span.className = className;
  span.setAttribute('aria-hidden', 'true');
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '2');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  for (const [tag, attrs] of parts) {
    const part = document.createElementNS(SVG_NS, tag);
    for (const [name, value] of Object.entries(attrs)) part.setAttribute(name, value);
    svg.append(part);
  }
  span.append(svg);
  return span;
}

export type UiIconName =
  | 'view-grid'
  | 'view-map'
  | 'menu-edit'
  | 'menu-copy'
  | 'menu-clear'
  | 'menu-open'
  | 'menu-delete'
  | 'tool-filter'
  | 'tool-sort'
  | 'tool-display'
  | 'tool-create'
  | 'tool-recycle'
  | 'tool-refresh'
  | 'view-add'
  | 'view-manage'
  | 'nav-prev'
  | 'nav-next'
  | 'detail-close'
  | 'detail-collapse'
  | 'detail-expand'
  | 'field-add'
  | 'col-insert-left'
  | 'col-insert-right'
  | 'sort-asc'
  | 'sort-desc'
  | 'field-hide'
  | 'tool-undo'
  | 'tool-redo';

const UI_ICONS: Record<UiIconName, readonly IconPart[]> = {
  'tool-undo': [
    ['path', { d: 'M9 14 4 9l5-5' }],
    ['path', { d: 'M4 9h10.5a5.5 5.5 0 0 1 5.5 5.5a5.5 5.5 0 0 1-5.5 5.5H11' }],
  ],
  'tool-redo': [
    ['path', { d: 'm15 14 5-5-5-5' }],
    ['path', { d: 'M20 9H9.5A5.5 5.5 0 0 0 4 14.5a5.5 5.5 0 0 0 5.5 5.5H13' }],
  ],
  'view-grid': [
    ['rect', { width: '18', height: '18', x: '3', y: '3', rx: '2' }],
    ['path', { d: 'M3 9h18' }],
    ['path', { d: 'M3 15h18' }],
    ['path', { d: 'M9 3v18' }],
  ],
  'view-map': [
    [
      'path',
      {
        d: 'M14.106 5.553a2 2 0 0 0 1.788 0l3.659-1.83A1 1 0 0 1 21 4.619v12.764a1 1 0 0 1-.553.894l-4.553 2.277a2 2 0 0 1-1.788 0l-4.212-2.106a2 2 0 0 0-1.788 0l-3.659 1.83A1 1 0 0 1 3 19.381V6.618a1 1 0 0 1 .553-.894l4.553-2.277a2 2 0 0 1 1.788 0z',
      },
    ],
    ['path', { d: 'M15 5.764v15' }],
    ['path', { d: 'M9 3.236v15' }],
  ],
  'menu-edit': [
    [
      'path',
      {
        d: 'M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z',
      },
    ],
    ['path', { d: 'm15 5 4 4' }],
  ],
  'menu-copy': [
    ['rect', { width: '14', height: '14', x: '8', y: '8', rx: '2', ry: '2' }],
    ['path', { d: 'M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2' }],
  ],
  'menu-clear': [
    [
      'path',
      {
        d: 'm7 21-4.3-4.3c-1-1-1-2.5 0-3.4l9.6-9.6c1-1 2.5-1 3.4 0l5.6 5.6c1 1 1 2.5 0 3.4L13 21',
      },
    ],
    ['path', { d: 'M22 21H7' }],
    ['path', { d: 'm5 11 9 9' }],
  ],
  'menu-open': [
    ['path', { d: 'M15 3h6v6' }],
    ['path', { d: 'M9 21H3v-6' }],
    ['path', { d: 'M21 3l-7 7' }],
    ['path', { d: 'M3 21l7-7' }],
  ],
  'menu-delete': [
    ['path', { d: 'M3 6h18' }],
    ['path', { d: 'M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6' }],
    ['path', { d: 'M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2' }],
    ['line', { x1: '10', x2: '10', y1: '11', y2: '17' }],
    ['line', { x1: '14', x2: '14', y1: '11', y2: '17' }],
  ],
  'tool-filter': [['path', { d: 'M22 3H2l8 9.46V19l4 2v-8.54z' }]],
  'tool-sort': [
    ['path', { d: 'm21 16-4 4-4-4' }],
    ['path', { d: 'M17 20V4' }],
    ['path', { d: 'm3 8 4-4 4 4' }],
    ['path', { d: 'M7 4v16' }],
  ],
  'tool-display': [
    [
      'path',
      {
        d: 'M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z',
      },
    ],
    ['circle', { cx: '12', cy: '12', r: '3' }],
  ],
  'tool-create': [
    ['path', { d: 'M5 12h14' }],
    ['path', { d: 'M12 5v14' }],
  ],
  'tool-recycle': [
    ['path', { d: 'M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8' }],
    ['path', { d: 'M3 3v5h5' }],
  ],
  'tool-refresh': [
    ['path', { d: 'M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8' }],
    ['path', { d: 'M21 3v5h-5' }],
    ['path', { d: 'M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16' }],
    ['path', { d: 'M8 16H3v5' }],
  ],
  'view-add': [
    ['path', { d: 'M5 12h14' }],
    ['path', { d: 'M12 5v14' }],
  ],
  'nav-prev': [['path', { d: 'm15 18-6-6 6-6' }]],
  'nav-next': [['path', { d: 'm9 18 6-6-6-6' }]],
  'detail-close': [
    ['path', { d: 'M18 6 6 18' }],
    ['path', { d: 'M6 6l12 12' }],
  ],
  'detail-expand': [
    ['path', { d: 'M15 3h6v6' }],
    ['path', { d: 'M9 21H3v-6' }],
    ['path', { d: 'm21 3-7 7' }],
    ['path', { d: 'm3 21 7-7' }],
  ],
  'detail-collapse': [
    ['path', { d: 'M4 14h6v6' }],
    ['path', { d: 'M20 10h-6V4' }],
    ['path', { d: 'm14 10 7-7' }],
    ['path', { d: 'm3 21 7-7' }],
  ],
  'field-add': [
    ['path', { d: 'M5 12h14' }],
    ['path', { d: 'M12 5v14' }],
  ],
  'col-insert-left': [
    ['path', { d: 'M21 3v18' }],
    ['path', { d: 'M14 12H4' }],
    ['path', { d: 'm8 8-4 4 4 4' }],
  ],
  'col-insert-right': [
    ['path', { d: 'M3 3v18' }],
    ['path', { d: 'M10 12h10' }],
    ['path', { d: 'm16 8 4 4-4 4' }],
  ],
  'sort-asc': [
    ['path', { d: 'M12 19V5' }],
    ['path', { d: 'm5 12 7-7 7 7' }],
  ],
  'sort-desc': [
    ['path', { d: 'M12 5v14' }],
    ['path', { d: 'm19 12-7 7-7-7' }],
  ],
  'field-hide': [
    [
      'path',
      {
        d: 'M10.733 5.076a10.744 10.744 0 0 1 11.205 6.575 1 1 0 0 1 0 .696 10.747 10.747 0 0 1-1.444 2.49',
      },
    ],
    ['path', { d: 'M14.084 14.158a3 3 0 0 1-4.242-4.242' }],
    [
      'path',
      {
        d: 'M17.479 17.499a10.75 10.75 0 0 1-15.417-5.151 1 1 0 0 1 0-.696 10.75 10.75 0 0 1 4.446-5.143',
      },
    ],
    ['path', { d: 'm2 2 20 20' }],
  ],
  'view-manage': [
    ['line', { x1: '21', x2: '14', y1: '4', y2: '4' }],
    ['line', { x1: '10', x2: '3', y1: '4', y2: '4' }],
    ['line', { x1: '21', x2: '12', y1: '12', y2: '12' }],
    ['line', { x1: '8', x2: '3', y1: '12', y2: '12' }],
    ['line', { x1: '21', x2: '16', y1: '20', y2: '20' }],
    ['line', { x1: '12', x2: '3', y1: '20', y2: '20' }],
    ['line', { x1: '14', x2: '14', y1: '2', y2: '6' }],
    ['line', { x1: '8', x2: '8', y1: '10', y2: '14' }],
    ['line', { x1: '16', x2: '16', y1: '18', y2: '22' }],
  ],
};

export function createUiIcon(name: UiIconName): HTMLElement {
  return buildIcon(UI_ICONS[name], 'loom-ui-icon');
}

import type { Field } from '../client/loomtable-client';
import { buildIcon, type IconPart } from './icons';

const FIELD_TYPE_ICONS: Record<Field['type'], readonly IconPart[]> = {
  text: [
    ['polyline', { points: '4 7 4 4 20 4 20 7' }],
    ['line', { x1: '9', y1: '20', x2: '15', y2: '20' }],
    ['line', { x1: '12', y1: '4', x2: '12', y2: '20' }],
  ],
  longText: [
    ['line', { x1: '21', y1: '6', x2: '3', y2: '6' }],
    ['line', { x1: '15', y1: '12', x2: '3', y2: '12' }],
    ['line', { x1: '17', y1: '18', x2: '3', y2: '18' }],
  ],
  number: [
    ['line', { x1: '4', y1: '9', x2: '20', y2: '9' }],
    ['line', { x1: '4', y1: '15', x2: '20', y2: '15' }],
    ['line', { x1: '10', y1: '3', x2: '8', y2: '21' }],
    ['line', { x1: '16', y1: '3', x2: '14', y2: '21' }],
  ],
  checkbox: [
    ['rect', { width: '18', height: '18', x: '3', y: '3', rx: '2' }],
    ['path', { d: 'm9 12 2 2 4-4' }],
  ],
  date: [
    ['path', { d: 'M8 2v4' }],
    ['path', { d: 'M16 2v4' }],
    ['rect', { width: '18', height: '18', x: '3', y: '4', rx: '2' }],
    ['path', { d: 'M3 10h18' }],
  ],
  url: [
    ['path', { d: 'M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71' }],
    ['path', { d: 'M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71' }],
  ],
  location: [
    ['path', { d: 'M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z' }],
    ['circle', { cx: '12', cy: '10', r: '3' }],
  ],
  select: [
    ['circle', { cx: '12', cy: '12', r: '10' }],
    ['path', { d: 'm16 10-4 4-4-4' }],
  ],
  multiSelect: [
    ['line', { x1: '8', y1: '6', x2: '21', y2: '6' }],
    ['line', { x1: '8', y1: '12', x2: '21', y2: '12' }],
    ['line', { x1: '8', y1: '18', x2: '21', y2: '18' }],
    ['line', { x1: '3', y1: '6', x2: '3.01', y2: '6' }],
    ['line', { x1: '3', y1: '12', x2: '3.01', y2: '12' }],
    ['line', { x1: '3', y1: '18', x2: '3.01', y2: '18' }],
  ],
  attachment: [
    [
      'path',
      {
        d: 'm21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48',
      },
    ],
  ],
};

export function createFieldTypeIcon(type: Field['type']): HTMLElement {
  return buildIcon(FIELD_TYPE_ICONS[type], 'loom-field-type-icon');
}

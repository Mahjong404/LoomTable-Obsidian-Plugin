import { describe, expect, it } from 'vitest';

const tileVisibilityStyles = `
.leaflet-tile {
  visibility: hidden;
}

.leaflet-tile-loaded {
  visibility: visible !important;
}`;

describe('Leaflet tile visibility CSS', () => {
  it('makes a loaded tile visible with the shipped Leaflet visibility rule', () => {
    const parsedDocument = new DOMParser().parseFromString(
      `<style>${tileVisibilityStyles}</style>`,
      'text/html',
    );
    const style = parsedDocument.head.firstElementChild;
    if (!(style instanceof HTMLStyleElement)) {
      throw new Error('Expected a parsed stylesheet element');
    }
    document.head.append(style);

    const image = document.createElement('img');
    image.className = 'leaflet-tile';
    document.body.append(image);

    expect(getComputedStyle(image).visibility).toBe('hidden');
    image.classList.add('leaflet-tile-loaded');
    expect(getComputedStyle(image).visibility).toBe('visible');
  });
});

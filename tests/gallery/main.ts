// Development-only Gallery entry. Bundled by scripts/build-gallery.mjs into
// tests/gallery/bundle.js — never part of the production plugin build.
import { galleryScenarios, type GalleryMountResult } from './scenarios';

const navElement = document.getElementById('gallery-nav');
const hostElement = document.getElementById('gallery-host');
if (navElement === null || hostElement === null) {
  throw new Error('The Gallery shell is missing.');
}
const nav = navElement;
const host = hostElement;

let activeDispose: (() => void) | null = null;
let activeButton: HTMLButtonElement | null = null;

async function show(id: string): Promise<void> {
  const scenario = galleryScenarios.find((candidate) => candidate.id === id);
  if (scenario === undefined) return;
  activeDispose?.();
  activeDispose = null;
  host.replaceChildren();
  const result = await scenario.mount(host);
  activeDispose =
    result !== undefined && result !== null && 'dispose' in result
      ? (result.dispose ?? null)
      : null;
  if (window.location.hash !== `#${id}`) window.location.hash = id;
}

const sections = new Map<string, HTMLElement>();
for (const scenario of galleryScenarios) {
  let section = sections.get(scenario.section);
  if (section === undefined) {
    section = document.createElement('section');
    section.className = 'loom-gallery-nav-section';
    const title = document.createElement('h3');
    title.textContent = scenario.section;
    section.append(title);
    sections.set(scenario.section, section);
    nav.append(section);
  }
  const item = document.createElement('button');
  item.type = 'button';
  item.className = 'loom-gallery-nav-item';
  item.textContent = scenario.title;
  item.dataset.scenario = scenario.id;
  item.addEventListener('click', () => {
    activeButton?.removeAttribute('aria-current');
    activeButton = item;
    item.setAttribute('aria-current', 'true');
    void show(scenario.id);
  });
  section.append(item);
}

const initial = window.location.hash.slice(1);
void show(
  galleryScenarios.some((scenario) => scenario.id === initial) ? initial : galleryScenarios[0]!.id,
);

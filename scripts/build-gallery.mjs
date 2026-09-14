// Bundles the development Gallery into tests/gallery/bundle.js. The output is
// gitignored and never referenced by the production plugin entry (src/main.ts).
import { build } from 'esbuild';

await build({
  entryPoints: ['tests/gallery/main.ts'],
  bundle: true,
  format: 'iife',
  logLevel: 'info',
  outfile: 'tests/gallery/bundle.js',
  platform: 'browser',
  sourcemap: 'inline',
  target: 'es2022',
});

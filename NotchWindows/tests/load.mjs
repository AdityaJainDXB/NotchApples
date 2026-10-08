// Loads one of the app's ES modules into Node for testing without a package.json or a bundler.
// (The app's files are plain browser modules; this reads the source and imports it from a data: URL.
// It only works for modules with no imports of their own, which is what the logic files are.)
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));

export async function loadModule(relativeToSrcJs) {
  const source = readFileSync(resolve(here, '../src/js', relativeToSrcJs), 'utf8');
  return import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
}

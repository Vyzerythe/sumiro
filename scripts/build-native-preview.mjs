import { copyFile, mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compileReconstructedSource } from './compile-reconstructed-source.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const output = join(root, '.local-build-source');
const files = compileReconstructedSource(root, output);
for (const [path, contents] of files) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, contents);
}
await copyFile(join(root, 'src', 'application', 'index.html'), join(output, 'index.html'));
console.log(`Built ${output}. Serve the repository root and open /.local-build-source/.`);

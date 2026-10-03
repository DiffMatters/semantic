import { readFileSync } from 'node:fs';
import { defineConfig } from 'tsup';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string };

export default defineConfig({
  entry: ['src/main.ts'],
  format: ['esm'],
  target: 'node22',
  platform: 'node',
  clean: true,
  // Inline core and its deps so the built bin runs standalone (npx, CI images).
  noExternal: [/.*/],
  banner: {
    js: "#!/usr/bin/env node\nimport { createRequire as __cdCreateRequire } from 'node:module';\nconst require = __cdCreateRequire(import.meta.url);",
  },
  define: { __VERSION__: JSON.stringify(pkg.version) },
});

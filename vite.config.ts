import { existsSync } from 'node:fs';
import { dirname, join, normalize, relative, resolve } from 'node:path';
import { defineConfig } from 'vite';
import dts from 'unplugin-dts/vite';

const ROOT = import.meta.dirname;
const SRC_ROOT = resolve(ROOT, 'src');
const OUT_ROOT = resolve(ROOT, 'dist');

const WEBGPU_REFERENCE = '/// <reference types="@webgpu/types" />';

/**
 * Public entry declarations that must carry the WebGPU ambient type reference.
 * A consumer may import any single subpath on its own, so every entry declares
 * the (required) `@webgpu/types` peer instead of relying on the consumer's
 * `tsconfig` `types`.
 */
const PUBLIC_ENTRY_DTS = new Set(
  [
    'index.d.ts',
    'engines/index.d.ts',
    'engines/anime4k/index.d.ts',
    'engines/anime4k/catalog.d.ts',
  ].map((rel) => normalize(join(OUT_ROOT, rel))),
);

/** Keep the `@webgpu/types` reference as the first line of a public entry. */
function addWebgpuReference(content: string, outFile: string): string {
  if (!PUBLIC_ENTRY_DTS.has(normalize(outFile))) return content;
  const reference = `${WEBGPU_REFERENCE}\n`;
  return content.startsWith(reference) ? content : `${reference}${content}`;
}

/**
 * Rewrite extensionless relative specifiers in emitted declarations to explicit
 * `.js`. `unplugin-dts` preserves the source specifiers, but Node16/NodeNext
 * consumers require extensions in ESM declaration imports (TS2834).
 *
 * Type-only modules are still resolvable without a runtime counterpart: a
 * `./types.js` specifier in a `.d.ts` resolves to the sibling `types.d.ts`, so
 * no stub `.js` files are emitted.
 */
function outFileToSrcFile(outFile: string): string {
  const rel = relative(OUT_ROOT, outFile).replace(/\.d\.ts$/, '.ts');
  return join(SRC_ROOT, rel);
}

function rewriteDtsSpecifiers(content: string, outFile: string): string {
  const srcFile = outFileToSrcFile(outFile);
  return content.replace(
    /(\bfrom\s+|\bimport\s*\(\s*)(['"])(\.\.?\/[^'"]+)\2/g,
    (whole, lead: string, quote: string, spec: string) => {
      if (spec.endsWith('.js') || spec.endsWith('.json')) return whole;
      if (spec.endsWith('.wgsl')) return `${lead}${quote}${spec}.js${quote}`;
      const base = resolve(dirname(srcFile), spec);
      if (existsSync(`${base}.ts`) || existsSync(`${base}.tsx`)) {
        return `${lead}${quote}${spec}.js${quote}`;
      }
      if (existsSync(join(base, 'index.ts'))) {
        return `${lead}${quote}${spec}/index.js${quote}`;
      }
      return whole;
    },
  );
}

export default defineConfig({
  build: {
    target: 'esnext',
    minify: false,
    sourcemap: false,
    outDir: 'dist',
    emptyOutDir: true,
    copyPublicDir: false,
    lib: {
      entry: {
        index: resolve(ROOT, 'src/index.ts'),
        'engines/index': resolve(ROOT, 'src/engines/index.ts'),
        'engines/anime4k/index': resolve(ROOT, 'src/engines/anime4k/index.ts'),
      },
      formats: ['es'],
    },
    rolldownOptions: {
      moduleTypes: { '.wgsl': 'text' },
      output: {
        preserveModules: true,
        preserveModulesRoot: 'src',
        exports: 'named',
      },
    },
  },
  plugins: [
    dts({
      entryRoot: 'src',
      outDirs: 'dist',
      beforeWriteFile(filePath: string, content: string) {
        return { content: addWebgpuReference(rewriteDtsSpecifiers(content, filePath), filePath) };
      },
    }),
  ],
});

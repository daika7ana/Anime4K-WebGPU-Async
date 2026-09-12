#!/usr/bin/env node
/**
 * Packaging verification harness for the ESM-only v3 build.
 *
 * Run from the repo root after `pnpm run build`:
 *   node scripts/check-packaging.cjs
 *
 * Checks:
 *   1. runtime self-reference `import()` through the real `exports` map
 *      (`anime4k-webgpu-async`, `/engines`, `/engines/anime4k`,
 *      `/engines/anime4k/catalog`);
 *   2. packaging invariants (`type: "module"`, `sideEffects: false`, no nested
 *      `dist/package.json`, exact `exports` keys);
 *   3. every catalog effect compiles through `createAnime4kBackend()` (proving
 *      the lazy per-effect loader/chunk paths resolve);
 *   4. shader parity: every captured `createShaderModule({ code })` equals the
 *      content of a `src/**\/*.wgsl` source file;
 *   5. specifier integrity over `dist/**\/*.js` and `dist/**\/*.d.ts` (`.js`-
 *      suffixed relative specifiers, `.wgsl.js` shader modules) plus "no
 *      `__awaiter` anywhere in `dist`".
 *
 * Exits 0 and prints `PASS` when everything holds, otherwise exits 1 with a
 * per-section diff. No new dependencies; plain CommonJS (v3 is ESM-only, so
 * this harness must be `.cjs`).
 */
'use strict';

/* -------------------------------------------------------------------------- *
 * GPU enum globals (constructors reference these as free variables).
 * -------------------------------------------------------------------------- */
globalThis.GPUTextureUsage = {
  TEXTURE_BINDING: 1,
  COPY_DST: 2,
  RENDER_ATTACHMENT: 4,
  STORAGE_BINDING: 8,
  COPY_SRC: 16,
};
globalThis.GPUShaderStage = { VERTEX: 1, FRAGMENT: 2, COMPUTE: 4 };
globalThis.GPUBufferUsage = {
  UNIFORM: 1,
  STORAGE: 2,
  COPY_DST: 4,
  COPY_SRC: 8,
  MAP_READ: 16,
  MAP_WRITE: 32,
};

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const PKG = require(path.join(ROOT, 'package.json'));
const PKG_NAME = PKG.name;

const failures = [];
const state = { shaderCaptures: [] };

function fail(section, detail) {
  failures.push({ section, detail });
}

function check(section, condition, detail) {
  if (!condition) fail(section, detail);
}

function errorText(err) {
  if (!err) return String(err);
  return err.stack || `${err.name || 'Error'}: ${err.message || err}`;
}

function walkFiles(dir, predicate, out = []) {
  if (!fs.existsSync(dir)) return out;
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  entries.forEach((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walkFiles(full, predicate, out);
    else if (entry.isFile() && predicate(full)) out.push(full);
  });
  return out;
}

/* -------------------------------------------------------------------------- *
 * 1) Runtime self-reference resolution.
 * -------------------------------------------------------------------------- */
const ROOT_EXPORTS = [
  'createBackendRegistry',
  'createAnime4kBackend',
  'ComposedPipeline',
  'ANIME4K_PRESET_MODES',
];
const ANIME4K_EXPORTS = [
  'createAnime4kBackend',
  'ANIME4K_PRESET_MODES',
  'resolveAnime4kPresetRefs',
  'anime4kEffectDescriptors',
];
const CATALOG_EXPORTS = ['anime4kEffectDescriptors'];

async function checkRuntimeResolution() {
  const subpaths = [
    { specifier: PKG_NAME, expected: ROOT_EXPORTS },
    { specifier: `${PKG_NAME}/engines`, expected: ROOT_EXPORTS },
    { specifier: `${PKG_NAME}/engines/anime4k`, expected: ANIME4K_EXPORTS },
    { specifier: `${PKG_NAME}/engines/anime4k/catalog`, expected: CATALOG_EXPORTS },
  ];

  for (let i = 0; i < subpaths.length; i += 1) {
    const { specifier, expected } = subpaths[i];
    try {
      // eslint-disable-next-line no-await-in-loop
      const mod = await import(specifier);
      expected.forEach((key) => {
        check(`runtime import("${specifier}") exports`, mod[key] !== undefined, `missing "${key}"`);
      });
    } catch (err) {
      fail(`runtime import("${specifier}")`, errorText(err));
    }
  }

  // The dependency-free catalog subpath must expose the same descriptors as the
  // root (`id` + `key`, in order), so it can replace a root import without
  // pulling in the backend or effect constructors.
  try {
    const [rootMod, catalogMod] = await Promise.all([
      import(PKG_NAME),
      import(`${PKG_NAME}/engines/anime4k/catalog`),
    ]);
    const rootDescriptors = rootMod.anime4kEffectDescriptors;
    const catalogDescriptors = catalogMod.anime4kEffectDescriptors;
    check(
      `runtime import("${PKG_NAME}/engines/anime4k/catalog") descriptors`,
      Array.isArray(catalogDescriptors) && catalogDescriptors.length === 15,
      `expected 15 descriptors, got ${
        Array.isArray(catalogDescriptors) ? catalogDescriptors.length : typeof catalogDescriptors
      }`,
    );
    const idsOf = (list) => (Array.isArray(list) ? list.map((descriptor) => descriptor.id) : []);
    const keysOf = (list) => (Array.isArray(list) ? list.map((descriptor) => descriptor.key) : []);
    const sameIds =
      JSON.stringify(idsOf(rootDescriptors)) === JSON.stringify(idsOf(catalogDescriptors));
    const sameKeys =
      JSON.stringify(keysOf(rootDescriptors)) === JSON.stringify(keysOf(catalogDescriptors));
    check(
      'catalog subpath descriptors match root',
      sameIds && sameKeys,
      `id lists match=${sameIds}, key lists match=${sameKeys}`,
    );
  } catch (err) {
    fail('runtime import(".../engines/anime4k/catalog") comparison', errorText(err));
  }
}

/* -------------------------------------------------------------------------- *
 * 2) Packaging invariants.
 * -------------------------------------------------------------------------- */
const EXPECTED_EXPORT_KEYS = [
  '.',
  './engines',
  './engines/anime4k',
  './engines/anime4k/catalog',
  './package.json',
];

const WEBGPU_REFERENCE = '/// <reference types="@webgpu/types" />';

/** Public entry declarations, each of which must carry the WebGPU reference. */
const PUBLIC_ENTRY_DTS = [
  'dist/index.d.ts',
  'dist/engines/index.d.ts',
  'dist/engines/anime4k/index.d.ts',
  'dist/engines/anime4k/catalog.d.ts',
];

function checkPackagingInvariants() {
  check(
    'package.json type',
    PKG.type === 'module',
    `expected "module", got ${JSON.stringify(PKG.type)}`,
  );
  check(
    'package.json sideEffects',
    PKG.sideEffects === false,
    `expected false, got ${JSON.stringify(PKG.sideEffects)}`,
  );
  check(
    'package.json main',
    PKG.main === 'dist/index.js',
    `expected "dist/index.js", got ${JSON.stringify(PKG.main)}`,
  );

  const exportKeys = Object.keys(PKG.exports || {});
  const actual = [...exportKeys].sort();
  const expected = [...EXPECTED_EXPORT_KEYS].sort();
  const onlyActual = actual.filter((key) => !expected.includes(key));
  const onlyExpected = expected.filter((key) => !actual.includes(key));
  if (onlyActual.length > 0 || onlyExpected.length > 0) {
    fail(
      'package.json exports keys',
      `unexpected: [${onlyActual.join(', ')}] missing: [${onlyExpected.join(', ')}]`,
    );
  }

  // A nested package.json inside dist/ would shadow `sideEffects`/`type`.
  const distDir = path.join(ROOT, 'dist');
  const nestedPkgs = walkFiles(distDir, (file) => path.basename(file) === 'package.json');
  check(
    'no nested dist/package.json',
    nestedPkgs.length === 0,
    `found: [${nestedPkgs.map((file) => path.relative(ROOT, file)).join(', ')}]`,
  );

  // v3 emits directly into dist/ (no second ESM subtree) and drops legacy
  // CDN/typeVersions fields.
  check(
    'no dist/esm directory',
    !fs.existsSync(path.join(distDir, 'esm')),
    'dist/esm exists (v3 emits directly into dist/)',
  );
  check(
    'package.json no typesVersions',
    PKG.typesVersions === undefined,
    `expected undefined, got ${JSON.stringify(PKG.typesVersions)}`,
  );
  check(
    'package.json no unpkg',
    PKG.unpkg === undefined,
    `expected undefined, got ${JSON.stringify(PKG.unpkg)}`,
  );
  check(
    'package.json no jsdelivr',
    PKG.jsdelivr === undefined,
    `expected undefined, got ${JSON.stringify(PKG.jsdelivr)}`,
  );

  // Every public entry declaration must load the WebGPU ambient types itself,
  // because a consumer may import only one subpath.
  PUBLIC_ENTRY_DTS.forEach((relativePath) => {
    const entry = path.join(ROOT, relativePath);
    if (!fs.existsSync(entry)) {
      fail('public entry declaration reference', `missing ${relativePath}`);
      return;
    }
    const firstLine = fs.readFileSync(entry, 'utf8').split(/\r?\n/, 1)[0];
    check(
      'public entry declaration reference',
      firstLine === WEBGPU_REFERENCE,
      `${relativePath} first line is ${JSON.stringify(firstLine)}`,
    );
  });

  // `@webgpu/types` must stay a required (non-optional) peer dependency.
  const webgpuPeerMeta = PKG.peerDependenciesMeta && PKG.peerDependenciesMeta['@webgpu/types'];
  check(
    'peerDependencies @webgpu/types required',
    PKG.peerDependencies !== undefined &&
      PKG.peerDependencies['@webgpu/types'] !== undefined &&
      !(webgpuPeerMeta && webgpuPeerMeta.optional === true),
    `peerDependencies=${JSON.stringify(PKG.peerDependencies)} ` +
      `peerDependenciesMeta=${JSON.stringify(PKG.peerDependenciesMeta)}`,
  );
}

/* -------------------------------------------------------------------------- *
 * 3+4) Catalog compilation and shader parity.
 * -------------------------------------------------------------------------- */
function makeCompileDevice(captures) {
  return {
    createTexture(desc = {}) {
      const size = Array.isArray(desc.size) ? desc.size : [0, 0, 1];
      return {
        label: desc.label,
        width: size[0],
        height: size[1],
        createView() {
          return {};
        },
      };
    },
    createShaderModule(desc = {}) {
      captures.push({ label: desc.label, code: desc.code });
      return {};
    },
    createComputePipelineAsync() {
      return Promise.resolve({});
    },
    createRenderPipelineAsync() {
      return Promise.resolve({});
    },
    createBindGroupLayout() {
      return {};
    },
    createPipelineLayout() {
      return {};
    },
    createBindGroup() {
      return {};
    },
    createSampler() {
      return {};
    },
    createBuffer() {
      return {};
    },
    queue: {
      writeBuffer() {},
      submit() {},
      onSubmittedWorkDone() {
        return Promise.resolve();
      },
    },
  };
}

function makeCompileContext(device) {
  const dims = { width: 64, height: 64 };
  return {
    device,
    inputTexture: {
      label: 'input texture',
      width: dims.width,
      height: dims.height,
      createView() {
        return {};
      },
    },
    sourceDimensions: { ...dims },
    currentDimensions: { ...dims },
    targetDimensions: { width: 128, height: 128 },
  };
}

async function checkCatalogCompilation() {
  const descriptorPath = path.join(ROOT, 'dist', 'engines', 'anime4k', 'index.js');
  let anime4k;
  try {
    anime4k = await import(`${pathToUrl(descriptorPath)}`);
  } catch (err) {
    fail('catalog compilation', `cannot import dist/engines/anime4k/index.js: ${errorText(err)}`);
    return;
  }

  const { createAnime4kBackend, anime4kEffectDescriptors } = anime4k;
  if (typeof createAnime4kBackend !== 'function' || !Array.isArray(anime4kEffectDescriptors)) {
    fail('catalog compilation', 'createAnime4kBackend/anime4kEffectDescriptors unavailable');
    return;
  }

  const backend = createAnime4kBackend();
  const captures = [];
  const device = makeCompileDevice(captures);
  const compiled = [];

  for (let i = 0; i < anime4kEffectDescriptors.length; i += 1) {
    const descriptor = anime4kEffectDescriptors[i];
    const ref = { id: descriptor.id, backendId: descriptor.backendId, key: descriptor.key };
    try {
      const context = makeCompileContext(device);
      // eslint-disable-next-line no-await-in-loop
      const node = await backend.compileEffect(ref, context);
      const pipeline = node && node.pipeline;
      if (!pipeline || typeof pipeline.getOutputTexture !== 'function') {
        fail('catalog compilation', `${descriptor.key}: compileEffect returned no pipeline`);
      } else {
        // Two-stage effects (e.g. ClampHighlights) keep their second stage
        // lazily constructed; materialize it so its shaders are captured by the
        // shader-parity check below.
        if (typeof pipeline.getDeferredPipeline === 'function') {
          const deferred = pipeline.getDeferredPipeline(context.inputTexture);
          if (!deferred || typeof deferred.getOutputTexture !== 'function') {
            fail(
              'catalog compilation',
              `${descriptor.key}: getDeferredPipeline returned no pipeline`,
            );
          }
        }
        compiled.push(descriptor.key);
      }
    } catch (err) {
      fail('catalog compilation', `${descriptor.key}: ${errorText(err)}`);
    }
  }

  check(
    'catalog compilation',
    compiled.length === anime4kEffectDescriptors.length,
    `compiled ${compiled.length}/${anime4kEffectDescriptors.length} effect(s)`,
  );
  console.log(
    `  catalog compilation: ${compiled.length}/${anime4kEffectDescriptors.length} effects compiled`,
  );

  // `Downscale` is not a catalog effect (it backs the auto-downscale preset
  // node), so the sweep above never constructs it. Construct it directly so
  // its shader is captured and covered by the shader-parity assertion.
  const downscalePath = path.join(ROOT, 'dist', 'pipelines', 'helpers', 'Downscale', 'index.js');
  try {
    const { Downscale } = await import(`${pathToUrl(downscalePath)}`);
    if (typeof Downscale !== 'function') {
      fail('shader parity', 'dist Downscale module does not export a Downscale class');
    } else {
      const context = makeCompileContext(device);
      new Downscale({
        device,
        inputTexture: context.inputTexture,
        targetDimensions: { width: 32, height: 32 },
      });
    }
  } catch (err) {
    fail('shader parity', `cannot construct Downscale from dist: ${errorText(err)}`);
  }

  state.shaderCaptures = captures;
}

/** Turn an absolute path into a file:// URL for dynamic import. */
function pathToUrl(filePath) {
  const { pathToFileURL } = require('url');
  return pathToFileURL(filePath).href;
}

function checkShaderParity() {
  const sourceRoot = path.join(ROOT, 'src');
  const wgslFiles = walkFiles(sourceRoot, (file) => file.endsWith('.wgsl'));
  const sourceByContent = new Map();
  wgslFiles.forEach((file) => {
    const content = fs.readFileSync(file, 'utf8');
    if (!sourceByContent.has(content)) sourceByContent.set(content, file);
  });

  const captures = state.shaderCaptures;
  if (captures.length === 0) {
    fail('shader parity', 'no shader modules were captured (catalog compilation failed?)');
    return;
  }

  const unmatched = [];
  const seen = new Set();
  captures.forEach((capture) => {
    const key = capture.code;
    if (sourceByContent.has(key)) {
      seen.add(key);
      return;
    }
    unmatched.push(capture);
  });

  if (unmatched.length > 0) {
    const labels = unmatched
      .slice(0, 5)
      .map((capture) => capture.label || '<unlabeled>')
      .join(', ');
    fail(
      'shader parity',
      `${unmatched.length}/${captures.length} captured shader(s) do not match any ` +
        `src/**/*.wgsl content (first: ${labels})`,
    );
    return;
  }
  console.log(
    `  shader parity: ${captures.length} capture(s) matched ` +
      `${seen.size} distinct source shader(s) of ${wgslFiles.length}`,
  );
}

/* -------------------------------------------------------------------------- *
 * 5) Specifier integrity + no __awaiter.
 * -------------------------------------------------------------------------- */
function extractSpecifiers(source) {
  const patterns = [
    /\bfrom\s*["']([^"']+)["']/g, // import/export ... from '...'
    /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g, // dynamic import('...')
    /\bimport\s+["']([^"']+)["']/g, // side-effect import '...'
  ];
  const specifiers = new Set();
  patterns.forEach((pattern) => {
    let match = pattern.exec(source);
    while (match) {
      specifiers.add(match[1]);
      match = pattern.exec(source);
    }
  });
  return [...specifiers];
}

function resolvesRelative(file, specifier) {
  const base = path.resolve(path.dirname(file), specifier);
  const candidates = [base, `${base}.js`, path.join(base, 'index.js')];
  if (file.endsWith('.d.ts')) {
    // Declaration-only modules (type-only files, tree-shaken barrels) have no
    // emitted runtime counterpart; a `./x.js` specifier resolves to `x.d.ts`.
    const dtsBase = base.replace(/\.js$/, '');
    candidates.push(`${dtsBase}.d.ts`, path.join(dtsBase, 'index.d.ts'));
  }
  return candidates.some(
    (candidate) => fs.existsSync(candidate) && fs.statSync(candidate).isFile(),
  );
}

function checkSpecifierIntegrity() {
  const distDir = path.join(ROOT, 'dist');
  if (!fs.existsSync(distDir)) {
    fail('specifier integrity', `missing ${path.relative(ROOT, distDir)}`);
    return;
  }

  const modules = walkFiles(distDir, (file) => file.endsWith('.js') || file.endsWith('.d.ts'));

  let relativeCount = 0;
  modules.forEach((file) => {
    const source = fs.readFileSync(file, 'utf8');
    extractSpecifiers(source).forEach((specifier) => {
      const where = path.relative(ROOT, file);
      if (specifier.endsWith('.wgsl')) {
        fail('specifier integrity', `${where} -> "${specifier}" (must be ".wgsl.js")`);
        return;
      }
      if (!specifier.startsWith('./') && !specifier.startsWith('../')) return;
      relativeCount += 1;
      if (!specifier.endsWith('.js')) {
        fail('specifier integrity', `${where} -> "${specifier}" is not ".js"-suffixed`);
      }
      if (!resolvesRelative(file, specifier)) {
        fail('specifier integrity', `${where} -> "${specifier}" does not resolve`);
      }
    });
  });

  // No downlevel __awaiter helper anywhere in the emitted output.
  const allFiles = walkFiles(distDir, () => true);
  const withAwaiter = allFiles.filter((file) => {
    try {
      return fs.readFileSync(file, 'utf8').includes('__awaiter');
    } catch {
      return false;
    }
  });
  check(
    'no __awaiter in dist',
    withAwaiter.length === 0,
    `found: [${withAwaiter.map((file) => path.relative(ROOT, file)).join(', ')}]`,
  );

  console.log(
    `  specifier integrity: ${modules.length} module(s)/declaration(s), ` +
      `${relativeCount} relative specifier(s), ${allFiles.length} file(s) scanned for __awaiter`,
  );
}

/* -------------------------------------------------------------------------- *
 * Main.
 * -------------------------------------------------------------------------- */
async function main() {
  const sections = [
    ['runtime self-reference resolution', checkRuntimeResolution],
    [
      'packaging invariants',
      () => {
        checkPackagingInvariants();
      },
    ],
    ['catalog compilation', checkCatalogCompilation],
    [
      'shader parity',
      () => {
        checkShaderParity();
      },
    ],
    [
      'specifier integrity',
      () => {
        checkSpecifierIntegrity();
      },
    ],
  ];

  for (let i = 0; i < sections.length; i += 1) {
    const [label, run] = sections[i];
    console.log(`- ${label}`);
    try {
      // eslint-disable-next-line no-await-in-loop
      await run();
    } catch (err) {
      fail(label, `unexpected harness error: ${errorText(err)}`);
    }
  }

  if (failures.length === 0) {
    console.log('PASS: packaging and ESM-graph checks succeeded.');
    process.exitCode = 0;
    return;
  }

  console.error(`\nFAIL: ${failures.length} packaging check failure(s).`);
  failures.forEach((entry) => {
    console.error(`\n  [${entry.section}]`);
    console.error(`    ${String(entry.detail).replace(/\n/g, '\n    ')}`);
  });
  process.exitCode = 1;
}

main().catch((err) => {
  console.error('FAIL: packaging harness crashed unexpectedly.');
  console.error(err && err.stack ? err.stack : err);
  process.exitCode = 1;
});

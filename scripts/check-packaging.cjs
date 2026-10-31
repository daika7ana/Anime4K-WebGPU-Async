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
 *   5. execution-graph order: for every exported pipeline class (leaves,
 *      presets, composed engine) every texture read through a bind group was
 *      produced earlier in `getExecutionOrder()` or is the input texture;
 *   6. specifier integrity over `dist/**\/*.js` and `dist/**\/*.d.ts` (`.js`-
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
  let nextResourceId = 0;
  const allocResourceId = () => {
    nextResourceId += 1;
    return nextResourceId;
  };

  return {
    /** Shared identity allocator for the mock graph input texture (internal). */
    __allocResourceId: allocResourceId,
    createTexture(desc = {}) {
      const size = Array.isArray(desc.size) ? desc.size : [0, 0, 1];
      const resourceId = allocResourceId();
      return {
        label: desc.label,
        width: size[0],
        height: size[1],
        __resourceId: resourceId,
        createView() {
          return { __resourceId: resourceId };
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
    createBindGroupLayout(desc = {}) {
      return { __layoutEntries: Array.isArray(desc.entries) ? desc.entries : [] };
    },
    createPipelineLayout() {
      return {};
    },
    createBindGroup(desc = {}) {
      // Classify each binding from the layout: a `storageTexture` entry is a
      // write, a `texture` entry is a read. Samplers carry no texture identity.
      const layoutEntries =
        desc.layout && Array.isArray(desc.layout.__layoutEntries)
          ? desc.layout.__layoutEntries
          : [];
      const record = { label: desc.label, reads: [], writes: [] };
      (Array.isArray(desc.entries) ? desc.entries : []).forEach((entry) => {
        const resource = entry && entry.resource;
        if (!resource || resource.__resourceId === undefined) return;
        const layoutEntry = layoutEntries.find((candidate) => candidate.binding === entry.binding);
        if (layoutEntry && layoutEntry.storageTexture) record.writes.push(resource.__resourceId);
        else record.reads.push(resource.__resourceId);
      });
      return { __bindResources: record };
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
 * 4b) Pipeline execution-graph order.
 *
 * Every pipeline class (leaf effects, presets, and the composed engine) is
 * built against the mock device above, flattened through `getExecutionOrder()`,
 * and walked in execution order. Every texture a node *reads* (a bind-group
 * entry whose layout slot is a `texture`, not a `storageTexture`) must already
 * have been produced by an earlier node or be the original input texture.
 * This is the check that catches nodes bound to a texture from a later stage
 * (the GANx4UUL ordering bug) which construction/dimension traces cannot see.
 * -------------------------------------------------------------------------- */
const GRAPH_INPUT_DIMENSIONS = { width: 64, height: 64 };
// 3.125x target: exercises both the x2 insertion and the x4 auto-downscale path.
const GRAPH_TARGET_DIMENSIONS = { width: 200, height: 200 };

const GRAPH_PIPELINES = [
  { label: 'restore/CNNM', kind: 'leaf', category: 'restore', file: 'CNNM', ctor: 'CNNM' },
  {
    label: 'restore/CNNSoftM',
    kind: 'leaf',
    category: 'restore',
    file: 'CNNSoftM',
    ctor: 'CNNSoftM',
  },
  { label: 'restore/CNNVL', kind: 'leaf', category: 'restore', file: 'CNNVL', ctor: 'CNNVL' },
  {
    label: 'restore/CNNSoftVL',
    kind: 'leaf',
    category: 'restore',
    file: 'CNNSoftVL',
    ctor: 'CNNSoftVL',
  },
  { label: 'restore/CNNUL', kind: 'leaf', category: 'restore', file: 'CNNUL', ctor: 'CNNUL' },
  { label: 'restore/GANUUL', kind: 'leaf', category: 'restore', file: 'GANUUL', ctor: 'GANUUL' },
  { label: 'upscale/CNNx2M', kind: 'leaf', category: 'upscale', file: 'CNNx2M', ctor: 'CNNx2M' },
  { label: 'upscale/CNNx2VL', kind: 'leaf', category: 'upscale', file: 'CNNx2VL', ctor: 'CNNx2VL' },
  {
    label: 'upscale/DenoiseCNNx2VL',
    kind: 'leaf',
    category: 'upscale',
    file: 'DenoiseCNNx2VL',
    ctor: 'DenoiseCNNx2VL',
  },
  { label: 'upscale/CNNx2UL', kind: 'leaf', category: 'upscale', file: 'CNNx2UL', ctor: 'CNNx2UL' },
  { label: 'upscale/GANx3L', kind: 'leaf', category: 'upscale', file: 'GANx3L', ctor: 'GANx3L' },
  {
    label: 'upscale/GANx4UUL',
    kind: 'leaf',
    category: 'upscale',
    file: 'GANx4UUL',
    ctor: 'GANx4UUL',
  },
  {
    label: 'denoise/BilateralMean',
    kind: 'leaf',
    category: 'denoise',
    file: 'BilateralMean',
    ctor: 'BilateralMean',
  },
  { label: 'deblur/DoG', kind: 'leaf', category: 'deblur', file: 'DoG', ctor: 'DoG' },
  { label: 'ModeA', kind: 'preset', file: 'ModeA', ctor: 'ModeA' },
  { label: 'ModeAA', kind: 'preset', file: 'ModeAA', ctor: 'ModeAA' },
  { label: 'ModeB', kind: 'preset', file: 'ModeB', ctor: 'ModeB' },
  { label: 'ModeBB', kind: 'preset', file: 'ModeBB', ctor: 'ModeBB' },
  { label: 'ModeC', kind: 'preset', file: 'ModeC', ctor: 'ModeC' },
  { label: 'ModeCA', kind: 'preset', file: 'ModeCA', ctor: 'ModeCA' },
  { label: 'ComposedPipeline.fromPreset(A)', kind: 'composed', modeId: 'A' },
  { label: 'ComposedPipeline.fromPreset(C)', kind: 'composed', modeId: 'C' },
];

function distModule(...segments) {
  return import(pathToUrl(path.join(ROOT, 'dist', ...segments)));
}

async function buildGraphPipeline(entry, device, inputTexture) {
  if (entry.kind === 'composed') {
    const root = await distModule('index.js');
    const registry = root.createBackendRegistry();
    registry.register(root.createAnime4kBackend());
    return root.ComposedPipeline.fromPreset({
      device,
      inputTexture,
      nativeDimensions: { ...GRAPH_INPUT_DIMENSIONS },
      targetDimensions: { ...GRAPH_TARGET_DIMENSIONS },
      registry,
      backendId: 'anime4k',
      modeId: entry.modeId,
      tier: 'balanced',
    });
  }

  const directory =
    entry.kind === 'preset'
      ? ['pipelines', 'presets', entry.file]
      : ['pipelines', entry.category, entry.file];
  const mod = await distModule(...directory, 'index.js');
  const Ctor = mod[entry.ctor];
  if (typeof Ctor !== 'function') {
    throw new Error(`dist/${directory.join('/')}/index.js has no "${entry.ctor}" export`);
  }
  const options = { device, inputTexture };
  if (entry.kind === 'preset') {
    options.nativeDimensions = { ...GRAPH_INPUT_DIMENSIONS };
    options.targetDimensions = { ...GRAPH_TARGET_DIMENSIONS };
  }
  return new Ctor(options);
}

function flattenGraphNodes(node, out = []) {
  if (typeof node.getExecutionOrder === 'function') {
    const order = node.getExecutionOrder() || [];
    for (let i = 0; i < order.length; i += 1) flattenGraphNodes(order[i], out);
  } else {
    out.push(node);
  }
  return out;
}

/**
 * Bind-group records owned by a node. The mock `createBindGroup` returns a
 * property bag, so the records are discovered by walking the node's own
 * properties (e.g. `bindGroup`, `bindGroups.downscaleBindGroup`). Depth 2 is
 * enough for one nesting level; `device` is skipped so the mock is not walked.
 */
function collectBindGroupRecords(node) {
  const records = [];
  const seen = new WeakSet();
  const visit = (value, depth) => {
    if (!value || typeof value !== 'object' || depth > 2 || seen.has(value)) return;
    seen.add(value);
    if (value.__bindResources) {
      records.push(value.__bindResources);
      return;
    }
    Object.keys(value).forEach((key) => {
      if (key === 'device') return;
      visit(value[key], depth + 1);
    });
  };
  visit(node, 0);
  return records;
}

function nodeLabel(node) {
  return (
    (node && node.name) || (node && node.constructor && node.constructor.name) || '<anonymous>'
  );
}

/** Walk one pipeline in execution order; return graph violations. */
function inspectPipelineGraph(pipeline, inputTexture) {
  const nodes = flattenGraphNodes(pipeline);
  const produced = new Set([inputTexture.__resourceId]);
  const offending = [];
  let bindingCount = 0;
  let missingCount = 0;

  nodes.forEach((node) => {
    const missing = [];
    collectBindGroupRecords(node).forEach((record) => {
      record.reads.forEach((resourceId) => {
        bindingCount += 1;
        if (!produced.has(resourceId)) {
          missingCount += 1;
          missing.push({ group: record.label, resourceId });
        }
      });
      record.writes.forEach((resourceId) => produced.add(resourceId));
    });
    if (missing.length > 0) offending.push({ node: nodeLabel(node), missing });
    const output = typeof node.getOutputTexture === 'function' ? node.getOutputTexture() : null;
    if (output && output.__resourceId !== undefined) produced.add(output.__resourceId);
  });

  return { nodeCount: nodes.length, bindingCount, missingCount, offending };
}

async function checkPipelineGraphOrder() {
  let pipelinesChecked = 0;
  let nodesChecked = 0;
  let bindingsChecked = 0;

  for (let i = 0; i < GRAPH_PIPELINES.length; i += 1) {
    const entry = GRAPH_PIPELINES[i];
    const device = makeCompileDevice([]);
    const inputTexture = {
      label: 'input texture',
      width: GRAPH_INPUT_DIMENSIONS.width,
      height: GRAPH_INPUT_DIMENSIONS.height,
      __resourceId: device.__allocResourceId(),
      createView() {
        return { __resourceId: inputTexture.__resourceId };
      },
    };

    let pipeline;
    try {
      // eslint-disable-next-line no-await-in-loop
      pipeline = await buildGraphPipeline(entry, device, inputTexture);
    } catch (err) {
      fail('pipeline graph order', `${entry.label}: construction threw: ${errorText(err)}`);
      continue;
    }

    try {
      const result = inspectPipelineGraph(pipeline, inputTexture);
      pipelinesChecked += 1;
      nodesChecked += result.nodeCount;
      bindingsChecked += result.bindingCount;

      if (result.bindingCount === 0) {
        fail(
          'pipeline graph order',
          `${entry.label}: captured no texture bindings (mock attribution is broken?)`,
        );
      }
      if (result.missingCount === 0) continue;

      const details = result.offending.slice(0, 5).map((offence) => {
        const first = offence.missing
          .slice(0, 3)
          .map((item) => `${item.group} -> texture #${item.resourceId}`)
          .join('; ');
        return `node "${offence.node}" reads ${offence.missing.length} unwritten binding(s): ${first}`;
      });
      const extra = result.offending.length > details.length ? ' ...' : '';
      fail(
        'pipeline graph order',
        `${entry.label}: ${result.offending.length} node(s) read ${result.missingCount} ` +
          `texture binding(s) not produced earlier\n${details.join('\n')}${extra}`,
      );
    } catch (err) {
      fail('pipeline graph order', `${entry.label}: graph walk threw: ${errorText(err)}`);
    }
  }

  console.log(
    `  pipeline graph order: ${pipelinesChecked}/${GRAPH_PIPELINES.length} pipeline(s), ` +
      `${nodesChecked} node(s), ${bindingsChecked} read binding(s) checked`,
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
    ['pipeline graph order', checkPipelineGraphOrder],
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

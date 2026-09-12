#!/usr/bin/env node
/**
 * WS-C: standalone Node parity harness for the engine composer.
 *
 * Compares the legacy preset classes (`ModeA`..`ModeCA`) against the engine
 * composer (`ComposedPipeline.fromPreset`) across a ratio matrix that covers
 * the conditional-x2 and auto-downscale decision boundaries (including the
 * deliberate no-op gap for target/native ratios in [2.0x, 2.4x]).
 *
 * For every (mode, native, target) cell:
 *   1. build the legacy preset and record its device construction calls;
 *   2. build the composed pipeline and record its device construction calls;
 *   3. compare construction traces (op + numeric args + labels);
 *   4. compare the flattened execution order ({width,height,isCompute});
 *   5. compare final output dimensions;
 *   6. compare the `recordPipelineList` pass/dispatch trace;
 *   7. assert neither side throws on an unknown `updateParam`.
 *
 * The v3 library is ESM-only, so this harness is `.cjs` and loads the built
 * graph with a dynamic `import()`.
 *
 * Run after `pnpm run build`:
 *   node scripts/check-preset-parity.cjs
 *
 * Exits 0 and prints `PASS` when every cell matches, otherwise exits 1 and
 * prints a per-cell diff. No new dependencies; plain CommonJS.
 */
'use strict';

/* -------------------------------------------------------------------------- *
 * GPU enum globals. Constructors reference these as free variables, so they
 * must exist on `globalThis` before the ESM graph is imported. Values only
 * need to be distinct; the mocks never interpret the bit flags.
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

const path = require('path');
const { pathToFileURL } = require('url');

/* -------------------------------------------------------------------------- *
 * Frozen public API expected from the built ESM graph. The graph is loaded in
 * `main()` (ESM-only in v3).
 * -------------------------------------------------------------------------- */
const REQUIRED_EXPORTS = [
  'ModeA',
  'ModeAA',
  'ModeB',
  'ModeBB',
  'ModeC',
  'ModeCA',
  'createBackendRegistry',
  'createAnime4kBackend',
  'ComposedPipeline',
  'ANIME4K_PRESET_MODES',
  'resolveAnime4kPresetRefs',
  'recordPipelineList',
];

let bundle = null;

/** Acquire the built ESM bundle. */
async function loadBundle() {
  const esmPath = path.resolve('dist/index.js');
  return import(pathToFileURL(esmPath).href);
}

function assertRequiredExports(bundle) {
  const missing = REQUIRED_EXPORTS.filter((name) => bundle[name] === undefined);
  if (missing.length > 0) {
    throw new Error(`bundle is missing export(s): ${missing.join(', ')}`);
  }
}

/* -------------------------------------------------------------------------- *
 * Resource identity. A per-side monotonic counter gives every created GPU
 * resource a stable identity so bind groups can be compared by *what* they
 * bind, not by labels (which repeat across effects). Views inherit their
 * parent texture's identity, because the F2 tail-threading bug binds the wrong
 * texture, not merely a different view object.
 * -------------------------------------------------------------------------- */
function makeResourceIds() {
  let nextId = 0;
  return {
    next() {
      nextId += 1;
      return nextId;
    },
  };
}

/* -------------------------------------------------------------------------- *
 * Mock GPU device / encoder. Every creation call is appended (in order) to the
 * trace array supplied by the caller. `bindTrace` (optional) additionally
 * records the resource identity bound at every `createBindGroup` entry.
 * -------------------------------------------------------------------------- */
function makeMockDevice(trace, ids = makeResourceIds(), bindTrace = null) {
  const log = (entry) => trace.push(entry);

  return {
    createTexture(desc = {}) {
      const size = Array.isArray(desc.size) ? desc.size : [0, 0, 1];
      const width = size[0];
      const height = size[1];
      const resourceId = ids.next();
      log({
        op: 'createTexture',
        label: desc.label,
        width,
        height,
      });
      return {
        label: desc.label,
        width,
        height,
        __resourceId: resourceId,
        createView() {
          return { __resourceId: resourceId, __resourceKind: 'texture' };
        },
      };
    },
    createShaderModule(desc = {}) {
      log({ op: 'createShaderModule', label: desc.label });
      return {};
    },
    createComputePipelineAsync(desc = {}) {
      log({ op: 'createComputePipelineAsync', label: desc.label });
      return Promise.resolve({});
    },
    createRenderPipelineAsync(desc = {}) {
      log({ op: 'createRenderPipelineAsync', label: desc.label });
      return Promise.resolve({});
    },
    createBindGroupLayout(desc = {}) {
      log({ op: 'createBindGroupLayout', label: desc.label });
      return {};
    },
    createPipelineLayout(desc = {}) {
      log({ op: 'createPipelineLayout', label: desc.label });
      return {};
    },
    createBindGroup(desc = {}) {
      log({ op: 'createBindGroup', label: desc.label });
      if (bindTrace) {
        const entries = Array.isArray(desc.entries) ? desc.entries : [];
        const args = [];
        entries.forEach((entry) => {
          const resource = entry && entry.resource;
          const resourceId =
            resource && resource.__resourceId !== undefined ? resource.__resourceId : null;
          args.push(entry ? entry.binding : null, resourceId);
        });
        bindTrace.push({ op: 'createBindGroup', label: desc.label, args });
      }
      return {};
    },
    createSampler(desc = {}) {
      log({ op: 'createSampler', label: desc && desc.label });
      return { __resourceId: ids.next(), __resourceKind: 'sampler' };
    },
    // Defensive: not exercised by the current preset path, but keeps the mock
    // shape-tolerant if a pipeline starts creating buffers.
    createBuffer(desc = {}) {
      log({ op: 'createBuffer', label: desc.label });
      return { __resourceId: ids.next(), __resourceKind: 'buffer' };
    },
    queue: {
      copyExternalImageToTexture() {},
      writeBuffer() {},
      submit() {},
      onSubmittedWorkDone() {
        return Promise.resolve();
      },
    },
  };
}

function makeMockPass(kind, trace) {
  const log = (op, args) => trace.push({ op: `${kind}:${op}`, args: args || [] });

  return {
    setPipeline() {
      log('setPipeline');
    },
    setBindGroup(index) {
      log('setBindGroup', [index]);
    },
    dispatchWorkgroups(x, y, z) {
      log('dispatchWorkgroups', [x, y, z]);
    },
    dispatchWorkgroupsIndirect(buffer, offset) {
      log('dispatchWorkgroupsIndirect', [offset]);
    },
    setVertexBuffer(slot) {
      log('setVertexBuffer', [slot]);
    },
    setIndexBuffer(buffer, format) {
      log('setIndexBuffer', [format]);
    },
    draw(count) {
      log('draw', [count]);
    },
    drawIndexed(count) {
      log('drawIndexed', [count]);
    },
    end() {
      log('end');
    },
  };
}

function makeMockEncoder(trace) {
  return {
    beginComputePass() {
      trace.push({ op: 'beginComputePass', args: [] });
      return makeMockPass('compute', trace);
    },
    beginRenderPass() {
      trace.push({ op: 'beginRenderPass', args: [] });
      return makeMockPass('render', trace);
    },
    finish() {
      trace.push({ op: 'finish', args: [] });
      return {};
    },
  };
}

function makeInputTexture({ width, height }, ids = makeResourceIds()) {
  const resourceId = ids.next();
  return {
    label: 'input texture',
    width,
    height,
    __resourceId: resourceId,
    createView() {
      return { __resourceId: resourceId, __resourceKind: 'texture' };
    },
  };
}

/* -------------------------------------------------------------------------- *
 * Trace canonicalisation / diffing.
 * -------------------------------------------------------------------------- */
function canonicalEntry(entry) {
  const parts = [entry.op];
  if (entry.label !== undefined) parts.push(`label=${entry.label}`);
  if (entry.width !== undefined || entry.height !== undefined) {
    parts.push(`${entry.width}x${entry.height}`);
  }
  if (Array.isArray(entry.args) && entry.args.length > 0) {
    parts.push(`(${entry.args.join(',')})`);
  }
  return parts.join(' ');
}

function diffEntries(a, b) {
  const ca = a.map(canonicalEntry);
  const cb = b.map(canonicalEntry);
  const max = Math.max(ca.length, cb.length);
  for (let i = 0; i < max; i += 1) {
    if (ca[i] !== cb[i]) {
      const from = Math.max(0, i - 2);
      const to = Math.min(max - 1, i + 2);
      const lines = [];
      for (let j = from; j <= to; j += 1) {
        lines.push(`    [${j}] legacy  : ${ca[j] === undefined ? '<missing>' : ca[j]}`);
        lines.push(`         composed: ${cb[j] === undefined ? '<missing>' : cb[j]}`);
      }
      return `length legacy=${ca.length} composed=${cb.length}; first diff at ${i}\n${lines.join('\n')}`;
    }
  }
  return null;
}

function canonicalOrderEntry(entry) {
  return (
    `${entry.width === undefined ? '?' : entry.width}x` +
    `${entry.height === undefined ? '?' : entry.height} isCompute=${entry.isCompute}`
  );
}

function diffOrder(a, b) {
  const ca = a.map(canonicalOrderEntry);
  const cb = b.map(canonicalOrderEntry);
  const max = Math.max(ca.length, cb.length);
  for (let i = 0; i < max; i += 1) {
    if (ca[i] !== cb[i]) {
      return (
        `length legacy=${ca.length} composed=${cb.length}; first diff at ${i}\n` +
        `    legacy  : ${ca.join(' | ')}\n` +
        `    composed: ${cb.join(' | ')}`
      );
    }
  }
  return null;
}

/* -------------------------------------------------------------------------- *
 * Execution-order flattening.
 * -------------------------------------------------------------------------- */
function entryOf(node) {
  let width;
  let height;
  try {
    const texture = typeof node.getOutputTexture === 'function' ? node.getOutputTexture() : null;
    if (texture) {
      width = texture.width;
      height = texture.height;
    }
  } catch {
    // Leave dims undefined; the diff surfaces the problem.
  }
  return { width, height, isCompute: node.isCompute === true };
}

function flattenExecution(node, out = []) {
  if (typeof node.getExecutionOrder === 'function') {
    const order = node.getExecutionOrder() || [];
    for (let i = 0; i < order.length; i += 1) {
      flattenExecution(order[i], out);
    }
  } else {
    out.push(entryOf(node));
  }
  return out;
}

/** Flatten to the actual nodes (not just their dims/isCompute entries). */
function flattenNodes(node, out = []) {
  if (typeof node.getExecutionOrder === 'function') {
    const order = node.getExecutionOrder() || [];
    for (let i = 0; i < order.length; i += 1) {
      flattenNodes(order[i], out);
    }
  } else {
    out.push(node);
  }
  return out;
}

function dimsOf(node) {
  const texture = node.getOutputTexture();
  return { width: texture.width, height: texture.height };
}

function errorText(err) {
  if (!err) return String(err);
  return err.stack || `${err.name || 'Error'}: ${err.message || err}`;
}

function sameArray(a, b) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

/* -------------------------------------------------------------------------- *
 * Matrix + expected tables.
 * -------------------------------------------------------------------------- */
const EXPECTED_PRESET_REFS = {
  A: ['ClampHighlights', 'CNNVL', 'CNNx2VL', 'CNNx2M'],
  AA: ['ClampHighlights', 'CNNVL', 'CNNx2VL', 'CNNM', 'CNNx2M'],
  B: ['ClampHighlights', 'CNNSoftVL', 'CNNx2VL', 'CNNx2M'],
  BB: ['ClampHighlights', 'CNNSoftVL', 'CNNx2VL', 'CNNSoftM', 'CNNx2M'],
  C: ['ClampHighlights', 'DenoiseCNNx2VL', 'CNNx2M'],
  CA: ['ClampHighlights', 'DenoiseCNNx2VL', 'CNNM', 'CNNx2M'],
};

const BASE_NATIVE = { width: 1000, height: 500 };
const RATIOS = [0.75, 1.0, 1.2, 1.21, 1.5, 2.0, 2.1, 2.4, 2.41, 3.0, 4.0, 4.1];

function buildMatrix() {
  const cells = RATIOS.map((ratio) => ({
    label: `r=${ratio}`,
    native: { ...BASE_NATIVE },
    target: {
      width: Math.round(BASE_NATIVE.width * ratio),
      height: Math.round(BASE_NATIVE.height * ratio),
    },
  }));

  // One odd-size case around 1.6x to catch ceil/round mismatches.
  const oddNative = { width: 1001, height: 501 };
  cells.push({
    label: 'r=1.6 (odd native)',
    native: oddNative,
    target: {
      width: Math.round(oddNative.width * 1.6),
      height: Math.round(oddNative.height * 1.6),
    },
  });

  return cells;
}

const MATRIX = buildMatrix();

function normalizeModes(value) {
  if (Array.isArray(value)) {
    return value
      .map((mode) =>
        typeof mode === 'string' ? mode : mode && (mode.id || mode.modeId || mode.key),
      )
      .filter((mode) => typeof mode === 'string' && mode.length > 0);
  }
  if (value && typeof value === 'object') return Object.keys(value);
  return [];
}

function makeRegistry() {
  const registry = bundle.createBackendRegistry();
  registry.register(bundle.createAnime4kBackend());
  return registry;
}

/* -------------------------------------------------------------------------- *
 * Per-cell comparison.
 * -------------------------------------------------------------------------- */
async function checkCell(ModeClass, registry, modeId, cell) {
  const failures = [];
  const { native, target } = cell;

  // 1) legacy preset.
  const legacyTrace = [];
  const legacyBindTrace = [];
  const legacyIds = makeResourceIds();
  let legacyPipeline = null;
  try {
    legacyPipeline = new ModeClass({
      device: makeMockDevice(legacyTrace, legacyIds, legacyBindTrace),
      inputTexture: makeInputTexture(native, legacyIds),
      nativeDimensions: { ...native },
      targetDimensions: { ...target },
    });
  } catch (err) {
    failures.push({ check: 'legacy construction threw', detail: errorText(err) });
  }

  // 2) composed pipeline.
  const composedTrace = [];
  const composedBindTrace = [];
  const composedIds = makeResourceIds();
  const composedInputTexture = makeInputTexture(native, composedIds);
  let composedPipeline = null;
  try {
    composedPipeline = await bundle.ComposedPipeline.fromPreset({
      device: makeMockDevice(composedTrace, composedIds, composedBindTrace),
      inputTexture: composedInputTexture,
      nativeDimensions: { ...native },
      targetDimensions: { ...target },
      registry,
      backendId: 'anime4k',
      modeId,
      tier: 'balanced',
    });
  } catch (err) {
    failures.push({ check: 'composed construction threw', detail: errorText(err) });
  }

  if (!legacyPipeline || !composedPipeline) return failures;

  // 3) construction trace.
  const constructionDiff = diffEntries(legacyTrace, composedTrace);
  if (constructionDiff) {
    failures.push({ check: 'construction trace', detail: constructionDiff });
  }

  // 4) flattened execution order.
  try {
    const orderDiff = diffOrder(
      flattenExecution(legacyPipeline),
      flattenExecution(composedPipeline),
    );
    if (orderDiff) failures.push({ check: 'execution order', detail: orderDiff });
  } catch (err) {
    failures.push({ check: 'execution order threw', detail: errorText(err) });
  }

  // 4b) bind-resource trace. Flattening above materialized the deferred
  // ClampHighlightsApply stage on both sides, so every bind group has been
  // created. Comparing *which* resource is bound catches the F2 tail-threading
  // bug that labels/dims cannot (a wrong texture can share a label and size).
  try {
    const bindDiff = diffEntries(legacyBindTrace, composedBindTrace);
    if (bindDiff) failures.push({ check: 'bind resource trace', detail: bindDiff });
  } catch (err) {
    failures.push({ check: 'bind resource trace threw', detail: errorText(err) });
  }

  // 5) final output dimensions.
  try {
    const legacyDims = dimsOf(legacyPipeline);
    const composedDims = dimsOf(composedPipeline);
    if (legacyDims.width !== composedDims.width || legacyDims.height !== composedDims.height) {
      failures.push({
        check: 'final output dims',
        detail:
          `legacy ${legacyDims.width}x${legacyDims.height} ` +
          `!== composed ${composedDims.width}x${composedDims.height}`,
      });
    }
  } catch (err) {
    failures.push({ check: 'final output dims threw', detail: errorText(err) });
  }

  // 6) record pass/dispatch trace.
  try {
    const legacyEncoded = [];
    await bundle.recordPipelineList(makeMockEncoder(legacyEncoded), [legacyPipeline]);
    const composedEncoded = [];
    await bundle.recordPipelineList(makeMockEncoder(composedEncoded), [composedPipeline]);
    const recordDiff = diffEntries(legacyEncoded, composedEncoded);
    if (recordDiff) failures.push({ check: 'record trace', detail: recordDiff });
  } catch (err) {
    failures.push({ check: 'recordPipelineList threw', detail: errorText(err) });
  }

  // 7) unknown updateParam must be swallowed by both roots.
  try {
    legacyPipeline.updateParam('__parity_noop__', 0);
  } catch (err) {
    failures.push({ check: 'legacy updateParam threw', detail: errorText(err) });
  }
  try {
    composedPipeline.updateParam('__parity_noop__', 0);
  } catch (err) {
    failures.push({ check: 'composed updateParam threw', detail: errorText(err) });
  }

  // 8) two-stage ClampHighlights structure. This is a structural assertion only
  // and must not disturb the legacy-vs-composed comparisons above.
  try {
    const order = composedPipeline.getExecutionOrder();
    const flattened = [];
    for (let i = 0; i < order.length; i += 1) {
      flattenNodes(order[i], flattened);
    }
    const last = flattened[flattened.length - 1];
    const lastCtor = last && last.constructor && last.constructor.name;
    if (lastCtor !== 'ClampHighlightsApply' || last.isCompute !== true) {
      failures.push({
        check: 'ClampHighlightsApply placement',
        detail:
          `expected last node ClampHighlightsApply (isCompute=true), got ` +
          `${lastCtor} (isCompute=${last ? last.isCompute : '<none>'})`,
      });
    }
  } catch (err) {
    failures.push({ check: 'ClampHighlightsApply placement threw', detail: errorText(err) });
  }

  try {
    const clampNode = composedPipeline.pipelines.find(
      (node) => node.constructor && node.constructor.name === 'ClampHighlights',
    );
    if (!clampNode) {
      failures.push({
        check: 'ClampHighlights node',
        detail: 'no ClampHighlights node found in composedPipeline.pipelines',
      });
    } else if (clampNode.getOutputTexture() !== composedInputTexture) {
      failures.push({
        check: 'ClampHighlights pass-through',
        detail: 'ClampHighlights.getOutputTexture() is not the pipeline input texture',
      });
    }
  } catch (err) {
    failures.push({ check: 'ClampHighlights pass-through threw', detail: errorText(err) });
  }

  return failures;
}

/* -------------------------------------------------------------------------- *
 * Main.
 * -------------------------------------------------------------------------- */
async function main() {
  try {
    bundle = await loadBundle();
    assertRequiredExports(bundle);
  } catch (err) {
    console.error('FAIL: unable to load the built ESM bundle (dist/index.js).');
    console.error('      Run `pnpm run build` first.');
    console.error(err && err.stack ? err.stack : err);
    process.exitCode = 1;
    return;
  }

  const presetModes = normalizeModes(bundle.ANIME4K_PRESET_MODES);
  const modeClasses = {
    A: bundle.ModeA,
    AA: bundle.ModeAA,
    B: bundle.ModeB,
    BB: bundle.ModeBB,
    C: bundle.ModeC,
    CA: bundle.ModeCA,
  };

  const failures = [];
  let cellsRun = 0;

  // Preset reference tables.
  Object.entries(EXPECTED_PRESET_REFS).forEach(([modeId, expected]) => {
    try {
      const actual = bundle.resolveAnime4kPresetRefs(modeId).map((ref) => ref.key);
      if (!sameArray(actual, expected)) {
        failures.push({
          cell: `preset-refs mode=${modeId}`,
          check: 'keys',
          detail: `expected [${expected.join(', ')}] got [${actual.join(', ')}]`,
        });
      }
    } catch (err) {
      failures.push({
        cell: `preset-refs mode=${modeId}`,
        check: 'threw',
        detail: errorText(err),
      });
    }
    if (!presetModes.includes(modeId)) {
      failures.push({
        cell: `preset-refs mode=${modeId}`,
        check: 'ANIME4K_PRESET_MODES',
        detail: `ANIME4K_PRESET_MODES does not include "${modeId}"`,
      });
    }
  });

  // Unknown mode must throw.
  try {
    bundle.resolveAnime4kPresetRefs('NOPE');
    failures.push({
      cell: 'preset-refs mode=NOPE',
      check: 'throws',
      detail: 'expected resolveAnime4kPresetRefs("NOPE") to throw, but it returned',
    });
  } catch {
    // Expected.
  }

  // Ratio-matrix parity cells.
  const registry = makeRegistry();
  for (let m = 0; m < presetModes.length; m += 1) {
    const modeId = presetModes[m];
    const ModeClass = modeClasses[modeId];
    if (typeof ModeClass !== 'function') {
      failures.push({
        cell: `mode=${modeId}`,
        check: 'mode class',
        detail: `no legacy class export mapped for mode "${modeId}"`,
      });
      continue;
    }

    for (let c = 0; c < MATRIX.length; c += 1) {
      const cell = MATRIX[c];
      cellsRun += 1;
      // eslint-disable-next-line no-await-in-loop
      const cellFailures = await checkCell(ModeClass, registry, modeId, cell);
      for (let f = 0; f < cellFailures.length; f += 1) {
        const failure = cellFailures[f];
        failures.push({
          cell:
            `mode=${modeId} native=${cell.native.width}x${cell.native.height} ` +
            `target=${cell.target.width}x${cell.target.height} (${cell.label})`,
          ...failure,
        });
      }
    }
  }

  // Report.
  if (failures.length === 0) {
    console.log(
      `PASS: ${cellsRun} cells matched, ` +
        `${Object.keys(EXPECTED_PRESET_REFS).length} preset ref tables matched, ` +
        'unknown mode rejected.',
    );
    process.exitCode = 0;
    return;
  }

  console.error(`FAIL: ${failures.length} check failure(s) across ${cellsRun} cell(s).`);
  failures.forEach((failure) => {
    console.error(`\n  [${failure.cell}] ${failure.check}`);
    console.error(`    ${String(failure.detail).replace(/\n/g, '\n    ')}`);
  });
  process.exitCode = 1;
}

main().catch((err) => {
  console.error('FAIL: parity harness crashed unexpectedly.');
  console.error(err && err.stack ? err.stack : err);
  process.exitCode = 1;
});

# Anime4K-WebGPU-Async

[![npm version](https://img.shields.io/npm/v/anime4k-webgpu-async.svg)](https://www.npmjs.com/package/anime4k-webgpu-async)
[![npm downloads](https://img.shields.io/npm/dm/anime4k-webgpu-async.svg)](https://www.npmjs.com/package/anime4k-webgpu-async)
[![license](https://img.shields.io/npm/l/anime4k-webgpu-async.svg)](https://www.npmjs.com/package/anime4k-webgpu-async)

Real-time [Anime4K](https://github.com/bloc97/Anime4K) for the browser: upscaling, denoising and
deblurring, computed entirely client-side with WebGPU compute shaders.

Published on npm as **[anime4k-webgpu-async](https://www.npmjs.com/package/anime4k-webgpu-async)** ·
Maintained by [daika7ana](https://github.com/daika7ana) ·
[Live demo](https://anime4k-webgpu-demo.fly.dev/) ([source](https://github.com/Anime4KWebBoost/Anime4K-Web-Demo))

> Requires a WebGPU-capable browser — see [caniuse.com/webgpu](https://caniuse.com/webgpu).

## Installation

```bash
npm install anime4k-webgpu-async
```

Or with your package manager of choice: `pnpm add anime4k-webgpu-async`,
`yarn add anime4k-webgpu-async`, `bun add anime4k-webgpu-async`.

TypeScript users should also install the peer dependency (modern package managers install peers
automatically):

```bash
npm install -D @webgpu/types
```

`@webgpu/types` is the only required peer dependency, and every public declaration — `.`,
`./engines`, `./engines/anime4k` and `./engines/anime4k/catalog` — begins with
`/// <reference types="@webgpu/types" />`. That reference loads the peer's ambient WebGPU types
program-wide, so you do **not** need to add `@webgpu/types` to your `tsconfig` `types`. On
TypeScript 6+ the built-in `dom` library carries a partial WebGPU set, so keep
`skipLibCheck: true` to avoid duplicate-declaration errors; TypeScript ≤5 relies on the peer's
types.

## ESM-only package

Version 3 is **ESM-only**: there is no UMD bundle, no CommonJS build, and no `anime4k-webgpu`
global. Use `import` — static or dynamic. `<script>` tags, CDN globals and `require()` are no
longer supported. The package is `"type": "module"` and ships a per-module ESM graph at
`dist/**`, with `dist/index.js` as the root entry and `dist/index.d.ts` for types.

Static imports work from the root and the engine subpaths:

```typescript
import { ModeA, render } from 'anime4k-webgpu-async';
import { ComposedPipeline, createBackendRegistry } from 'anime4k-webgpu-async/engines';
import { createAnime4kBackend, anime4kPresetPlans } from 'anime4k-webgpu-async/engines/anime4k';
import { anime4kEffectDescriptors } from 'anime4k-webgpu-async/engines/anime4k/catalog';
```

The `exports` map exposes `.`, `./engines`, `./engines/anime4k`, `./engines/anime4k/catalog` and
`./package.json`; consumer tooling must be `exports`-aware (TypeScript ≥4.7). The
`./engines/anime4k/catalog` subpath is dependency-free catalog data
(`anime4kEffectDescriptors`), so importing it never pulls in the backend or effect constructors.
For on-demand loading, use dynamic `import()`:

```typescript
const { createBackendRegistry, ComposedPipeline } = await import('anime4k-webgpu-async/engines');
const { createAnime4kBackend, anime4kPresetPlans } =
  await import('anime4k-webgpu-async/engines/anime4k');
```

`loadAnime4kConstructor(key)` is exported from `anime4k-webgpu-async/engines/anime4k` (and via
`./engines`) for optional prewarming of a single effect chunk. Otherwise
`createAnime4kBackend`'s `compileEffect` loads each effect's constructor lazily, so every effect
becomes its own chunk.

> **Serve the chunks.** Dynamic-import chunks mean a one-time fetch the first time each effect
> is compiled. Deployments should serve the whole `dist/**` directory, including the per-effect
> chunk files.

Node's `require(esm)` (Node ≥20.19) can load the package, but no CJS build is provided; prefer
`import`. `@webgpu/types` remains the only peer dependency, and a modern WebGPU browser is
required.

### Tree-shaking

The ESM graph is built per-module with `"sideEffects": false`, so an `exports`-aware bundler can
drop everything you don't import. To get the most out of it:

- **Use named imports.** `import { CNNx2VL } from 'anime4k-webgpu-async'` keeps only that effect
  reachable; `import * as anime4k` pulls in the whole namespace.
- **Import `render` and pipelines directly** from the root instead of re-export barrels.
- **Use `anime4k-webgpu-async/engines` for composers** such as `ComposedPipeline` and
  `createBackendRegistry`, so renderer-only usage doesn't drag in the engine graph.
- **Let `createAnime4kBackend` split chunks.** Its per-effect dynamic imports produce one chunk
  per effect; prewarm a hot effect with `loadAnime4kConstructor(key)`.

Approximate Rollup output (minified, tree-shaken):

| Entry | Size |
| --- | --- |
| `render` | ~9.5 KB |
| `CNNx2VL` | ~193 KB |
| `ModeA` | ~430 KB |
| `ComposedPipeline` | ~16 KB |
| Anime4K backend | ~30 KB initial + 15 lazy chunks |

Eagerly importing the whole library used to be ~3.35 MB; the numbers above are what a bundler
keeps once unused effects are removed.

## Usage

### 1. Render wrapper

`render()` wires a `<video>` to a `<canvas>` and runs the pipeline you build:

```typescript
import { CNNx2UL, GANUUL, render } from 'anime4k-webgpu-async';

await render({
  video,
  canvas,
  pipelineBuilder: (device, inputTexture) => {
    const upscale = new CNNx2UL({ device, inputTexture });
    const restore = new GANUUL({
      device,
      inputTexture: upscale.getOutputTexture(),
    });
    return [upscale, restore];
  },
});
```

See [`examples/react-renderer.tsx`](./examples/react-renderer.tsx) for a React example that
builds a preset through the engine composer (`ComposedPipeline.fromPreset`), and
[`examples/react-webgpu.tsx`](./examples/react-webgpu.tsx) for a manual, raw-WebGPU integration.

For a [preset mode](https://github.com/bloc97/Anime4K/blob/master/md/GLSL_Instructions_Advanced.md),
pass the native and target resolutions so the correct chain is assembled automatically:

```typescript
import { ModeA, render } from 'anime4k-webgpu-async';

await render({
  video,
  canvas,
  pipelineBuilder: (device, inputTexture) => [new ModeA({
    device,
    inputTexture,
    nativeDimensions: { width: video.videoWidth, height: video.videoHeight },
    targetDimensions: { width: canvas.width, height: canvas.height },
  })],
});
```

### 2. Existing WebGPU pipelines

Every effect is a class implementing `Anime4KPipeline`, so you can drop it into any encoder:

```typescript
import { Anime4KPipeline, CNNx2UL } from 'anime4k-webgpu-async';

const pipeline: Anime4KPipeline = new CNNx2UL({ device, inputTexture });

// per frame
await pipeline.pass(commandEncoder);        // async — always await
const output = pipeline.getOutputTexture(); // bind this instead of inputTexture

// adjust a supported parameter (e.g. deblur strength)
pipeline.updateParam('strength', 3.0);
```

`inputTexture` must have usage `TEXTURE_BINDING`. Output texture usage depends on the pipeline:
render-based helpers (e.g. `Overlay`, `Downscale`) expose
`TEXTURE_BINDING | RENDER_ATTACHMENT | STORAGE_BINDING`, while compute-based helpers (e.g.
`Conv2d`, `ClampHighlights`) only need `TEXTURE_BINDING | STORAGE_BINDING`. Pipelines can be
chained in tandem for more sophisticated effects.

### 3. Engine-backed composition

Effects can also be composed through an engine backend instead of importing pipeline classes
directly. Register the Anime4K backend, then build a preset chain with
`ComposedPipeline.fromPreset`, or a flat chain from an `EffectReference[]` with
`ComposedPipeline.fromEffects`. Both are async, and `render()` now accepts a builder that returns
a Promise, so the composed pipeline can be passed straight through:

```typescript
import {
  ANIME4K_PRESET_MODES,
  ComposedPipeline,
  createAnime4kBackend,
  createBackendRegistry,
  render,
} from 'anime4k-webgpu-async';

const registry = createBackendRegistry();
registry.register(createAnime4kBackend());

await render({
  video,
  canvas,
  pipelineBuilder: (device, inputTexture) => ComposedPipeline.fromPreset({
    device,
    inputTexture,
    nativeDimensions: { width: video.videoWidth, height: video.videoHeight },
    targetDimensions: { width: canvas.width, height: canvas.height },
    registry,
    backendId: 'anime4k',
    // ANIME4K_PRESET_MODES: 'A' | 'AA' | 'B' | 'BB' | 'C' | 'CA'
    modeId: 'A',
    tier: 'balanced', // accepted, but currently a no-op for Anime4K
  }),
});
```

A flat chain takes the same context with `effects` instead of `modeId`/`tier`:

```typescript
await ComposedPipeline.fromEffects({
  device,
  inputTexture,
  nativeDimensions,
  targetDimensions,
  registry,
  effects: [/* EffectReference[] */],
});
```

Backends expose `resolvePreset` and `resolvePresetPlan` to turn a preset into executable
`PresetNode`s. A `PresetNode` is either an effect node — optionally carrying
`when: 'upscale-x2-if-needed'` — or `{ kind: 'auto-downscale' }`. `tier` is accepted by
`fromPreset` but currently has no effect for Anime4K: there is one pipeline per effect and no
tier-parameterized weights.

### Supported pipelines

| Category | Pipelines |
| --- | --- |
| Deblur | `DoG` |
| Denoise | `BilateralMean` |
| Restore | `CNNM`, `CNNSoftM`, `CNNSoftVL`, `CNNVL`, `CNNUL`, `GANUUL` |
| Upscale | `CNNx2M`, `CNNx2VL`, `CNNx2UL`, `DenoiseCNNx2VL`, `GANx3L`, `GANx4UUL` |
| Helpers | `Conv2d`, `DepthToSpace`, `Overlay`, `Original`, `Downscale`, `ClampHighlights`, `AutoDownscale` |
| Presets | `ModeA`, `ModeAA`, `ModeB`, `ModeBB`, `ModeC`, `ModeCA` ([reference](https://github.com/bloc97/Anime4K/blob/master/md/GLSL_Instructions_Advanced.md)) |

For custom chains, the primitives `PipelineChain`, `PresetPipeline`, `recordPipelineList`,
`AutoDownscale` and `planAutoDownscale` are exported as well.

## Performance

GPU frame time stays within real-time budgets (≈3 ms for a 720p input on an RTX 3070 Ti or 4090)
and is largely independent of input resolution. The exception is `GANx4UUL`, which upscales to 4×
and becomes expensive at high input resolutions (e.g. 8K from 1080p). Pipeline creation is async
to avoid main-thread stalls, and consecutive compute dispatches are consolidated into shared
compute passes — a 10–15× reduction in per-frame pass overhead over the original implementation.

<details>
<summary>Benchmark figures (360p / 720p, RTX 3070 Ti &amp; 4090)</summary>

<img src="images/1a.svg" alt="Figure 1. Denoise and deblur comparison" width="720">

<img src="images/1b.svg" alt="Figure 2. Restore CNN vs restore GAN" width="720">

<img src="images/1c.svg" alt="Figure 3. Upscale CNN x2 vs GAN x3/x4 vs Real-ESRGAN" width="720">

<img src="images/2.svg" alt="Figure 4. Upscale GAN x4 + restore GAN vs Real-ESRGAN" width="720">

<img src="images/performance_analysis_720P_diff_graphic_card.svg" alt="Figure 5. GPU time per effect across graphics cards (720p)" width="720">

<img src="images/performance_analysis_diff_input_size.svg" alt="Figure 6. GPU time across input resolutions" width="720">

</details>

## Future improvements

* Use `read-write` storage textures once supported in Chrome stable, for lower VRAM usage.
* Reuse/intermediate texture pooling to cut VRAM in multi-chain setups (render + benchmark).

## Credits

Maintained by [daika7ana](https://github.com/daika7ana) —
[npm](https://www.npmjs.com/package/anime4k-webgpu-async) ·
[GitHub](https://github.com/daika7ana/Anime4K-WebGPU-Async).

Originally a University of Pennsylvania CIS 565 final project by Ruijun (Daniel) Zhong, Tong Hu
and Yuanqi Wang — [pitch](https://docs.google.com/presentation/d/1QKqbgSwnxgH9Htm_SM3CYOdL-5bIGNmq2VT5xSiAARs/edit?usp=sharing),
[milestone 1](https://docs.google.com/presentation/d/1vmPm16IPomAWMxoYmIAXXQBsLOk9jNHT3xhsdn3K37Q/edit?usp=sharing),
[milestone 2](https://docs.google.com/presentation/d/1gor5TFMMb6vhkBVJBjttUPvZFZvytHT6YuLI_zqOfAc/edit?usp=sharing),
[milestone 3](https://docs.google.com/presentation/d/1nEbmPhS-CbPhUhzjQtkeCNdFZiAGyXShSNRu5my55iY/edit?usp=sharing),
[final](https://docs.google.com/presentation/d/1DGrMEzUCkYuYvQE-T6p7vRvCusKvNPK1/edit#slide=id.g1ed29a20d86_4_11).

Built on [Anime4K](https://github.com/bloc97/Anime4K),
[UnityAnime4K](https://github.com/keijiro/UnityAnime4K) and
[WebGPU-Samples](https://github.com/webgpu/webgpu-samples).

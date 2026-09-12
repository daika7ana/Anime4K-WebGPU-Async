
# Change Log
All notable changes to this project will be documented in this file.
 
The format is based on [Keep a Changelog](http://keepachangelog.com/)
and this project adheres to [Semantic Versioning](http://semver.org/).

## [3.1.0] - 2026-09-12

### Added

- `ClampHighlightsApply`, the deferred clamp stage of `ClampHighlights` (exported through the helpers barrel), and the optional `Anime4KPipeline.getDeferredPipeline` capability that `PipelineChain` / `ComposedPipeline` use to run it once after the last node.

### Changed

- The public `ClampHighlights` class is now the stats-only pass-through stage: its previous `pipelines.clampPipeline` / `bindGroups.clampBindGroup` internals have moved to the new `ClampHighlightsApply`, and its `outputTexture` now aliases the input texture. Code reading those stats-stage internals or expecting `ClampHighlights` to clamp in place should use `ClampHighlightsApply` (or a chain, which defers it automatically).
- `Downscale` switched from a single bilinear fullscreen **render** tap to a **compute** fractional-box filter that averages in linear light (sRGB decode → filter → sRGB encode), removing phase-dependent aliasing/shimmer at non-integer ratios. It now exposes `isCompute` / `recordCompute` so `recordPipelineList` batches it with adjacent compute nodes, and its output texture no longer requires `RENDER_ATTACHMENT` (usage is `TEXTURE_BINDING | STORAGE_BINDING`).
- `Downscale`'s internal fields are now `pipelines` (holding `downscalePipeline`) and `bindGroups` (holding `downscaleBindGroup`), replacing the old render `pipeline` / `bindGroup` fields. `Downscale` is root-exported, so code reading those internals needs updating.

### Fixed

- `ClampHighlights` was an identity in practice: its stats and clamp passes ran back-to-back on the same texture, so `min(luma, localMax) == luma`. It is now a genuine two-stage effect — the 5x5 local-max stats are captured at the insertion point and the clamp is applied to the final frame — matching upstream.
- `PipelineChain.add(...)` did not advance the chain tail, so the legacy `ModeA`..`ModeCA` preset classes bound the original video texture to every `addNode` effect. It now appends through the same path as `append()`, threading intermediate textures (and registering deferrals), which makes the legacy presets structurally identical to `ComposedPipeline.fromPreset`.

## [3.0.0]

### Breaking

- **ESM-only.** The package is now `"type": "module"` and ships only a per-module ESM graph; there is no UMD bundle and no CommonJS build.
- Removed the `<script>` / CDN path (the `anime4k-webgpu` global) and `require()` support. Use `import` (static or dynamic).
- The `exports` map is now required for resolution. Removed the `module`, `unpkg`, `jsdelivr`, `typesVersions` fields and the version-2 deep-import passthrough. Consumer tooling must be `exports`-aware (TypeScript ≥4.7).
- Type declarations are ESM with explicit `.js` specifiers.
- Build output moved from `lib/` to `dist/`: `main`, `types`, `files` and every `exports` subpath now resolve to `dist/**`. Deployments must serve `dist/**`.

### Added

- Lazy per-effect constructor loaders (`src/engines/anime4k/constructors.ts`): `createAnime4kBackend().compileEffect` dynamically imports only the pipeline an effect needs, producing one chunk per effect.
- `loadAnime4kConstructor(key)` export from `anime4k-webgpu-async/engines/anime4k` (also available via `./engines`) for optional prewarming.
- Engine-backed composer `ComposedPipeline` (`fromPreset` / `fromEffects`) for assembling chains from a backend registry.
- Executable preset plans: `resolvePresetPlan` / `resolvePreset` and `PresetNode` variants (effect nodes with an optional `when: 'upscale-x2-if-needed'`, plus `{ kind: 'auto-downscale' }`).
- Anime4K preset resolution: `ANIME4K_PRESET_MODES` (`A` / `AA` / `B` / `BB` / `C` / `CA`) with `resolveAnime4kPresetRefs` / `resolveAnime4kPresetPlan`, and `anime4kPresetPlans`.
- Exported `shouldUpscaleX2` helper.
- `"sideEffects": false` for bundler tree-shaking.
- Every public declaration entry (`.`, `./engines`, `./engines/anime4k`, `./engines/anime4k/catalog`) starts with `/// <reference types="@webgpu/types" />`, so `@webgpu/types` (a required, non-optional peer dependency) supplies WebGPU globals without consumers editing their `tsconfig` `types`.
- New dependency-free subpath export `anime4k-webgpu-async/engines/anime4k/catalog` (re-exports `anime4kEffectDescriptors`) that does not pull in the backend or effect constructors.

### Changed

- Build migrated to **Vite 8 + Rolldown** (`vite.config.ts`), replacing the custom `scripts/build.mjs` TypeScript-compiler-API script. The library build keeps a per-module ESM graph in `dist/**` via `build.rolldownOptions.output.preserveModules` (`preserveModulesRoot: 'src'`), handles `*.wgsl` imports via `build.rolldownOptions.moduleTypes: { '.wgsl': 'text' }` (emitting `dist/**/*.wgsl.js`), and emits declarations with `unplugin-dts/vite`.
- `pnpm run build` is now `vite build`.
- Compilation target raised to ES2020, removing the `__awaiter` helper emit.
- Catalog and preset builders are PURE-annotated so bundlers can drop unused effects and presets.
- `RendererOptions.pipelineBuilder` may now return a `Promise` resolving to a single pipeline or an array, so async builders (e.g. `ComposedPipeline.fromPreset(...)`) can be passed directly.
- Migrated the project from npm to **pnpm 11**: added the `packageManager` field and `pnpm-lock.yaml`, removed the tracked `package-lock.json` (now gitignored), and rewrote all scripts and `nodemonConfig.exec` to invoke `pnpm`.
- Upgraded the toolchain to **TypeScript 6.0.3** and **ESLint 10** flat config (`eslint.config.mjs`), replacing the removed `.eslintrc.json` / `.eslintignore` and the Airbnb stack (`eslint-config-airbnb`, `airbnb-typescript`), whose presets only support ESLint ≤9. The config layers `@eslint/js`, `typescript-eslint` (`recommendedTypeChecked`), `eslint-plugin-import-x` and `globals` with `parserOptions.projectService`.
- Adopted **Prettier** as the formatter (`prettier`, `eslint-config-prettier`): formatting is owned by Prettier (`format` / `format:check`), while ESLint keeps logic rules; `verify` now also runs `format:check`.
- Raised `@webgpu/types` to `^0.1.72` (still the only peer dependency) and `@types/node` to `^25.9.6`, and refreshed `nodemon`, `unplugin-dts` and `vite` (`^8.3.0`).
- `tsconfig.json` now enables `skipLibCheck: true`: TypeScript 6.0.3 ships only a partial WebGPU `dom` library, so `@webgpu/types` is still required and the two overlap.

### Migration

- Replace `require('anime4k-webgpu-async')` and `<script>` / global usage with ESM `import`.
- Deep `anime4k-webgpu-async/dist/...` imports are gone; import from the root or the `./engines` / `./engines/anime4k` subpaths.
- Import engines via subpaths, e.g. `import { createBackendRegistry, ComposedPipeline } from 'anime4k-webgpu-async/engines'`.
- `render()`'s `pipelineBuilder` may return a Promise (carried over from 2.1.0), so async builders can be passed directly.
- Each effect is fetched as a dynamic chunk on first compile; serve all of `dist/**`.

## [2.1.0] - 2026-9-11

### Added
- New exported primitives for building custom chains (additive): `PipelineChain`, `PresetPipeline`, `AutoDownscale`, `planAutoDownscale`, `autoUpscaleX2`, `AUTO_DOWNSCALE_THRESHOLDS`, `recordPipelineList`, and `Dimensions`.
- `render()`'s `pipelineBuilder` may now also return a single `Anime4KPipeline` (such as a `PipelineChain`) instead of an array.
- Presets are now rebuilt on top of `PresetPipeline`.

### Changed
- Shared `recordPipelineList()` consolidation replaces the duplicated `beginComputePass()` logic at 24 sites across presets and composites.
- The renderer now routes custom chains built via `render()` through `recordPipelineList()`, so consecutive compute pipelines share one compute pass.
- Build now also emits TypeScript declarations: `build` is `webpack && tsc --emitDeclarationOnly`, so `index.d.ts` and per-module `.d.ts` files are present after a clean build.
- **Behavior change.** Preset `updateParam()` now forwards to child pipelines instead of throwing.
- **Behavior change.** The `Overlay` compute path now requires exactly 2 input textures at a matching resolution. `GANx3L` and `GANx4UUL` previously routed 3-input / mixed-resolution overlays through the 2-texture compute shader, ignoring custom fragment shaders and the residual input; they now use the correct render path, which changes their rendered output.

### Fixed
- `render()` readyState deadlock: it now waits only while `readyState < HAVE_CURRENT_DATA` and attaches `loadeddata` with `{ once: true }`.
- `Original` no longer opens an empty compute pass (`isCompute` / `recordCompute` removed); it is a pure pass-through.
- Duplicate-`render()` guard: re-calling `render()` on the same video cancels the previous loop.
- Frame-loop hardening: a failing `pass()` / `recordPipelineList()` / submit clears the backpressure guard, logs, and keeps the loop scheduled; `onSubmittedWorkDone()` rejection also clears the guard.
- An empty pipeline builder now throws `pipelineBuilder returned no pipelines` instead of crashing on `pipelines.at(-1)`.

## [2.0.0] - 2026-6-7

### Changed
- **Breaking.** `Anime4KPipeline.pass()` is now `async` and returns `Promise<void>`. All callers must `await` the call.
- Pipeline creation uses `createComputePipelineAsync()` / `createRenderPipelineAsync()` to eliminate main-thread blocking during initialization (2–3s UI freeze removed).
- Same-resolution `Overlay` now uses a compute pipeline instead of a render pipeline.
- Composite pipelines batch compute dispatches into shared `beginComputePass()` calls, reducing per-frame pass overhead by 10–15× on preset modes.
- `DepthToSpace` dispatch corrected from `ceil(dim/4)` to `ceil(dim/8)` to match `@workgroup_size(8,8)`.
- Renderer now has a backpressure guard to prevent unbounded GPU queue buildup.

### Added
- `isCompute` and `recordCompute()` on `Anime4KPipeline` interface for compute pass consolidation.
- `overlay2_compute.wgsl` shader for same-resolution overlay via compute.

## [1.0.0] - 2024-6-6
 
### Added
- More restore, upscale pipelines.
- All 6 preset modes.
- Render binding to setup video - canvas easily.

### Changed
- **Breaking.** Changed all pipeline constructors - emulate named parameters.
- Project structure. Shaders are now placed beside pipeline definition.

### Fixed
- Clamping added to pipeline outputs to avoid OOB color values.

## [0.1.5] - 2023-12-10
 
### Added

- Update readme.
- Include simple denoise pipeline.
- CNN/GAN upscale pipelines.
- CNN/GAN Denoise pipeline
- Original pipeline for passthrough

### Changed
- Pipelines are now built on top of small single stage pipelines.
 
## [0.1.4] - 2023-12-3

### Added

- First working version.
 
### Fixed
 
- Fix webpack configurations for library export.

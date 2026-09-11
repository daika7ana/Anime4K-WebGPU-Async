
# Change Log
All notable changes to this project will be documented in this file.
 
The format is based on [Keep a Changelog](http://keepachangelog.com/)
and this project adheres to [Semantic Versioning](http://semver.org/).

## [2.1.0] - 2026-9-11

### Added
- New exported primitives for building custom chains (additive): `PipelineChain`, `PresetPipeline`, `AutoDownscale`, `planAutoDownscale`, `autoUpscaleX2`, `AUTO_DOWNSCALE_THRESHOLDS`, `recordPipelineList`, and `Dimensions`.
- `render()`'s `pipelineBuilder` may now also return a single `Anime4KPipeline` (such as a `PipelineChain`) instead of an array.
- Presets are now rebuilt on top of `PresetPipeline`.

### Changed
- Shared `recordPipelineList()` consolidation replaces the duplicated `beginComputePass()` logic at 24 sites across presets and composites.
- The renderer now routes custom chains built via `render()` through `recordPipelineList()`, so consecutive compute pipelines share one compute pass.
- Build now also emits TypeScript declarations: `build` is `webpack && tsc --emitDeclarationOnly`, so `lib/index.d.ts` and per-module `.d.ts` files are present after a clean build.
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


# Change Log
All notable changes to this project will be documented in this file.
 
The format is based on [Keep a Changelog](http://keepachangelog.com/)
and this project adheres to [Semantic Versioning](http://semver.org/).

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

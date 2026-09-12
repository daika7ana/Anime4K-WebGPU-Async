/**
 * Engine backend seam (C1a Phase 0).
 *
 * NOTE: `Dimensions` is intentionally NOT re-exported here — it already comes
 * from `./pipelines` (via `pipelines/interfaces`) and a second star-export of a
 * structurally identical declaration would produce a TS2308 ambiguity at the
 * package root. Consumers keep importing `Dimensions` from the root unchanged.
 *
 * The `anime4k-webgpu-async/engines` and `anime4k-webgpu-async/engines/anime4k`
 * subpaths are published via the package.json `exports` map (per-module ESM
 * graph under `dist/`). Keep this module side-effect-free so consumers can
 * tree-shake unused engine code.
 */
export type {
  PerformanceTier,
  EffectCategory,
  EffectParamSchema,
  DimensionBehavior,
  EngineCapabilities,
  EffectDescriptor,
  GpuResourceCacheLike,
  CompileEffectContext,
  CompiledEffectNode,
  BenchmarkProfile,
  BackendRegistry,
  PresetNodeCondition,
  PresetAutoDownscaleNode,
} from './types';
export * from './backend-factory';
export * from './registry';
export * from './anime4k';
export * from './composer';

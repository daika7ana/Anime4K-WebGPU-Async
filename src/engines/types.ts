/**
 * Engine backend seam (C1a Phase 0).
 *
 * A backend describes which effects it can compile and how to compile them.
 * The extension owns catalog policy (which effects a user can pick, which
 * presets map to which chains); the library only owns the algorithmic backends.
 */
import type { Anime4KPipeline } from '../pipelines/interfaces';

export interface Dimensions {
  width: number;
  height: number;
}

export type PerformanceTier = 'performance' | 'balanced' | 'quality' | 'ultra';

export type EffectCategory =
  | 'restore'
  | 'upscale'
  | 'denoise'
  | 'deblur'
  | 'sharpen'
  | 'deband'
  | 'color'
  | 'helper'
  | 'custom';

export interface EffectParamSchema {
  type: 'number' | 'boolean' | 'select';
  min?: number;
  max?: number;
  step?: number;
  defaultValue?: number | boolean | string;
  options?: ReadonlyArray<{ label: string; value: number | boolean | string }>;
  labelKey?: string;
  labelFallback?: string;
}

export interface DimensionBehavior {
  kind: 'same' | 'scale' | 'target';
  scale?: number; // required when kind === 'scale'
}

export type RequiredEngineLimits = Pick<
  GPUSupportedLimits,
  'maxTextureDimension2D' | 'maxStorageBufferBindingSize' | 'maxComputeWorkgroupStorageSize'
>;

export interface EngineCapabilities {
  requiredFeatures?: readonly GPUFeatureName[];
  requiredLimits?: Partial<RequiredEngineLimits>;
  loadsAssets?: boolean;
  prewarmable?: boolean;
}

export interface EffectDescriptor {
  id: string;
  backendId: string;
  key: string;
  name: string;
  category: EffectCategory;
  dimensionBehavior: DimensionBehavior;
  paramsSchema?: Readonly<Record<string, EffectParamSchema>>;
  supportsRealtime?: boolean;
  hidden?: boolean;
  capabilities?: EngineCapabilities;
  license?: { expression: string; componentName: string; sourceUrl: string };
  payload?: Readonly<Record<string, string | number>>;
}

export interface EffectReference {
  id: string;
  backendId: string;
  key: string;
  params?: Record<string, number | boolean | string>;
}

/**
 * Structural subset of the extension's gpu-resource-cache; the library must
 * NOT import extension code.
 */
export interface GpuResourceCacheLike {
  getShaderModule(device: GPUDevice, code: string, label?: string): GPUShaderModule;
}

export interface CompileEffectContext {
  device: GPUDevice;
  inputTexture: GPUTexture;
  sourceDimensions: Dimensions;
  currentDimensions: Dimensions;
  targetDimensions: Dimensions;
  params?: Record<string, number | boolean | string>;
  resources?: GpuResourceCacheLike;
  isStale?: () => boolean;
}

export interface CompiledEffectNode {
  pipeline: Anime4KPipeline;
  outputTexture: GPUTexture;
  outputDimensions: Dimensions;
  profileLabel: string;
}

export interface BenchmarkProfile {
  id: string;
  name: string;
  effects: readonly EffectReference[];
}

/** Insertion condition for a preset node, evaluated at compose time. */
export type PresetNodeCondition = 'upscale-x2-if-needed';

export interface PresetEffectNode {
  kind: 'effect';
  ref: EffectReference;
  /** Omitted = always insert; 'upscale-x2-if-needed' = insert only when target > 1.2x current. */
  when?: PresetNodeCondition;
}

export interface PresetAutoDownscaleNode {
  kind: 'auto-downscale';
}

export type PresetNode = PresetEffectNode | PresetAutoDownscaleNode;

export interface AlgorithmBackend {
  readonly backendId: string;
  readonly displayName: string;
  readonly capabilities?: EngineCapabilities;
  listEffects(): readonly EffectDescriptor[];
  resolvePreset?(modeId: string, tier: PerformanceTier): readonly EffectReference[];
  /**
   * Executable preset description. Optional: backends without it stay composable
   * via resolvePreset() (all refs treated as unconditional). Throws for unknown modeId.
   */
  resolvePresetPlan?(modeId: string, tier: PerformanceTier): readonly PresetNode[];
  compileEffect(ref: EffectReference, ctx: CompileEffectContext): Promise<CompiledEffectNode>;
  getBenchmarkProfiles?(): readonly BenchmarkProfile[];
}

export interface BackendRegistry {
  register(backend: AlgorithmBackend, opts?: { lazy?: () => Promise<AlgorithmBackend> }): void;
  getBackend(backendId: string): AlgorithmBackend | undefined;
  getBackendAsync(backendId: string): Promise<AlgorithmBackend>;
  listEffects(opts?: { includeHidden?: boolean }): readonly EffectDescriptor[];
  getDescriptorById(id: string): EffectDescriptor | undefined;
  getDescriptorByBackendKey(backendId: string, key: string): EffectDescriptor | undefined;
}

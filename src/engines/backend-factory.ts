/**
 * Generic factory for {@link AlgorithmBackend} implementations.
 *
 * Handles descriptor lookup, per-effect payload loading (memoized per
 * `${backendId}:${key}`), pipeline construction and output-dimension
 * derivation so concrete backends only provide their catalog and a
 * `createPipeline` function.
 */
import type { Anime4KPipeline } from '../pipelines/interfaces';
import type {
  AlgorithmBackend,
  BenchmarkProfile,
  CompileEffectContext,
  CompiledEffectNode,
  Dimensions,
  EffectDescriptor,
  EffectReference,
  EngineCapabilities,
  PerformanceTier,
  PresetNode,
} from './types';

export interface EffectPayloadLoader<T> {
  (): Promise<T>;
}

export interface CreateEffectBackendOptions<TPayload> {
  backendId: string;
  backendDisplayName: string;
  descriptors: readonly EffectDescriptor[];
  loaders?: Record<string, EffectPayloadLoader<TPayload>>;
  createPipeline(
    this: void,
    payload: TPayload | undefined,
    context: CompileEffectContext,
    descriptor: EffectDescriptor,
    effect: EffectReference,
  ): Anime4KPipeline | Promise<Anime4KPipeline>;
  resolvePreset?: (modeId: string, tier: PerformanceTier) => readonly EffectReference[];
  resolvePresetPlan?: (modeId: string, tier: PerformanceTier) => readonly PresetNode[];
  getBenchmarkProfiles?: () => readonly BenchmarkProfile[];
  getOutputDimensions?: (descriptor: EffectDescriptor, context: CompileEffectContext) => Dimensions;
  capabilities?: EngineCapabilities;
}

/** Default output dimensions derived from a descriptor's {@link DimensionBehavior}. */
export function defaultOutputDimensions(
  descriptor: EffectDescriptor,
  context: CompileEffectContext,
): Dimensions {
  const { dimensionBehavior } = descriptor;
  if (dimensionBehavior.kind === 'scale') {
    const scale = dimensionBehavior.scale ?? 1;
    return {
      width: Math.ceil(context.currentDimensions.width * scale),
      height: Math.ceil(context.currentDimensions.height * scale),
    };
  }
  if (dimensionBehavior.kind === 'target') {
    return context.targetDimensions;
  }
  return context.currentDimensions;
}

export function createEffectBackend<TPayload>(
  options: CreateEffectBackendOptions<TPayload>,
): AlgorithmBackend {
  const {
    backendId,
    backendDisplayName,
    descriptors,
    loaders,
    createPipeline,
    resolvePreset,
    resolvePresetPlan,
    getBenchmarkProfiles,
    getOutputDimensions,
    capabilities,
  } = options;

  const byId = new Map<string, EffectDescriptor>();
  const byKey = new Map<string, EffectDescriptor>();
  descriptors.forEach((descriptor) => {
    byId.set(descriptor.id, descriptor);
    byKey.set(descriptor.key, descriptor);
  });

  // Memoized per `${backendId}:${key}` so repeated compiles share one payload.
  const payloadCache = new Map<string, Promise<TPayload | undefined>>();

  const resolvePayload = (descriptor: EffectDescriptor): Promise<TPayload | undefined> => {
    const cacheKey = `${backendId}:${descriptor.key}`;
    const cached = payloadCache.get(cacheKey);
    if (cached) return cached;
    const loader = loaders?.[descriptor.key];
    const pending = loader ? loader() : Promise.resolve(undefined);
    payloadCache.set(cacheKey, pending);
    return pending;
  };

  return {
    backendId,
    displayName: backendDisplayName,
    ...(capabilities ? { capabilities } : {}),
    listEffects: () => descriptors,
    async compileEffect(
      ref: EffectReference,
      ctx: CompileEffectContext,
    ): Promise<CompiledEffectNode> {
      const descriptor = byId.get(ref.id) ?? byKey.get(ref.key);
      if (!descriptor) {
        throw new Error(`[${backendId}] Unknown effect reference "${ref.id}" (key "${ref.key}").`);
      }
      const payload = await resolvePayload(descriptor);
      const pipeline = await createPipeline(payload, ctx, descriptor, ref);
      return {
        pipeline,
        outputTexture: pipeline.getOutputTexture(),
        outputDimensions:
          getOutputDimensions?.(descriptor, ctx) ?? defaultOutputDimensions(descriptor, ctx),
        profileLabel: descriptor.key,
      };
    },
    ...(resolvePreset ? { resolvePreset } : {}),
    ...(resolvePresetPlan ? { resolvePresetPlan } : {}),
    ...(getBenchmarkProfiles ? { getBenchmarkProfiles } : {}),
  };
}

/**
 * Build a payload loader that resolves a named constructor/export from a
 * dynamically imported module (e.g. a lazily loaded shader/model asset).
 */
export function createPipelineConstructorLoader<T>(
  moduleImporter: () => Promise<Record<string, unknown>>,
  exportName: string,
): EffectPayloadLoader<T> {
  return async () => {
    const moduleExports = await moduleImporter();
    const exported = moduleExports[exportName];
    if (typeof exported !== 'function') {
      throw new Error(
        `[engines] Expected module export "${exportName}" to be a function/constructor, ` +
          `received ${typeof exported}.`,
      );
    }
    return exported as T;
  };
}

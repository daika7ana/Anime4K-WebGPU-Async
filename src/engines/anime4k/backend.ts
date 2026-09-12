/**
 * Anime4K backend: compiles the library's own pipeline classes.
 *
 * Mirrors the legacy extension construction path in
 * `pipeline-builder.ts` (device + inputTexture + dimensions, then
 * `updateParam` for each supplied param).
 *
 * Pipeline constructors are resolved lazily through `loadAnime4kConstructor`
 * so importing this backend does not statically pull in every shader module.
 */
import { defaultOutputDimensions } from '../backend-factory';
import type {
  AlgorithmBackend,
  CompiledEffectNode,
  CompileEffectContext,
  EffectDescriptor,
  EffectReference,
} from '../types';
import { anime4kEffectDescriptors } from './catalog';
import { loadAnime4kConstructor } from './constructors';
import { resolveAnime4kPresetPlan, resolveAnime4kPresetRefs } from './presets';

const BACKEND_ID = 'anime4k';

export function createAnime4kBackend(): AlgorithmBackend {
  const descriptorsById = new Map<string, EffectDescriptor>();
  const descriptorsByKey = new Map<string, EffectDescriptor>();
  anime4kEffectDescriptors.forEach((descriptor) => {
    descriptorsById.set(descriptor.id, descriptor);
    descriptorsByKey.set(descriptor.key, descriptor);
  });

  return {
    backendId: BACKEND_ID,
    displayName: 'Anime4K',
    listEffects: () => anime4kEffectDescriptors,
    async compileEffect(
      ref: EffectReference,
      ctx: CompileEffectContext,
    ): Promise<CompiledEffectNode> {
      const descriptor = descriptorsById.get(ref.id) ?? descriptorsByKey.get(ref.key);
      if (!descriptor) {
        throw new Error(`[${BACKEND_ID}] Unknown effect reference "${ref.id}" (key "${ref.key}").`);
      }

      const Ctor = await loadAnime4kConstructor(descriptor.key);

      const pipeline = new Ctor({
        device: ctx.device,
        inputTexture: ctx.inputTexture,
        nativeDimensions: ctx.currentDimensions,
        targetDimensions: ctx.targetDimensions,
      });

      const params = ctx.params ?? ref.params;
      if (params) {
        Object.entries(params).forEach(([key, value]) => {
          pipeline.updateParam(key, value);
        });
      }

      return {
        pipeline,
        outputTexture: pipeline.getOutputTexture(),
        outputDimensions: defaultOutputDimensions(descriptor, ctx),
        profileLabel: descriptor.key,
      };
    },
    resolvePreset: (modeId) => resolveAnime4kPresetRefs(modeId),
    resolvePresetPlan: (modeId) => resolveAnime4kPresetPlan(modeId),
    // `getBenchmarkProfiles` is omitted until a trivial profile set exists.
  };
}

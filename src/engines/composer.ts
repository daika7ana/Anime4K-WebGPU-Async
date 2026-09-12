/**
 * Runtime composer that turns engine effect references (or an executable
 * preset plan) into a single {@link PipelineChain}.
 *
 * Construction is async because backends may be lazily registered and effect
 * compilation may load assets. `pass`/`updateParam`/`getOutputTexture`/
 * `getExecutionOrder` are inherited from {@link PipelineChain}.
 */
import { PipelineChain } from '../pipelines/PipelineChain';
import { AutoDownscale, shouldUpscaleX2 } from '../pipelines/helpers/AutoDownscale';
import type { Dimensions } from '../pipelines/interfaces';
import type {
  AlgorithmBackend,
  BackendRegistry,
  EffectReference,
  GpuResourceCacheLike,
  PerformanceTier,
} from './types';

export interface ComposeBaseOptions {
  device: GPUDevice;
  inputTexture: GPUTexture;
  targetDimensions: Dimensions;
  nativeDimensions?: Dimensions;
  resources?: GpuResourceCacheLike;
  isStale?: () => boolean;
}

export interface ComposeEffectsOptions extends ComposeBaseOptions {
  registry: BackendRegistry;
  effects: readonly EffectReference[];
}

export interface ComposePresetOptions extends ComposeBaseOptions {
  registry: BackendRegistry;
  backendId: string;
  modeId: string;
  tier: PerformanceTier;
}

export class ComposedPipeline extends PipelineChain {
  readonly targetDimensions: Dimensions;

  readonly nativeDimensions: Dimensions;

  private readonly resources?: GpuResourceCacheLike;

  private readonly isStale?: () => boolean;

  private constructor(options: ComposeBaseOptions) {
    super({ device: options.device, inputTexture: options.inputTexture });
    this.nativeDimensions = options.nativeDimensions ?? {
      width: options.inputTexture.width,
      height: options.inputTexture.height,
    };
    this.targetDimensions = options.targetDimensions;
    this.resources = options.resources;
    this.isStale = options.isStale;
  }

  static async fromEffects(options: ComposeEffectsOptions): Promise<ComposedPipeline> {
    const { registry, effects, ...base } = options;
    const pipeline = new ComposedPipeline(base);

    for (let i = 0; i < effects.length; i += 1) {
      const ref = effects[i];
      const backend = await registry.getBackendAsync(ref.backendId);
      await pipeline.addEffect(backend, ref);
    }

    return pipeline;
  }

  static async fromPreset(options: ComposePresetOptions): Promise<ComposedPipeline> {
    const { registry, backendId, modeId, tier, ...base } = options;
    const pipeline = new ComposedPipeline(base);
    const backend = await registry.getBackendAsync(backendId);
    const plan = backend.resolvePresetPlan?.(modeId, tier);

    if (plan) {
      for (let i = 0; i < plan.length; i += 1) {
        const node = plan[i];
        if (node.kind === 'auto-downscale') {
          pipeline.addAutoDownscale();
        } else if (node.when !== 'upscale-x2-if-needed' || pipeline.needsUpscaleX2()) {
          let effectBackend = backend;
          if (node.ref.backendId !== backendId) {
            effectBackend = await registry.getBackendAsync(node.ref.backendId);
          }
          await pipeline.addEffect(effectBackend, node.ref);
        }
      }
      return pipeline;
    }

    const refs = backend.resolvePreset?.(modeId, tier);
    if (!refs) {
      throw new Error(
        `[composer] Backend "${backendId}" cannot resolve preset "${modeId}" ` +
          '(missing resolvePresetPlan and resolvePreset).',
      );
    }

    for (let i = 0; i < refs.length; i += 1) {
      await pipeline.addEffect(backend, refs[i]);
    }
    return pipeline;
  }

  private async addEffect(backend: AlgorithmBackend, ref: EffectReference): Promise<void> {
    const inputTexture = this.getOutputTexture();
    const compiled = await backend.compileEffect(ref, {
      device: this.device,
      inputTexture,
      sourceDimensions: this.nativeDimensions,
      currentDimensions: { width: inputTexture.width, height: inputTexture.height },
      targetDimensions: this.targetDimensions,
      ...(ref.params ? { params: ref.params } : {}),
      ...(this.resources ? { resources: this.resources } : {}),
      ...(this.isStale ? { isStale: this.isStale } : {}),
    });
    this.append(compiled.pipeline);
  }

  private needsUpscaleX2(): boolean {
    const t = this.getOutputTexture();
    return shouldUpscaleX2({ width: t.width, height: t.height }, this.targetDimensions);
  }

  private addAutoDownscale(): void {
    this.append(
      new AutoDownscale({
        device: this.device,
        inputTexture: this.getOutputTexture(),
        nativeDimensions: this.nativeDimensions,
        targetDimensions: this.targetDimensions,
      }),
    );
  }
}

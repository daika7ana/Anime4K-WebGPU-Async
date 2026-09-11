import {
  Anime4KPipeline,
  Anime4KPipelineDescriptor,
  Anime4KPresetPipelineDescriptor,
  Dimensions,
} from '../interfaces';
import { PipelineChain } from '../PipelineChain';
import { AutoDownscale, autoUpscaleX2 } from '../helpers/AutoDownscale';

/**
 * Base class for the quality presets. Adds preset-aware helpers on top of
 * `PipelineChain` so each preset is just a declarative node order.
 *
 * `updateParam` is intentionally inherited from `PipelineChain`, which
 * forwards to every child and swallows per-child "no param" errors.
 */
export class PresetPipeline extends PipelineChain {
  protected readonly nativeDimensions: Dimensions;

  protected readonly targetDimensions: Dimensions;

  constructor({
    device,
    inputTexture,
    nativeDimensions,
    targetDimensions,
  }: Anime4KPresetPipelineDescriptor) {
    super({ device, inputTexture });
    this.nativeDimensions = nativeDimensions;
    this.targetDimensions = targetDimensions;
  }

  /** Append a node built from the chain's device and current output texture. */
  protected addNode<T extends Anime4KPipeline>(
    Ctor: new (o: Anime4KPipelineDescriptor) => T,
  ): this {
    this.add(Ctor);
    return this;
  }

  /**
   * Append an x2 upscaler only when the target strictly exceeds 1.2x the
   * current output texture on both axes.
   */
  protected addUpscaleX2IfNeeded<T extends Anime4KPipeline>(
    Ctor: new (o: Anime4KPipelineDescriptor) => T,
  ): this {
    const upscale = autoUpscaleX2(
      this.device,
      this.getOutputTexture(),
      this.targetDimensions,
      (descriptor) => new Ctor(descriptor),
    );
    this.append(upscale);
    return this;
  }

  /** Append the native/target aware auto-downscale wrapper. */
  protected addAutoDownscale(): this {
    this.append(new AutoDownscale({
      device: this.device,
      inputTexture: this.getOutputTexture(),
      nativeDimensions: this.nativeDimensions,
      targetDimensions: this.targetDimensions,
    }));
    return this;
  }
}

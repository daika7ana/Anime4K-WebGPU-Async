import { Anime4KPipeline, Anime4KPipelineDescriptor, Dimensions } from '../../interfaces';
import { UnsupportedParamError } from '../../errors';
import { Downscale } from '../Downscale';

export const AUTO_DOWNSCALE_THRESHOLDS = {
  UPSCALE_MIN: 1.2,
  X2_MAX: 2.0,
  X4_MIN: 2.4,
  X4_MAX: 4.0,
} as const;

export interface AutoDownscalePlan {
  factor: 2 | 4;
  downscaleTo: Dimensions;
}

/**
 * Pure heuristic (no GPU objects) reproducing the preset auto-downscale
 * decision exactly.
 *
 * x2 is selected when the target is strictly greater than 1.2x and strictly
 * less than 2.0x the native size on both axes. x4 is selected when the target
 * is strictly greater than 2.4x and strictly less than 4.0x native.
 *
 * Note the intentional gap: ratios in [2.0x, 2.4x] yield no auto-downscale.
 * This mirrors the original preset behavior and must not be "fixed".
 */
export function planAutoDownscale(
  native: Dimensions,
  target: Dimensions,
): AutoDownscalePlan | null {
  const { UPSCALE_MIN, X2_MAX, X4_MIN, X4_MAX } = AUTO_DOWNSCALE_THRESHOLDS;

  if (
    target.width > UPSCALE_MIN * native.width &&
    target.height > UPSCALE_MIN * native.height &&
    target.width < X2_MAX * native.width &&
    target.height < X2_MAX * native.height
  ) {
    return {
      factor: 2,
      downscaleTo: { width: target.width, height: target.height },
    };
  }

  // Intentional gap: no downscale for [2.0x, 2.4x] ratios.

  if (
    target.width > X4_MIN * native.width &&
    target.height > X4_MIN * native.height &&
    target.width < X4_MAX * native.width &&
    target.height < X4_MAX * native.height
  ) {
    return {
      factor: 4,
      // Half the target on each axis, rounded up (matches the presets).
      downscaleTo: {
        width: Math.ceil(target.width / 2),
        height: Math.ceil(target.height / 2),
      },
    };
  }

  return null;
}

/** Pure predicate shared by legacy autoUpscaleX2 and the engine composer. */
export function shouldUpscaleX2(
  currentDimensions: Dimensions,
  targetDimensions: Dimensions,
): boolean {
  const { UPSCALE_MIN } = AUTO_DOWNSCALE_THRESHOLDS;
  return (
    targetDimensions.width > UPSCALE_MIN * currentDimensions.width &&
    targetDimensions.height > UPSCALE_MIN * currentDimensions.height
  );
}

/**
 * Create an x2 upscaler only when the target strictly exceeds 1.2x the current
 * input texture on both axes.
 */
export function autoUpscaleX2<T extends Anime4KPipeline>(
  device: GPUDevice,
  inputTexture: GPUTexture,
  targetDimensions: Dimensions,
  create: (o: Anime4KPipelineDescriptor) => T,
): T | null {
  if (
    shouldUpscaleX2({ width: inputTexture.width, height: inputTexture.height }, targetDimensions)
  ) {
    return create({ device, inputTexture });
  }

  return null;
}

/**
 * Pipeline wrapper around the preset auto-downscale heuristic. Composes the
 * existing compute-based `Downscale`; it does not duplicate any WGSL.
 *
 * When the plan is `null` the wrapper is inactive: `pass()` is a no-op and
 * `getOutputTexture()` returns the input texture unchanged.
 */
export class AutoDownscale implements Anime4KPipeline {
  readonly plan: AutoDownscalePlan | null;

  private readonly device: GPUDevice;

  private readonly inputTexture: GPUTexture;

  private readonly targetDimensions: Dimensions;

  private downscale: Downscale | null = null;

  constructor({
    device,
    inputTexture,
    nativeDimensions,
    targetDimensions,
  }: Anime4KPipelineDescriptor & {
    nativeDimensions: Dimensions;
    targetDimensions: Dimensions;
  }) {
    this.device = device;
    this.inputTexture = inputTexture;
    this.targetDimensions = targetDimensions;
    this.plan = planAutoDownscale(nativeDimensions, targetDimensions);
  }

  get isActive(): boolean {
    return this.plan !== null;
  }

  private ensureDownscale(): Downscale | null {
    if (!this.plan) return null;

    if (!this.downscale) {
      // x2 downscales straight to the target; x4 downscales to half of it.
      const downscaleTo = this.plan.factor === 2 ? this.targetDimensions : this.plan.downscaleTo;

      this.downscale = new Downscale({
        device: this.device,
        inputTexture: this.inputTexture,
        targetDimensions: downscaleTo,
      });
    }

    return this.downscale;
  }

  updateParam(param: string, value: any): void {
    const downscale = this.ensureDownscale();
    if (downscale) {
      downscale.updateParam(param, value);
      return;
    }
    throw new UnsupportedParamError(this.constructor.name, param);
  }

  async pass(encoder: GPUCommandEncoder): Promise<void> {
    const downscale = this.ensureDownscale();
    if (downscale) {
      await downscale.pass(encoder);
    }
  }

  getOutputTexture(): GPUTexture {
    const downscale = this.ensureDownscale();
    return downscale ? downscale.getOutputTexture() : this.inputTexture;
  }

  getExecutionOrder(): readonly Anime4KPipeline[] {
    const downscale = this.ensureDownscale();
    return downscale ? [downscale] : [];
  }

  dispose(): void {
    this.downscale?.dispose();
  }
}

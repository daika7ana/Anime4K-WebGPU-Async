/**
 * Lazy, cached pipeline-constructor loaders for the Anime4K effects.
 *
 * Each effect resolves through a dynamic `import()` of its concrete pipeline
 * module so the ESM build emits one chunk per effect: consumers only pay for
 * the shaders of the effects they actually use.
 *
 * Module scope intentionally stays side-effect-free — `loaderMap` is a plain
 * object literal of arrow functions and the cache is created on first use.
 */
import type { Anime4KPipeline } from '../../pipelines/interfaces';
import type { Dimensions } from '../types';

export type Anime4KEffectConstructor = new (descriptor: {
  device: GPUDevice;
  inputTexture: GPUTexture;
  nativeDimensions: Dimensions;
  targetDimensions: Dimensions;
}) => Anime4KPipeline;

/** key → concrete pipeline module loader (one per catalog descriptor). */
const loaderMap: Record<string, () => Promise<Anime4KEffectConstructor>> = {
  ClampHighlights: () =>
    import('../../pipelines/helpers/ClampHighlights').then((m) => m.ClampHighlights),
  DoG: () => import('../../pipelines/deblur/DoG').then((m) => m.DoG),
  BilateralMean: () => import('../../pipelines/denoise/BilateralMean').then((m) => m.BilateralMean),
  CNNM: () => import('../../pipelines/restore/CNNM').then((m) => m.CNNM),
  CNNSoftM: () => import('../../pipelines/restore/CNNSoftM').then((m) => m.CNNSoftM),
  CNNSoftVL: () => import('../../pipelines/restore/CNNSoftVL').then((m) => m.CNNSoftVL),
  CNNVL: () => import('../../pipelines/restore/CNNVL').then((m) => m.CNNVL),
  CNNUL: () => import('../../pipelines/restore/CNNUL').then((m) => m.CNNUL),
  GANUUL: () => import('../../pipelines/restore/GANUUL').then((m) => m.GANUUL),
  CNNx2M: () => import('../../pipelines/upscale/CNNx2M').then((m) => m.CNNx2M),
  CNNx2VL: () => import('../../pipelines/upscale/CNNx2VL').then((m) => m.CNNx2VL),
  DenoiseCNNx2VL: () =>
    import('../../pipelines/upscale/DenoiseCNNx2VL').then((m) => m.DenoiseCNNx2VL),
  CNNx2UL: () => import('../../pipelines/upscale/CNNx2UL').then((m) => m.CNNx2UL),
  GANx3L: () => import('../../pipelines/upscale/GANx3L').then((m) => m.GANx3L),
  GANx4UUL: () => import('../../pipelines/upscale/GANx4UUL').then((m) => m.GANx4UUL),
};

let cache: Map<string, Promise<Anime4KEffectConstructor>> | undefined;

/** Resolve (and memoize) the constructor loader for a catalog `key`. */
export function loadAnime4kConstructor(key: string): Promise<Anime4KEffectConstructor> {
  if (!cache) cache = new Map();
  const cached = cache.get(key);
  if (cached) return cached;

  const load = loaderMap[key];
  if (!load) {
    return Promise.reject(new Error(`[anime4k] No constructor loader for effect "${key}".`));
  }

  const pending = load();
  cache.set(key, pending);
  return pending;
}

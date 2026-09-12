/**
 * Anime4K effect catalog.
 *
 * Mirrors the consuming extension's `AVAILABLE_EFFECTS` catalog: `id`, `name`,
 * `category` and `dimensionBehavior.scale` must stay in sync. `key` is the
 * existing `className` used for dynamic construction.
 *
 * CAS, Debanding and ColorAdjust are intentionally NOT listed here: they are
 * extension-owned custom effects (no library export). The extension registers
 * them from its own `core` backend using the same ids, so the id spaces stay
 * compatible without this backend advertising something it cannot compile.
 */
import type { EffectCategory, EffectDescriptor } from '../types';

const ANIME4K_LICENSE = {
  expression: 'MIT',
  componentName: 'Anime4K',
  sourceUrl: 'https://github.com/bloc97/Anime4K',
};

const ANIME4K = 'anime4k';
const SAME = { kind: 'same' } as const;
const scale = (factor: number) => ({ kind: 'scale', scale: factor }) as const;

function effect(
  id: string,
  key: string,
  name: string,
  category: EffectCategory,
  dimensionBehavior: EffectDescriptor['dimensionBehavior'],
  license?: EffectDescriptor['license'],
): EffectDescriptor {
  return {
    id,
    backendId: ANIME4K,
    key,
    name,
    category,
    dimensionBehavior,
    ...(license ? { license } : {}),
  };
}

function buildDescriptors(): readonly EffectDescriptor[] {
  return [
    // Helper
    effect(
      'anime4k/Helper/ClampHighlights',
      'ClampHighlights',
      'Clamp Highlights',
      'helper',
      SAME,
      ANIME4K_LICENSE,
    ),

    // Deblur
    effect('anime4k/Deblur/DoG', 'DoG', 'Deblur (DoG)', 'deblur', SAME, ANIME4K_LICENSE),

    // Denoise
    effect(
      'anime4k/Denoise/BilateralMean',
      'BilateralMean',
      'Denoise (Bilateral Mean)',
      'denoise',
      SAME,
    ),

    // Restore
    effect('anime4k/Restore/CNNM', 'CNNM', 'Restore CNN (M)', 'restore', SAME, ANIME4K_LICENSE),
    effect(
      'anime4k/Restore/CNNSoftM',
      'CNNSoftM',
      'Restore CNN Soft (M)',
      'restore',
      SAME,
      ANIME4K_LICENSE,
    ),
    effect(
      'anime4k/Restore/CNNSoftVL',
      'CNNSoftVL',
      'Restore CNN Soft (VL)',
      'restore',
      SAME,
      ANIME4K_LICENSE,
    ),
    effect('anime4k/Restore/CNNVL', 'CNNVL', 'Restore CNN (VL)', 'restore', SAME, ANIME4K_LICENSE),
    effect('anime4k/Restore/CNNUL', 'CNNUL', 'Restore CNN (UL)', 'restore', SAME, ANIME4K_LICENSE),
    effect(
      'anime4k/Restore/GANUUL',
      'GANUUL',
      'Restore GAN (UUL)',
      'restore',
      SAME,
      ANIME4K_LICENSE,
    ),

    // Upscale
    effect(
      'anime4k/Upscale/CNNx2M',
      'CNNx2M',
      'Upscale CNN x2 (M)',
      'upscale',
      scale(2),
      ANIME4K_LICENSE,
    ),
    effect(
      'anime4k/Upscale/CNNx2VL',
      'CNNx2VL',
      'Upscale CNN x2 (VL)',
      'upscale',
      scale(2),
      ANIME4K_LICENSE,
    ),
    effect(
      'anime4k/Upscale/DenoiseCNNx2VL',
      'DenoiseCNNx2VL',
      'Upscale & Denoise CNN x2 (VL)',
      'upscale',
      scale(2),
      ANIME4K_LICENSE,
    ),
    effect(
      'anime4k/Upscale/CNNx2UL',
      'CNNx2UL',
      'Upscale CNN x2 (UL)',
      'upscale',
      scale(2),
      ANIME4K_LICENSE,
    ),
    effect(
      'anime4k/Upscale/GANx3L',
      'GANx3L',
      'Upscale GAN x3 (L)',
      'upscale',
      scale(3),
      ANIME4K_LICENSE,
    ),
    effect(
      'anime4k/Upscale/GANx4UUL',
      'GANx4UUL',
      'Upscale GAN x4 (UUL)',
      'upscale',
      scale(4),
      ANIME4K_LICENSE,
    ),
  ];
}

export const anime4kEffectDescriptors: readonly EffectDescriptor[] =
  /*#__PURE__*/ buildDescriptors();

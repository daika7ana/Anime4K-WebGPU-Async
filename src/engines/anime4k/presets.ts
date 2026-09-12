/**
 * Executable Anime4K preset plans.
 *
 * Plans describe preset node order (including conditional x2 upscales and the
 * auto-downscale marker) so the composer can build the same chains the
 * `ModeA`..`ModeCA` pipeline classes produce. Effect references are always
 * looked up from the catalog by `key` — ids are never hand-written here.
 */
import { anime4kEffectDescriptors } from './catalog';
import type { EffectReference, PresetEffectNode, PresetNode } from '../types';

export const ANIME4K_PRESET_MODES = ['A', 'AA', 'B', 'BB', 'C', 'CA'] as const;
export type Anime4kPresetMode = (typeof ANIME4K_PRESET_MODES)[number];

function buildPresetPlans(): Readonly<Record<Anime4kPresetMode, readonly PresetNode[]>> {
  const descriptorsByKey = new Map(
    anime4kEffectDescriptors.map((descriptor) => [descriptor.key, descriptor]),
  );

  function refFor(key: string): EffectReference {
    const descriptor = descriptorsByKey.get(key);
    if (!descriptor) {
      throw new Error(`[anime4k] Preset references unknown catalog key "${key}".`);
    }
    return { id: descriptor.id, backendId: descriptor.backendId, key: descriptor.key };
  }

  function effect(key: string, when?: 'upscale-x2-if-needed'): PresetNode {
    return {
      kind: 'effect',
      ref: refFor(key),
      ...(when ? { when } : {}),
    };
  }

  const AUTO_DOWNSCALE: PresetNode = { kind: 'auto-downscale' };

  return {
    A: [
      effect('ClampHighlights'),
      effect('CNNVL'),
      effect('CNNx2VL', 'upscale-x2-if-needed'),
      AUTO_DOWNSCALE,
      effect('CNNx2M', 'upscale-x2-if-needed'),
    ],
    AA: [
      effect('ClampHighlights'),
      effect('CNNVL'),
      effect('CNNx2VL', 'upscale-x2-if-needed'),
      effect('CNNM'),
      AUTO_DOWNSCALE,
      effect('CNNx2M', 'upscale-x2-if-needed'),
    ],
    B: [
      effect('ClampHighlights'),
      effect('CNNSoftVL'),
      effect('CNNx2VL', 'upscale-x2-if-needed'),
      AUTO_DOWNSCALE,
      effect('CNNx2M', 'upscale-x2-if-needed'),
    ],
    BB: [
      effect('ClampHighlights'),
      effect('CNNSoftVL'),
      effect('CNNx2VL', 'upscale-x2-if-needed'),
      AUTO_DOWNSCALE,
      effect('CNNSoftM'),
      effect('CNNx2M', 'upscale-x2-if-needed'),
    ],
    C: [
      effect('ClampHighlights'),
      effect('DenoiseCNNx2VL', 'upscale-x2-if-needed'),
      AUTO_DOWNSCALE,
      effect('CNNx2M', 'upscale-x2-if-needed'),
    ],
    CA: [
      effect('ClampHighlights'),
      effect('DenoiseCNNx2VL', 'upscale-x2-if-needed'),
      AUTO_DOWNSCALE,
      effect('CNNM'),
      effect('CNNx2M', 'upscale-x2-if-needed'),
    ],
  };
}

export const anime4kPresetPlans: Readonly<Record<Anime4kPresetMode, readonly PresetNode[]>> =
  /*#__PURE__*/ buildPresetPlans();

/** Resolve a preset plan, throwing a clear error for an unknown mode. */
export function resolveAnime4kPresetPlan(modeId: string): readonly PresetNode[] {
  if (!(ANIME4K_PRESET_MODES as readonly string[]).includes(modeId)) {
    throw new Error(
      `[anime4k] Unknown preset mode "${modeId}". ` +
        `Supported modes: ${ANIME4K_PRESET_MODES.join(', ')}.`,
    );
  }
  return anime4kPresetPlans[modeId as Anime4kPresetMode];
}

/**
 * Flat projection of a preset plan: effect refs only, with conditional nodes
 * included unconditionally. Used by backends without a plan-aware composer.
 */
export function resolveAnime4kPresetRefs(modeId: string): readonly EffectReference[] {
  return resolveAnime4kPresetPlan(modeId)
    .filter((node): node is PresetEffectNode => node.kind === 'effect')
    .map((node) => node.ref);
}

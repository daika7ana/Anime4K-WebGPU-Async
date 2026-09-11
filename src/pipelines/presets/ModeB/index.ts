import { ClampHighlights } from '../../helpers';
import { Anime4KPresetPipelineDescriptor } from '../../interfaces';
import { CNNSoftVL } from '../../restore';
import { CNNx2M, CNNx2VL } from '../../upscale';
import { PresetPipeline } from '../PresetPipeline';

/**
 * Mode B node order:
 *   ClampHighlights, CNNSoftVL, [CNNx2VL if up], [AutoDownscale], [CNNx2M if up]
 */
export class ModeB extends PresetPipeline {
  constructor(descriptor: Anime4KPresetPipelineDescriptor) {
    super(descriptor);
    this.addNode(ClampHighlights)
      .addNode(CNNSoftVL)
      .addUpscaleX2IfNeeded(CNNx2VL)
      .addAutoDownscale()
      .addUpscaleX2IfNeeded(CNNx2M);
  }
}

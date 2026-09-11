import { ClampHighlights } from '../../helpers';
import { Anime4KPresetPipelineDescriptor } from '../../interfaces';
import { CNNSoftM, CNNSoftVL } from '../../restore';
import { CNNx2M, CNNx2VL } from '../../upscale';
import { PresetPipeline } from '../PresetPipeline';

/**
 * Mode BB node order:
 *   ClampHighlights, CNNSoftVL, [CNNx2VL if up], [AutoDownscale], CNNSoftM, [CNNx2M if up]
 */
export class ModeBB extends PresetPipeline {
  constructor(descriptor: Anime4KPresetPipelineDescriptor) {
    super(descriptor);
    this.addNode(ClampHighlights)
      .addNode(CNNSoftVL)
      .addUpscaleX2IfNeeded(CNNx2VL)
      .addAutoDownscale()
      .addNode(CNNSoftM)
      .addUpscaleX2IfNeeded(CNNx2M);
  }
}

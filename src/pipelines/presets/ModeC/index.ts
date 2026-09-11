import { ClampHighlights } from '../../helpers';
import { Anime4KPresetPipelineDescriptor } from '../../interfaces';
import { CNNx2M, DenoiseCNNx2VL } from '../../upscale';
import { PresetPipeline } from '../PresetPipeline';

/**
 * Mode C node order:
 *   ClampHighlights, [DenoiseCNNx2VL if up], [AutoDownscale], [CNNx2M if up]
 */
export class ModeC extends PresetPipeline {
  constructor(descriptor: Anime4KPresetPipelineDescriptor) {
    super(descriptor);
    this.addNode(ClampHighlights)
      .addUpscaleX2IfNeeded(DenoiseCNNx2VL)
      .addAutoDownscale()
      .addUpscaleX2IfNeeded(CNNx2M);
  }
}

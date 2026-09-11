import { ClampHighlights } from '../../helpers';
import { Anime4KPresetPipelineDescriptor } from '../../interfaces';
import { CNNM } from '../../restore';
import { CNNx2M, DenoiseCNNx2VL } from '../../upscale';
import { PresetPipeline } from '../PresetPipeline';

/**
 * Mode CA node order:
 *   ClampHighlights, [DenoiseCNNx2VL if up], [AutoDownscale], CNNM, [CNNx2M if up]
 */
export class ModeCA extends PresetPipeline {
  constructor(descriptor: Anime4KPresetPipelineDescriptor) {
    super(descriptor);
    this.addNode(ClampHighlights)
      .addUpscaleX2IfNeeded(DenoiseCNNx2VL)
      .addAutoDownscale()
      .addNode(CNNM)
      .addUpscaleX2IfNeeded(CNNx2M);
  }
}

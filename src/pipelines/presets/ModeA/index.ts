import { ClampHighlights } from '../../helpers';
import { Anime4KPresetPipelineDescriptor } from '../../interfaces';
import { CNNVL } from '../../restore';
import { CNNx2M, CNNx2VL } from '../../upscale';
import { PresetPipeline } from '../PresetPipeline';

/**
 * Mode A node order:
 *   ClampHighlights, CNNVL, [CNNx2VL if up], [AutoDownscale], [CNNx2M if up]
 */
export class ModeA extends PresetPipeline {
  constructor(descriptor: Anime4KPresetPipelineDescriptor) {
    super(descriptor);
    this.addNode(ClampHighlights)
      .addNode(CNNVL)
      .addUpscaleX2IfNeeded(CNNx2VL)
      .addAutoDownscale()
      .addUpscaleX2IfNeeded(CNNx2M);
  }
}

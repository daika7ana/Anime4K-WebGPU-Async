import { ClampHighlights } from '../../helpers';
import { Anime4KPresetPipelineDescriptor } from '../../interfaces';
import { CNNM, CNNVL } from '../../restore';
import { CNNx2M, CNNx2VL } from '../../upscale';
import { PresetPipeline } from '../PresetPipeline';

/**
 * Mode AA node order:
 *   ClampHighlights, CNNVL, [CNNx2VL if up], CNNM, [AutoDownscale], [CNNx2M if up]
 */
export class ModeAA extends PresetPipeline {
  constructor(descriptor: Anime4KPresetPipelineDescriptor) {
    super(descriptor);
    this.addNode(ClampHighlights)
      .addNode(CNNVL)
      .addUpscaleX2IfNeeded(CNNx2VL)
      .addNode(CNNM)
      .addAutoDownscale()
      .addUpscaleX2IfNeeded(CNNx2M);
  }
}

import { Anime4KPipeline, OriginalPipelineDescriptor } from '../../interfaces';
import { UnsupportedParamError } from '../../errors';

/**
 * Original pipeline
 *    Output the input texture without any change.
 */
export class Original implements Anime4KPipeline {
  outputTexture: GPUTexture;

  /**
   * Creates an instance of Original.
   *
   * @param {Object} options - The options for the Original pipeline.
   * @param {GPUTexture} options.inputTexture - The input texture for the pipeline.
   */
  constructor({ inputTexture }: OriginalPipelineDescriptor) {
    this.outputTexture = inputTexture;
  }

  updateParam(param: string, value: any): void {
    throw new UnsupportedParamError(this.constructor.name, param);
  }

  async pass(encoder: GPUCommandEncoder): Promise<void> {
    // no-op — Original is a pass-through; getOutputTexture() returns the input.
  }

  getOutputTexture(): GPUTexture {
    return this.outputTexture;
  }
}

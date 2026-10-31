import { Anime4KPipeline, Anime4KPipelineDescriptor } from '../../interfaces';
import { UnsupportedParamError } from '../../errors';
import { Conv2d, Overlay } from '../../helpers';
import { recordPipelineList } from '../../recordPipelineList';

/**
 * Shared body of the CNNM / CNNSoftM pipelines; the concrete subclass supplies its own
 * weight shaders. Internal: not exported from any barrel.
 */
export class ConvNetM implements Anime4KPipeline {
  /**
   * 7 conv2d pipelines and output
   */
  pipelines: Anime4KPipeline[] = [];

  /**
   * @param {Object} options - The options for the pipeline.
   * @param {GPUDevice} options.device - The GPU device to use for
   * creating textures and shader modules.
   * @param {GPUTexture} options.inputTexture - The input texture for the pipeline.
   * @param {string[]} shaders - The 7 weight shaders (conv2d_tf, then conv2d_1..6_tf).
   * @param {string} outputShader - The final `output` shader.
   */
  constructor(
    { device, inputTexture }: Anime4KPipelineDescriptor,
    shaders: string[],
    outputShader: string,
  ) {
    // pipeline 0: main -> conv_2d_tf
    this.pipelines.push(
      new Conv2d({
        device,
        inputTextures: [inputTexture],
        shaderWGSL: shaders[0],
        name: 'conv2d_tf',
      }),
    );

    // pipeline 1 - 6:
    for (let i = 1; i < shaders.length; i += 1) {
      // get the output texture from last pipeline
      this.pipelines.push(
        new Conv2d({
          device,
          inputTextures: [this.pipelines[i - 1].getOutputTexture()],
          shaderWGSL: shaders[i],
          name: `conv2d_${i}_tf`,
        }),
      );
    }

    const outputTextures: GPUTexture[] = [];
    this.fillOutputTextures(outputTextures, 0, 7);
    this.pipelines.push(
      new Conv2d({
        device,
        inputTextures: outputTextures,
        shaderWGSL: outputShader,
        name: 'output',
      }),
    );

    this.pipelines.push(
      new Overlay({
        device,
        inputTextures: [inputTexture, this.pipelines[this.pipelines.length - 1].getOutputTexture()],
        outputTextureSize: [inputTexture.width, inputTexture.height],
      }),
    );
  }

  private fillOutputTextures(outputTextures: GPUTexture[], from: number, count: number) {
    for (let i = from; i < from + count; i += 1) {
      outputTextures.push(this.pipelines[i].getOutputTexture());
    }
  }

  updateParam(param: string, value: any): void {
    throw new UnsupportedParamError(this.constructor.name, param);
  }

  getExecutionOrder(): readonly Anime4KPipeline[] {
    return this.pipelines;
  }

  async pass(encoder: GPUCommandEncoder): Promise<void> {
    await recordPipelineList(encoder, this.pipelines);
  }

  getOutputTexture(): GPUTexture {
    return this.pipelines[this.pipelines.length - 1].getOutputTexture();
  }

  dispose(): void {
    for (const node of this.pipelines) node.dispose?.();
  }
}

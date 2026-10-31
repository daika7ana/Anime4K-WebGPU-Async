import { Anime4KPipeline, Anime4KPipelineDescriptor } from '../../interfaces';
import { UnsupportedParamError } from '../../errors';
import { Conv2d, Overlay } from '../../helpers';
import { recordPipelineList } from '../../recordPipelineList';

/**
 * Shared body of the CNNVL / CNNSoftVL pipelines; the concrete subclass supplies its own
 * weight shaders. Internal: not exported from any barrel.
 */
export class ConvNetVL implements Anime4KPipeline {
  /**
   *  [0, 1] conv2d_tf, conv2d_tf1
   *  [2, 3] conv2d_1_tf, conv2d_1_tf1
   *  [4, 5] conv2d_2_tf, conv2d_2_tf1
   *  [6, 7] conv2d_3_tf, conv2d_3_tf1
   *  [8, 9] conv2d_4_tf, conv2d_4_tf1
   *  [10, 11] conv2d_5_tf, conv2d_5_tf1
   *  [12, 13] conv2d_6_tf, conv2d_6_tf1
   *  [14, 15] conv2d_7_tf, conv2d_7_tf1
   *  [14] output
   */
  pipelines: Anime4KPipeline[] = [];

  /**
   * @param {Object} options - The options for the pipeline.
   * @param {GPUDevice} options.device - The GPU device to use for
   * creating textures and shader modules.
   * @param {GPUTexture} options.inputTexture - The input texture for the pipeline.
   * @param {string[]} shaders - The 16 weight shaders, in the order listed above.
   * @param {string} outputShader - The final `output` shader.
   */
  constructor(
    { device, inputTexture }: Anime4KPipelineDescriptor,
    shaders: string[],
    outputShader: string,
  ) {
    this.pushPipeline(device, [inputTexture], shaders[0], 'conv2d_tf');
    this.pushPipeline(device, [inputTexture], shaders[1], 'conv2d_tf_1');

    const inputTextures: GPUTexture[] = [];
    for (let i = 1; i < 8; i += 1) {
      inputTextures.length = 0;
      this.fillOutputTextures(inputTextures, 2 * (i - 1), 2);
      this.pushPipeline(device, inputTextures, shaders[2 * i], `conv2d_${i}_tf`);
      this.pushPipeline(device, inputTextures, shaders[2 * i + 1], `conv2d_${i}_tf_1`);
    }

    const outputTextures: GPUTexture[] = [];
    this.fillOutputTextures(outputTextures, 2, 14);
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

  private pushPipeline(
    device: GPUDevice,
    inputTexture: GPUTexture[],
    shaderWGSL: string,
    name: string,
  ): void {
    this.pipelines.push(
      new Conv2d({
        device,
        inputTextures: inputTexture,
        shaderWGSL,
        name,
      }),
    );
  }

  private fillOutputTextures(outputTextures: GPUTexture[], from: number, count: number) {
    for (let i = from; i < from + count; i += 1) {
      outputTextures.push(this.pipelines[i].getOutputTexture());
    }
  }

  dispose(): void {
    for (const node of this.pipelines) node.dispose?.();
  }
}

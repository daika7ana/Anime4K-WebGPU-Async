import { Anime4KPipeline, Anime4KPipelineDescriptor } from '../../interfaces';
import { UnsupportedParamError } from '../../errors';
import { Conv2d, DepthToSpace, Overlay } from '../../helpers';
import { recordPipelineList } from '../../recordPipelineList';

/**
 * Shared body of the CNNx2VL / DenoiseCNNx2VL pipelines; the concrete subclass supplies its own
 * weight shaders. Internal: not exported from any barrel.
 */
export class ConvNetX2 implements Anime4KPipeline {
  pipelines: Anime4KPipeline[] = [];

  /**
   * @param {Object} options - The options for the pipeline.
   * @param {GPUDevice} options.device - The GPU device to use for
   * creating textures and shader modules.
   * @param {GPUTexture} options.inputTexture - The input texture for the pipeline.
   * @param {string[]} shaders - The 17 weight shaders; the last 3 are the `conv2d_last_tf_*` set.
   */
  constructor({ device, inputTexture }: Anime4KPipelineDescriptor, shaders: string[]) {
    this.pushPipeline(device, [inputTexture], shaders[0], 'conv2d_tf');
    this.pushPipeline(device, [inputTexture], shaders[1], 'conv2d_tf_1');

    const inputTextures: GPUTexture[] = [];
    for (let i = 1; i < 7; i += 1) {
      inputTextures.length = 0;
      this.fillOutputTextures(inputTextures, 2 * (i - 1), 2);
      this.pushPipeline(device, inputTextures, shaders[2 * i], `conv2d_${i}_tf`);
      this.pushPipeline(device, inputTextures, shaders[2 * i + 1], `conv2d_${i}_tf_1`);
    }

    inputTextures.length = 0;
    this.fillOutputTextures(inputTextures, 0, this.pipelines.length);

    const len = shaders.length;
    for (let i = 0; i < 3; i += 1) {
      this.pushPipeline(device, inputTextures, shaders[len - 3 + i], `conv2d_last_tf_${i}`);
    }
    inputTextures.length = 0;
    this.fillOutputTextures(inputTextures, this.pipelines.length - 3, 3);
    this.pipelines.push(
      new DepthToSpace({
        device,
        inputTextures,
        name: 'DepthToSpace',
      }),
    );

    this.pipelines.push(
      new Overlay({
        device,
        inputTextures: [inputTexture, this.getOutputTexture()],
        outputTextureSize: [2 * inputTexture.width, 2 * inputTexture.height],
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

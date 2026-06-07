import vertexWGSL from './shaders/vertex.wgsl';
import { Anime4KPipeline, OverlayPipelineDescriptor } from '../../interfaces';
import overlay2WGSL from './shaders/overlay2.wgsl';
import overlay2ComputeWGSL from './shaders/overlay2_compute.wgsl';

/**
 * Render Pipeline:
 *      Takes in n input textures output texture.
 */
export class Overlay implements Anime4KPipeline {
  outputTexture: GPUTexture;

  pipeline!: Promise<GPURenderPipeline>;

  bindGroup!: GPUBindGroup;

  name: string;

  isCompute: boolean = false;
  computePipeline: Promise<GPUComputePipeline> | null = null;
  computeBindGroup: GPUBindGroup | null = null;

  /**
   * Creates an instance of Overlay.
   *
   * @param {Object} options - The options for the Overlay pipeline.
   * @param {GPUDevice} options.device - The GPU device to use for creating
   *  textures and shader modules.
   * @param {Array<GPUTexture>} options.inputTextures - The input textures for the pipeline.
   * All input textures must have the same dimensions.
   * @param {Array<number>} options.outputTextureSize - The size of the output texture.
   * @param {string} [options.fragmentWGSL=overlay2WGSL] - The fragment shader code in WGSL format.
   * Defaults to 'overlay2WGSL' (overlay 2 textures).
   * @param {string} [options.name='overlay'] - The name of the pipeline. Defaults to 'overlay'.
   *
   * @throws {Error} Will throw an error if the shader is not defined.
   */
  constructor({
    device,
    inputTextures,
    outputTextureSize,
    fragmentWGSL = overlay2WGSL,
    name = 'overlay',
  }: OverlayPipelineDescriptor) {
    const inputLength = inputTextures.length;
    this.name = name;

    if (fragmentWGSL === undefined) {
      throw Error(`${name}: shader not defined.`);
    }

    // texture
    this.outputTexture = device.createTexture({
      label: `${name}: output texture`,
      size: [outputTextureSize[0], outputTextureSize[1], 1],
      format: 'rgba16float',
      usage: GPUTextureUsage.TEXTURE_BINDING
      | GPUTextureUsage.RENDER_ATTACHMENT
      | GPUTextureUsage.STORAGE_BINDING,
    });

    // Detect same-resolution: use compute pipeline instead of render pipeline
    const isSameResolution = inputTextures[0].width === outputTextureSize[0]
      && inputTextures[0].height === outputTextureSize[1];

    if (isSameResolution) {
      this.isCompute = true;

      const computeModule = device.createShaderModule({
        label: `${name}: compute module`,
        code: overlay2ComputeWGSL,
      });

      const computeBindGroupLayout = device.createBindGroupLayout({
        label: `${name}: compute bind group layout`,
        entries: [
          { binding: 0, visibility: GPUShaderStage.COMPUTE, texture: {} },
          { binding: 1, visibility: GPUShaderStage.COMPUTE, texture: {} },
          {
            binding: 2,
            visibility: GPUShaderStage.COMPUTE,
            storageTexture: { access: 'write-only', format: 'rgba16float' },
          },
        ],
      });

      const computePipelineLayout = device.createPipelineLayout({
        label: `${name}: compute pipeline layout`,
        bindGroupLayouts: [computeBindGroupLayout],
      });

      this.computePipeline = device.createComputePipelineAsync({
        label: `${name}: compute pipeline`,
        layout: computePipelineLayout,
        compute: {
          module: computeModule,
          entryPoint: 'computeMain',
        },
      });

      this.computeBindGroup = device.createBindGroup({
        label: `${name}: compute bind group`,
        layout: computeBindGroupLayout,
        entries: [
          { binding: 0, resource: inputTextures[0].createView() },
          { binding: 1, resource: inputTextures[1].createView() },
          { binding: 2, resource: this.outputTexture.createView() },
        ],
      });
    } else {
      // modules
      const vertexModule = device.createShaderModule({
        label: `${name}: vertex module`,
        code: vertexWGSL,
      });
      const fragmentModule = device.createShaderModule({
        label: `${name}: fragment module`,
        code: fragmentWGSL,
      });

      // BindGroupLayout
      const bindGroupLayoutEntries: GPUBindGroupLayoutEntry[] = [];
      bindGroupLayoutEntries.push({
        binding: 0,
        visibility: GPUShaderStage.FRAGMENT,
        sampler: {},
      });
      for (let i = 1; i <= inputLength; i += 1) {
        bindGroupLayoutEntries.push({
          binding: i,
          visibility: GPUShaderStage.FRAGMENT,
          texture: {},
        });
      }
      const bindGroupLayout = device.createBindGroupLayout({
        label: `${name}: bind group layout`,
        entries: bindGroupLayoutEntries,
      });

      // PipelineLayout
      const pipelineLayout = device.createPipelineLayout({
        label: `${name}: pipeline layout`,
        bindGroupLayouts: [bindGroupLayout],
      });

      // Pipeline
      this.pipeline = device.createRenderPipelineAsync({
        layout: pipelineLayout,
        vertex: {
          module: vertexModule,
          entryPoint: 'vert_main',
        },
        fragment: {
          module: fragmentModule,
          entryPoint: 'main',
          targets: [
            {
              format: 'rgba16float',
            },
          ],
        },
        primitive: {
          topology: 'triangle-list',
        },
      });

      // Sampler
      const sampler = device.createSampler({
        magFilter: 'linear',
        minFilter: 'linear',
      });

      // BindGroup
      const bindGroupEntries: GPUBindGroupEntry[] = [];
      bindGroupEntries.push({
        binding: 0,
        resource: sampler,
      });
      for (let i = 1; i <= inputLength; i += 1) {
        bindGroupEntries.push({
          binding: i,
          resource: inputTextures[i - 1].createView(),
        });
      }
      this.bindGroup = device.createBindGroup({
        label: `${name}: bind group`,
        layout: bindGroupLayout,
        entries: bindGroupEntries,
      });
    }
  }

  updateParam(param: string, value: any): void {
    throw new Error(`${this.constructor.name} has no param`);
  }

  async recordCompute(pass: GPUComputePassEncoder): Promise<void> {
    pass.setPipeline(await this.computePipeline!);
    pass.setBindGroup(0, this.computeBindGroup!);
    pass.dispatchWorkgroups(
      Math.ceil(this.outputTexture.width / 8),
      Math.ceil(this.outputTexture.height / 8),
    );
  }

  async pass(encoder: GPUCommandEncoder): Promise<void> {
    if (this.isCompute) {
      const computePass = encoder.beginComputePass();
      await this.recordCompute(computePass);
      computePass.end();
    } else {
      const bilinearPass = encoder.beginRenderPass({
        colorAttachments: [
          {
            view: this.outputTexture.createView(),
            clearValue: {
              r: 0.0, g: 0.0, b: 0.0, a: 1.0,
            },
            loadOp: 'clear',
            storeOp: 'store',
          },
        ],
      });
      bilinearPass.setPipeline(await this.pipeline);
      bilinearPass.setBindGroup(0, this.bindGroup);
      bilinearPass.draw(6);
      bilinearPass.end();
    }
  }

  getOutputTexture(): GPUTexture {
    return this.outputTexture;
  }
}

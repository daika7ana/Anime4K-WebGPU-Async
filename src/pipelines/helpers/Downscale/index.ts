import { Anime4KPipeline, DownscalePipelineDescriptor } from '../../interfaces';
import { UnsupportedParamError } from '../../errors';
import downscaleWGSL from './shaders/downscale.wgsl';

export class Downscale implements Anime4KPipeline {
  outputTexture: GPUTexture;

  pipelines: {
    downscalePipeline: Promise<GPUComputePipeline>;
  };

  bindGroups: {
    downscaleBindGroup: GPUBindGroup;
  };

  name: string;

  readonly isCompute = true;

  constructor({
    device,
    inputTexture,
    targetDimensions,
    name = 'downscale',
  }: DownscalePipelineDescriptor) {
    this.name = name;

    // output texture
    this.outputTexture = device.createTexture({
      label: `${name} output texture`,
      size: [targetDimensions.width, targetDimensions.height, 1],
      format: 'rgba16float',
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.STORAGE_BINDING,
    });

    // bindGroupLayouts
    const downscaleBindGroupLayout = device.createBindGroupLayout({
      label: `${name} bind group layout`,
      entries: [
        {
          binding: 0,
          visibility: GPUShaderStage.COMPUTE,
          texture: {},
        },
        {
          binding: 1,
          visibility: GPUShaderStage.COMPUTE,
          storageTexture: {
            access: 'write-only',
            format: 'rgba16float',
          },
        },
      ],
    });

    // modules
    const downscaleModule = device.createShaderModule({
      label: `${name} downscale module`,
      code: downscaleWGSL,
    });

    // pipeline layouts
    const downscalePipelineLayout = device.createPipelineLayout({
      label: `${name} pipeline layout`,
      bindGroupLayouts: [downscaleBindGroupLayout],
    });

    this.pipelines = {
      downscalePipeline: device.createComputePipelineAsync({
        label: `${name} downscale pipeline`,
        layout: downscalePipelineLayout,
        compute: {
          module: downscaleModule,
          entryPoint: 'computeMain',
        },
      }),
    };

    this.bindGroups = {
      downscaleBindGroup: device.createBindGroup({
        label: `${name} bind group`,
        layout: downscaleBindGroupLayout,
        entries: [
          {
            binding: 0,
            resource: inputTexture.createView(),
          },
          {
            binding: 1,
            resource: this.outputTexture.createView(),
          },
        ],
      }),
    };
  }

  updateParam(param: string, value: any): void {
    throw new UnsupportedParamError(this.name, param);
  }

  async recordCompute(pass: GPUComputePassEncoder): Promise<void> {
    pass.setPipeline(await this.pipelines.downscalePipeline);
    pass.setBindGroup(0, this.bindGroups.downscaleBindGroup);
    pass.dispatchWorkgroups(
      Math.ceil(this.outputTexture.width / 8),
      Math.ceil(this.outputTexture.height / 8),
    );
  }

  async pass(encoder: GPUCommandEncoder): Promise<void> {
    const computePass = encoder.beginComputePass();
    await this.recordCompute(computePass);
    computePass.end();
  }

  getOutputTexture(): GPUTexture {
    return this.outputTexture;
  }

  dispose(): void {
    this.outputTexture.destroy();
  }
}

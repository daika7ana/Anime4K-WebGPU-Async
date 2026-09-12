import { Anime4KPipeline, ClampHighlightsApplyPipelineDescriptor } from '../../interfaces';
import clampWGSL from './shaders/clamp.wgsl';

/**
 * Clamp-apply stage of `ClampHighlights`.
 *
 * Runs after every other node in the chain against the final frame: it clamps
 * each pixel's luma to the 5x5 local-max statistics captured at the insertion
 * point (`statsTexture`), subtracting the clipped luma difference from RGB.
 * The stats texture may be at a different resolution than the output, so it is
 * sampled bilinearly with normalized coordinates.
 */
export class ClampHighlightsApply implements Anime4KPipeline {
  name: string;

  pipelines: {
    clampPipeline: Promise<GPUComputePipeline>;
  };

  bindGroups: {
    clampBindGroup: GPUBindGroup;
  };

  outputTexture: GPUTexture;

  readonly isCompute = true;

  constructor({
    device,
    inputTexture,
    statsTexture,
    name = 'clamp highlights apply',
  }: ClampHighlightsApplyPipelineDescriptor) {
    this.name = name;

    // textures
    this.outputTexture = device.createTexture({
      label: `${name}: clamp_highlights_apply_texture`,
      size: [inputTexture.width, inputTexture.height, 1],
      format: 'rgba16float',
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.STORAGE_BINDING,
    });

    const statsSampler = device.createSampler({
      label: `${name}: stats sampler`,
      magFilter: 'linear',
      minFilter: 'linear',
      addressModeU: 'clamp-to-edge',
      addressModeV: 'clamp-to-edge',
    });

    // bindGroupLayouts
    const clampBindGroupLayout = device.createBindGroupLayout({
      label: `${name} clamp bind group layout`,
      entries: [
        {
          binding: 0,
          visibility: GPUShaderStage.COMPUTE,
          texture: {},
        },
        {
          binding: 1,
          visibility: GPUShaderStage.COMPUTE,
          texture: {},
        },
        {
          binding: 2,
          visibility: GPUShaderStage.COMPUTE,
          sampler: {
            type: 'filtering',
          },
        },
        {
          binding: 3,
          visibility: GPUShaderStage.COMPUTE,
          storageTexture: {
            access: 'write-only',
            format: 'rgba16float',
          },
        },
      ],
    });

    // modules
    const clampModule = device.createShaderModule({
      label: `${name}: clamp Module`,
      code: clampWGSL,
    });

    // pipeline layouts
    const clampPipelineLayout = device.createPipelineLayout({
      label: `${name} clamp pipeline layout`,
      bindGroupLayouts: [clampBindGroupLayout],
    });

    const clampPipeline = device.createComputePipelineAsync({
      label: `${name} clamp pipeline`,
      layout: clampPipelineLayout,
      compute: {
        module: clampModule,
        entryPoint: 'computeMain',
      },
    });

    this.pipelines = {
      clampPipeline,
    };

    const clampBindGroup = device.createBindGroup({
      label: `${name} clamp bind group`,
      layout: clampBindGroupLayout,
      entries: [
        {
          binding: 0,
          resource: inputTexture.createView(),
        },
        {
          binding: 1,
          resource: statsTexture.createView(),
        },
        {
          binding: 2,
          resource: statsSampler,
        },
        {
          binding: 3,
          resource: this.outputTexture.createView(),
        },
      ],
    });

    this.bindGroups = {
      clampBindGroup,
    };
  }

  updateParam(param: string, value: any): void {
    throw new Error(`${this.name} has no param.`);
  }

  async recordCompute(pass: GPUComputePassEncoder): Promise<void> {
    pass.setPipeline(await this.pipelines.clampPipeline);
    pass.setBindGroup(0, this.bindGroups.clampBindGroup);
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
}

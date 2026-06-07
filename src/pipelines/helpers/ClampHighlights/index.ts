import { Anime4KPipeline, ClampHighlightsPipelineDescriptor } from '../../interfaces';
import luminationXWGSL from './shaders/luminationX.wgsl';
import luminationYWGSL from './shaders/luminationY.wgsl';
import clampWGSL from './shaders/clamp.wgsl';

export class ClampHighlights implements Anime4KPipeline {
  name: string;

  pipelines: {
    luminationXPipeline: Promise<GPUComputePipeline>,
    luminationYPipeline: Promise<GPUComputePipeline>,
    clampPipeline: Promise<GPUComputePipeline>,
  };

  bindGroups: {
    luminationXBindGroup: GPUBindGroup,
    luminationYBindGroup: GPUBindGroup,
    clampBindGroup: GPUBindGroup,
  };

  outputTexture: GPUTexture;

  readonly isCompute = true;

  constructor({
    device,
    inputTexture,
    name = 'clamp highlights',
  }: ClampHighlightsPipelineDescriptor) {
    this.name = name;

    // textures
    this.outputTexture = device.createTexture({
      label: `${name}: clamp_highlights_texture`,
      size: [inputTexture.width, inputTexture.height, 1],
      format: 'rgba16float',
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.STORAGE_BINDING,
    });

    const statsXTexture = device.createTexture({
      label: `${name}: statsmax_texture`,
      size: [inputTexture.width, inputTexture.height, 1],
      format: 'rgba16float',
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.STORAGE_BINDING,
    });

    const statsYTexture = device.createTexture({
      label: `${name}: statsmax_texture`,
      size: [inputTexture.width, inputTexture.height, 1],
      format: 'rgba16float',
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.STORAGE_BINDING,
    });

    // bindGroupLayouts
    const luminationBindGroupLayout = device.createBindGroupLayout({
      label: `${name} lumination bind group layout`,
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
          storageTexture: {
            access: 'write-only',
            format: 'rgba16float',
          },
        },
      ],
    });

    // modules
    const luminationXModule = device.createShaderModule({
      label: `${name}: luminationX Module`,
      code: luminationXWGSL,
    });

    const luminationYModule = device.createShaderModule({
      label: `${name}: luminationY Module`,
      code: luminationYWGSL,
    });

    const clampModule = device.createShaderModule({
      label: `${name}: clamp Module`,
      code: clampWGSL,
    });

    // pipeline layouts
    const luminationPipelineLayout = device.createPipelineLayout({
      label: `${name} lumination pipeline layout`,
      bindGroupLayouts: [luminationBindGroupLayout],
    });

    const clampPipelineLayout = device.createPipelineLayout({
      label: `${name} clamp pipeline layout`,
      bindGroupLayouts: [clampBindGroupLayout],
    });

    const luminationXPipeline = device.createComputePipelineAsync({
      label: `${name} luminationX pipeline`,
      layout: luminationPipelineLayout,
      compute: {
        module: luminationXModule,
        entryPoint: 'computeMain',
      },
    });

    const luminationYPipeline = device.createComputePipelineAsync({
      label: `${name} luminationY pipeline`,
      layout: luminationPipelineLayout,
      compute: {
        module: luminationYModule,
        entryPoint: 'computeMain',
      },
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
      luminationXPipeline,
      luminationYPipeline,
      clampPipeline,
    };

    const luminationXBindGroup = device.createBindGroup({
      label: `${name} luminationX bind group`,
      layout: luminationBindGroupLayout,
      entries: [
        {
          binding: 0,
          resource: inputTexture.createView(),
        },
        {
          binding: 1,
          resource: statsXTexture.createView(),
        },
      ],
    });

    const luminationYBindGroup = device.createBindGroup({
      label: `${name} luminationY bind group`,
      layout: luminationBindGroupLayout,
      entries: [
        {
          binding: 0,
          resource: statsXTexture.createView(),
        },
        {
          binding: 1,
          resource: statsYTexture.createView(),
        },
      ],
    });

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
          resource: statsYTexture.createView(),
        },
        {
          binding: 2,
          resource: this.outputTexture.createView(),
        },
      ],
    });

    this.bindGroups = {
      luminationXBindGroup,
      luminationYBindGroup,
      clampBindGroup,
    };
  }

  updateParam(param: string, value: any): void {
    throw new Error(`${this.name} has no param.`);
  }

  async recordCompute(pass: GPUComputePassEncoder): Promise<void> {
    // luminationX
    pass.setPipeline(await this.pipelines.luminationXPipeline);
    pass.setBindGroup(0, this.bindGroups.luminationXBindGroup);
    pass.dispatchWorkgroups(
      Math.ceil(this.outputTexture.width / 8),
      Math.ceil(this.outputTexture.height / 8),
    );

    // luminationY
    pass.setPipeline(await this.pipelines.luminationYPipeline);
    pass.setBindGroup(0, this.bindGroups.luminationYBindGroup);
    pass.dispatchWorkgroups(
      Math.ceil(this.outputTexture.width / 8),
      Math.ceil(this.outputTexture.height / 8),
    );

    // clamp
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

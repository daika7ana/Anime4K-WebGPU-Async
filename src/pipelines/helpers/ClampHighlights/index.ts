import { Anime4KPipeline, ClampHighlightsPipelineDescriptor } from '../../interfaces';
import { UnsupportedParamError } from '../../errors';
import luminationXWGSL from './shaders/luminationX.wgsl';
import luminationYWGSL from './shaders/luminationY.wgsl';
import { ClampHighlightsApply } from './Apply';

/**
 * Stats-capture stage of `ClampHighlights`.
 *
 * Upstream `Anime4K_Clamp_Highlights.glsl` is a TWO-STAGE effect: the luma
 * statistics are captured when the effect is inserted (mpv `MAIN` hook, which
 * does not modify the hooked image), while the actual clamp runs after all
 * enhancement shaders (mpv `PREKERNEL` hook) against the final frame.
 *
 * This class only runs the stats passes: `luminationX` writes a horizontal
 * 5-tap luma max and `luminationY` writes a vertical 5-tap max of that, giving
 * a 5x5 local max that INCLUDES the center tap. The center tap is intentional
 * and matches upstream; it must not be removed. The connected
 * {@link ClampHighlightsApply} stage, produced lazily by
 * {@link getDeferredPipeline}, consumes `statsY` and runs once at the end of a
 * chain (see `PipelineChain`).
 */
export class ClampHighlights implements Anime4KPipeline {
  name: string;

  pipelines: {
    luminationXPipeline: Promise<GPUComputePipeline>;
    luminationYPipeline: Promise<GPUComputePipeline>;
  };

  bindGroups: {
    luminationXBindGroup: GPUBindGroup;
    luminationYBindGroup: GPUBindGroup;
  };

  outputTexture: GPUTexture;

  readonly isCompute = true;

  private readonly device: GPUDevice;

  private readonly statsXTexture: GPUTexture;

  private readonly statsYTexture: GPUTexture;

  constructor({
    device,
    inputTexture,
    name = 'clamp highlights',
  }: ClampHighlightsPipelineDescriptor) {
    this.name = name;
    this.device = device;
    // Pass-through: stats capture does not alter the frame at the insertion
    // point, so the chain tail stays on the input texture.
    this.outputTexture = inputTexture;

    // textures
    const statsXTexture = device.createTexture({
      label: `${name}: statsmax_texture`,
      size: [inputTexture.width, inputTexture.height, 1],
      format: 'rgba16float',
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.STORAGE_BINDING,
    });
    this.statsXTexture = statsXTexture;

    this.statsYTexture = device.createTexture({
      label: `${name}: statsmax_texture`,
      size: [inputTexture.width, inputTexture.height, 1],
      format: 'rgba16float',
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.STORAGE_BINDING,
    });

    const statsYTexture = this.statsYTexture;

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

    // modules
    const luminationXModule = device.createShaderModule({
      label: `${name}: luminationX Module`,
      code: luminationXWGSL,
    });

    const luminationYModule = device.createShaderModule({
      label: `${name}: luminationY Module`,
      code: luminationYWGSL,
    });

    // pipeline layouts
    const luminationPipelineLayout = device.createPipelineLayout({
      label: `${name} lumination pipeline layout`,
      bindGroupLayouts: [luminationBindGroupLayout],
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

    this.pipelines = {
      luminationXPipeline,
      luminationYPipeline,
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

    this.bindGroups = {
      luminationXBindGroup,
      luminationYBindGroup,
    };
  }

  updateParam(param: string, value: any): void {
    throw new UnsupportedParamError(this.name, param);
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
  }

  async pass(encoder: GPUCommandEncoder): Promise<void> {
    const computePass = encoder.beginComputePass();
    await this.recordCompute(computePass);
    computePass.end();
  }

  getOutputTexture(): GPUTexture {
    return this.outputTexture;
  }

  /** Owns both stats textures; the pass-through output is the input. */
  dispose(): void {
    this.statsXTexture.destroy();
    this.statsYTexture.destroy();
  }

  /**
   * Produce the clamp stage bound to the chain's final texture and this stage's
   * stats. The chain appends and runs it after every other node.
   */
  getDeferredPipeline(finalInputTexture: GPUTexture): Anime4KPipeline {
    return new ClampHighlightsApply({
      device: this.device,
      inputTexture: finalInputTexture,
      statsTexture: this.statsYTexture,
      name: this.name,
    });
  }
}

export * from './Apply';

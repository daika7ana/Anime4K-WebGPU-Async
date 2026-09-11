import { Anime4KPipeline, Anime4KPipelineDescriptor } from './interfaces';
import { recordPipelineList } from './recordPipelineList';

export interface PipelineChainDescriptor {
  device: GPUDevice;
  inputTexture: GPUTexture;
}

/**
 * Generic container that owns an ordered list of pipelines and threads the
 * current output texture through each appended node.
 */
export class PipelineChain implements Anime4KPipeline {
  readonly device: GPUDevice;

  readonly pipelines: Anime4KPipeline[];

  private currentTexture: GPUTexture;

  constructor({ device, inputTexture }: PipelineChainDescriptor) {
    this.device = device;
    this.pipelines = [];
    this.currentTexture = inputTexture;
  }

  /**
   * Construct a node using the chain's device and current output texture,
   * append it, and return it.
   */
  add<T extends Anime4KPipeline, O extends object = Record<never, never>>(
    Ctor: new (o: Anime4KPipelineDescriptor & O) => T,
    options?: O,
  ): T {
    const descriptor = {
      device: this.device,
      inputTexture: this.currentTexture,
      ...(options ?? {}),
    } as Anime4KPipelineDescriptor & O;
    const node = new Ctor(descriptor);
    this.pipelines.push(node);
    return node;
  }

  /**
   * Append a pipeline. Advances the tracked current output texture to the
   * appended node's output. No-op on null/undefined.
   */
  append<T extends Anime4KPipeline>(pipeline: T | null | undefined): T | null {
    if (pipeline == null) return null;
    this.pipelines.push(pipeline);
    this.currentTexture = pipeline.getOutputTexture();
    return pipeline;
  }

  getOutputTexture(): GPUTexture {
    return this.currentTexture;
  }

  /** Backward-compat alias for getOutputTexture(). */
  get outputTexture(): GPUTexture {
    return this.currentTexture;
  }

  getExecutionOrder(): readonly Anime4KPipeline[] {
    return this.pipelines;
  }

  async pass(encoder: GPUCommandEncoder): Promise<void> {
    await recordPipelineList(encoder, this.getExecutionOrder());
  }

  updateParam(param: string, value: any): void {
    for (let i = 0; i < this.pipelines.length; i += 1) {
      try {
        this.pipelines[i].updateParam(param, value);
      } catch {
        // Children without the requested parameter throw; keep forwarding.
      }
    }
  }
}

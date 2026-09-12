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

  /** Deferred epilogue factories registered by appended two-stage nodes. */
  private readonly deferredFactories: Array<(tail: GPUTexture) => Anime4KPipeline | null> = [];

  private resolvedDeferred: readonly Anime4KPipeline[] | null = null;

  private resolvedDeferredTail: GPUTexture | null = null;

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
    this.append(node);
    return node;
  }

  /**
   * Append a pipeline. Advances the tracked current output texture to the
   * appended node's output and registers any deferred epilogue it exposes.
   * No-op on null/undefined.
   */
  append<T extends Anime4KPipeline>(pipeline: T | null | undefined): T | null {
    if (pipeline == null) return null;
    this.pipelines.push(pipeline);
    this.currentTexture = pipeline.getOutputTexture();
    if (typeof pipeline.getDeferredPipeline === 'function') {
      const defer = pipeline.getDeferredPipeline.bind(pipeline);
      this.deferredFactories.push((tail) => defer(tail));
      // A new factory may change the epilogue even when the tail reference is
      // unchanged (e.g. two consecutive pass-through stages), so drop the memo.
      this.resolvedDeferred = null;
      this.resolvedDeferredTail = null;
    }
    return pipeline;
  }

  /**
   * The last explicitly appended node's output, BEFORE any deferred epilogue is
   * materialized. Intra-chain construction (upscale/downscale decisions) uses
   * this so deferrals only run at the very end.
   */
  protected getTailTexture(): GPUTexture {
    return this.currentTexture;
  }

  /**
   * Materialize the deferred epilogue by threading the current tail texture
   * through each registered factory in order. Memoized on the tail texture.
   */
  private resolveDeferred(): readonly Anime4KPipeline[] {
    if (this.deferredFactories.length === 0) {
      return Object.freeze([]);
    }
    if (this.resolvedDeferred && this.resolvedDeferredTail === this.currentTexture) {
      return this.resolvedDeferred;
    }

    const resolved: Anime4KPipeline[] = [];
    let tail = this.currentTexture;
    for (let i = 0; i < this.deferredFactories.length; i += 1) {
      const node = this.deferredFactories[i](tail);
      if (node == null) continue;
      resolved.push(node);
      tail = node.getOutputTexture();
    }

    this.resolvedDeferred = Object.freeze(resolved);
    this.resolvedDeferredTail = this.currentTexture;
    return this.resolvedDeferred;
  }

  getOutputTexture(): GPUTexture {
    const deferred = this.resolveDeferred();
    if (deferred.length > 0) {
      return deferred[deferred.length - 1].getOutputTexture();
    }
    return this.currentTexture;
  }

  /** Backward-compat alias for getOutputTexture(). */
  get outputTexture(): GPUTexture {
    return this.getOutputTexture();
  }

  getExecutionOrder(): readonly Anime4KPipeline[] {
    return [...this.pipelines, ...this.resolveDeferred()];
  }

  async pass(encoder: GPUCommandEncoder): Promise<void> {
    await recordPipelineList(encoder, this.getExecutionOrder());
  }

  updateParam(param: string, value: any): void {
    const order = this.getExecutionOrder();
    for (let i = 0; i < order.length; i += 1) {
      try {
        order[i].updateParam(param, value);
      } catch {
        // Children without the requested parameter throw; keep forwarding.
      }
    }
  }
}

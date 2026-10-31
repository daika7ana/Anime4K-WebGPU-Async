export interface Dimensions {
  width: number;
  height: number;
}

export interface Anime4KPipeline {
  /**
   * Update the controllable parameter managed by the pipeline
   *
   * @param param  - name of the parameter
   * @param value  - value of the parameter
   */
  updateParam(param: string, value: any): void;

  /**
   * write compute commands into the encoder
   *
   * @param encoder - encoder to record commands into
   */
  pass(encoder: GPUCommandEncoder): Promise<void>;

  /**
   * get the output texture of this pipeline
   */
  getOutputTexture(): GPUTexture;

  /**
   * Release GPU resources owned by this pipeline (never its input texture).
   * Optional: nodes that alias their input have nothing to release.
   */
  dispose?(): void;

  /** True when this pipeline contains only compute work and can share a compute pass */
  readonly isCompute?: boolean;

  /** Record compute dispatches into an open compute pass. Only valid when isCompute === true */
  recordCompute?(pass: GPUComputePassEncoder): Promise<void>;

  /** Children in exact execution order (opt-in; needed to flatten composites). */
  getExecutionOrder?(): readonly Anime4KPipeline[];

  /**
   * Optional capability for two-stage effects. When a node exposing this is
   * appended to a chain, the chain runs the returned pipeline once, after its
   * last node, passing the chain's current tail texture. The returned node's
   * output becomes the chain output.
   */
  getDeferredPipeline?(finalInputTexture: GPUTexture): Anime4KPipeline | null;
}

export interface OriginalPipelineDescriptor {
  inputTexture: GPUTexture;
}

export interface Conv2dPipelineDescriptor {
  device: GPUDevice;
  inputTextures: GPUTexture[];
  shaderWGSL: string;
  name?: string;
}

export interface DepthToSpacePipelineDescriptor {
  device: GPUDevice;
  inputTextures: GPUTexture[];
  name?: string;
}

export interface OverlayPipelineDescriptor {
  device: GPUDevice;
  inputTextures: GPUTexture[];
  outputTextureSize: number[];
  fragmentWGSL?: string;
  name?: string;
}

export interface DownscalePipelineDescriptor {
  device: GPUDevice;
  inputTexture: GPUTexture;
  targetDimensions: { width: number; height: number };
  name?: string;
}

/**
 * Stats-capture stage for `ClampHighlights`. Holds the 5x5 local-max luma
 * statistics for the inserted frame; it does not modify its input.
 */
export interface ClampHighlightsPipelineDescriptor {
  device: GPUDevice;
  inputTexture: GPUTexture;
  name?: string;
}

/**
 * Clamp-apply stage for `ClampHighlights`. Runs after every other node in the
 * chain, clamping the final frame's luminance against the previously captured
 * stats texture sampled at `statsTexture`.
 */
export interface ClampHighlightsApplyPipelineDescriptor extends Anime4KPipelineDescriptor {
  statsTexture: GPUTexture;
  name?: string;
}

export interface Anime4KPipelineDescriptor extends OriginalPipelineDescriptor {
  device: GPUDevice;
}

export interface Anime4KPresetPipelineDescriptor extends Anime4KPipelineDescriptor {
  nativeDimensions: { width: number; height: number };
  targetDimensions: { width: number; height: number };
}

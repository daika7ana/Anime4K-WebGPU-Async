import { Anime4KPipeline, recordPipelineList } from '../pipelines';
import fullscreenTexturedQuadWGSL from './shaders/fullscreenTexturedQuad.wgsl';
import sampleExternalTextureWGSL from './shaders/sampleExternalTexture.wgsl';

export interface RendererOptions {
  video: HTMLVideoElement;
  canvas: HTMLCanvasElement;
  // function to build custom pipeline
  // accepts either a single pipeline (e.g. a container) or an array of pipelines,
  // and may resolve them asynchronously
  pipelineBuilder: (
    device: GPUDevice,
    inputTexture: GPUTexture,
  ) => Anime4KPipeline | Anime4KPipeline[] | Promise<Anime4KPipeline | Anime4KPipeline[]>;
  // stops the render loop and releases the GPU resources created by render()
  signal?: AbortSignal;
}

/**
 * Tracks the active render loop for each video element so that calling
 * `render()` again on the same video cancels the previous loop instead of
 * leaving it running alongside the new one.
 */
// A single bad frame must not end the session; a pipeline that keeps failing does.
const MAX_CONSECUTIVE_FRAME_ERRORS = 3;

const renderLoops = new WeakMap<HTMLVideoElement, { cancelled: boolean }>();

/**
 * Renders a video using a custom pipeline.
 *
 * @param {RendererOptions} options - The options for rendering.
 * @param {HTMLVideoElement} options.video - The video element to render.
 * @param {HTMLCanvasElement} options.canvas - The canvas element to render to.
 * @param {Function} options.pipelineBuilder - A function that builds the custom pipeline.
 * It takes a GPUDevice and a GPUTexture as parameters
 * and returns a single Anime4KPipeline, an array of Anime4KPipeline instances, or a
 * Promise that resolves to either.
 * The pipelines returned will be executed in order in the render loop.
 * The output texture of the last pipeline will be rendered to the canvas.
 * @param {AbortSignal} [options.signal] - Aborting it stops the render loop and releases the
 * GPU resources created by this call.
 *
 * @returns {Promise<void>} A promise that resolves when redering is binded.
 *
 * @throws {Error} Will throw an error if WebGPU is not supported.
 */
export async function render(options: RendererOptions): Promise<void> {
  const { video, canvas, pipelineBuilder, signal } = options;

  // Nothing is allocated before this first abort check.
  if (signal?.aborted) {
    return;
  }

  // Cancel any render loop previously started for this video, then register a
  // fresh token for the loop this call is about to create.
  const previousLoop = renderLoops.get(video);
  if (previousLoop) {
    previousLoop.cancelled = true;
  }
  const loopToken = { cancelled: false };
  renderLoops.set(video, loopToken);

  const releaseLoop = () => {
    if (renderLoops.get(video) === loopToken) {
      renderLoops.delete(video);
    }
  };

  if (!navigator.gpu) {
    releaseLoop();
    throw new Error('WebGPU not supported');
  }

  if (video.readyState < video.HAVE_CURRENT_DATA) {
    // an error that fired before this call would otherwise wait forever
    if (video.error) {
      releaseLoop();
      throw new Error('Video failed to load');
    }
    await new Promise<void>((resolve, reject) => {
      const cleanup = () => {
        video.removeEventListener('loadeddata', onLoadedData);
        video.removeEventListener('error', onFailure);
        video.removeEventListener('abort', onFailure);
        video.removeEventListener('emptied', onFailure);
        signal?.removeEventListener('abort', onAbort);
      };
      const onLoadedData = () => {
        cleanup();
        resolve();
      };
      const onFailure = () => {
        cleanup();
        reject(new Error('Video failed to load before loadeddata'));
      };
      const onAbort = () => {
        cleanup();
        resolve();
      };
      video.addEventListener('loadeddata', onLoadedData);
      video.addEventListener('error', onFailure);
      video.addEventListener('abort', onFailure);
      video.addEventListener('emptied', onFailure);
      signal?.addEventListener('abort', onAbort, { once: true });
    });
    if (loopToken.cancelled || signal?.aborted) {
      releaseLoop();
      return;
    }
  }
  const WIDTH = video.videoWidth;
  const HEIGHT = video.videoHeight;

  // configure WebGPU
  const adapter = await navigator.gpu.requestAdapter();
  if (!adapter) {
    releaseLoop();
    throw new Error('WebGPU not supported');
  }
  let device: GPUDevice;
  try {
    // Ask for the adapter's full 2D texture limit: large upscales (e.g. GANx4UUL
    // on a 1080p source) allocate textures above the default 8192 limit.
    device = await adapter.requestDevice({
      requiredLimits: {
        maxTextureDimension2D: adapter.limits.maxTextureDimension2D,
      },
    });
  } catch (error) {
    releaseLoop();
    throw new Error(
      `Failed to create WebGPU device: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
  }
  if (loopToken.cancelled || signal?.aborted) {
    device.destroy();
    releaseLoop();
    return;
  }

  const canvasContext = canvas.getContext('webgpu');
  if (!canvasContext) {
    device.destroy();
    releaseLoop();
    throw new Error('Unable to get a WebGPU context from the canvas');
  }
  const context: GPUCanvasContext = canvasContext;
  const presentationFormat = navigator.gpu.getPreferredCanvasFormat();
  context.configure({
    device,
    format: presentationFormat,
    alphaMode: 'premultiplied',
  });

  // create frame texture buffer of the video
  let videoFrameTexture: GPUTexture | undefined;
  const frameTexture = (videoFrameTexture = device.createTexture({
    size: [WIDTH, HEIGHT, 1],
    format: 'rgba16float',
    usage:
      GPUTextureUsage.TEXTURE_BINDING |
      GPUTextureUsage.COPY_DST |
      GPUTextureUsage.RENDER_ATTACHMENT,
  }));

  // Pipeline dimensions are fixed for the lifetime of the loop; if the video's
  // metadata reports different dimensions the caller must call render() again
  // rather than copying frames into a stale-sized texture.
  function handleLoadedMetadata() {
    if (video.videoWidth === WIDTH && video.videoHeight === HEIGHT) {
      return;
    }
    teardown();
    // eslint-disable-next-line no-console
    console.error(
      `Video dimensions changed from ${WIDTH}x${HEIGHT} to ` +
        `${video.videoWidth}x${video.videoHeight}; rendering stopped. Call render() again.`,
    );
  }

  let pipelines: Anime4KPipeline[] = [];
  let cleanedUp = false;
  function disposePipelines() {
    for (const pipeline of pipelines) {
      pipeline.dispose?.();
    }
    pipelines = [];
  }
  function teardown() {
    if (cleanedUp) {
      return;
    }
    cleanedUp = true;
    loopToken.cancelled = true;
    disposePipelines();
    videoFrameTexture?.destroy();
    device.destroy();
    signal?.removeEventListener('abort', teardown);
    video.removeEventListener('loadedmetadata', handleLoadedMetadata);
    releaseLoop();
  }

  signal?.addEventListener('abort', teardown, { once: true });
  video.addEventListener('loadedmetadata', handleLoadedMetadata);

  // stop without retrying if the device is lost
  void device.lost.then((info) => {
    if (info.reason === 'destroyed') {
      return;
    }
    teardown();
    // eslint-disable-next-line no-console
    console.error(`WebGPU device lost: ${info.message}`);
  });

  const built = await pipelineBuilder(device, frameTexture);
  pipelines = Array.isArray(built) ? built : [built];
  if (loopToken.cancelled || signal?.aborted) {
    // the abort may have fired while the builder was running, i.e. before
    // these pipelines existed
    disposePipelines();
    teardown();
    return;
  }
  if (pipelines.length === 0) {
    teardown();
    throw new Error('pipelineBuilder returned no pipelines');
  }

  // every node's texture is allocated eagerly, so an oversized intermediate
  // texture is just as fatal as an oversized output
  const nodes = pipelines.flatMap((pipeline) => pipeline.getExecutionOrder?.() ?? [pipeline]);
  const maxTextureDimension2D = device.limits.maxTextureDimension2D;
  for (const node of nodes) {
    const texture = node.getOutputTexture();
    if (texture.width > maxTextureDimension2D || texture.height > maxTextureDimension2D) {
      teardown();
      const name = texture.label || node.constructor.name;
      throw new Error(
        `${name} output texture is ${texture.width}x${texture.height}, which exceeds ` +
          `maxTextureDimension2D (${maxTextureDimension2D})`,
      );
    }
  }

  // function to get copy new video frame into texture
  function updateVideoFrameTexture() {
    device.queue.copyExternalImageToTexture({ source: video }, { texture: frameTexture }, [
      WIDTH,
      HEIGHT,
    ]);
  }

  // render pipeline setups
  const renderBindGroupLayout = device.createBindGroupLayout({
    label: 'Render Bind Group Layout',
    entries: [
      {
        binding: 1,
        visibility: GPUShaderStage.FRAGMENT,
        sampler: {},
      },
      {
        binding: 2,
        visibility: GPUShaderStage.FRAGMENT,
        texture: {},
      },
    ],
  });

  const renderPipelineLayout = device.createPipelineLayout({
    label: 'Render Pipeline Layout',
    bindGroupLayouts: [renderBindGroupLayout],
  });

  const renderPipeline = device.createRenderPipelineAsync({
    layout: renderPipelineLayout,
    vertex: {
      module: device.createShaderModule({
        code: fullscreenTexturedQuadWGSL,
      }),
      entryPoint: 'vert_main',
    },
    fragment: {
      module: device.createShaderModule({
        code: sampleExternalTextureWGSL,
      }),
      entryPoint: 'main',
      targets: [
        {
          format: presentationFormat,
        },
      ],
    },
    primitive: {
      topology: 'triangle-list',
    },
  });

  const sampler = device.createSampler({
    magFilter: 'linear',
    minFilter: 'linear',
  });

  const renderBindGroup = device.createBindGroup({
    layout: renderBindGroupLayout,
    entries: [
      {
        binding: 1,
        resource: sampler,
      },
      {
        binding: 2,
        resource: pipelines.at(-1)!.getOutputTexture().createView(),
      },
    ],
  });

  // render loop
  let consecutiveFailures = 0;
  // bounded backpressure: a slow GPU must not grow the submission queue
  let inFlight = 0;

  async function frame() {
    if (loopToken.cancelled) {
      return;
    }
    if (inFlight >= 2) {
      // two frames still on the GPU; do no work this tick
      video.requestVideoFrameCallback(() => {
        void frame();
      });
      return;
    }
    try {
      if (!video.paused) {
        updateVideoFrameTexture();
      }
      const commandEncoder = device.createCommandEncoder();
      await recordPipelineList(commandEncoder, pipelines);
      const passEncoder = commandEncoder.beginRenderPass({
        colorAttachments: [
          {
            view: context.getCurrentTexture().createView(),
            clearValue: {
              r: 0.0,
              g: 0.0,
              b: 0.0,
              a: 1.0,
            },
            loadOp: 'clear' as GPULoadOp,
            storeOp: 'store' as GPUStoreOp,
          },
        ],
      });
      passEncoder.setPipeline(await renderPipeline);
      passEncoder.setBindGroup(0, renderBindGroup);
      passEncoder.draw(6);
      passEncoder.end();
      if (loopToken.cancelled) {
        return;
      }
      device.queue.submit([commandEncoder.finish()]);
      inFlight += 1;
      // Decrement only: GPU-level failures are reported through device.lost.
      void device.queue.onSubmittedWorkDone().then(
        () => {
          inFlight -= 1;
        },
        () => {
          inFlight -= 1;
        },
      );
      consecutiveFailures = 0;
    } catch (error) {
      if (loopToken.cancelled) {
        return;
      }
      // Skip the frame: one-off failures keep rendering at the next frame. A
      // pipeline that fails repeatedly is broken, so stop instead of spamming.
      consecutiveFailures += 1;
      if (consecutiveFailures >= MAX_CONSECUTIVE_FRAME_ERRORS) {
        teardown();
        // eslint-disable-next-line no-console
        console.error(error);
        return;
      }
      // eslint-disable-next-line no-console
      console.warn('Skipping frame after render error:', error);
    }
    if (!loopToken.cancelled) {
      video.requestVideoFrameCallback(() => {
        void frame();
      });
    }
  }
  // start render loop
  if (!loopToken.cancelled) {
    video.requestVideoFrameCallback(() => {
      void frame();
    });
  }
}

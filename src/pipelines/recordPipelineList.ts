import { Anime4KPipeline } from './interfaces';

/**
 * Record a list of pipelines into a command encoder while consolidating
 * consecutive compute-only pipelines into a single shared compute pass.
 *
 * Semantics:
 * - a pipeline with `isCompute === true` and a `recordCompute` function is
 *   recorded into a lazily-opened, shared `GPUComputePassEncoder`;
 * - before any other pipeline the open compute pass (if any) is closed and the
 *   pipeline's own `pass()` is awaited;
 * - composites that expose `getExecutionOrder()` are flattened and their
 *   children recorded in order;
 * - any compute pass still open at the end is closed.
 *
 * @param encoder   - command encoder to record into
 * @param pipelines - pipelines to record, in execution order
 */
export async function recordPipelineList(
  encoder: GPUCommandEncoder,
  pipelines: readonly Anime4KPipeline[],
): Promise<void> {
  let computePass: GPUComputePassEncoder | null = null;

  const closeComputePass = (): void => {
    if (computePass) {
      computePass.end();
      computePass = null;
    }
  };

  const record = async (list: readonly Anime4KPipeline[]): Promise<void> => {
    for (let i = 0; i < list.length; i += 1) {
      const p = list[i];
      const executionOrder = p.getExecutionOrder?.();
      if (executionOrder) {
        // Flatten composites and keep sharing the open compute pass.
        await record(executionOrder);
      } else if (p.isCompute === true && typeof p.recordCompute === 'function') {
        if (!computePass) computePass = encoder.beginComputePass();
        await p.recordCompute(computePass);
      } else {
        closeComputePass();
        await p.pass(encoder);
      }
    }
  };

  await record(pipelines);
  closeComputePass();
}

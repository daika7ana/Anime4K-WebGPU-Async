import React, { useRef, useEffect } from 'react';
import { render } from 'anime4k-webgpu-async';
import {
  ComposedPipeline,
  createAnime4kBackend,
  createBackendRegistry,
} from 'anime4k-webgpu-async/engines';

export const ReactRenderer: React.FC = () => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) {
      return undefined;
    }

    video.muted = true;
    video.src = '/OnePunchMan.mp4';

    const registry = createBackendRegistry();
    registry.register(createAnime4kBackend());

    let cancelled = false;
    async function init() {
      await render({
        video,
        canvas,
        // The engine composer builds a preset chain. render() awaits the
        // builder, so fromPreset()'s Promise can be returned directly.
        pipelineBuilder: (device, inputTexture) =>
          ComposedPipeline.fromPreset({
            device,
            inputTexture,
            registry,
            backendId: 'anime4k',
            modeId: 'A',
            tier: 'balanced',
            nativeDimensions: { width: video.videoWidth, height: video.videoHeight },
            targetDimensions: { width: canvas.width, height: canvas.height },
          }),
      });
      if (!cancelled) {
        await video.play().catch(() => {
          // Autoplay may be blocked; `<video controls>` lets the user start it.
        });
      }
    }
    void init();

    return () => {
      cancelled = true;
      video.pause();
    };
  }, []);

  return (
    <div>
      <video ref={videoRef} controls />
      <canvas
        ref={canvasRef}
        width="1280"
        height="720"
        style={{ border: '1px solid black' }}
      />
    </div>
  );
};

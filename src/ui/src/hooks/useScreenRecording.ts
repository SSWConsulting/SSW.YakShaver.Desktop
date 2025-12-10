import { useCallback, useRef, useState } from "react";
import { toast } from "sonner";
import type { RegionBounds } from "../types";

const VIDEO_MIME_TYPE = "video/mp4";
const CANVAS_WIDTH = 1920;
const CANVAS_HEIGHT = 1080;
const CANVAS_FPS = 30;

interface RecordingStreams {
  video?: MediaStream;
  audio?: MediaStream;
}

interface CanvasProxyRefs {
  video: HTMLVideoElement | null;
  canvas: HTMLCanvasElement | null;
  ctx: CanvasRenderingContext2D | null;
  intervalId: ReturnType<typeof setInterval> | null;
  region: RegionBounds | null;
}

interface ElectronVideoConstraints extends MediaTrackConstraints {
  mandatory?: {
    chromeMediaSource: string;
    chromeMediaSourceId: string;
  };
}

export function useScreenRecording() {
  const [isRecording, setIsRecording] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamsRef = useRef<RecordingStreams>({});
  const audioContextRef = useRef<AudioContext | null>(null);
  const audioSourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const canvasProxyRef = useRef<CanvasProxyRefs>({
    video: null,
    canvas: null,
    ctx: null,
    intervalId: null,
    region: null,
  });

  const cleanupCanvasProxy = useCallback(() => {
    const proxy = canvasProxyRef.current;
    if (proxy.intervalId !== null) {
      clearInterval(proxy.intervalId);
      proxy.intervalId = null;
    }
    if (proxy.video) {
      proxy.video.srcObject = null;
      proxy.video.remove();
      proxy.video = null;
    }
    if (proxy.canvas) {
      proxy.canvas.remove();
      proxy.canvas = null;
    }
    proxy.ctx = null;
    proxy.region = null;
  }, []);

  const cleanup = useCallback(async () => {
    mediaRecorderRef.current?.stream
      .getTracks()
      .forEach((track) => track.stop());
    streamsRef.current.video?.getTracks().forEach((track) => track.stop());
    streamsRef.current.audio?.getTracks().forEach((track) => track.stop());

    if (audioSourceRef.current) {
      audioSourceRef.current.disconnect();
      audioSourceRef.current = null;
    }
    if (audioContextRef.current) {
      await audioContextRef.current.close().catch(() => {});
      audioContextRef.current = null;
    }

    cleanupCanvasProxy();

    mediaRecorderRef.current = null;
    chunksRef.current = [];
    streamsRef.current = {};
  }, [cleanupCanvasProxy]);


// Canvas proxy is used only for region cropping
// Full screen recording uses the raw video stream for better performance
  const setupCanvasProxy = useCallback(
    (videoStream: MediaStream, region: RegionBounds): MediaStream => {
      const video = document.createElement("video");
      video.muted = true;
      video.playsInline = true;
      // Hidden video element to draw frames from
      video.style.position = "fixed";
      video.style.top = "0";
      video.style.left = "0";
      video.style.width = "1px";
      video.style.height = "1px";
      video.style.opacity = "0.01";
      video.style.pointerEvents = "none";
      video.style.zIndex = "-1";
      document.body.appendChild(video);

      const canvas = document.createElement("canvas");
      canvas.width = CANVAS_WIDTH;
      canvas.height = CANVAS_HEIGHT;
      canvas.style.position = "fixed";
      canvas.style.top = "0";
      canvas.style.left = "0";
      canvas.style.width = "1px";
      canvas.style.height = "1px";
      canvas.style.opacity = "0.01";
      canvas.style.pointerEvents = "none";
      canvas.style.zIndex = "-1";
      document.body.appendChild(canvas);

      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("Failed to get canvas context");

      ctx.fillStyle = "black";
      ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

      canvasProxyRef.current = { video, canvas, ctx, intervalId: null, region };

      const drawFrame = () => {
        const proxy = canvasProxyRef.current;
        if (!proxy.video || !proxy.ctx || !proxy.canvas) return;

        // Skip if video doesn't have valid dimensions yet
        if (proxy.video.videoWidth === 0 || proxy.video.videoHeight === 0) {
          return;
        }

        proxy.ctx.fillStyle = "black";
        proxy.ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

        // Region recording: crop to the selected area
        if (proxy.region) {
          const scaleFactor = proxy.region.scaleFactor || 1;

          // Convert region coordinates from screen space to video space
          // The scaleFactor accounts for HiDPI displays (e.g., Retina displays have scaleFactor = 2)
          const srcX = proxy.region.x * scaleFactor;
          const srcY = proxy.region.y * scaleFactor;
          const srcWidth = proxy.region.width * scaleFactor;
          const srcHeight = proxy.region.height * scaleFactor;

          // Calculate destination dimensions maintaining aspect ratio
          const regionAspect = proxy.region.width / proxy.region.height;
          const canvasAspect = CANVAS_WIDTH / CANVAS_HEIGHT;

          let drawWidth: number;
          let drawHeight: number;
          let offsetX: number;
          let offsetY: number;

          if (regionAspect > canvasAspect) {
            drawWidth = CANVAS_WIDTH;
            drawHeight = CANVAS_WIDTH / regionAspect;
            offsetX = 0;
            offsetY = (CANVAS_HEIGHT - drawHeight) / 2;
          } else {
            drawHeight = CANVAS_HEIGHT;
            drawWidth = CANVAS_HEIGHT * regionAspect;
            offsetX = (CANVAS_WIDTH - drawWidth) / 2;
            offsetY = 0;
          }

          // Draw the cropped region to the canvas
          proxy.ctx.drawImage(
            proxy.video,
            srcX,
            srcY,
            srcWidth,
            srcHeight,
            offsetX,
            offsetY,
            drawWidth,
            drawHeight
          );
        }
      };

      // Set srcObject first
      video.srcObject = videoStream;

      // Use setInterval instead of requestAnimationFrame
      // requestAnimationFrame gets throttled when window is minimized/hidden
      // setInterval continues running even when window is not visible
      const frameInterval = Math.floor(1000 / CANVAS_FPS);
      canvasProxyRef.current.intervalId = setInterval(drawFrame, frameInterval);

      // Ensure video plays
      video.play().catch((err) => {
        console.error("Failed to play video:", err);
      });

      return canvas.captureStream(CANVAS_FPS);
    },
    []
  );

  const start = useCallback(
    async (
      sourceId?: string,
      options?: { micDeviceId?: string; cameraDeviceId?: string; region?: RegionBounds }
    ) => {
      setIsProcessing(true);
      try {
        const result = await window.electronAPI.screenRecording.start(sourceId);
        if (!result.success) throw new Error("Failed to start recording");

        const [videoStream, audioStream] = await Promise.all([
          navigator.mediaDevices.getUserMedia({
            audio: false,
            video: {
              mandatory: {
                chromeMediaSource: "desktop",
                chromeMediaSourceId: result.sourceId,
                // Set to 4K resolution (3840x2160) and 30 FPS to ensure high-quality recordings.
                maxWidth: 3840,
                maxHeight: 2160,
                maxFrameRate: 30,
              },
            } as ElectronVideoConstraints,
          }),
          navigator.mediaDevices.getUserMedia({
            audio: options?.micDeviceId
              ? { deviceId: { exact: options.micDeviceId } }
              : true,
            video: false,
          }),
        ]);

        const audioContext = new AudioContext();
        const audioSource = audioContext.createMediaStreamSource(audioStream);
        const gainNode = audioContext.createGain();
        // Create a silent audio pipeline to force Windows to keep the audio device active (prevents Windows from switching Bluetooth devices)
        gainNode.gain.value = 0;
        audioSource.connect(gainNode);
        gainNode.connect(audioContext.destination);

        audioContextRef.current = audioContext;
        audioSourceRef.current = audioSource;

        streamsRef.current = { video: videoStream, audio: audioStream };

        // Use Canvas Proxy only for region cropping (not needed for full screen)
        const finalVideoStream = options?.region
          ? setupCanvasProxy(videoStream, options.region)
          : videoStream;

        const recorder = new MediaRecorder(
          new MediaStream([
            ...finalVideoStream.getVideoTracks(),
            ...audioStream.getAudioTracks(),
          ]),
          { mimeType: VIDEO_MIME_TYPE }
        );

        chunksRef.current = [];
        recorder.ondataavailable = (e) =>
          e.data.size > 0 && chunksRef.current.push(e.data);

        mediaRecorderRef.current = recorder;

        recorder.start();
        try {
          await window.electronAPI.screenRecording.showControlBar(
            options?.cameraDeviceId
          );
        } catch (error) {
          recorder.stop();
          cleanup();
          toast.error(`Failed to show control bar: ${error}`);
          throw error;
        }

        setIsRecording(true);
        toast.success("Recording started");
      } catch (error) {
        cleanup();
        toast.error(`Failed to start recording: ${error}`);
        throw error;
      } finally {
        setIsProcessing(false);
      }
    },
    [cleanup, setupCanvasProxy]
  );

  const stop = useCallback(async (): Promise<{
    blob: Blob;
    filePath: string;
  } | null> => {
    if (!mediaRecorderRef.current) return null;

    const recorder = mediaRecorderRef.current;
    if (recorder.state === "inactive") return null;

    setIsProcessing(true);

    return new Promise((resolve) => {
      recorder.onstop = async () => {
        try {
          await window.electronAPI.screenRecording
            .hideControlBar()
            .catch(() => {});

          const blob = new Blob(chunksRef.current, { type: VIDEO_MIME_TYPE });
          const result = await window.electronAPI.screenRecording.stop(
            new Uint8Array(await blob.arrayBuffer())
          );

          if (!result.success || !result.filePath) {
            throw new Error(result.error || "Failed to save recording");
          }

          toast.success("Recording completed! Review your video.");
          resolve({ blob, filePath: result.filePath });
        } catch (error) {
          toast.error(`Failed to save recording: ${error}`);
          resolve(null);
        } finally {
          cleanup();
          setIsRecording(false);
          setIsProcessing(false);
        }
      };

      if (recorder.state === "recording") {
        recorder.stop();
      }
    });
  }, [cleanup]);

  return {
    isRecording,
    isProcessing,
    start,
    stop,
  };
}

import { useCallback, useRef, useState } from "react";
import { toast } from "sonner";
import type { RegionBounds } from "../types";

const VIDEO_MIME_TYPE = "video/mp4";

interface RecordingStreams {
  video?: MediaStream;
  audio?: MediaStream;
}

interface WebCodecsProxyRefs {
  processor: MediaStreamTrackProcessor | null;
  generator: MediaStreamTrackGenerator | null;
  reader: ReadableStreamDefaultReader<VideoFrame> | null;
  writer: WritableStreamDefaultWriter<VideoFrame> | null;
  offscreenCanvas: OffscreenCanvas | null;
  ctx: OffscreenCanvasRenderingContext2D | null;
  processingActive: boolean;
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
  const webCodecsProxyRef = useRef<WebCodecsProxyRefs>({
    processor: null,
    generator: null,
    reader: null,
    writer: null,
    offscreenCanvas: null,
    ctx: null,
    processingActive: false,
    region: null,
  });

  const cleanupWebCodecsProxy = useCallback(async () => {
    const proxy = webCodecsProxyRef.current;

    // Stop processing loop
    proxy.processingActive = false;

    // Cancel reader and close writer
    try {
      if (proxy.reader) {
        await proxy.reader.cancel();
        proxy.reader = null;
      }
      if (proxy.writer) {
        await proxy.writer.close();
        proxy.writer = null;
      }
    } catch (error) {
      console.error("Error closing WebCodecs streams:", error);
    }

    // Clean up processor and generator
    if (proxy.processor) {
      proxy.processor = null;
    }
    if (proxy.generator) {
      proxy.generator.stop();
      proxy.generator = null;
    }

    // Clean up canvas
    proxy.offscreenCanvas = null;
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

    await cleanupWebCodecsProxy();

    mediaRecorderRef.current = null;
    chunksRef.current = [];
    streamsRef.current = {};
  }, [cleanupWebCodecsProxy]);


  // WebCodecs proxy is used only for region cropping
  // Full screen recording uses the raw video stream for better performance
  const setupWebCodecsProxy = useCallback(
    (videoStream: MediaStream, region: RegionBounds): MediaStream => {
      const videoTrack = videoStream.getVideoTracks()[0];
      if (!videoTrack) throw new Error("No video track found");

      // Use region dimensions directly for the canvas to avoid aspect ratio issues
      // Scale factor is already applied in the region bounds
      const scaleFactor = region.scaleFactor || 1;
      const canvasWidth = Math.round(region.width * scaleFactor);
      const canvasHeight = Math.round(region.height * scaleFactor);

      // Ensure dimensions are even numbers (required for most video codecs)
      const evenWidth = canvasWidth % 2 === 0 ? canvasWidth : canvasWidth + 1;
      const evenHeight = canvasHeight % 2 === 0 ? canvasHeight : canvasHeight + 1;

      console.log(`[WebCodecs] Creating canvas: ${evenWidth}x${evenHeight} for region: ${region.width}x${region.height} (scaleFactor: ${scaleFactor})`);

      // Create OffscreenCanvas for GPU-accelerated rendering
      const offscreenCanvas = new OffscreenCanvas(evenWidth, evenHeight);
      const ctx = offscreenCanvas.getContext("2d");
      if (!ctx) throw new Error("Failed to get OffscreenCanvas context");

      // Initialize with black background
      ctx.fillStyle = "black";
      ctx.fillRect(0, 0, evenWidth, evenHeight);

      // Create MediaStreamTrackProcessor to read frames from the video track
      const processor = new MediaStreamTrackProcessor({ track: videoTrack });
      const reader = processor.readable.getReader();

      // Create MediaStreamTrackGenerator to output processed frames
      const generator = new MediaStreamTrackGenerator({ kind: "video" });
      const writer = generator.writable.getWriter();

      // Store refs
      webCodecsProxyRef.current = {
        processor,
        generator,
        reader,
        writer,
        offscreenCanvas,
        ctx,
        processingActive: true,
        region,
      };

      // Process frames asynchronously
      const processFrames = async () => {
        const proxy = webCodecsProxyRef.current;

        try {
          while (proxy.processingActive) {
            const { done, value: inputFrame } = await proxy.reader!.read();

            if (done || !proxy.processingActive) {
              inputFrame?.close();
              break;
            }

            try {
              const canvas = proxy.offscreenCanvas!;
              const ctx = proxy.ctx!;

              // Clear canvas with black background
              ctx.fillStyle = "black";
              ctx.fillRect(0, 0, canvas.width, canvas.height);

              // Region recording: crop to the selected area
              if (proxy.region) {
                const scaleFactor = proxy.region.scaleFactor || 1;

                // Convert region coordinates from screen space (logical pixels) to video space (physical pixels)
                // Include the monitor's global offset so coordinates map into the captured frame correctly
                // The scaleFactor accounts for HiDPI displays (e.g., Retina displays have scaleFactor = 2)
                const srcX = proxy.region.x * scaleFactor; 
                const srcY = proxy.region.y * scaleFactor;
                const srcWidth = proxy.region.width * scaleFactor;
                const srcHeight = proxy.region.height * scaleFactor;

                // Validate source coordinates
                if (srcX < 0 || srcY < 0 || srcWidth <= 0 || srcHeight <= 0) {
                  console.warn(`[WebCodecs] Invalid source coordinates: x=${srcX}, y=${srcY}, w=${srcWidth}, h=${srcHeight}`);
                  inputFrame.close();
                  continue;
                }

                // Check if source coordinates are within the video frame bounds
                if (srcX + srcWidth > inputFrame.displayWidth || srcY + srcHeight > inputFrame.displayHeight) {
                  console.warn(
                    `[WebCodecs] Source coordinates out of bounds. ` +
                    `Source: (${srcX}, ${srcY}, ${srcWidth}, ${srcHeight}), ` +
                    `Frame: ${inputFrame.displayWidth}x${inputFrame.displayHeight}`
                  );

              // Check bounds
                if (srcX + srcWidth > inputFrame.displayWidth || 
                    srcY + srcHeight > inputFrame.displayHeight) {
                  console.error(
                    `[WebCodecs] Coordinates out of bounds. ` +
                    `Region: (${srcX}, ${srcY}, ${srcWidth}, ${srcHeight}), ` +
                    `Frame: ${inputFrame.displayWidth}x${inputFrame.displayHeight}`
                  );
                  inputFrame.close();
                  continue;
                }

                  // Clamp to frame bounds
                  const clampedWidth = Math.min(srcWidth, inputFrame.displayWidth - srcX);
                  const clampedHeight = Math.min(srcHeight, inputFrame.displayHeight - srcY);

                  ctx.drawImage(
                    inputFrame,
                    srcX,
                    srcY,
                    clampedWidth,
                    clampedHeight,
                    0,
                    0,
                    canvas.width,
                    canvas.height
                  );
                } else {
                  // Draw the cropped region directly to fill the entire canvas
                  ctx.drawImage(
                    inputFrame,
                    srcX,
                    srcY,
                    srcWidth,
                    srcHeight,
                    0,
                    0,
                    canvas.width,
                    canvas.height
                  );
                }
              }

              // Create a new VideoFrame from the canvas
              const outputFrame = new VideoFrame(canvas, {
                timestamp: inputFrame.timestamp,
                duration: inputFrame.duration || undefined,
              });

              // Write the processed frame to the generator
              await proxy.writer!.write(outputFrame);

              // Close frames to free memory
              outputFrame.close();
            } catch (error) {
              console.error("[WebCodecs] Error processing frame:", error, {
                frameWidth: inputFrame?.displayWidth,
                frameHeight: inputFrame?.displayHeight,
                canvasWidth: proxy.offscreenCanvas?.width,
                canvasHeight: proxy.offscreenCanvas?.height,
                region: proxy.region,
              });
            } finally {
              // Always close the input frame
              inputFrame.close();
            }
          }
        } catch (error) {
          if (error instanceof Error && error.name !== "AbortError") {
            console.error("[WebCodecs] Frame processing error:", error);
          }
        }
      };

      // Start processing frames
      processFrames();

      // Return a MediaStream containing the generator track
      return new MediaStream([generator]);
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

        // Use WebCodecs Proxy only for region cropping (not needed for full screen)
        const finalVideoStream = options?.region
          ? setupWebCodecsProxy(videoStream, options.region)
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
    [cleanup, setupWebCodecsProxy]
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

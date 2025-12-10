import { useCallback, useRef, useState } from "react";
import { toast } from "sonner";

const VIDEO_MIME_TYPE = "video/mp4";

interface RecordingStreams {
  video?: MediaStream;
  audio?: MediaStream;
  croppedVideo?: MediaStream;
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
  const cropRafRef = useRef<number | null>(null);
  const regionRef = useRef<{
    x: number;
    y: number;
    width: number;
    height: number;
    displayId?: string;
  } | null>(null);

  const cleanup = useCallback(async () => {
    mediaRecorderRef.current?.stream
      .getTracks()
      .forEach((track) => track.stop());
    streamsRef.current.video?.getTracks().forEach((track) => track.stop());
    streamsRef.current.audio?.getTracks().forEach((track) => track.stop());
    streamsRef.current.croppedVideo
      ?.getTracks()
      .forEach((track) => track.stop());

    if (cropRafRef.current !== null) {
      cancelAnimationFrame(cropRafRef.current);
      cropRafRef.current = null;
    }

    if (regionRef.current) {
      await window.electronAPI.screenRecording
        .hideRegionHighlight()
        .catch(() => {});
    }

    regionRef.current = null;

    if (audioSourceRef.current) {
      audioSourceRef.current.disconnect();
      audioSourceRef.current = null;
    }
    if (audioContextRef.current) {
      await audioContextRef.current.close().catch(() => {});
      audioContextRef.current = null;
    }

    mediaRecorderRef.current = null;
    chunksRef.current = [];
    streamsRef.current = {};
  }, []);

  const start = useCallback(
    async (
      sourceId?: string,
      options?: { micDeviceId?: string; cameraDeviceId?: string }
    ) => {
      setIsProcessing(true);
      try {
        const generalSettings = await window.electronAPI.generalSettings
          .get()
          .catch(() => null);

        let selectedSourceId = sourceId;
        if (generalSettings?.enableRegionCapture) {
          const selection =
            await window.electronAPI.screenRecording.startRegionSelection();
          if ((selection as { cancelled?: boolean })?.cancelled) {
            setIsProcessing(false);
            return;
          }

          regionRef.current = selection as {
            x: number;
            y: number;
            width: number;
            height: number;
            displayId?: string;
          };

          if ((selection as { displayId?: string }).displayId) {
            const sources =
              await window.electronAPI.screenRecording.listSources();
            const matchingDisplay = sources.find(
              (s) =>
                s.displayId?.toString() ===
                (selection as { displayId?: string }).displayId
            );
            selectedSourceId = matchingDisplay?.id ?? sourceId;
          }
        }

        const result = await window.electronAPI.screenRecording.start(
          selectedSourceId
        );
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

        let effectiveVideoStream = videoStream;

        if (regionRef.current) {
          const cropped = await createCroppedStream(
            videoStream,
            regionRef.current,
            cropRafRef
          );
          effectiveVideoStream = cropped;
          streamsRef.current.croppedVideo = cropped;
        }

        const audioContext = new AudioContext();
        const audioSource = audioContext.createMediaStreamSource(audioStream);
        const gainNode = audioContext.createGain();
        // Create a silent audio pipeline to force Windows to keep the audio device active (prevents Windows from switching Bluetooth devices)
        gainNode.gain.value = 0;
        audioSource.connect(gainNode);
        gainNode.connect(audioContext.destination);

        audioContextRef.current = audioContext;
        audioSourceRef.current = audioSource;

        streamsRef.current = {
          video: videoStream,
          audio: audioStream,
          croppedVideo: streamsRef.current.croppedVideo,
        };

        const recorder = new MediaRecorder(
          new MediaStream([
            ...(effectiveVideoStream.getVideoTracks().length
              ? effectiveVideoStream.getVideoTracks()
              : videoStream.getVideoTracks()),
            ...audioStream.getAudioTracks(),
          ]),
          { mimeType: VIDEO_MIME_TYPE }
        );

        chunksRef.current = [];
        recorder.ondataavailable = (e) =>
          e.data.size > 0 && chunksRef.current.push(e.data);

        mediaRecorderRef.current = recorder;

        try {
          await window.electronAPI.screenRecording.showControlBar(
            options?.cameraDeviceId
          );

          recorder.start();

          await window.electronAPI.screenRecording.startTimer();

          if (regionRef.current) {
            await window.electronAPI.screenRecording
              .showRegionHighlight(regionRef.current)
              .catch(() => {});
          }
        } catch (error) {
          if (recorder.state !== "inactive") {
            recorder.stop();
          }
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
    [cleanup]
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
            .hideRegionHighlight()
            .catch(() => {});

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

async function createCroppedStream(
  source: MediaStream,
  region: { x: number; y: number; width: number; height: number },
  cropRafRef: { current: number | null }
): Promise<MediaStream> {
  const videoTrack = source.getVideoTracks()[0];
  if (!videoTrack) return source;

  const video = document.createElement("video");
  video.muted = true;
  video.srcObject = new MediaStream([videoTrack]);
  await video.play().catch(() => {});

  const canvas = document.createElement("canvas");
  canvas.width = region.width;
  canvas.height = region.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return source;

  const render = () => {
    ctx.clearRect(0, 0, region.width, region.height);
    ctx.drawImage(
      video,
      region.x,
      region.y,
      region.width,
      region.height,
      0,
      0,
      region.width,
      region.height
    );
    if (typeof video.requestVideoFrameCallback === "function") {
      video.requestVideoFrameCallback(() => render());
    } else {
      cropRafRef.current = requestAnimationFrame(render);
    }
  };

  if (typeof video.requestVideoFrameCallback === "function") {
    video.requestVideoFrameCallback(() => render());
  } else {
    cropRafRef.current = requestAnimationFrame(render);
  }

  const croppedStream = canvas.captureStream(30);
  return croppedStream;
}

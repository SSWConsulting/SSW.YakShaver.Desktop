import { useCallback, useRef, useState } from "react";
import { toast } from "sonner";

const VIDEO_MIME_TYPE = "video/mp4";

interface RecordingStreams {
  video?: MediaStream;
  audio?: MediaStream;
  camera?: MediaStream;
  composite?: MediaStream;
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
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const desktopVideoRef = useRef<HTMLVideoElement | null>(null);
  const cameraVideoRef = useRef<HTMLVideoElement | null>(null);
  const rafRef = useRef<number | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const audioSourceRef = useRef<MediaStreamAudioSourceNode | null>(null);

  const cleanup = useCallback(() => {
    mediaRecorderRef.current?.stream.getTracks().forEach((track) => track.stop());
    streamsRef.current.video?.getTracks().forEach((track) => track.stop());
    streamsRef.current.audio?.getTracks().forEach((track) => track.stop());
    streamsRef.current.camera?.getTracks().forEach((track) => track.stop());
    streamsRef.current.composite?.getTracks().forEach((track) => track.stop());
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    if (audioSourceRef.current) {
      audioSourceRef.current.disconnect();
      audioSourceRef.current = null;
    }
    if (audioContextRef.current) {
      audioContextRef.current.close();
      audioContextRef.current = null;
    }
    desktopVideoRef.current && (desktopVideoRef.current.srcObject = null);
    cameraVideoRef.current && (cameraVideoRef.current.srcObject = null);
    canvasRef.current = null;
    desktopVideoRef.current = null;
    cameraVideoRef.current = null;

    mediaRecorderRef.current = null;
    chunksRef.current = [];
    streamsRef.current = {};
  }, []);

  const start = useCallback(
    async (
      sourceId?: string,
      options?: { micDeviceId?: string; cameraDeviceId?: string },
    ) => {
      setIsProcessing(true);
      try {
        const result = await window.electronAPI.screenRecording.start(sourceId);
        if (!result.success) {
          throw new Error("Failed to start recording");
        }

        const videoStream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: {
            mandatory: {
              chromeMediaSource: "desktop",
              chromeMediaSourceId: result.sourceId,
            },
          } as ElectronVideoConstraints,
        });

        // Get audio stream
        const audioConstraints = options?.micDeviceId
          ? { deviceId: { exact: options.micDeviceId } }
          : true;

        const audioStream = await navigator.mediaDevices.getUserMedia({
          audio: audioConstraints,
          video: false,
        });

        // Create AudioContext to keep audio pipeline active (prevents Windows from switching Bluetooth devices)
        const audioContext = new AudioContext();
        const audioSource = audioContext.createMediaStreamSource(audioStream);
        const gainNode = audioContext.createGain();
        gainNode.gain.value = 0; // Silent, we just need to keep the pipeline active
        audioSource.connect(gainNode);
        gainNode.connect(audioContext.destination);

        audioContextRef.current = audioContext;
        audioSourceRef.current = audioSource;

        let compositeStream: MediaStream | null = null;
        if (options?.cameraDeviceId) {
          const camStream = await navigator.mediaDevices.getUserMedia({
            video: { deviceId: { exact: options.cameraDeviceId } },
            audio: false,
          });
          const desktopVideo = document.createElement("video");
          const cameraVideo = document.createElement("video");
          desktopVideo.muted = true;
          cameraVideo.muted = true;
          desktopVideo.playsInline = true;
          cameraVideo.playsInline = true;
          desktopVideo.srcObject = videoStream;
          cameraVideo.srcObject = camStream;
          await Promise.all([
            desktopVideo.play().catch(() => {}),
            cameraVideo.play().catch(() => {}),
          ]);
          const settings = videoStream.getVideoTracks()[0].getSettings();
          const width = settings.width || 1280;
          const height = settings.height || 720;
          const canvas = document.createElement("canvas");
          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext("2d");
          const draw = () => {
            if (!ctx) return;
            ctx.clearRect(0, 0, width, height);
            ctx.drawImage(desktopVideo, 0, 0, width, height);
            const camW = Math.floor(width * 0.25);
            const camH = Math.floor(height * 0.25);
            const x = width - camW - 16;
            const y = height - camH - 16;
            ctx.drawImage(cameraVideo, x, y, camW, camH);
            rafRef.current = requestAnimationFrame(draw);
          };
          draw();
          compositeStream = canvas.captureStream(30);
          canvasRef.current = canvas;
          desktopVideoRef.current = desktopVideo;
          cameraVideoRef.current = cameraVideo;
          streamsRef.current = { video: videoStream, audio: audioStream, camera: camStream, composite: compositeStream };
        } else {
          streamsRef.current = { video: videoStream, audio: audioStream };
        }

        const videoTracks = compositeStream
          ? compositeStream.getVideoTracks()
          : videoStream.getVideoTracks();

        const recorder = new MediaRecorder(
          new MediaStream([...videoTracks, ...audioStream.getAudioTracks()]),
          { mimeType: VIDEO_MIME_TYPE },
        );

        chunksRef.current = [];
        recorder.ondataavailable = (e) => e.data.size > 0 && chunksRef.current.push(e.data);

        recorder.start();
        mediaRecorderRef.current = recorder;
        setIsRecording(true);

        await window.electronAPI.screenRecording.showControlBar();
        toast.success("Recording started");
      } catch (error) {
        cleanup();
        toast.error(`Failed to start recording: ${error}`);
        throw error;
      } finally {
        setIsProcessing(false);
      }
    },
    [cleanup],
  );

  const stop = useCallback(async (): Promise<{ blob: Blob; filePath: string } | null> => {
    if (!mediaRecorderRef.current) return null;

    setIsProcessing(true);
    const recorder = mediaRecorderRef.current;

    return new Promise((resolve) => {
      recorder.onstop = async () => {
        try {
          await window.electronAPI.screenRecording.hideControlBar();

          const blob = new Blob(chunksRef.current, { type: VIDEO_MIME_TYPE });
          const result = await window.electronAPI.screenRecording.stop(
            new Uint8Array(await blob.arrayBuffer()),
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

      recorder.stop();
    });
  }, [cleanup]);

  return {
    isRecording,
    isProcessing,
    start,
    stop,
  };
}

import { useCallback, useRef, useState } from "react";
import { toast } from "sonner";
import { CAMERA_ONLY_SOURCE_ID } from "../constants/recording";

const VIDEO_MIME_TYPE = "video/mp4";

interface RecordingStreams {
  video?: MediaStream;
  audio?: MediaStream;
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

  const cleanup = useCallback(async () => {
    mediaRecorderRef.current?.stream.getTracks().forEach((track) => {
      track.stop();
    });
    streamsRef.current.video?.getTracks().forEach((track) => {
      track.stop();
    });
    streamsRef.current.audio?.getTracks().forEach((track) => {
      track.stop();
    });

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

  const setupAudioContext = useCallback((audioStream: MediaStream) => {
    const audioContext = new AudioContext();
    const audioSource = audioContext.createMediaStreamSource(audioStream);
    const gainNode = audioContext.createGain();
    // Create a silent audio pipeline to force Windows to keep the audio device active (prevents Windows from switching Bluetooth devices)
    gainNode.gain.value = 0;
    audioSource.connect(gainNode);
    gainNode.connect(audioContext.destination);

    audioContextRef.current = audioContext;
    audioSourceRef.current = audioSource;
  }, []);

  const setupRecorder = useCallback((videoStream: MediaStream, audioStream: MediaStream) => {
    streamsRef.current = { video: videoStream, audio: audioStream };

    const recorder = new MediaRecorder(
      new MediaStream([...videoStream.getVideoTracks(), ...audioStream.getAudioTracks()]),
      { mimeType: VIDEO_MIME_TYPE },
    );

    chunksRef.current = [];
    recorder.ondataavailable = (e) => e.data.size > 0 && chunksRef.current.push(e.data);

    mediaRecorderRef.current = recorder;
    return recorder;
  }, []);

  const startRecorder = useCallback(
    async (recorder: MediaRecorder, cameraDeviceId?: string | null) => {
      try {
        await window.electronAPI.screenRecording.showControlBar(cameraDeviceId ?? undefined);
        recorder.start();
        await window.electronAPI.screenRecording.startTimer();
      } catch (error) {
        if (recorder.state !== "inactive") {
          recorder.stop();
        }
        cleanup();
        toast.error(`Failed to show control bar: ${error}`);
        throw error;
      }
    },
    [cleanup],
  );

  const start = useCallback(
    async (sourceId?: string, options?: { micDeviceId?: string; cameraDeviceId?: string }) => {
      setIsProcessing(true);
      try {
        const isCameraOnly = sourceId === CAMERA_ONLY_SOURCE_ID;
        
        if (isCameraOnly) {
          // Camera-only mode: use camera as main video source
          if (!options?.cameraDeviceId) {
            throw new Error("Camera device is required for camera-only mode");
          }

          const [cameraStream, audioStream] = await Promise.all([
            navigator.mediaDevices.getUserMedia({
              audio: false,
              video: {
                deviceId: { exact: options.cameraDeviceId },
                // Most cameras don't support 4K, so we use Full HD (1920x1080) as a reasonable default.
                width: { ideal: 1920 },
                height: { ideal: 1080 },
              },
            }),
            navigator.mediaDevices.getUserMedia({
              audio: options?.micDeviceId ? { deviceId: { exact: options.micDeviceId } } : true,
              video: false,
            }),
          ]);

          setupAudioContext(audioStream);
          const recorder = setupRecorder(cameraStream, audioStream);
          // Pass null for camera device ID to indicate no camera PIP should be shown
          await startRecorder(recorder, null);

          setIsRecording(true);
          toast.success("Recording started");
        } else {
          // Screen recording mode (original behavior)
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
              audio: options?.micDeviceId ? { deviceId: { exact: options.micDeviceId } } : true,
              video: false,
            }),
          ]);

          setupAudioContext(audioStream);
          const recorder = setupRecorder(videoStream, audioStream);
          await startRecorder(recorder, options?.cameraDeviceId);

          setIsRecording(true);
          toast.success("Recording started");
        }
      } catch (error) {
        cleanup();
        toast.error(`Failed to start recording: ${error}`);
        throw error;
      } finally {
        setIsProcessing(false);
      }
    },
    [cleanup, setupAudioContext, setupRecorder, startRecorder],
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
          await window.electronAPI.screenRecording.hideControlBar().catch(() => {});

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

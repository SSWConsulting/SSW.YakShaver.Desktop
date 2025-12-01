import { useCallback, useRef, useState } from "react";
import { toast } from "sonner";

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

  const cleanup = useCallback(() => {
    mediaRecorderRef.current?.stream
      .getTracks()
      .forEach((track) => track.stop());
    streamsRef.current.video?.getTracks().forEach((track) => track.stop());
    streamsRef.current.audio?.getTracks().forEach((track) => track.stop());

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
        const result = await window.electronAPI.screenRecording.start(sourceId);
        if (!result.success) throw new Error("Failed to start recording");

        // Get screen and audio streams only - camera is handled separately
        const [videoStream, audioStream] = await Promise.all([
          navigator.mediaDevices.getUserMedia({
            audio: false,
            video: {
              mandatory: {
                chromeMediaSource: "desktop",
                chromeMediaSourceId: result.sourceId,
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

        streamsRef.current = { video: videoStream, audio: audioStream };

        // Record only the screen stream
        const recorder = new MediaRecorder(
          new MediaStream([
            ...videoStream.getVideoTracks(),
            ...audioStream.getAudioTracks(),
          ]),
          { mimeType: VIDEO_MIME_TYPE }
        );

        chunksRef.current = [];
        recorder.ondataavailable = (e) =>
          e.data.size > 0 && chunksRef.current.push(e.data);
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
    [cleanup]
  );

  const stop = useCallback(async (): Promise<{
    blob: Blob;
    filePath: string;
  } | null> => {
    if (!mediaRecorderRef.current) return null;

    setIsProcessing(true);
    const recorder = mediaRecorderRef.current;

    return new Promise((resolve) => {
      recorder.onstop = async () => {
        try {
          await window.electronAPI.screenRecording.hideControlBar();

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

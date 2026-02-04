import { useCallback, useRef, useState } from "react";
import { toast } from "sonner";
import { CAMERA_ONLY_SOURCE_ID } from "../constants/recording";

const VIDEO_MIME_TYPE = "video/mp4";
// Audio gain boost value to ensure adequate volume levels in recordings
// A value of 1.5 (50% boost) provides clear audio without distortion
const AUDIO_GAIN_BOOST = 1.5;

interface RecordingStreams {
  video?: MediaStream;
  audio?: MediaStream;
  systemAudio?: MediaStream;
  displayStream?: MediaStream; // Keep alive for system audio to work
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
  const systemAudioSourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const mixedAudioDestinationRef = useRef<MediaStreamAudioDestinationNode | null>(null);
  const gainNodeRef = useRef<GainNode | null>(null);

  const cleanup = useCallback(async () => {
    // Disable loopback audio (was kept enabled during recording for system audio capture)
    await window.electronAPI.screenRecording.disableLoopbackAudio().catch(() => {});

    mediaRecorderRef.current?.stream.getTracks().forEach((track) => {
      track.stop();
    });
    streamsRef.current.video?.getTracks().forEach((track) => {
      track.stop();
    });
    streamsRef.current.audio?.getTracks().forEach((track) => {
      track.stop();
    });
    streamsRef.current.systemAudio?.getTracks().forEach((track) => {
      track.stop();
    });
    // Stop the display stream (kept alive for system audio)
    streamsRef.current.displayStream?.getTracks().forEach((track) => {
      track.stop();
    });

    if (audioSourceRef.current) {
      audioSourceRef.current.disconnect();
      audioSourceRef.current = null;
    }
    if (systemAudioSourceRef.current) {
      systemAudioSourceRef.current.disconnect();
      systemAudioSourceRef.current = null;
    }
    if (gainNodeRef.current) {
      gainNodeRef.current.disconnect();
      gainNodeRef.current = null;
    }
    // Disconnect and clean up the MediaStreamAudioDestinationNode to free resources
    if (mixedAudioDestinationRef.current) {
      mixedAudioDestinationRef.current.disconnect();
      mixedAudioDestinationRef.current = null;
    }
    if (audioContextRef.current) {
      await audioContextRef.current.close().catch(() => {});
      audioContextRef.current = null;
    }

    mediaRecorderRef.current = null;
    chunksRef.current = [];
    streamsRef.current = {};
  }, []);

  const setupRecorder = useCallback(
    (videoStream: MediaStream, audioStream: MediaStream, systemAudioStream?: MediaStream) => {
      console.log("[SetupRecorder] Setting up recorder...");
      console.log("[SetupRecorder] Video tracks:", videoStream.getVideoTracks().length);
      console.log("[SetupRecorder] Mic audio tracks:", audioStream.getAudioTracks().length);
      console.log(
        "[SetupRecorder] System audio stream:",
        systemAudioStream ? "present" : "missing",
      );
      console.log(
        "[SetupRecorder] System audio tracks:",
        systemAudioStream?.getAudioTracks().length ?? 0,
      );

      streamsRef.current = {
        video: videoStream,
        audio: audioStream,
        systemAudio: systemAudioStream,
      };

      // Close existing audio context if present to prevent resource leaks
      if (audioContextRef.current && audioContextRef.current.state !== "closed") {
        audioContextRef.current.close().catch((err) => {
          console.warn("Failed to close audio context:", err);
        });
      }

      // Create a new AudioContext for mixing audio sources
      const audioContext = new AudioContext();

      // Create source nodes for each audio stream
      const micSource = audioContext.createMediaStreamSource(audioStream);

      // Create gain nodes for volume control
      // Using gain boost to ensure adequate audio levels for better audibility
      const micGain = audioContext.createGain();
      micGain.gain.value = AUDIO_GAIN_BOOST;

      // Create a destination node that will output the mixed audio as a MediaStream
      const destination = audioContext.createMediaStreamDestination();

      // Connect microphone through gain to destination
      micSource.connect(micGain);
      micGain.connect(destination);

      // Also create a silent pipeline to force Windows to keep the audio device active
      // This prevents Windows from switching Bluetooth devices during recording
      const silentGainNode = audioContext.createGain();
      silentGainNode.gain.value = 0; // Silent
      micSource.connect(silentGainNode);
      silentGainNode.connect(audioContext.destination);

      // If we have system audio, mix it in
      if (systemAudioStream && systemAudioStream.getAudioTracks().length > 0) {
        console.log("[SetupRecorder] Mixing system audio into recording...");

        const systemTrack = systemAudioStream.getAudioTracks()[0];
        console.log("[SetupRecorder] System audio track enabled:", systemTrack.enabled);
        console.log("[SetupRecorder] System audio track readyState:", systemTrack.readyState);
        console.log("[SetupRecorder] System audio track muted:", systemTrack.muted);
        console.log(
          "[SetupRecorder] System audio track settings:",
          JSON.stringify(systemTrack.getSettings()),
        );

        // Listen for track ending
        systemTrack.onended = () => console.warn("[SetupRecorder] System audio track ENDED!");
        systemTrack.onmute = () => console.warn("[SetupRecorder] System audio track MUTED!");

        const systemSource = audioContext.createMediaStreamSource(systemAudioStream);

        // Create gain node for system audio
        const systemGain = audioContext.createGain();
        systemGain.gain.value = AUDIO_GAIN_BOOST;
        console.log("[SetupRecorder] System audio gain:", AUDIO_GAIN_BOOST);

        // Connect system audio through gain to destination
        systemSource.connect(systemGain);
        systemGain.connect(destination);

        // Also connect system audio to the silent pipeline for consistency
        systemSource.connect(silentGainNode);
        systemAudioSourceRef.current = systemSource;
        console.log("[SetupRecorder] System audio connected to mixer");
      } else {
        console.log("[SetupRecorder] No system audio to mix");
      }

      // Store references for cleanup
      audioContextRef.current = audioContext;
      audioSourceRef.current = micSource;
      mixedAudioDestinationRef.current = destination;
      gainNodeRef.current = silentGainNode;

      // Ensure AudioContext is running (may be suspended by browser policy)
      if (audioContext.state === "suspended") {
        console.log("[SetupRecorder] AudioContext suspended, resuming...");
        audioContext.resume();
      }
      console.log("[SetupRecorder] AudioContext state:", audioContext.state);
      console.log(
        "[SetupRecorder] Mixed audio tracks:",
        destination.stream.getAudioTracks().length,
      );

      // Create MediaRecorder with video and the MIXED audio stream
      const recorder = new MediaRecorder(
        new MediaStream([
          ...videoStream.getVideoTracks(),
          ...destination.stream.getAudioTracks(), // Use the mixed audio from Web Audio API
        ]),
        { mimeType: VIDEO_MIME_TYPE },
      );

      console.log(
        "[SetupRecorder] MediaRecorder created with",
        recorder.stream.getAudioTracks().length,
        "audio tracks",
      );

      chunksRef.current = [];
      recorder.ondataavailable = (e) => e.data.size > 0 && chunksRef.current.push(e.data);

      mediaRecorderRef.current = recorder;
      return recorder;
    },
    [],
  );

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

          const recorder = setupRecorder(cameraStream, audioStream);
          // Pass null for camera device ID to indicate no camera PIP should be shown
          await startRecorder(recorder, null);

          setIsRecording(true);
          toast.success("Recording started");
        } else {
          // Screen recording mode with system audio capture
          const result = await window.electronAPI.screenRecording.start(sourceId);
          if (!result.success) throw new Error("Failed to start recording");

          // Request system audio via electron-audio-loopback
          // This captures system audio on macOS 12.3+, Windows 10+, and Linux
          let systemAudioStream: MediaStream | undefined;
          try {
            // Enable loopback audio before calling getDisplayMedia
            console.log("[SystemAudio] Enabling loopback...");
            await window.electronAPI.screenRecording.enableLoopbackAudio();
            console.log("[SystemAudio] Loopback enabled, requesting display media...");

            // Get display media - loopback audio will be included
            const displayStream = await navigator.mediaDevices.getDisplayMedia({
              video: true,
              audio: true,
            });

            console.log("[SystemAudio] Display stream obtained");
            console.log("[SystemAudio] Audio tracks:", displayStream.getAudioTracks().length);
            console.log("[SystemAudio] Video tracks:", displayStream.getVideoTracks().length);

            // Check track state IMMEDIATELY after getDisplayMedia
            const audioTrack = displayStream.getAudioTracks()[0];
            if (audioTrack) {
              console.log("[SystemAudio] Audio track state IMMEDIATELY:", audioTrack.readyState);
            }

            // DON'T disable loopback yet - it will end the audio track!
            // We'll disable it in cleanup() when recording stops

            // DON'T stop the video tracks - the audio track lifecycle may be linked to them
            // Just extract the audio track to use for mixing
            const audioTracks = displayStream.getAudioTracks();

            if (audioTracks.length > 0) {
              // Create a new stream with just the audio track
              // Keep the original displayStream alive (don't stop video tracks)
              // The audio may depend on the video track being active
              systemAudioStream = new MediaStream(audioTracks);

              // Store the display stream so we can stop it during cleanup
              streamsRef.current.displayStream = displayStream;

              console.log("[SystemAudio] Audio extracted, track state:", audioTracks[0].readyState);
              toast.success("System audio capture enabled");
            } else {
              // No audio tracks, safe to disable loopback now
              await window.electronAPI.screenRecording.disableLoopbackAudio();
              displayStream.getTracks().forEach((track) => track.stop());
              toast.info("Recording without system audio - only microphone will be captured");
            }
          } catch (displayError) {
            // Ensure loopback is disabled on error
            await window.electronAPI.screenRecording.disableLoopbackAudio().catch(() => {});
            console.warn("System audio not available:", displayError);
            toast.info("Recording without system audio - only microphone will be captured");
          }

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

          const recorder = setupRecorder(videoStream, audioStream, systemAudioStream);
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
    [cleanup, setupRecorder, startRecorder],
  );

  const stop = useCallback(async (): Promise<{
    blob: Blob;
    filePath: string;
    fileName: string;
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
          resolve({
            blob,
            filePath: result.filePath,
            fileName: result.fileName || result.filePath,
          });
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

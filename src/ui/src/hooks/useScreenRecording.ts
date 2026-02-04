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
    // MediaStreamAudioDestinationNode is a destination node (sources connect TO it)
    // so we don't disconnect it, but we clean up the reference
    if (mixedAudioDestinationRef.current) {
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

  const setupRecorder = useCallback((videoStream: MediaStream, audioStream: MediaStream, systemAudioStream?: MediaStream) => {
    streamsRef.current = { video: videoStream, audio: audioStream, systemAudio: systemAudioStream };

    // Close existing audio context if present to prevent resource leaks
    if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
      audioContextRef.current.close().catch(() => {});
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
      const systemSource = audioContext.createMediaStreamSource(systemAudioStream);
      
      // Create gain node for system audio
      const systemGain = audioContext.createGain();
      systemGain.gain.value = AUDIO_GAIN_BOOST;
      
      // Connect system audio through gain to destination
      systemSource.connect(systemGain);
      systemGain.connect(destination);
      
      // Also connect system audio to the silent pipeline for consistency
      systemSource.connect(silentGainNode);
      systemAudioSourceRef.current = systemSource;
    }
    
    // Store references for cleanup
    audioContextRef.current = audioContext;
    audioSourceRef.current = micSource;
    mixedAudioDestinationRef.current = destination;
    gainNodeRef.current = silentGainNode;

    // Create MediaRecorder with video and the MIXED audio stream
    const recorder = new MediaRecorder(
      new MediaStream([
        ...videoStream.getVideoTracks(),
        ...destination.stream.getAudioTracks() // Use the mixed audio from Web Audio API
      ]),
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

          const recorder = setupRecorder(cameraStream, audioStream);
          // Pass null for camera device ID to indicate no camera PIP should be shown
          await startRecorder(recorder, null);

          setIsRecording(true);
          toast.success("Recording started");
        } else {
          // Screen recording mode with system audio capture
          const result = await window.electronAPI.screenRecording.start(sourceId);
          if (!result.success) throw new Error("Failed to start recording");

          // Request system audio via getDisplayMedia
          // This will prompt the user to share system audio and capture audio from remote participants
          let systemAudioStream: MediaStream | undefined;
          try {
            // Use getDisplayMedia to request system audio loopback
            // The backend's setDisplayMediaRequestHandler will provide the loopback audio
            // Note: We request both video and audio because getDisplayMedia requires at least one
            const displayStream = await navigator.mediaDevices.getDisplayMedia({
              video: true, // Required by getDisplayMedia API
              audio: true, // Request system audio (loopback will be provided by backend handler)
            });
            
            // Stop video tracks immediately since we only want audio
            displayStream.getVideoTracks().forEach(track => {
              track.stop();
            });
            
            // Check if we got audio tracks
            if (displayStream.getAudioTracks().length > 0) {
              // Store the stream with audio tracks for recording
              systemAudioStream = displayStream;
              toast.success("System audio capture enabled");
            } else {
              // If no audio tracks, stop any remaining tracks to prevent resource leak
              displayStream.getTracks().forEach(track => track.stop());
              console.warn("Display stream has no audio tracks");
            }
          } catch (displayError) {
            // User may have denied system audio permission or it's not available
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

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { CAMERA_ONLY_SOURCE_ID } from "../constants/recording";

const VIDEO_MIME_TYPE = "video/mp4";
const AUDIO_GAIN_BOOST = 1.5;

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

// Buffer for receiving system audio PCM data from main process
class SystemAudioBuffer {
  private buffer: Float32Array[] = [];
  private sampleRate = 48000;
  private isFloat = false;
  private channelCount = 1;

  setMetadata(metadata: { sampleRate: number; isFloat: boolean; channelsPerFrame: number }) {
    this.sampleRate = metadata.sampleRate;
    this.isFloat = metadata.isFloat;
    this.channelCount = metadata.channelsPerFrame;
    console.log("[SystemAudio] Metadata set:", metadata);
  }

  pushData(data: ArrayBuffer) {
    // Convert raw PCM to Float32
    let float32Data: Float32Array;
    
    if (this.isFloat) {
      // Already 32-bit float
      float32Data = new Float32Array(data);
    } else {
      // 16-bit signed integer - convert to float
      const int16Data = new Int16Array(data);
      float32Data = new Float32Array(int16Data.length);
      for (let i = 0; i < int16Data.length; i++) {
        float32Data[i] = int16Data[i] / 32768;
      }
    }
    
    this.buffer.push(float32Data);
    
    // Keep buffer from growing too large (max ~1 second)
    while (this.buffer.length > 10) {
      this.buffer.shift();
    }
  }

  // Get samples to fill an output buffer
  getSamples(outputLength: number): Float32Array {
    const result = new Float32Array(outputLength);
    let resultIndex = 0;
    
    while (resultIndex < outputLength && this.buffer.length > 0) {
      const chunk = this.buffer[0];
      const remaining = outputLength - resultIndex;
      const toCopy = Math.min(remaining, chunk.length);
      
      result.set(chunk.subarray(0, toCopy), resultIndex);
      resultIndex += toCopy;
      
      if (toCopy >= chunk.length) {
        this.buffer.shift();
      } else {
        // Partial copy - remove used portion
        this.buffer[0] = chunk.subarray(toCopy);
      }
    }
    
    return result;
  }

  hasData(): boolean {
    return this.buffer.length > 0;
  }

  clear() {
    this.buffer = [];
  }

  getSampleRate(): number {
    return this.sampleRate;
  }
}

export function useScreenRecording() {
  const [isRecording, setIsRecording] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamsRef = useRef<RecordingStreams>({});
  const audioContextRef = useRef<AudioContext | null>(null);
  const audioSourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const mixedAudioDestinationRef = useRef<MediaStreamAudioDestinationNode | null>(null);
  const systemAudioBufferRef = useRef<SystemAudioBuffer>(new SystemAudioBuffer());
  const scriptProcessorRef = useRef<ScriptProcessorNode | null>(null);
  const unsubscribeDataRef = useRef<(() => void) | null>(null);
  const unsubscribeMetadataRef = useRef<(() => void) | null>(null);

  // Set up system audio data listener
  const setupSystemAudioListener = useCallback(() => {
    // Subscribe to system audio data from main process
    unsubscribeDataRef.current = window.electronAPI.screenRecording.onSystemAudioData((data) => {
      systemAudioBufferRef.current.pushData(data.data);
    });

    unsubscribeMetadataRef.current = window.electronAPI.screenRecording.onSystemAudioMetadata(
      (metadata) => {
        systemAudioBufferRef.current.setMetadata(
          metadata as { sampleRate: number; isFloat: boolean; channelsPerFrame: number }
        );
      }
    );
  }, []);

  const cleanupSystemAudioListener = useCallback(() => {
    if (unsubscribeDataRef.current) {
      unsubscribeDataRef.current();
      unsubscribeDataRef.current = null;
    }
    if (unsubscribeMetadataRef.current) {
      unsubscribeMetadataRef.current();
      unsubscribeMetadataRef.current = null;
    }
  }, []);

  const cleanup = useCallback(async () => {
    // Stop system audio capture
    await window.electronAPI.screenRecording.stopSystemAudio().catch(() => {});
    cleanupSystemAudioListener();
    systemAudioBufferRef.current.clear();

    mediaRecorderRef.current?.stream.getTracks().forEach((track) => track.stop());
    streamsRef.current.video?.getTracks().forEach((track) => track.stop());
    streamsRef.current.audio?.getTracks().forEach((track) => track.stop());

    if (audioSourceRef.current) {
      audioSourceRef.current.disconnect();
      audioSourceRef.current = null;
    }
    if (scriptProcessorRef.current) {
      scriptProcessorRef.current.disconnect();
      scriptProcessorRef.current = null;
    }
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
  }, [cleanupSystemAudioListener]);

  const setupRecorder = useCallback(
    (videoStream: MediaStream, audioStream: MediaStream, includeSystemAudio: boolean) => {
      streamsRef.current = { video: videoStream, audio: audioStream };

      // Close existing audio context if present
      if (audioContextRef.current && audioContextRef.current.state !== "closed") {
        audioContextRef.current.close().catch(() => {});
      }

      const audioContext = new AudioContext({ sampleRate: 48000 });
      const micSource = audioContext.createMediaStreamSource(audioStream);
      const micGain = audioContext.createGain();
      micGain.gain.value = AUDIO_GAIN_BOOST;
      const destination = audioContext.createMediaStreamDestination();

      // Connect microphone
      micSource.connect(micGain);
      micGain.connect(destination);

      // If including system audio, create a ScriptProcessor to inject PCM data
      if (includeSystemAudio) {
        console.log("[SetupRecorder] Setting up system audio injection...");
        
        // ScriptProcessorNode is deprecated but works reliably for this use case
        // Buffer size of 4096 gives ~85ms latency at 48kHz
        const scriptProcessor = audioContext.createScriptProcessor(4096, 1, 1);
        const systemGain = audioContext.createGain();
        systemGain.gain.value = AUDIO_GAIN_BOOST;
        
        scriptProcessor.onaudioprocess = (event) => {
          const outputBuffer = event.outputBuffer.getChannelData(0);
          const samples = systemAudioBufferRef.current.getSamples(outputBuffer.length);
          outputBuffer.set(samples);
        };
        
        // Connect: scriptProcessor -> systemGain -> destination
        scriptProcessor.connect(systemGain);
        systemGain.connect(destination);
        
        // Also need a dummy input to keep scriptProcessor running
        // Create an oscillator at 0 Hz (DC) with 0 gain
        const oscillator = audioContext.createOscillator();
        const silentGain = audioContext.createGain();
        silentGain.gain.value = 0;
        oscillator.connect(silentGain);
        silentGain.connect(scriptProcessor);
        oscillator.start();
        
        scriptProcessorRef.current = scriptProcessor;
        console.log("[SetupRecorder] System audio injection ready");
      }

      audioContextRef.current = audioContext;
      audioSourceRef.current = micSource;
      mixedAudioDestinationRef.current = destination;

      // Ensure AudioContext is running
      if (audioContext.state === "suspended") {
        audioContext.resume();
      }

      const recorder = new MediaRecorder(
        new MediaStream([
          ...videoStream.getVideoTracks(),
          ...destination.stream.getAudioTracks(),
        ]),
        { mimeType: VIDEO_MIME_TYPE }
      );

      chunksRef.current = [];
      recorder.ondataavailable = (e) => e.data.size > 0 && chunksRef.current.push(e.data);

      mediaRecorderRef.current = recorder;
      return recorder;
    },
    []
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
    [cleanup]
  );

  const start = useCallback(
    async (sourceId?: string, options?: { micDeviceId?: string; cameraDeviceId?: string }) => {
      setIsProcessing(true);
      try {
        const isCameraOnly = sourceId === CAMERA_ONLY_SOURCE_ID;

        if (isCameraOnly) {
          // Camera-only mode
          if (!options?.cameraDeviceId) {
            throw new Error("Camera device is required for camera-only mode");
          }

          const [cameraStream, audioStream] = await Promise.all([
            navigator.mediaDevices.getUserMedia({
              audio: false,
              video: {
                deviceId: { exact: options.cameraDeviceId },
                width: { ideal: 1920 },
                height: { ideal: 1080 },
              },
            }),
            navigator.mediaDevices.getUserMedia({
              audio: options?.micDeviceId ? { deviceId: { exact: options.micDeviceId } } : true,
              video: false,
            }),
          ]);

          const recorder = setupRecorder(cameraStream, audioStream, false);
          await startRecorder(recorder, null);

          setIsRecording(true);
          toast.success("Recording started");
        } else {
          // Screen recording mode
          const result = await window.electronAPI.screenRecording.start(sourceId);
          if (!result.success) throw new Error("Failed to start recording");

          // Try to start system audio capture
          let systemAudioEnabled = false;
          try {
            console.log("[Recording] Starting system audio capture...");
            setupSystemAudioListener();
            
            const systemAudioResult = await window.electronAPI.screenRecording.startSystemAudio();
            console.log("[Recording] System audio result:", systemAudioResult);
            if (systemAudioResult.success) {
              systemAudioEnabled = true;
              console.log("[Recording] System audio capture started");
              toast.success("System audio capture enabled");
            } else {
              console.warn("[Recording] System audio not available:", systemAudioResult.error);
              cleanupSystemAudioListener();
              if (systemAudioResult.error?.includes("permission")) {
                toast.warning("System audio requires permission. Check System Settings.", {
                  duration: 5000,
                });
              } else {
                toast.info("Recording without system audio - only microphone will be captured");
              }
            }
          } catch (error) {
            console.warn("[Recording] System audio error:", error);
            cleanupSystemAudioListener();
            toast.info("Recording without system audio - only microphone will be captured");
          }

          const [videoStream, audioStream] = await Promise.all([
            navigator.mediaDevices.getUserMedia({
              audio: false,
              video: {
                mandatory: {
                  chromeMediaSource: "desktop",
                  chromeMediaSourceId: result.sourceId,
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

          const recorder = setupRecorder(videoStream, audioStream, systemAudioEnabled);
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
    [cleanup, setupRecorder, startRecorder, setupSystemAudioListener, cleanupSystemAudioListener]
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
            new Uint8Array(await blob.arrayBuffer())
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

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      cleanup();
    };
  }, [cleanup]);

  return {
    isRecording,
    isProcessing,
    start,
    stop,
  };
}

import { useCallback, useEffect, useRef, useState } from "react";

const ANALYSER_FFT_SIZE = 256;
const SAMPLE_INTERVAL_MS = 50;
const RMS_SCALE_FACTOR = 4; // scales typical speech RMS (~0.1–0.25) to a clearly visible bar level

/**
 * Samples the current audio level (0–1) from the given microphone device in real time.
 * Returns 0 when no device is selected or audio access is unavailable.
 * Cleans up all Web Audio API resources on unmount or when the device changes.
 */
export function useMicrophoneLevel(microphoneId: string | undefined): number {
  const [level, setLevel] = useState(0);

  const streamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopCapture = useCallback(() => {
    if (intervalRef.current !== null) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    if (audioContextRef.current) {
      audioContextRef.current.close().catch(() => {
        // Ignore cleanup errors – context may already be closed
      });
      audioContextRef.current = null;
    }
    analyserRef.current = null;
    setLevel(0);
  }, []);

  useEffect(() => {
    if (!microphoneId) {
      stopCapture();
      return;
    }

    let cancelled = false;

    const startCapture = async () => {
      stopCapture();

      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: { deviceId: { exact: microphoneId } },
          video: false,
        });

        if (cancelled) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }

        const audioContext = new AudioContext();
        const source = audioContext.createMediaStreamSource(stream);
        const analyser = audioContext.createAnalyser();
        analyser.fftSize = ANALYSER_FFT_SIZE;

        source.connect(analyser);

        streamRef.current = stream;
        audioContextRef.current = audioContext;
        analyserRef.current = analyser;

        const dataArray = new Uint8Array(analyser.frequencyBinCount);

        intervalRef.current = setInterval(() => {
          if (!analyserRef.current) return;
          analyserRef.current.getByteTimeDomainData(dataArray);

          // Compute RMS over the time-domain data, then normalise to 0–1.
          // Each byte is in [0, 255] with 128 representing silence.
          let sumOfSquares = 0;
          for (const sample of dataArray) {
            const normalised = (sample - 128) / 128;
            sumOfSquares += normalised * normalised;
          }
          const rms = Math.sqrt(sumOfSquares / dataArray.length);
          setLevel(Math.min(1, rms * RMS_SCALE_FACTOR));
        }, SAMPLE_INTERVAL_MS);
      } catch {
        // Permission denied or device unavailable – silently stay at 0
        setLevel(0);
      }
    };

    void startCapture();

    return () => {
      cancelled = true;
      stopCapture();
    };
  }, [microphoneId, stopCapture]);

  return level;
}

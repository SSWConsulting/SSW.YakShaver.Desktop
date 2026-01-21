export interface DurationParts {
  totalSeconds: number;
  hours: number;
  minutes: number;
  seconds: number;
}

export const getDurationParts = (seconds: number): DurationParts => {
  const hours = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  return { totalSeconds: seconds, hours, minutes: mins, seconds: secs };
};

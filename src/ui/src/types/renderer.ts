export interface ElectronVideoConstraints extends MediaTrackConstraints {
  mandatory: {
    chromeMediaSource: string;
    chromeMediaSourceId?: string;
  };
}

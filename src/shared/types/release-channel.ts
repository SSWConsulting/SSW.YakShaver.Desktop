export interface ProcessedRelease {
  prNumber: string;
  tag: string;
  version: string;
  publishedAt: string;
}

interface ReleaseListSuccess {
  status: "success";
  releases: ProcessedRelease[];
}

interface ReleaseListWarning {
  status: "warning";
  releases: ProcessedRelease[];
  warning: string;
}

interface ReleaseListError {
  status: "error";
  error: string;
}

export type ReleaseListResult = ReleaseListSuccess | ReleaseListWarning | ReleaseListError;

interface ReleaseUpdateAvailable {
  status: "update-available";
  available: true;
  version: string;
  currentVersion: string;
}

interface ReleaseUpToDate {
  status: "up-to-date";
  available: false;
  currentVersion: string;
}

interface ReleaseUpdateWarning {
  status: "warning";
  available: false;
  warning: string;
  currentVersion: string;
}

interface ReleaseUpdateError {
  status: "error";
  available: false;
  error: string;
  currentVersion: string;
}

export type ReleaseUpdateCheckResult =
  | ReleaseUpdateAvailable
  | ReleaseUpToDate
  | ReleaseUpdateWarning
  | ReleaseUpdateError;

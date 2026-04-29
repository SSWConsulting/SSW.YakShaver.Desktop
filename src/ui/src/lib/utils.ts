import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function timeAgo(date: Date): string {
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hrs ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days} days ago`;
  return date.toLocaleDateString();
}

/**
 * Extract a YouTube video ID from a URL and return a thumbnail URL.
 * All host literals come from env (Vite substitutes at build time):
 *   - YOUTUBE_VALID_DOMAINS (comma-separated allowlist of hostnames)
 *   - YOUTUBE_SHORT_HOSTNAME (the short URL hostname)
 *   - YOUTUBE_THUMBNAIL_URL_BASE (canonical thumbnail host or china mock)
 *
 * Returns null when the URL doesn't match a valid YouTube shape, or when
 * the build region has no YouTube support (china — env values empty).
 */
export function getYouTubeThumbnail(url: string): string | null {
  const thumbnailBase = process.env.YOUTUBE_THUMBNAIL_URL_BASE ?? "";
  const validDomains = (process.env.YOUTUBE_VALID_DOMAINS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const shortHostname = process.env.YOUTUBE_SHORT_HOSTNAME ?? "";
  if (!thumbnailBase || validDomains.length === 0) return null;

  let videoId: string | null = null;
  try {
    const parsed = new URL(url);
    if (!validDomains.includes(parsed.hostname)) return null;

    if (shortHostname && parsed.hostname === shortHostname) {
      videoId = parsed.pathname.slice(1);
    } else if (parsed.searchParams.has("v")) {
      videoId = parsed.searchParams.get("v");
    } else {
      const segments = parsed.pathname.split("/").filter(Boolean);
      if (segments.length >= 2 && segments[0] === "embed") {
        videoId = segments[1];
      }
    }
  } catch {
    return null;
  }

  if (videoId && /^[a-zA-Z0-9_-]{11}$/.test(videoId)) {
    return `${thumbnailBase}/${videoId}/mqdefault.jpg`;
  }
  return null;
}

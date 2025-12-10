// TypeScript definitions for WebCodecs Insertable Streams API
// MediaStreamTrackProcessor and MediaStreamTrackGenerator

interface MediaStreamTrackProcessorInit {
  track: MediaStreamTrack;
  maxBufferSize?: number;
}

interface MediaStreamTrackProcessor {
  readonly readable: ReadableStream<VideoFrame>;
}

declare const MediaStreamTrackProcessor: {
  prototype: MediaStreamTrackProcessor;
  new (init: MediaStreamTrackProcessorInit): MediaStreamTrackProcessor;
};

interface MediaStreamTrackGeneratorInit {
  kind: "video" | "audio";
}

interface MediaStreamTrackGenerator extends MediaStreamTrack {
  readonly writable: WritableStream<VideoFrame>;
}

declare const MediaStreamTrackGenerator: {
  prototype: MediaStreamTrackGenerator;
  new (init: MediaStreamTrackGeneratorInit): MediaStreamTrackGenerator;
};

interface VideoFrame {
  readonly format: string | null;
  readonly codedWidth: number;
  readonly codedHeight: number;
  readonly codedRect: DOMRectReadOnly | null;
  readonly visibleRect: DOMRectReadOnly | null;
  readonly displayWidth: number;
  readonly displayHeight: number;
  readonly duration: number | null;
  readonly timestamp: number;
  readonly colorSpace: VideoColorSpace;
  clone(): VideoFrame;
  close(): void;
}

interface VideoFrameInit {
  format?: string;
  codedWidth?: number;
  codedHeight?: number;
  timestamp: number;
  duration?: number;
  visibleRect?: DOMRectInit;
  displayWidth?: number;
  displayHeight?: number;
  colorSpace?: VideoColorSpaceInit;
}

interface VideoColorSpace {
  readonly primaries: string | null;
  readonly transfer: string | null;
  readonly matrix: string | null;
  readonly fullRange: boolean | null;
}

interface VideoColorSpaceInit {
  primaries?: string;
  transfer?: string;
  matrix?: string;
  fullRange?: boolean;
}

declare const VideoFrame: {
  prototype: VideoFrame;
  new (image: CanvasImageSource, init?: VideoFrameInit): VideoFrame;
};

// OffscreenCanvas support
interface OffscreenCanvas extends EventTarget {
  width: number;
  height: number;
  getContext(
    contextId: "2d",
    options?: CanvasRenderingContext2DSettings
  ): OffscreenCanvasRenderingContext2D | null;
  getContext(
    contextId: "bitmaprenderer",
    options?: ImageBitmapRenderingContextSettings
  ): ImageBitmapRenderingContext | null;
  getContext(
    contextId: "webgl" | "webgl2",
    options?: WebGLContextAttributes
  ): WebGLRenderingContext | WebGL2RenderingContext | null;
  convertToBlob(options?: { type?: string; quality?: number }): Promise<Blob>;
  transferToImageBitmap(): ImageBitmap;
}

declare const OffscreenCanvas: {
  prototype: OffscreenCanvas;
  new (width: number, height: number): OffscreenCanvas;
};

interface OffscreenCanvasRenderingContext2D
  extends CanvasState,
    CanvasTransform,
    CanvasCompositing,
    CanvasImageSmoothing,
    CanvasFillStrokeStyles,
    CanvasShadowStyles,
    CanvasFilters,
    CanvasRect,
    CanvasDrawPath,
    CanvasText,
    CanvasDrawImage,
    CanvasImageData,
    CanvasPathDrawingStyles,
    CanvasTextDrawingStyles,
    CanvasPath {
  readonly canvas: OffscreenCanvas;
  commit(): void;
}

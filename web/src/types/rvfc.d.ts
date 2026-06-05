// Ambient types for HTMLVideoElement.requestVideoFrameCallback. Declared here
// because not all TS lib.dom versions ship it. Interface merging keeps this safe
// if the installed lib already declares these (signatures match the WICG spec).
interface VideoFrameCallbackMetadata {
  presentationTime: DOMHighResTimeStamp;
  expectedDisplayTime: DOMHighResTimeStamp;
  width: number;
  height: number;
  mediaTime: number;
  presentedFrames: number;
  processingDuration?: number;
  // Populated only for some WebRTC sources (NOT in Chrome today — see README).
  captureTime?: DOMHighResTimeStamp;
  receiveTime?: DOMHighResTimeStamp;
  rtpTimestamp?: number;
}

interface HTMLVideoElement {
  requestVideoFrameCallback(
    callback: (now: DOMHighResTimeStamp, metadata: VideoFrameCallbackMetadata) => void,
  ): number;
  cancelVideoFrameCallback(handle: number): void;
}

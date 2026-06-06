// Minimal WHEP (WebRTC-HTTP Egress Protocol) client for MediaMTX playback.
//
// Flow: create a recvonly PeerConnection, POST our SDP offer to the WHEP URL,
// apply the SDP answer. On a single LAN we need no STUN/TURN; we gather ICE
// candidates locally and post a non-trickle offer (simplest reliable path).

export interface WhepSession {
  readonly pc: RTCPeerConnection;
  /** The remote media (video + maybe audio) tracks, as they arrive. */
  readonly stream: MediaStream;
  close(): void;
}

export async function startWhep(url: string): Promise<WhepSession> {
  const pc = new RTCPeerConnection({ bundlePolicy: 'max-bundle' });
  const stream = new MediaStream();

  pc.addTransceiver('video', { direction: 'recvonly' });
  pc.addTransceiver('audio', { direction: 'recvonly' });
  pc.ontrack = (e) => {
    if (!stream.getTracks().includes(e.track)) stream.addTrack(e.track);
  };

  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
  await waitIceGatheringComplete(pc, 1500);

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/sdp' },
    body: pc.localDescription?.sdp ?? offer.sdp ?? '',
  });
  if (!res.ok) {
    pc.close();
    throw new Error(`WHEP POST failed: ${res.status} ${res.statusText}`);
  }

  const answerSdp = await res.text();
  await pc.setRemoteDescription({ type: 'answer', sdp: answerSdp });

  // WHEP returns a resource URL (Location) we DELETE on teardown so the server
  // frees the session promptly instead of waiting for ICE timeout. `url` may be
  // a relative path, so resolve the (possibly relative) Location against the
  // absolute request URL.
  const locHeader = res.headers.get('Location');
  const reqAbs = new URL(url, window.location.href);
  const resourceUrl = locHeader ? new URL(locHeader, reqAbs).toString() : null;

  let closed = false;
  return {
    pc,
    stream,
    close() {
      if (closed) return;
      closed = true;
      if (resourceUrl) {
        fetch(resourceUrl, { method: 'DELETE', keepalive: true }).catch(() => {});
      }
      pc.close();
    },
  };
}

function waitIceGatheringComplete(pc: RTCPeerConnection, timeoutMs: number): Promise<void> {
  if (pc.iceGatheringState === 'complete') return Promise.resolve();
  return new Promise((resolve) => {
    const done = () => {
      pc.removeEventListener('icegatheringstatechange', check);
      clearTimeout(timer);
      resolve();
    };
    const check = () => {
      if (pc.iceGatheringState === 'complete') done();
    };
    const timer = setTimeout(done, timeoutMs); // post what we have if gathering stalls
    pc.addEventListener('icegatheringstatechange', check);
  });
}

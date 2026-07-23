/**
 * Keep mobile/web recordings alive as far as the browser allows.
 *
 * Reality: iOS/Android often suspend mic when the tab is backgrounded.
 * We cannot guarantee true OS background capture in a website — instead we:
 *  1) Hold Screen Wake Lock while recording (keeps screen / tab more alive)
 *  2) Detect visibility hide + track mute and warn the user
 *  3) Flush MediaRecorder data on hide so partial audio is not lost
 */

import { toast } from "@/lib/toast";

export type RecordingGuardHandlers = {
  /** Called when the page becomes hidden while recording (flush chunks here). */
  onHidden?: () => void;
  /** Called when returning to foreground. */
  onVisible?: () => void;
  /** Mic track muted (phone call / OS stole audio). */
  onTrackMuted?: () => void;
  onTrackUnmuted?: () => void;
};

export type RecordingGuard = {
  release: () => void;
  /** True if Screen Wake Lock is currently held. */
  wakeLockActive: () => boolean;
};

type WakeLockSentinelLike = {
  released: boolean;
  release: () => Promise<void>;
  addEventListener?: (type: "release", fn: () => void) => void;
};

export async function requestScreenWakeLock(): Promise<WakeLockSentinelLike | null> {
  try {
    const nav = navigator as Navigator & {
      wakeLock?: { request: (type: "screen") => Promise<WakeLockSentinelLike> };
    };
    if (!nav.wakeLock?.request) return null;
    const sentinel = await nav.wakeLock.request("screen");
    return sentinel;
  } catch {
    return null;
  }
}

/**
 * Attach wake lock + visibility/mute monitors for an active MediaStream recording.
 */
export function attachRecordingGuard(
  stream: MediaStream | null | undefined,
  handlers: RecordingGuardHandlers = {}
): RecordingGuard {
  let wake: WakeLockSentinelLike | null = null;
  let released = false;
  let warnedHidden = false;
  let warnedMuted = false;

  const acquireWake = () => {
    void requestScreenWakeLock().then((s) => {
      if (released) {
        void s?.release().catch(() => {});
        return;
      }
      wake = s;
      s?.addEventListener?.("release", () => {
        if (released) return;
        // Re-request if page still visible (some browsers drop lock on brief blur).
        if (document.visibilityState === "visible") acquireWake();
      });
    });
  };

  acquireWake();

  const onVisibility = () => {
    if (released) return;
    if (document.visibilityState === "hidden") {
      handlers.onHidden?.();
      if (!warnedHidden) {
        warnedHidden = true;
        toast("已切到背景：手機可能暫停麥克風，請盡量保持畫面開啟");
      }
      return;
    }
    warnedHidden = false;
    acquireWake();
    handlers.onVisible?.();
  };

  const onTrackMute = () => {
    if (released) return;
    handlers.onTrackMuted?.();
    if (!warnedMuted) {
      warnedMuted = true;
      toast("麥克風被系統中斷（來電等），錄音可能缺一段");
    }
  };

  const onTrackUnmute = () => {
    if (released) return;
    warnedMuted = false;
    handlers.onTrackUnmuted?.();
    toast("麥克風已恢復");
  };

  document.addEventListener("visibilitychange", onVisibility);
  window.addEventListener("pagehide", onVisibility);

  const tracks = stream?.getAudioTracks?.() || [];
  for (const t of tracks) {
    t.addEventListener("mute", onTrackMute);
    t.addEventListener("unmute", onTrackUnmute);
  }

  return {
    wakeLockActive: () => Boolean(wake && !wake.released),
    release: () => {
      if (released) return;
      released = true;
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", onVisibility);
      for (const t of tracks) {
        t.removeEventListener("mute", onTrackMute);
        t.removeEventListener("unmute", onTrackUnmute);
      }
      const w = wake;
      wake = null;
      void w?.release().catch(() => {});
    },
  };
}

export function isLikelyMobileBrowser(): boolean {
  if (typeof navigator === "undefined") return false;
  return /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent || "");
}

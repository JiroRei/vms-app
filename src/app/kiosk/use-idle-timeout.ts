"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/** What counts as "someone is still standing here". */
const ACTIVITY_EVENTS = [
  "pointerdown",
  "keydown",
  "wheel",
  "touchstart",
  "mousemove",
  "scroll",
] as const;

/**
 * `mousemove` fires dozens of times a second; re-arming the timers on every one
 * of them is pure waste. One re-arm per second is precise enough for a timeout
 * measured in tens of seconds.
 */
const ACTIVITY_THROTTLE_MS = 1000;

export type IdleTimeout = {
  /** True once the grace period has started and the prompt should be shown. */
  warning: boolean;
  /** Seconds left before `onIdle` fires. Meaningless unless `warning`. */
  secondsLeft: number;
  /** "I'm still here" — dismisses the prompt and restarts the clock. */
  stayActive: () => void;
};

/**
 * Fires `onIdle` after `idleMs` without user input, warning `warningMs` before
 * it does.
 *
 * Activity restarts the clock — except while the warning is up. That window is
 * deliberately answer-only: the prompt is modal, so a real visitor's tap lands
 * on its button, and a passer-by brushing the screen must not silently cancel a
 * reset that is already half-announced.
 */
export function useIdleTimeout({
  idleMs,
  warningMs,
  onIdle,
  enabled = true,
}: {
  idleMs: number;
  warningMs: number;
  onIdle: () => void;
  enabled?: boolean;
}): IdleTimeout {
  /** `null` means "not warning"; a number is the countdown. One source of truth. */
  const [secondsLeft, setSecondsLeft] = useState<number | null>(null);

  // Held in refs so a new `onIdle` identity — or a re-render — does not tear
  // down and restart the timers mid-countdown.
  const onIdleRef = useRef(onIdle);
  const restartRef = useRef<() => void>(() => {});

  useEffect(() => {
    onIdleRef.current = onIdle;
  }, [onIdle]);

  useEffect(() => {
    if (!enabled) return;

    let warningTimer: ReturnType<typeof setTimeout> | undefined;
    let idleTimer: ReturnType<typeof setTimeout> | undefined;
    let countdown: ReturnType<typeof setInterval> | undefined;
    let warning = false;
    let lastArmed = Date.now();

    function clearTimers() {
      clearTimeout(warningTimer);
      clearTimeout(idleTimer);
      clearInterval(countdown);
      warningTimer = idleTimer = countdown = undefined;
    }

    /** Runs from a timer, never from the effect body. */
    function beginWarning() {
      warning = true;

      let remaining = Math.ceil(warningMs / 1000);
      setSecondsLeft(remaining);

      countdown = setInterval(() => {
        remaining -= 1;
        setSecondsLeft(Math.max(remaining, 0));
      }, 1000);

      idleTimer = setTimeout(() => {
        clearTimers();
        warning = false;
        setSecondsLeft(null);
        onIdleRef.current();
      }, warningMs);
    }

    /**
     * Pure timer work, no state — which is what lets the effect body call it on
     * mount without kicking off a cascading render.
     */
    function armWarning() {
      clearTimers();
      warning = false;
      lastArmed = Date.now();
      warningTimer = setTimeout(beginWarning, Math.max(idleMs - warningMs, 0));
    }

    /** The answer to the prompt. Only ever called from an event handler. */
    function restart() {
      setSecondsLeft(null);
      armWarning();
    }

    function onActivity() {
      if (warning) return;
      if (Date.now() - lastArmed < ACTIVITY_THROTTLE_MS) return;
      // Not warning, so `secondsLeft` is already null: re-arming the timers is
      // the whole job, and no render is needed.
      armWarning();
    }

    restartRef.current = restart;
    armWarning();

    for (const event of ACTIVITY_EVENTS) {
      window.addEventListener(event, onActivity, { passive: true });
    }

    return () => {
      for (const event of ACTIVITY_EVENTS) {
        window.removeEventListener(event, onActivity);
      }

      clearTimers();
      restartRef.current = () => {};
      // Leaves no half-finished countdown behind for the next time the hook is
      // enabled — otherwise re-enabling would show the prompt immediately.
      setSecondsLeft(null);
    };
  }, [enabled, idleMs, warningMs]);

  const stayActive = useCallback(() => restartRef.current(), []);

  return {
    warning: secondsLeft !== null,
    secondsLeft: secondsLeft ?? 0,
    stayActive,
  };
}

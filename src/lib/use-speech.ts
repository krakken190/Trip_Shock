"use client";

import { useCallback, useEffect, useRef, useState } from "react";

// Browser speech recognition (Chrome/Edge). Audio is transcribed by the browser vendor's service.
/* eslint-disable @typescript-eslint/no-explicit-any */
type Recognition = any;

function getCtor(): (new () => Recognition) | null {
  if (typeof window === "undefined") return null;
  return (window as any).SpeechRecognition ?? (window as any).webkitSpeechRecognition ?? null;
}

const ERRORS: Record<string, string> = {
  "not-allowed": "Microphone access was blocked. Allow it in the browser's site settings.",
  "service-not-allowed": "Speech recognition isn't available in this browser.",
  "no-speech": "Didn't catch anything — try again.",
  "audio-capture": "No microphone found.",
  network: "Speech service unreachable — check your connection.",
};

/**
 * Dictation that appends to existing text. `onFinal` receives each finalised phrase;
 * `interim` holds the words still being recognised.
 */
export function useSpeech(onFinal: (text: string) => void, lang = "en-IN") {
  const [supported, setSupported] = useState(false);
  const [listening, setListening] = useState(false);
  const [interim, setInterim] = useState("");
  const [error, setError] = useState<string | null>(null);
  const rec = useRef<Recognition | null>(null);
  const finalRef = useRef(onFinal);
  finalRef.current = onFinal;

  useEffect(() => setSupported(!!getCtor()), []);

  const stop = useCallback(() => {
    rec.current?.stop();
  }, []);

  const start = useCallback(() => {
    const Ctor = getCtor();
    if (!Ctor) return;
    setError(null);
    const r = new Ctor();
    r.lang = lang;
    r.continuous = true;
    r.interimResults = true;
    r.onresult = (e: any) => {
      let pending = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const res = e.results[i];
        if (res.isFinal) finalRef.current(res[0].transcript.trim());
        else pending += res[0].transcript;
      }
      setInterim(pending);
    };
    r.onerror = (e: any) => {
      if (e.error !== "aborted") setError(ERRORS[e.error] ?? `Speech recognition error: ${e.error}`);
    };
    r.onend = () => {
      setListening(false);
      setInterim("");
    };
    rec.current = r;
    r.start();
    setListening(true);
  }, [lang]);

  useEffect(() => () => rec.current?.abort?.(), []);

  return { supported, listening, interim, error, start, stop };
}

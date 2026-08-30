import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

const MAX_RECORDING_MS = 60_000;

function audioToBase64(bytes: Uint8Array) {
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 8192) binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
  return btoa(binary);
}

/** Records a short operator-selected clip and inserts—not sends—its transcript. */
export function useCopilotDictation(onTranscript: (transcript: string) => void) {
  const [state, setState] = useState<"idle" | "starting" | "listening" | "transcribing">("idle");
  const [error, setError] = useState<string | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  const timerRef = useRef<number | null>(null);
  const release = useCallback(() => { if (timerRef.current !== null) window.clearTimeout(timerRef.current); timerRef.current = null; streamRef.current?.getTracks().forEach((track) => track.stop()); streamRef.current = null; }, []);
  const stop = useCallback(() => { const recorder = recorderRef.current; recorderRef.current = null; if (recorder && recorder.state !== "inactive") recorder.stop(); release(); }, [release]);
  useEffect(() => () => stop(), [stop]);
  const start = useCallback(async () => {
    if (state !== "idle") return;
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") { setError("This browser cannot record audio. Type your question instead."); return; }
    setState("starting"); setError(null); chunksRef.current = [];
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true }); streamRef.current = stream;
      const recorder = new MediaRecorder(stream); recorderRef.current = recorder;
      recorder.ondataavailable = (event) => { if (event.data.size) chunksRef.current.push(event.data); };
      recorder.onstop = () => { release(); const blob = new Blob(chunksRef.current, { type: recorder.mimeType || "audio/webm" }); if (blob.size < 1500) { setState("idle"); setError("No speech was picked up. Try again or type your question."); return; } void (async () => { setState("transcribing"); try { const result = await supabase.functions.invoke("copilot-transcribe", { body: { audio: audioToBase64(new Uint8Array(await blob.arrayBuffer())), mimeType: blob.type } }); if (result.error) throw result.error; const transcript = String((result.data as { transcript?: string } | null)?.transcript ?? "").trim(); if (!transcript) throw new Error("Nothing was recognised. Try again or type your question."); onTranscript(transcript); } catch (caught) { setError(caught instanceof Error ? caught.message : "Transcription failed."); } finally { setState("idle"); } })(); };
      recorder.start(); setState("listening"); timerRef.current = window.setTimeout(stop, MAX_RECORDING_MS);
    } catch (caught) { release(); setState("idle"); const message = caught instanceof Error ? caught.message.toLowerCase() : ""; setError(message.includes("permission") || message.includes("denied") ? "Microphone permission was denied. Allow microphone access and try again." : "Could not start the microphone. Type your question instead."); }
  }, [onTranscript, release, state, stop]);
  return { state, error, start, stop };
}

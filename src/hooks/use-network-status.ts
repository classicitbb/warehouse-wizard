import { useEffect, useState } from "react";

export const OFFLINE_WORK_MESSAGE = "Connection lost. Work was not posted. Reconnect and try again.";

export function isAppOnline() {
  return typeof navigator === "undefined" || navigator.onLine !== false;
}

export function assertOnline() {
  if (!isAppOnline()) {
    throw new Error(OFFLINE_WORK_MESSAGE);
  }
}

export function useNetworkStatus() {
  const [online, setOnline] = useState(isAppOnline);

  useEffect(() => {
    const update = () => setOnline(isAppOnline());
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    update();
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);

  return { online };
}

export function guardMutation<TArgs extends unknown[], TResult>(
  fn: (...args: TArgs) => Promise<TResult> | TResult,
) {
  return (...args: TArgs) => {
    assertOnline();
    return fn(...args);
  };
}

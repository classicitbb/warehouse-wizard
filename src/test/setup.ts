import "@testing-library/jest-dom";

// Tests must never reach the live backend. Any component/hook that slips a real
// network call into a test run gets a loud, attributable failure instead of a
// silent request against Lovable Cloud.
const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url =
    typeof input === "string" ? input : input instanceof URL ? input.href : (input as Request).url;
  if (/^https?:\/\//i.test(url)) {
    throw new Error(
      `Blocked network call in tests: ${url}. Mock this dependency in the test file.`,
    );
  }
  return realFetch(input as RequestInfo, init);
}) as typeof fetch;

const localStorageMock = (() => {
  const store = new Map<string, string>();
  return {
    get length() {
      return store.size;
    },
    clear: () => store.clear(),
    getItem: (key: string) => store.get(key) ?? null,
    key: (index: number) => Array.from(store.keys())[index] ?? null,
    removeItem: (key: string) => store.delete(key),
    setItem: (key: string, value: string) => store.set(key, String(value)),
  };
})();

Object.defineProperty(globalThis, "localStorage", {
  configurable: true,
  value: localStorageMock,
});

Object.defineProperty(window, "localStorage", {
  configurable: true,
  value: localStorageMock,
});

Object.defineProperty(window, "matchMedia", {
  writable: true,
  value: (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => {},
  }),
});

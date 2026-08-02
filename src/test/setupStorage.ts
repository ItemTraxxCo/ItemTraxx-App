// Node's own experimental global `localStorage`/`sessionStorage` (gated behind
// --localstorage-file) shadow jsdom's working implementations when Vitest
// populates globals for the jsdom environment, so `window.localStorage` and
// `window.sessionStorage` resolve to Node's stubs (always undefined-returning)
// instead of real Storage objects. Install minimal in-memory replacements once,
// for every test file, so any code under test that touches browser storage works.
const createMemoryStorage = (): Storage => {
  const data = new Map<string, string>();
  return {
    getItem: (key: string) => (data.has(key) ? (data.get(key) as string) : null),
    setItem: (key: string, value: string) => {
      data.set(key, String(value));
    },
    removeItem: (key: string) => {
      data.delete(key);
    },
    clear: () => {
      data.clear();
    },
    key: (index: number) => Array.from(data.keys())[index] ?? null,
    get length() {
      return data.size;
    },
  } as Storage;
};

for (const propertyName of ["localStorage", "sessionStorage"] as const) {
  Object.defineProperty(window, propertyName, {
    configurable: true,
    writable: true,
    value: createMemoryStorage(),
  });
}

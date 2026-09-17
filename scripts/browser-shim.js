const store = new Map()
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
}
if (!globalThis.crypto) globalThis.crypto = {}
if (!globalThis.crypto.randomUUID) {
  let n = 0
  globalThis.crypto.randomUUID = () => `uuid-${++n}-${process.hrtime.bigint()}`
}

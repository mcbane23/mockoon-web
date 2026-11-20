/**
 * crypto.randomUUID only exists in secure contexts (HTTPS or localhost). Mockpit is served over
 * plain HTTP on the local network, and @mockoon/commons calls window.crypto.randomUUID() to build
 * routes and responses, so provide it when missing. getRandomValues works in every context.
 */
export function installPolyfills(): void {
  const cryptoObject = globalThis.crypto as Crypto | undefined;
  if (cryptoObject && typeof cryptoObject.randomUUID !== 'function') {
    (cryptoObject as { randomUUID: () => string }).randomUUID = () => {
      const bytes = cryptoObject.getRandomValues(new Uint8Array(16));
      bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40;
      bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
      const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');

      return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
    };
  }
}

installPolyfills();

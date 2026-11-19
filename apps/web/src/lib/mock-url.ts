const LOOPBACK = ['127.0.0.1', '::1', 'localhost'];

export const isLoopback = (host: string): boolean =>
  LOOPBACK.includes(host.toLowerCase()) || /^127\.\d+\.\d+\.\d+$/.test(host);

type MockAddress = { hostname: string; port: number; endpointPrefix: string; tlsEnabled: boolean };

/**
 * Host to show for a mock: its own hostname when set, otherwise the address the user opened the
 * UI with, so that the URL works from the machine the browser runs on.
 */
export function mockHost(hostname: string, locationHostname = window.location.hostname): string {
  const host =
    hostname && hostname !== '0.0.0.0' && hostname !== '::' ? hostname : locationHostname;

  return host.includes(':') && !host.startsWith('[') ? `[${host}]` : host;
}

/** Base URL without a trailing slash: {http|https}://{host}:{port}/{endpointPrefix}. */
export function mockBaseUrl(address: MockAddress, locationHostname?: string): string {
  const prefix = address.endpointPrefix.replace(/^\/+|\/+$/g, '');

  return `${address.tlsEnabled ? 'https' : 'http'}://${mockHost(address.hostname, locationHostname)}:${address.port}${prefix ? `/${prefix}` : ''}`;
}

export function routeUrl(
  address: MockAddress,
  endpoint: string,
  locationHostname?: string,
): string {
  return `${mockBaseUrl(address, locationHostname)}/${endpoint.replace(/^\/+/, '')}`;
}

/** The mock only listens on loopback while the UI was opened from another machine. */
export function isUnreachableFromBrowser(
  hostname: string,
  locationHostname = window.location.hostname,
): boolean {
  return isLoopback(hostname) && !isLoopback(locationHostname);
}

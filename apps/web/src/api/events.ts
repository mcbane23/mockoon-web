import type { ServerEvent } from '@stubhouse/shared';

export type EventsHandlers = {
  onEvent: (event: ServerEvent) => void;
  /** The connection was lost; EventSource reconnects on its own. */
  onDisconnect: () => void;
  /** Connected again after a loss: missed events are not replayed, so reload everything. */
  onReconnect: () => void;
};

/** Subscribe to /api/events. Returns a function that closes the connection. */
export function connectEvents(handlers: EventsHandlers): () => void {
  const source = new EventSource('/api/events');
  let lost = false;

  source.onopen = () => {
    if (lost) {
      lost = false;
      handlers.onReconnect();
    }
  };
  source.onerror = () => {
    if (!lost) {
      lost = true;
      handlers.onDisconnect();
    }
  };
  source.onmessage = (message) => {
    try {
      handlers.onEvent(JSON.parse(message.data as string) as ServerEvent);
    } catch (error) {
      console.error('Invalid server event', error);
    }
  };

  return () => source.close();
}

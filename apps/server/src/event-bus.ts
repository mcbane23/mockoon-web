import { EventEmitter } from 'node:events';
import type { ServerEvent } from '@maketa/shared';

export type ServerEventListener = (event: ServerEvent) => void;

/** Plain EventEmitter with a typed payload. Everything emitted here is forwarded to SSE clients. */
export class EventBus {
  private readonly emitter = new EventEmitter();

  constructor() {
    this.emitter.setMaxListeners(0);
  }

  emit(event: ServerEvent): void {
    this.emitter.emit('event', event);
  }

  subscribe(listener: ServerEventListener): () => void {
    this.emitter.on('event', listener);

    return () => this.emitter.off('event', listener);
  }
}

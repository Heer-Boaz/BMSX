/**
 * A generic event dispatcher that can be used to manage listeners and dispatch events.
 *
 * @template T The type of data that will be dispatched to listeners.
 */
export class EventEmitter {
    private listeners: Record<string, Function[]> = {};

    on(event: string, listener: Function): void {
        if (!this.listeners[event]) {
            this.listeners[event] = [];
        }
        this.listeners[event].push(listener);
    }

    emit(event: string, ...args: any[]): void {
        this.listeners[event]?.forEach(listener => listener(...args));
    }

    // Additional methods for removing listeners, etc.
    remove(event: string, listener: Function): void {
        const listeners = this.listeners[event];
        if (listeners) {
            this.listeners[event] = listeners.filter(l => l !== listener);
        }
    }

    removeAll(event: string): void {
        delete this.listeners[event];
    }

    once(event: string, listener: Function): void {
        const onceListener = (...args: any[]) => {
            listener(...args);
            this.remove(event, onceListener);
        };
        this.on(event, onceListener);
    }
}

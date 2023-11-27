/**
 * A generic event dispatcher that can be used to manage listeners and dispatch events.
 */
export class EventEmitter {
    private listeners: Record<string, Function[]> = {};
    private static instance: EventEmitter;
    /**
     * Returns the singleton instance of the EventEmitter class.
     * If the instance does not exist, it creates a new one.
     * @returns The singleton instance of the EventEmitter class.
     */
    public static getInstance(): EventEmitter {
        if (!EventEmitter.instance) {
            EventEmitter.instance = new EventEmitter();
        }
        return EventEmitter.instance;
    }

    /**
     * Adds a listener function to the specified event.
     *
     * @param event - The name of the event.
     * @param listener - The listener function to be added.
     */
    on(event: string, listener: Function): void {
        if (!this.listeners[event]) {
            this.listeners[event] = [];
        }
        this.listeners[event].push(listener);
    }

    /**
     * Emits an event and invokes all registered listeners with the provided arguments.
     *
     * @param event - The name of the event to emit.
     * @param sender - The sender of the event.
     * @param args - Additional arguments to pass to the listeners.
     */
    emit(event: string, sender: any, ...args: any[]): void {
        this.listeners[event]?.forEach(listener => listener(...args));
    }

    // Additional methods for removing listeners, etc.
    /**
     * Removes a listener function from the specified event.
     *
     * @param event - The name of the event.
     * @param listener - The listener function to remove.
     */
    off(event: string, listener: Function): void {
        const listeners = this.listeners[event];
        if (listeners) {
            this.listeners[event] = listeners.filter(l => l !== listener);
        }
    }

    /**
     * Removes all listeners for the specified event.
     *
     * @param event - The event to remove all listeners for.
     */
    removeAll(event: string): void {
        delete this.listeners[event];
    }

    /**
     * Adds a one-time listener function for the specified event.
     * The listener will be automatically removed after it is called.
     *
     * @param event - The name of the event to listen for.
     * @param listener - The listener function to be called when the event is emitted.
     */
    once(event: string, listener: Function): void {
        const onceListener = (...args: any[]) => {
            listener(...args);
            this.off(event, onceListener);
        };
        this.on(event, onceListener);
    }
}

/**
 * Decorator that registers a method as a handler for a specific event.
 *
 * @param eventName The name of the event to handle.
 * @returns A function that decorates the target method.
 */
export function handles_event(eventName: string) {
    return function (target: any, propertyKey: string, descriptor: PropertyDescriptor) {
        EventEmitter.getInstance().on(eventName, descriptor.value);
    };
}

/* Decorator function that registers itself as a handler for a specific event using the `once` function.
 * @param eventName The name of the event to handle.
 * @returns A decorator function that can be applied to a method.
 */
export function registers_event_once(eventName: string) {
    return function (target: any, propertyKey: string, descriptor: PropertyDescriptor) {
        EventEmitter.getInstance().once(eventName, descriptor.value);
    };
}

/**
 * Decorator function that emits an event when the decorated method is called.
 * @param eventName The name of the event to emit.
 * @returns A decorator function that can be applied to a method.
 */
export function emits_event(eventName: string) {
    return function (target: any, propertyKey: string, descriptor: PropertyDescriptor) {
        const originalMethod = descriptor.value;
        descriptor.value = function (...args: any[]) {
            originalMethod.apply(this, args);
            // Logic to emit the event
            EventEmitter.getInstance().emit(eventName, this, ...args);
        };
    };
}

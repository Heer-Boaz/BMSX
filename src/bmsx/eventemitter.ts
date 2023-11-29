import { IIdentifiable } from './gameobject';
/**
 * A generic event dispatcher that can be used to manage listeners and dispatch events.
 */
export class EventEmitter {
    private listeners: Record<string, Record<string, Function[]>> = {};
    /**
     * The singleton instance of the EventEmitter class.
     */
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

    on(event: string, listener: Function, emitter?: string): void {
        if (!this.listeners[event]) {
            this.listeners[event] = {};
        }
        const key = emitter || 'all';
        if (!this.listeners[event][key]) {
            this.listeners[event][key] = [];
        }
        this.listeners[event][key].push(listener);
    }

    emit(event: string, emitter: string, ...args: any[]): void {
        // Emit to specific listeners
        this.listeners[event]?.[emitter]?.forEach(listener => listener(...args));
        // Emit to all listeners
        this.listeners[event]?.['all']?.forEach(listener => listener(...args));
    }

    off(event: string, listener: Function, emitter?: string): void {
        const key = emitter || 'all';
        const emitterListeners = this.listeners[event]?.[key];
        if (emitterListeners) {
            this.listeners[event][key] = emitterListeners.filter(l => l !== listener);
        }
    }

    removeAll(event: string, emitter?: string): void {
        const key = emitter || 'all';
        delete this.listeners[event]?.[key];
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
 * Represents a subscription to an event.
 */
export type EventSubscription = {
    /**
     * The name of the event.
     */
    eventName: string;
    /**
     * The name of the event handler.
     */
    handlerName: string;
};

/**
 * Represents a constructor function that supports event subscriptions.
 */
export type ConstructorWithEventSubscriptions = Function & {
    eventSubscriptions?: EventSubscription[];
};

/**
 * Helper function to update all event subscriptions
 * Updates all event subscriptions for a given constructor by traversing the prototype chain.
 * @param constructor - The constructor function to update event subscriptions for.
 */
function updateAllEventSubscriptions(constructor: any) {
    let currentClass: any = constructor;
    const subscriptions = new Array<EventSubscription>();

    while (currentClass && currentClass !== Object) {
        if (currentClass.eventSubscriptions) {
            subscriptions.push(...currentClass.eventSubscriptions);
        }
        currentClass = Object.getPrototypeOf(currentClass);
    }

    constructor.eventSubscriptions = subscriptions;
}

/**
 * Decorator function that subscribes a method to a parent-scoped event.
 *
 * @param eventName - The name of the event to subscribe to.
 * @returns A decorator function that adds the event subscription to the target class.
 */
export function subscribesToParentScopedEvent(eventName: string) {
    return function (target: any, propertyKey: string) {
        if (!target.constructor.eventSubscriptions) {
            target.constructor.eventSubscriptions = [];
        }
        target.constructor.eventSubscriptions.push({ eventName, handlerName: propertyKey });
        updateAllEventSubscriptions(target.constructor);
    };
}

/**
 * Decorator that registers a method as a handler for a specific event.
 *
 * @param eventName The name of the event to handle.
 * @returns A function that decorates the target method.
 */
export function globalEventHandler(eventName: string) {
    return function (target: any, propertyKey: string, descriptor: PropertyDescriptor) {
        EventEmitter.getInstance().on(eventName, descriptor.value);
    };
}

/* Decorator function that registers itself as a handler for a specific event using the `once` function.
 * @param eventName The name of the event to handle.
 * @returns A decorator function that can be applied to a method.
 */
export function oneTimeGlobalEventHandler(eventName: string) {
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
            EventEmitter.getInstance().emit(eventName, (this as IIdentifiable).id, this, ...args);
        };
    };
}

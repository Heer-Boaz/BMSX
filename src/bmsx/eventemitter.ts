import { IIdentifiable } from "./bmsx.js";

type Listener = { listener: Function, subscriber: any };
type ListenerSet = Set<Listener>;
type EventListenerMap = Record<string, ListenerSet>;
type EmitterScopeListenerMap = Record<string, EventListenerMap>;

/**
 * A generic event dispatcher that can be used to manage listeners and dispatch events.
 */
export class EventEmitter {
    private emitterScopeListeners: EmitterScopeListenerMap = {};
    private globalScopeListeners: EventListenerMap = {};
    private static _instance: EventEmitter;

    public static get instance(): EventEmitter {
        if (!EventEmitter._instance) {
            EventEmitter._instance = new EventEmitter();
        }
        return EventEmitter._instance;
    }

    on(event_name: string, listener: Function, subscriber: any, emitter_id?: string): void {
        if (emitter_id) {
            if (!this.emitterScopeListeners[event_name]) {
                this.emitterScopeListeners[event_name] = {};
            }
            if (!this.emitterScopeListeners[event_name][emitter_id]) {
                this.emitterScopeListeners[event_name][emitter_id] = new Set();
            }
            this.emitterScopeListeners[event_name][emitter_id].add({ listener, subscriber });
        } else {
            if (!this.globalScopeListeners[event_name]) {
                this.globalScopeListeners[event_name] = new Set();
            }
            this.globalScopeListeners[event_name].add({ listener, subscriber });
        }
    }

    emit(event_name: string, emitter: IIdentifiable, ...args: any[]): void {
        this.emitterScopeListeners[event_name]?.[emitter.id]?.forEach(({ listener, subscriber }) => {
            listener.call(subscriber, event_name, emitter, ...args);
        });
        this.globalScopeListeners[event_name]?.forEach(({ listener, subscriber }) => {
            listener.call(subscriber, event_name, emitter, ...args);
        });
    }

    off(event: string, listener: Function, emitter?: string): void {
        const key = emitter || 'all';
        const emitterListeners = this.emitterScopeListeners[event]?.[key];
        if (!emitterListeners) {
            console.warn(`No listeners for event "${event}" and emitter "${key}"`);
            return;
        }
        for (let item of emitterListeners) {
            if (item.listener === listener) {
                emitterListeners.delete(item);
            }
        }
    }

    removeSubscriber(subscriber: any): void {
        for (const event in this.emitterScopeListeners) {
            for (const key in this.emitterScopeListeners[event]) {
                for (let item of this.emitterScopeListeners[event][key]) {
                    if (item.subscriber === subscriber) {
                        this.emitterScopeListeners[event][key].delete(item);
                    }
                }
            }
        }
        for (const event in this.globalScopeListeners) {
            for (let item of this.globalScopeListeners[event]) {
                if (item.subscriber === subscriber) {
                    this.globalScopeListeners[event].delete(item);
                }
            }
        }
    }

    clear(): void {
        this.emitterScopeListeners = {};
        this.globalScopeListeners = {};
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

    /**
     * The scope of the event subscription.
     * - 'all': The event will be consumed for all instances. NOT IMPLEMENTED!
     * - 'parent': The event will be consumed for the parent instance only.
     * - 'self': The event will be consumed for the current instance only.
     */
    scope: 'all' | 'parent' | 'self';
};

/**
 * Represents a constructor function that supports event subscriptions.
 */
export interface IEventSubscriber {
    eventSubscriptions?: EventSubscription[]
}

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
        target.constructor.eventSubscriptions.push({ eventName, handlerName: propertyKey, scope: 'parent' });
        updateAllEventSubscriptions(target.constructor);
    };
}

/**
 * Decorator function that subscribes a method to a self-scoped event.
 *
 * @param eventName - The name of the event to subscribe to.
 * @returns A decorator function that adds the event subscription to the target class.
 */
export function subscribesToSelfScopedEvent(eventName: string) {
    return function (target: any, propertyKey: string) {
        if (!target.constructor.eventSubscriptions) {
            target.constructor.eventSubscriptions = [];
        }
        target.constructor.eventSubscriptions.push({ eventName, handlerName: propertyKey, scope: 'self' });
        updateAllEventSubscriptions(target.constructor);
    };
}

/**
 * Decorator that registers a method as a handler for a specific event.
 *
 * @param eventName The name of the event to handle.
 * @returns A function that decorates the target method.
 */
export function subscribesToGlobalEvent(eventName: string) {
    return function (target: any, propertyKey: string, _descriptor: PropertyDescriptor) {
        if (!target.constructor.eventSubscriptions) {
            target.constructor.eventSubscriptions = [];
        }
        target.constructor.eventSubscriptions.push({ eventName, handlerName: propertyKey, scope: 'all' });
        updateAllEventSubscriptions(target.constructor);
    };
}

/**
 * Decorator function that emits an event when the decorated method is called.
 * @param eventName The name of the event to emit.
 * @returns A decorator function that can be applied to a method.
 */
export function emits_event(eventName: string) {
    return function (_target: any, _propertyKey: string, descriptor: PropertyDescriptor) {
        const originalMethod = descriptor.value;
        descriptor.value = function (...args: any[]) {
            originalMethod.apply(this, args);
            // Logic to emit the event
            EventEmitter.instance.emit(eventName, this as IIdentifiable, ...args);
        };
    };
}

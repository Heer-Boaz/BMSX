import { IIdentifiable, IParentable, IRegisterable, Identifier } from "./game";
import { Registry } from "./registry";

type Listener = { listener: Function, subscriber: any };
type ListenerSet = Set<Listener>;
type EventListenerMap = Record<string, ListenerSet>;
type EmitterScopeListenerMap = Record<string, EventListenerMap>;

/**
 * Represents an object that can subscribe to events.
 * @remarks
 * The object must implement the IIdentifiable interface if it subscribes to self-scoped events.
 * The object must implement the IParentable interface if it subscribes to parent-scoped events.
 * The object must implement the IEventSubscriber interface if it subscribes to events.
 */
type EventSubscriberType = IEventSubscriber | (IEventSubscriber & IParentable) | (IEventSubscriber & IIdentifiable);

/**
 * A generic event dispatcher that can be used to manage listeners and dispatch events.
 */
export class EventEmitter implements IRegisterable {
    public get id(): Identifier { return 'event_emitter'; }
    public dispose(): void {
        Registry.instance.deregister(this);
    }

    private emitterScopeListeners: EmitterScopeListenerMap = {};
    private globalScopeListeners: EventListenerMap = {};
    private static _instance: EventEmitter;

    public static get instance(): EventEmitter {
        if (!EventEmitter._instance) {
            EventEmitter._instance = new EventEmitter();
        }
        return EventEmitter._instance;
    }

    constructor() {
        Registry.instance.register(this);
    }

    /**
     * Initializes class-bound event subscriptions for the given subscriber.
     * @param subscriber - The event subscriber.
     */
    public initClassBoundEventSubscriptions(subscriber: EventSubscriberType, wrapper?: (...args: any[]) => any) {
        const constr = subscriber.constructor as IEventSubscriber;
        if (!constr?.eventSubscriptions) return;

        const eventEmitter = EventEmitter.instance;
        constr.eventSubscriptions.forEach(subscription => {
            let handler = subscriber[subscription.handlerName].bind(subscriber);
            // If a wrapper function is provided, use it to call the handler
            if (wrapper) {
                const originalHandler = handler;
                handler = (...args: any[]) => wrapper(originalHandler, ...args);
            }

            let emitterFilter: string;
            switch (subscription.scope) {
                case 'all': emitterFilter = undefined; break;
                case 'parent':
                    emitterFilter = (subscriber as IParentable).parentid;
                    if (!emitterFilter) throw Error(`Cannot subscribe '${(subscriber as IIdentifiable).id}' to event '${subscription.eventName}' with scope '${subscription.scope}' as the class (instance) '${subscriber.constructor.name}' does not have a 'parentid'.`);
                    break;
                case 'self':
                    emitterFilter = (subscriber as IIdentifiable).id;
                    if (!emitterFilter) throw Error(`Cannot subscribe '${(subscriber as IIdentifiable).id}' to event '${subscription.eventName}' with scope '${subscription.scope}' as the class (instance) '${subscriber.constructor.name}' does not have an 'id'.`);
                    break;
            }
            eventEmitter.on(subscription.eventName, handler, subscriber, emitterFilter);
        });
    }

    /**
     * Adds a listener function to the specified event name.
     *
     * @param event_name - The name of the event.
     * @param listener - The listener function to be called when the event is emitted.
     * @param subscriber - The subscriber object associated with the listener.
     * @param filtered_on_emitter_id - (Optional) The ID of the emitter scope. If provided, the listener will be added to the emitter scope listeners, otherwise it will be added to the global scope listeners.
     */
    on(event_name: string, listener: Function, subscriber: any, filtered_on_emitter_id?: Identifier): void {
        if (filtered_on_emitter_id) {
            if (!this.emitterScopeListeners[event_name]) {
                this.emitterScopeListeners[event_name] = {};
            }
            if (!this.emitterScopeListeners[event_name][filtered_on_emitter_id]) {
                this.emitterScopeListeners[event_name][filtered_on_emitter_id] = new Set();
            }
            this.emitterScopeListeners[event_name][filtered_on_emitter_id].add({ listener, subscriber });
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

    off(event_name: string, listener: Function, emitter?: string): void {
        const key = emitter || 'all';
        const emitterListeners = this.emitterScopeListeners[event_name]?.[key];
        if (!emitterListeners) {
            console.warn(`No listeners for event "${event_name}" and emitter "${key}"`);
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
 * Represents the scope of an event subscription. The scope determines which instances will receive the event.
 * - 'all': The event will be consumed for all instances.
 * - 'parent': The event will be consumed for events emitted by the parent instance only.
 * - 'self': The event will be consumed for events emitted by the current instance only.
 * - Identifier: The event will be consumed for events emitted by the instance with the given ID only.
 */
export type EventScope = 'all' | 'parent' | 'self' | Identifier;

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
    scope: EventScope;
};

/**
 * Represents a constructor function that supports event subscriptions.
 */
export interface IEventSubscriber {
    eventSubscriptions?: EventSubscription[]
    // on?(event_name: string, handler: Function, emitter_id: Identifier): void;
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
 * Decorator function that subscribes a method to a scoped event emitted by a event emitter specified by its unique ID.
 * @param eventName The name of the event to subscribe to.
 * @param emitter_id The ID of the event emitter.
 * @returns A decorator function that adds the event subscription to the target class.
 */
export function subscribesToEmitterScopedEvent(eventName: string, emitter_id: string) {
    return function (target: any, propertyKey: string, _descriptor: PropertyDescriptor) {
        if (!target.constructor.eventSubscriptions) {
            target.constructor.eventSubscriptions = [];
        }
        target.constructor.eventSubscriptions.push({ eventName, handlerName: propertyKey, scope: emitter_id });
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

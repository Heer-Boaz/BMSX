import { Identifiable, Identifier, Parentable, type RegisterablePersistent } from '../rompack/rompack';
import { Registry } from "./registry";

export type EventPayload = Record<string, any>;
export type EventHandler = (event_name: string, emitter: Identifiable, payload?: EventPayload) => any;

type Listener = { listener: EventHandler, subscriber: any, persistent: boolean };
export type ListenerSet = Set<Listener>;
type EventListenerMap = Record<string, ListenerSet>;
type EmitterScopeListenerMap = Record<string, EventListenerMap>;

/**
 * Represents an object that can subscribe to events.
 * @remarks
 * The object must implement the Identifiable interface if it subscribes to self-scoped events.
 * The object must implement the Parentable interface if it subscribes to parent-scoped events.
 * The object must implement the EventSubscriber interface if it subscribes to events.
 */
type EventSubscriberType = EventSubscriber | (EventSubscriber & Parentable) | (EventSubscriber & Identifiable);

/**
 * A generic event dispatcher that can be used to manage listeners and dispatch events.
 */
export class EventEmitter implements RegisterablePersistent {
	get registrypersistent(): true {
		return true;
	}

	/**
	 * Gets the identifier of the event emitter.
	 * Hardcoded to 'event_emitter'.
	 *
	 * @returns The identifier of the event emitter.
	 */
	public get id(): 'event_emitter' { return 'event_emitter'; }

	/**
	 * Disposes the object and deregisters it from the registry.
	 */
	public dispose(): void {
		EventEmitter.instance.clear();
	}

	/**
	 * Map of listeners for each emitter scope.
	 */
	public emitterScopeListeners: EmitterScopeListenerMap = {};
	/**
	 * Map of event listeners registered on the global scope.
	 */
	public globalScopeListeners: EventListenerMap = {};

	/**
	 * Listeners that receive all events emitted on the bus (wildcard).
	 * Signature: (name, payload?, emitter?)
	 */
	private anyListeners: Array<{ handler: EventHandler, persistent: boolean }> = [];

	/**
	 * The singleton instance of the EventEmitter class.
	 */
	private static _instance: EventEmitter;

	public static get instance(): EventEmitter {
		if (!EventEmitter._instance) {
			EventEmitter._instance = new EventEmitter();
		}
		return EventEmitter._instance;
	}

	/**
	 * Constructs a new instance of the EventEmitter class.
	 */
	constructor() {
		Registry.instance.register(this);
	}

	/**
	 * Subscribes a listener that is called for every emitted event.
	 * The payload is the first argument passed by the emitter (if any).
	 */
	public onAny(handler: EventHandler, persistent: boolean): void {
		// default persistent to false if undefined
		this.anyListeners.push({ handler, persistent: !!persistent });
	}

	/**
	 * Unsubscribes a previously registered wildcard listener.
	 * @param handler - The event handler to remove.
	 * @param forcePersistent - If true, also removes persistent listeners.
	 */
	public offAny(handler: EventHandler, forcePersistent: boolean = false): void {
		this.anyListeners = this.anyListeners.filter(x => (x.handler !== handler || (forcePersistent && x.persistent)));
	}

	/**
	 * Initializes class-bound event subscriptions for the given subscriber.
	 * @param subscriber - The event subscriber.
	 */
	public initClassBoundEventSubscriptions(subscriber: EventSubscriberType, wrapper?: (...args: any[]) => any) {
		const constr = subscriber.constructor as EventSubscriber;
		if (!constr?.eventSubscriptions) return;

		const self = EventEmitter.instance;
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
					emitterFilter = (subscriber as Parentable).parentid;
					if (!emitterFilter) throw Error(`Cannot subscribe '${(subscriber as Identifiable).id}' to event '${subscription.eventName}' with scope '${subscription.scope}' as the class (instance) '${subscriber.constructor.name}' does not have a 'parentid'.`);
					break;
				case 'self':
					emitterFilter = (subscriber as Identifiable).id;
					if (!emitterFilter) throw Error(`Cannot subscribe '${(subscriber as Identifiable).id}' to event '${subscription.eventName}' with scope '${subscription.scope}' as the class (instance) '${subscriber.constructor.name}' does not have an 'id'.`);
					break;
			}
			self.on(subscription.eventName, handler, subscriber, emitterFilter, !!subscription.persistent);
		});
	}

	private checkIfListenerExists(event_name: string, listener: EventHandler, subscriber: any, filtered_on_emitter_id?: Identifier): boolean {
		const self = EventEmitter.instance;
		if (filtered_on_emitter_id) {
			const emitterListeners = self.emitterScopeListeners[event_name]?.[filtered_on_emitter_id];
			if (emitterListeners) {
				for (let item of emitterListeners) {
					if (item.listener === listener && item.subscriber === subscriber) {
						return true; // Listener already exists
					}
				}
			}
		} else {
			const globalListeners = self.globalScopeListeners[event_name];
			if (globalListeners) {
				for (let item of globalListeners) {
					if (item.listener === listener && item.subscriber === subscriber) {
						return true; // Listener already exists
					}
				}
			}
		}
		return false; // Listener does not exist
	}

	/**
	 * Registers a listener for an event.
	 * @param event_name Name of the event.
	 * @param listener Callback invoked when the event is emitted.
	 * @param subscriber The logical subscriber instance (used for bulk removal).
	 * @param filtered_on_emitter_id Optional emitter id filter (self/parent/custom). If omitted the listener is global.
	 * @param persistent If true the listener survives EventEmitter.clear() just like registry persistent objects.
	 */
	on(event_name: string, listener: EventHandler, subscriber: any, filtered_on_emitter_id?: Identifier, persistent: boolean = false): void {
		const self = EventEmitter.instance;
		if (filtered_on_emitter_id) {
			if (!self.emitterScopeListeners[event_name]) {
				self.emitterScopeListeners[event_name] = {};
			}
			if (!self.emitterScopeListeners[event_name][filtered_on_emitter_id]) {
				self.emitterScopeListeners[event_name][filtered_on_emitter_id] = new Set();
			}
			if (self.checkIfListenerExists(event_name, listener, subscriber, filtered_on_emitter_id)) {
				console.warn(`Listener for event "${event_name}" already exists for emitter "${filtered_on_emitter_id}".`);
				return; // Prevent adding the same listener multiple times
			}
			self.emitterScopeListeners[event_name][filtered_on_emitter_id].add({ listener, subscriber, persistent });
		} else {
			if (!self.globalScopeListeners[event_name]) {
				self.globalScopeListeners[event_name] = new Set();
			}
			if (self.checkIfListenerExists(event_name, listener, subscriber)) {
				console.warn(`Listener for event "${event_name}", listener "${listener}", subscriber: "${subscriber}" already exists in global scope.`);
				return; // Prevent adding the same listener multiple times
			}
			self.globalScopeListeners[event_name].add({ listener, subscriber, persistent });
		}
	}

	/**
	 * Emits an event to its listeners.
	 *
	 * @param event_name - The name of the event.
	 * @param emitter - The emitter object.
	 * @param args - Additional arguments to pass to the listeners.
	 */
	emit(event_name: string, emitter: Identifiable, payload?: EventPayload): void {
		let anyoneSubscribed = false;
		EventEmitter.instance.emitterScopeListeners[event_name]?.[emitter.id]?.forEach(({ listener, subscriber }) => {
			anyoneSubscribed = true;
			listener.call(subscriber, event_name, emitter, payload);
		});
		EventEmitter.instance.globalScopeListeners[event_name]?.forEach(({ listener, subscriber }) => {
			anyoneSubscribed = true;
			listener.call(subscriber, event_name, emitter, payload);
		});

		// Wildcard listeners
		for (const item of this.anyListeners) item.handler(event_name, emitter, payload);

		if (!anyoneSubscribed) {
			console.warn(`No listeners for event "${event_name}" and emitter "${emitter.id}"!`);
			if (this.anyListeners.length === 0) console.warn(`Also, no wildcard listeners for event "${event_name}"!`);
		}
	}

	/**
	 * Removes a listener function from the specified event and emitter.
	 *
	 * @param event_name - The name of the event.
	 * @param listener - The listener function to remove.
	 * @param emitter - Optional. The emitter name. If not provided, 'all' is used as the default emitter.
	 * @param forcePersistent - If true, also removes persistent listeners.
	 */
	off(event_name: string, listener: EventHandler, emitter?: EventScope, forcePersistent: boolean = false): void {
		const key = emitter || 'all';
		const emitterListeners = EventEmitter.instance.emitterScopeListeners[event_name]?.[key];
		if (!emitterListeners) {
			console.warn(`No listeners for event "${event_name}" and emitter "${key}"`);
			return;
		}
		for (let item of emitterListeners) {
			if (item.listener === listener && (forcePersistent || !item.persistent)) {
				emitterListeners.delete(item);
			}
		}
	}

	/**
	 * Removes a subscriber from the event emitter.
	 *
	 * @param subscriber - The subscriber to be removed.
	 */
	removeSubscriber(subscriber: any): void {
		const self = EventEmitter.instance;
		for (const event in self.emitterScopeListeners) {
			for (const key in self.emitterScopeListeners[event]) {
				for (let item of self.emitterScopeListeners[event][key]) {
					if (item.subscriber === subscriber) {
						self.emitterScopeListeners[event][key].delete(item);
					}
				}
			}
		}
		for (const event in self.globalScopeListeners) {
			for (let item of self.globalScopeListeners[event]) {
				if (item.subscriber === subscriber) {
					self.globalScopeListeners[event].delete(item);
				}
			}
		}
	}

	/**
	 * Clears all the listeners from the event emitter.
	 */
	clear(): void {
		// Only remove non-persistent listeners. Persistent listeners survive resets.
		const self = EventEmitter.instance;

		// Filter emitter-scoped listeners
		for (const eventName in self.emitterScopeListeners) {
			const emitterMap = self.emitterScopeListeners[eventName];
			for (const emitterId in emitterMap) {
				const originalSet = emitterMap[emitterId];
				const kept = new Set<Listener>();
				for (const item of originalSet) {
					if (item.persistent) kept.add(item);
				}
				if (kept.size > 0) {
					emitterMap[emitterId] = kept;
				} else {
					delete emitterMap[emitterId];
				}
			}
			if (Object.keys(emitterMap).length === 0) {
				delete self.emitterScopeListeners[eventName];
			}
		}

		// Filter global listeners
		for (const eventName in self.globalScopeListeners) {
			const originalSet = self.globalScopeListeners[eventName];
			const kept = new Set<Listener>();
			for (const item of originalSet) {
				if (item.persistent) kept.add(item);
			}
			if (kept.size > 0) {
				self.globalScopeListeners[eventName] = kept;
			} else {
				delete self.globalScopeListeners[eventName];
			}
		}
		// Preserve persistent wildcard listeners; remove non-persistent ones
		this.anyListeners = this.anyListeners.filter(item => item.persistent);
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
	/** If true this subscription survives EventEmitter.clear(). */
	persistent?: boolean;
};

/**
 * Represents an event subscriber.
 */
export interface EventSubscriber {
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
export function subscribesToParentScopedEvent(eventName: string, persistent?: boolean) {
	return function (target: any, propertyKey: string) {
		if (!target.constructor.eventSubscriptions) {
			target.constructor.eventSubscriptions = [];
		}
		target.constructor.eventSubscriptions.push({ eventName, handlerName: propertyKey, scope: 'parent', persistent });
		updateAllEventSubscriptions(target.constructor);
	};
}

/**
 * Decorator function that subscribes a method to a self-scoped event.
 *
 * @param eventName - The name of the event to subscribe to.
 * @returns A decorator function that adds the event subscription to the target class.
 */
export function subscribesToSelfScopedEvent(eventName: string, persistent?: boolean) {
	return function (target: any, propertyKey: string) {
		if (!target.constructor.eventSubscriptions) {
			target.constructor.eventSubscriptions = [];
		}
		target.constructor.eventSubscriptions.push({ eventName, handlerName: propertyKey, scope: 'self', persistent });
		updateAllEventSubscriptions(target.constructor);
	};
}

/**
 * Decorator function that subscribes a method to a scoped event emitted by a event emitter specified by its unique ID.
 * @param eventName The name of the event to subscribe to.
 * @param emitter_id The ID of the event emitter.
 * @returns A decorator function that adds the event subscription to the target class.
 */
export function subscribesToEmitterScopedEvent(eventName: string, emitter_id: string, persistent?: boolean) {
	return function (target: any, propertyKey: string, _descriptor: PropertyDescriptor) {
		if (!target.constructor.eventSubscriptions) {
			target.constructor.eventSubscriptions = [];
		}
		target.constructor.eventSubscriptions.push({ eventName, handlerName: propertyKey, scope: emitter_id, persistent });
		updateAllEventSubscriptions(target.constructor);
	};
}

/**
 * Decorator that registers a method as a handler for a specific event.
 *
 * @param eventName The name of the event to handle.
 * @returns A function that decorates the target method.
 */
export function subscribesToGlobalEvent(eventName: string, persistent?: boolean) {
	return function (target: any, propertyKey: string, _descriptor: PropertyDescriptor) {
		if (!target.constructor.eventSubscriptions) {
			target.constructor.eventSubscriptions = [];
		}
		target.constructor.eventSubscriptions.push({ eventName, handlerName: propertyKey, scope: 'all', persistent });
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
		descriptor.value = function (payload: EventPayload) {
			originalMethod.apply(this, payload);
			// Logic to emit the event
			EventEmitter.instance.emit(eventName, this as Identifiable, payload);
		};
	};
}

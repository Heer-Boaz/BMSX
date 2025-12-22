import { Identifiable, Identifier, type RegisterablePersistent } from '../rompack/rompack';
import { Registry } from "./registry";
import { $ } from './engine_core';
import { HandlerRegistry } from './handlerregistry';
import { create_gameevent, EventPayload, GameEvent } from './game_event';
export { create_gameevent as createGameEvent, EventPayload, GameEvent } from './game_event';

export type EventHandler<E extends GameEvent = GameEvent> = (event: E) => any;

type Listener = { listener: EventHandler, subscriber: any, persistent: boolean };
export type ListenerSet = Set<Listener>;
type EventListenerMap = Record<string, ListenerSet>;
type EmitterScopeListenerMap = Record<string, EventListenerMap>;

export type EventListenerDisposer = () => void;

const portCache = new WeakMap<Identifiable, EventPort>();

export class EventPort {
	constructor(private readonly emitter: Identifiable) { }

	public on(spec: { event_name?: string; event?: string; handler: EventHandler; subscriber?: any; emitter?: Identifier; persistent?: boolean }): EventListenerDisposer {
		if (!spec || typeof spec !== 'object') {
			throw new Error('[EventPort] on(spec) requires a spec object.');
		}
		const eventNameRaw = spec.event_name ?? spec.event;
		const eventName = typeof eventNameRaw === 'string' && eventNameRaw.trim().length > 0 ? eventNameRaw.trim() : null;
		if (!eventName) {
			throw new Error('[EventPort] on(spec) requires spec.event to be a non-empty string.');
		}
		if (typeof spec.handler !== 'function') {
			throw new Error('[EventPort] on(spec) requires spec.handler to be a function.');
		}
		const emitterId = spec.emitter ?? this.emitter.id;
		EventEmitter.instance.on({ event_name: eventName, handler: spec.handler, subscriber: spec.subscriber, emitter: emitterId, persistent: spec.persistent });
		return () => EventEmitter.instance.off(eventName, spec.handler, emitterId);
	}

	emit(eventName: string, payload?: EventPayload): GameEvent {
		const event = create_gameevent({ type: eventName, emitter: this.emitter, ...(payload ?? {}) });
		EventEmitter.instance.emit(event);
		return event;
	}

	emit_event<T extends GameEvent>(event: T): T {
		if (!event.emitter) {
			event.emitter = this.emitter;
		}
		EventEmitter.instance.emit(event);
		return event;
	}
}

export function eventsOf(emitter: Identifiable): EventPort {
	let port = portCache.get(emitter);
	if (!port) {
		port = new EventPort(emitter);
		portCache.set(emitter, port);
	}
	return port;
}

/**
 * A generic event dispatcher that can be used to manage listeners and dispatch events.
 */
export class EventEmitter implements RegisterablePersistent {
	/**
	 * The singleton instance of the EventEmitter class.
	 */
	public static readonly instance: EventEmitter = new EventEmitter();

	// Toggle to enable verbose event logs
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

	public bind(): void {
		Registry.instance.register(this);
	}

	public unbind(): void {
		// No-op
		Registry.instance.deregister(this);
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
	private anyListeners: Array<{ handler: EventHandler<any>, persistent: boolean }> = [];

	/**
	 * Constructs a new instance of the EventEmitter class.
	 */
	constructor() {
		this.bind();
	}

	/**
	 * Subscribes a listener that is called for every emitted event.
	 * The payload is the first argument passed by the emitter (if any).
	 */
	public onAny(handler: EventHandler<any>, persistent: boolean = false): void {
		EventEmitter.instance.anyListeners.push({ handler, persistent });
	}

	/**
	 * Unsubscribes a previously registered wildcard listener.
	 * @param handler - The event handler to remove.
	 * @param forcePersistentRemoval - If true, also removes persistent listeners.
	 */
	public offAny(handler: EventHandler<any>, forcePersistentRemoval: boolean = false): void {
		EventEmitter.instance.anyListeners = EventEmitter.instance.anyListeners.filter(x => (x.handler !== handler || (!forcePersistentRemoval && x.persistent)));
	}

	private checkIfListenerExists(event_name: string, listener: EventHandler<any>, subscriber: any, filtered_on_emitter_id?: Identifier): boolean {
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
	public on(spec: { event_name?: string; event?: string; handler: EventHandler<any>; subscriber?: any; emitter?: Identifier; persistent?: boolean }): void {
		if (!spec || typeof spec !== 'object') {
			throw new Error('[EventEmitter] on(spec) requires a spec object.');
		}
		const eventNameRaw = spec.event_name ?? spec.event;
		const eventName = typeof eventNameRaw === 'string' && eventNameRaw.trim().length > 0 ? eventNameRaw.trim() : null;
		if (!eventName) {
			throw new Error('[EventEmitter] on(spec) requires spec.event_name (or spec.event) to be a non-empty string.');
		}
		if (typeof spec.handler !== 'function') {
			throw new Error(`[EventEmitter] Listener for event '${eventName}' must be a function.`);
		}
		const subscriber = spec.subscriber;
		const filtered_on_emitter_id = spec.emitter;
		const persistent = !!spec.persistent;
		const self = EventEmitter.instance;
		if (filtered_on_emitter_id) {
			if (!self.emitterScopeListeners[eventName]) {
				self.emitterScopeListeners[eventName] = {};
			}
			if (!self.emitterScopeListeners[eventName][filtered_on_emitter_id]) {
				self.emitterScopeListeners[eventName][filtered_on_emitter_id] = new Set();
			}
			if (self.checkIfListenerExists(eventName, spec.handler, subscriber, filtered_on_emitter_id)) {
				if ($.debug) console.warn(`Listener for event "${eventName}" already exists for emitter "${filtered_on_emitter_id}".`);
				return; // Prevent adding the same listener multiple times
			}
			self.emitterScopeListeners[eventName][filtered_on_emitter_id].add({ listener: spec.handler, subscriber, persistent });
		} else {
			if (!self.globalScopeListeners[eventName]) {
				self.globalScopeListeners[eventName] = new Set();
			}
			if (self.checkIfListenerExists(eventName, spec.handler, subscriber)) {
				if ($.debug) console.warn(`Listener for event "${eventName}", listener "${spec.handler}", subscriber: "${subscriber}" already exists in global scope.`);
				return; // Prevent adding the same listener multiple times
			}
			self.globalScopeListeners[eventName].add({ listener: spec.handler, subscriber, persistent });
		}
	}

	public emit<E extends GameEvent = GameEvent>(event: E): void;
	public emit(event_name: string, emitter?: Identifiable, payload?: EventPayload): void;
	public emit<E extends GameEvent = GameEvent>(arg0: E | string, emitterOrSource?: Identifiable, payload?: EventPayload): void {
		if (typeof arg0 === 'string') {
			if (payload && typeof payload !== 'object') {
				throw new Error(`Event '${arg0}' payload must be an object.`);
			}
			const event = create_gameevent({type: arg0, emitter: emitterOrSource, payload});
			this.emit(event);
			return;
		}
		const event = arg0;
		const eventName = event.type;
		const emitter = event.emitter;
		// console.log(`[EventEmitter] Emitting event '${eventName}' from emitter '${emitter?.id ?? 'global'}' with payload:`, payload ?? '(no payload)');
		const self = EventEmitter.instance;
			// let anyoneSubscribed = false;
			const deliver = (set?: ListenerSet) => {
				if (!set) return;
				for (const item of set) {
					// anyoneSubscribed = true;
					item.listener.call(item.subscriber, event);
				}
			};
		if (emitter) {
			const scoped = self.emitterScopeListeners[eventName]?.[emitter.id];
			deliver(scoped);
		}
		deliver(self.globalScopeListeners[eventName]);

		for (const item of self.anyListeners) {
			if (item.handler(event)) { // anyoneSubscribed = true;
			}
		}

		const dispatchRegistrySlot = (slotId: string): boolean => {
			const stub = HandlerRegistry.instance.get(slotId);
			if (!stub) return false;
			const outcome = stub.call(emitter , event);
			// anyoneSubscribed = true;
			return outcome === HandlerRegistry.STOP;
		};

		if (emitter && typeof emitter.id === 'string') {
			const emitterId = emitter.id;
			if (dispatchRegistrySlot(`event.${emitterId}.${eventName}`)) {
				return;
			}
		}
		if (dispatchRegistrySlot(`event.global.${eventName}`)) {
			return;
		}

		// if (!anyoneSubscribed && $.debug) {
		// 	console.debug(`[EventEmitter] '${eventName}' emitted by '${emitter?.id ?? 'global'}' but no listeners were registered.`);
		// }
	}

	/**
	 * Removes a listener function from the specified event and emitter scope.
	 *
	 * Behavior:
	 * - If 'emitter' is undefined, removes from the global scope listeners.
	 * - If 'emitter' is provided (string or Identifier), removes from the emitter-scoped listeners for that id.
	 *
	 * @param event_name - The name of the event.
	 * @param listener - The listener function to remove.
	 * @param emitter - Optional. The emitter id for scoped listeners. If omitted, the listener is removed from global scope.
	 * @param forcePersistent - If true, also removes persistent listeners.
	 */
	off(event_name: string, listener: EventHandler<any>, emitter?: Identifier, forcePersistent: boolean = false): void {
		const self = EventEmitter.instance;
		if (emitter === undefined) {
			// Global-scope removal
			const globalListeners = self.globalScopeListeners[event_name];
			if (!globalListeners) {
				console.warn(`No listeners for event "${event_name}" in global scope`);
				return;
			}
			for (const item of Array.from(globalListeners)) {
				if (item.listener === listener && (forcePersistent || !item.persistent)) {
					globalListeners.delete(item);
				}
			}
			if (globalListeners.size === 0) delete self.globalScopeListeners[event_name];
			return;
		}

		// Emitter-scoped removal
		const key = emitter;
		const emitterListeners = self.emitterScopeListeners[event_name]?.[key];
		if (!emitterListeners) {
			console.warn(`No listeners for event "${event_name}" and emitter "${key}"`);
			return;
		}
		for (const item of Array.from(emitterListeners)) {
			if (item.listener === listener && (forcePersistent || !item.persistent)) {
				emitterListeners.delete(item);
			}
		}
		if (emitterListeners.size === 0) {
			delete self.emitterScopeListeners[event_name][key];
			if (Object.keys(self.emitterScopeListeners[event_name]).length === 0) delete self.emitterScopeListeners[event_name];
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
		self.anyListeners = self.anyListeners.filter(item => item.persistent);
	}
}

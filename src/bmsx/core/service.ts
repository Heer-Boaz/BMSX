import { type RegisterablePersistent, type Identifier, type Identifiable } from '../rompack/rompack';
import { EventEmitter } from './eventemitter';
import { Stateful } from '../fsm/fsmtypes';
import { StateMachineController } from '../fsm/fsmcontroller';
import { StateDefinitions } from '../fsm/fsmlibrary';
import { Registry } from './registry';
import { onload, type RevivableObjectArgs } from '../serializer/serializationhooks';

/**
 * Base class for non-world-bound, persistent services (UE-style Subsystems).
 *
 * Characteristics:
 * - Registers in the global Registry at construction time.
 * - Default `registrypersistent = true` so services survive world loads unless explicitly disposed.
 * - Opt-in event processing is governed by `eventhandling_enabled` (true by default).
 * - Decorator-driven event subscriptions are initialized via the shared decorator logic
 *   (they will run after construction and after Registry.register due to deferred init).
 */
export abstract class Service implements Stateful, Identifiable, RegisterablePersistent {
	/** Unique identifier for the service (override or pass via constructor). */
	public id: Identifier;
	sc: StateMachineController;
	/** True when the service participates in gameplay. */
	public active: boolean = false;
	/** If false, systems should not advance time-based logic for this service. */
	public tickEnabled: boolean = true;

	/**
	 * If true, service survives Registry.clear() calls (e.g., during world reloads).
	 */
	public get registrypersistent(): true { return true; }

	/**
	 * Controls whether the service processes events (checked by EventEmitter gating).
	 * Services default to listening immediately; subclasses may toggle as needed.
	 */
	public eventhandling_enabled: boolean = false;

	// Default no-op state hooks; subclasses override to participate in Savegame.
	public getState(): unknown { return undefined; }
	public setState(_: unknown): void { /* no-op by default */ }

	/**
	 * Construct a new Service.
	 * @param id Unique identifier. If omitted, defaults to the class name in lower_snake_case.
	 * @param opts Optional flags for initial state.
	 */
	protected constructor(opts?: RevivableObjectArgs & { id?: Identifier }) {
		this.id = opts?.id ?? Service.deriveIdFromConstructor(this.constructor.name ?? 'service');

		const fsmName = this.constructor.name;
		const hasDef = !!StateDefinitions?.[fsmName];
		this.sc = hasDef ? new StateMachineController(fsmName, this.id) : new StateMachineController();

		// Register service in global registry
		this.bind();
	}

	/**
	 * Convenience: enable event processing for this service.
	 */
	public enableEvents(): void { this.eventhandling_enabled = true; }

	/**
	 * Convenience: disable event processing for this service.
	 */
	public disableEvents(): void { this.eventhandling_enabled = false; }

	/**
	 * Dispose the service; unsubscribes from events and deregisters from the Registry.
	 * Note: persistent records are preserved by default in this codebase; pass `true` to
	 * Registry.deregister's second argument if removal of the persistent record is required.
	 */
	public dispose(): void {
		// Remove all event subscriptions for this service and mark it inactive.
		this.disableEvents();
		// Deregister, preserving persistence behavior unless caller forces removal.
		this.unbind();
	}

	/** Wire decorator-declared subscriptions for this service. */
	@onload
	public bind(): void {
		Registry.instance.register(this);
		EventEmitter.instance.initClassBoundEventSubscriptions(this);
		// Bind controller subscriptions (no start on revive/bind)
		if (!this.sc) {
			throw new Error(`[Service:${this.id}] State machine controller was not initialized before bind().`);
		}
		this.sc.bind();
	}

	/** Unwire all subscriptions for this service. */
	public unbind(): void {
		EventEmitter.instance.removeSubscriber(this);
		Registry.instance.deregister(this, true);
	}

	/** BeginPlay-style activation for services (starts FSM). */
	public activate(): void {
		this.active = true;
		this.bind();
		this.enableEvents();
		this.sc.start();
	}

	public deactivate(): void {
		this.active = false;
		this.disableEvents();
		this.sc.pause();
	}

	private static deriveIdFromConstructor(name: string): Identifier {
		// Convert PascalCase/MyService to lower_snake_case: my_service
		const snake = name
			.replace(/^_+/, '') // strip leading underscores
			.replace(/([a-z0-9])([A-Z])/g, '$1_$2') // aA -> a_A
			.replace(/[-\s]+/g, '_') // dashes/spaces -> underscore
			.replace(/__+/g, '_') // collapse duplicate underscores
			.toLowerCase();
		return (snake || 'service') as Identifier;
	}
}

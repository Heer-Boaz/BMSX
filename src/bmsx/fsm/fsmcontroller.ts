import { EventEmitter, type EventLane, type EventPayload } from '../core/eventemitter';
import { Identifiable, Identifier } from '../rompack/rompack';
import { insavegame, onload, excludepropfromsavegame, type RevivableObjectArgs } from '../serializer/serializationhooks';
import { ActiveStateMachines } from './fsmlibrary';
import { type Stateful } from './fsmtypes';
import { State } from './state';

/**
 * Maximum history size for the state transition stack.
 */
export const BST_MAX_HISTORY = 10;

/**
 * The default BST ID.
 */
export const DEFAULT_BST_ID = 'master';

export interface FSMControllerOptions extends RevivableObjectArgs {
	/** The ID of the state machine. */
	fsm_id?: string;
	/** The ID of the object being controlled. */
	id?: string;

}

@insavegame
/**
 * Represents a state machine controller that manages multiple state machines.
 */
export class StateMachineController {
	/**
	 * The substate object that holds the state context for each substate.
	 */
	statemachines: Record<Identifier, State>;
	/** If true, controller will be advanced by systems. */
	public tickEnabled: boolean = true;
	/** True after a successful start(); prevents double-start. */
	@excludepropfromsavegame
	private _started: boolean = false;

	@excludepropfromsavegame
	public readonly _subscribedCache = new Set<string>();

	// NOTE THAT THE STATE MACHINES ARE NOT STARTED AUTOMATICALLY
	// THE TARGET OBJECT MUST CALL start() TO START THE STATE MACHINES
	// ALSO NOTE THAT THE eventhandling_enabled FLAG OF THE **target** IS USED TO DETERMINE WHETHER EVENTS SHOULD BE DISPATCHED TO THE STATE MACHINES

	/**
	 * Gets the state machines.
	 * @returns An object representing the state machines, where the keys are the machine IDs and the values are the corresponding states.
	 * @throws {Error} If no machine with the specified ID is found.
	 */
	public get machines(): Record<Identifier, State> {
		return new Proxy(this.statemachines, {
			get: (target, prop: string) => {
				if (target[prop]) {
					return target[prop];
				}
				throw new Error(`No machine with ID '${prop}'`);
			}
		});
	}

	/**
	 * Updates the cache of active state machines by adding any new machines that have been added to the controller.
	 * This ensures that the ActiveStateMachines map is always up-to-date with the current state of the controller.
	 * Note that this method is called automatically in the constructor and on bind() (after deserialization).
	 */
	private updateActiveMachinesCache(): void {
		for (const id in this.statemachines) {
			this.registerActiveMachine(this.statemachines[id]);
		}
	}

	private registerActiveMachine(machine: State): void {
		const machineId = machine.localdef_id;
		const existing = ActiveStateMachines.get(machineId) ?? [];
		if (existing.includes(machine)) return;
		ActiveStateMachines.set(machineId, [...existing, machine]);
	}

	public unregisterActiveMachine(machine: State): void {
		const machineId = machine.localdef_id;
		const existing = ActiveStateMachines.get(machineId);
		if (!existing) return;
		const next = existing.filter(entry => entry !== machine);
		if (next.length === 0) {
			ActiveStateMachines.delete(machineId);
			return;
		}
		ActiveStateMachines.set(machineId, next);
	}

	private bindMachine(machine: State): void {
		const events = machine.definition.event_list;
		if (!events || events.length === 0) {
			return;
		}
		for (const event of events) {
			let scope = event.scope;
			switch (scope) {
				case 'self':
					scope = machine.target.id;
					break;
				case 'all':
				default:
					scope = undefined;
					break;
			}
			const key = `${event.name}-${scope ?? 'global'}-${event.lane ?? 'any'}`;
			if (this._subscribedCache.has(key)) {
				continue;
			}
			const lane = event.lane ?? 'any';
			EventEmitter.instance.on(event.name, this.auto_dispatch, machine.target, { emitter: scope, persistent: true, lane });
			this._subscribedCache.add(key);
		}
	}

	public ensureStatemachine(id: Identifier, targetId: Identifier): State {
		if (typeof id !== 'string' || id.length === 0) {
			throw new Error('[StateMachineController] ensureStatemachine requires a non-empty machine id.');
		}
		if (typeof targetId !== 'string' || targetId.length === 0) {
			throw new Error('[StateMachineController] ensureStatemachine requires a non-empty target id.');
		}
		const existing = this.statemachines[id];
		if (existing) {
			return existing;
		}
		const machine = State.create(id, targetId);
		this.statemachines[id] = machine;
		this.registerActiveMachine(machine);
		if (this._started) {
			this.bindMachine(machine);
			machine.start();
		}
		return machine;
	}

	/**
	 * Creates a new instance of the StateMachineController class.
	 * @param opts - The options for the state machine controller.
	 * @throws {Error} If fsm_id or id is not provided in the options.
	 */
	constructor(opts: FSMControllerOptions) {
		// Support parameterless construction for deserialization. In normal runtime code,
		// WorldObject passes explicit ids. When fsm_id is supplied, eagerly add the machine.
		if (opts.constructReason === 'revive') {
			return; // Deserialization will populate properties
		}
		// if (!opts.fsm_id) throw new Error('FSMController requires fsm_id (the id of the state machine to load)');
		// if (!opts.id) throw new Error('FSMController requires id that reflects the target object (the object being controlled)');
		this.statemachines = {};
		if (opts.fsm_id && opts.id) {
			this.add_statemachine(opts.fsm_id, opts.id);
			// Track active machines by fsm_id (used for global event dispatch?)
			this.updateActiveMachinesCache();
		}
	}

	/**
	 * Disposes the BFStateMachine and deregisters all machines.
	 */
	public dispose(): void {
		this.pause();
		this._started = false;
		// Deregister all machines
		for (let id in this.statemachines) {
			const machine = this.statemachines[id];
			this.unregisterActiveMachine(machine);
			machine.dispose();
		}
		this.unbind();
	}

	/**
	 * Starts the state machine by initializing and starting all state machines.
	 */
	start(): void {
		if (this._started) return;
		// Ensure event subscriptions are installed before starting machines
		this.bind();
		// Start all state machines
		for (const id in this.statemachines) {
			this.statemachines[id].start();
		}
		this._started = true;
		this.resume();
	}

	/** Resume ticking without reinitializing state. */
	public resume(): void { this.tickEnabled = true; }
	/** Pause ticking (machines retain state). */
	public pause(): void { this.tickEnabled = false; }

	/** Wire all event subscriptions declared in machine definitions. */
	public bind(): void {
		for (const id in this.statemachines) {
			const machine = this.statemachines[id];
			this.bindMachine(machine);
			this.registerActiveMachine(machine);
		}
	}

	/** Unwire all event subscriptions declared in machine definitions. */
	public unbind(): void {
		for (const id in this.statemachines) {
			const machine = this.statemachines[id];
			const events = machine.definition.event_list;
			if (!events) {
				this.unregisterActiveMachine(machine);
				continue;
			}
			events.forEach(event => {
				let scope = event.scope;
				switch (scope) {
					case 'self': scope = machine.target.id; break;
					case 'all':
					default: scope = undefined; break;
				}
				// Pass undefined explicitly for global scope so EventEmitter.off removes global listeners
				EventEmitter.instance.off(event.name, this.auto_dispatch, scope, true);
			});
			this.unregisterActiveMachine(machine);
		}
	}

	@onload
	/**
	 * Initializes all statemachines by subscribing to events defined in the machine definition and allowing dispatching events to the appropriate machines.
	 */
	initLoadSetup(): void {
		this._subscribedCache.clear(); // Clear the subscribed cache
		this.bind();
	}

	/**
	 * Runs the current state of the current state machine.
	 * Also runs all state machines that have 'parallel' set to true.
	 */
	tick(): void {
		if (!this.tickEnabled) return; // If ticking is disabled or there is no current machine, do nothing. Some objects may not have a machine, so this is fine
		// Runs the current state of the current state machine
		// this.current_machine.tick();

		// Run all state machines. The machine itself handles the `paused` flag or lack of any definition
		for (let id in this.statemachines) {
			// Skip the current machine, as it has already been run
			// if (id === this.current_machine_id) continue;
			// if (this.statemachines[id].is_concurrent) this.statemachines[id].tick();
			this.statemachines[id].tick(); // Run all non-paused machines, even if they are not concurrent. This allows for event-driven state changes in non-concurrent machines and it makes sense to regard all distinct machines as "parallel".
		}
	}

	/**
	 * Switches both statemachine and state, based on the newstate which is a combination of statemachine and state, written as 'statemachine.state.substate...'.
	 * If no stateid is specified, assume that the stateid is the same as the machineid.
	 * If no machineid is specified, assume that the machineid is the same as the current machine.
	 * If the machine is not running in parallel, set it as the current machine. Otherwise, only switch the state in the specified machine, without changing the current machine.
	 * Throws an error if no machine with the specified ID exists.
	 * @param newstate The new state to switch to, in the format 'statemachine.state.substate'.
	 * @param args Optional arguments to pass to the new state.
	 */
	transition_to(newstate: Identifier, ...args: any[]): void {
		const dotIndex = newstate.indexOf(':/');
		let machineid = dotIndex !== -1 ? newstate.slice(0, dotIndex) : newstate;
		let stateids = dotIndex !== -1 ? newstate.slice(dotIndex + 1) : undefined;

		// Allow for switching to a state in the same machine without having to specify the machineid
		if (!stateids) {
			stateids = machineid; // If no stateid is specified, assume that the stateid is the same as the machineid
			// machineid = this.current_machine_id; // If no machineid is specified, assume that the machineid is the same as the current machine
		}

		const machine = this.statemachines[machineid];
		if (!machine) throw new Error(`No machine with ID '${machineid}'`);
		// if (!machine.is_concurrent) { // If the machine is not running in parallel, set it as the current machine
			// this.current_machine_id = machineid;
		// }
		machine.transition_to_path(stateids, ...args);
	}

	/**
	 * Switches the state in the specified state machine.
	 * If no state ID is specified, it assumes that the state ID is the same as the machine ID.
	 * Throws an error if no machine with the specified ID is found.
	 *
	 * @param path - The path to the state machine and state ID, separated by a ':/' (e.g., 'machineID:/stateID').
	 * @param args - Additional arguments to pass to the state switch function.
	 */
	switch_to(path: string, ...args: any[]): void {
		const sepIndex = path.indexOf(':/');
		const machineid = sepIndex !== -1 ? path.slice(0, sepIndex) : path;
		const statePath = sepIndex !== -1 ? path.slice(sepIndex + 2) : undefined;

		const machine = this.statemachines[machineid];
		if (!machine) throw new Error(`No machine with ID '${machineid}'`);

		// Only switch the state in the specified machine, without changing the current machine
		const targetPath = statePath ?? machineid;
		machine.transition_switch_path(targetPath, ...args);
	}

	/**
	 * Dispatches an event to the current state machine and other parallel running state machines.
	 *
	 * @param event_name - The name of the event to be dispatched.
	 * @param emitter - The identifier or identifiable object that triggered the event.
	 * @param args - Additional arguments to be passed to the event handlers.
	 */
	public dispatch_event(event_name: string, emitter: Identifier | Identifiable, ...args: any[]): void {
		const emitter_id = typeof emitter === 'string' ? emitter : emitter.id;

		// Dispatch the event to the current machine
		// this.current_machine?.dispatch_event(event_name, emitter_id, ...args); // Optional chaining in case there is no current machine (allowed for objects without a state machine)

		// Dispatch the event to all other machines. Note that the machine itself handles the `paused` flag or lack of any definition
		for (const id in this.statemachines) {
			// if (this.current_machine_id === id) continue; // Skip the current machine, as the event has already been dispatched to that machine
			// if (!this.statemachines[id].is_concurrent) continue; // ~Skip machines that are not running in parallel~ // Actually, dispatch to all non-paused machines, even if they are not concurrent. This allows for event-driven state changes in non-concurrent machines and it makes sense to regard all distinct machines as "parallel".
			this.statemachines[id].dispatch_event(event_name, emitter_id, ...args);
		}
	}

	/**
	 * Dispatches an event to the state machine.
	 *
	 * @param event_name - The name of the event to dispatch.
	 * @param emitter - The identifier or identifiable object that emitted the event.
	 * @param args - Additional arguments to pass to the event handler.
	 */
	public auto_dispatch(this: Stateful, event_name: string, emitter: Identifier | Identifiable, payload?: EventPayload, lane?: EventLane): void {
		if (this.eventhandling_enabled === false) return;
		this.sc.dispatch_event(event_name, emitter, payload, lane);
	}

	/**
	 * Adds a state machine to the Bfsm instance.
	 *
	 * @param id - The ID of the state machine.
	 * @param target_id - The ID of the target machine.
	 */
	add_statemachine(id: Identifier, target_id: Identifier): void {
		this.ensureStatemachine(id, target_id);
	}

	/**
	 * Gets the state machine with the given ID.
	 * @param id - The ID of the state machine.
	 * @returns The state machine with the given ID.
	 */
	get_statemachine(id: Identifier): State {
		return this.statemachines[id];
	}

	/**
	 * Checks if the specified ID matches the current state of the state machine.
	 * @param id - The ID to check.
	 * @returns `true` if the ID matches the current state, `false` otherwise.
	 * @throws Error if the machine with the specified ID does not exist.
	 */
	matches_state_path(id: string): boolean {
		const sepIndex = id.indexOf(':/');
		if (sepIndex === -1) {
			// No machine specified, check all machines
			for (const id in this.statemachines) {
				const machine = this.statemachines[id];
				if (machine.matches_state_path(id)) return true;
			}
			// const machine = this.current_machine;
			// return machine ? machine.matches_state_path(id) : false;
			return false;
		}
		else {
			// Machine specified, check only that machine

			const machineid = id.slice(0, sepIndex);
			const statePath = id.slice(sepIndex + 2);
			const machine = this.statemachines[machineid];
			if (!machine) return false;

			return machine.matches_state_path(statePath);
		}
	}

	/**
	 * Runs the state machine with the given ID.
	 * @param id - The ID of the state machine.
	 */
	run_statemachine(id: Identifier): void {
		this.statemachines[id].tick();
	}

	/**
	 * Runs all state machines.
	 */
	run_all_statemachines(): void {
		for (const id in this.statemachines) {
			this.run_statemachine(id);
		}
	}

	/**
	 * Resets the state machine with the given ID.
	 * @param id - The ID of the state machine.
	 */
	reset_statemachine(id: Identifier): void {
		this.statemachines[id].reset();
	}

	/**
	 * Resets all state machines.
	 */
	reset_all_statemachines(): void {
		for (const id in this.statemachines) {
			this.reset_statemachine(id);
		}
	}

	/**
	 * Goes back to the previous state of the state machine with the given ID.
	 * @param id - The ID of the state machine.
	 */
	pop_statemachine(id: Identifier): void {
		this.statemachines[id].pop_and_transition();
	}

	/**
	 * Goes back to the previous state of all state machines.
	 */
	pop_all_statemachines(): void {
		for (const id in this.statemachines) {
			this.pop_statemachine(id);
		}
	}

	/**
	 * Sets the state of the state machine with the given ID to the state with the given ID.
	 * @param id - The ID of the state machine.
	 * @param path - The ID of the state.
	 */
	switch_state(id: Identifier, path: Identifier): void {
		this.statemachines[id].transition_to(path);
	}

	/**
	 * Pauses the specified state machine.
	 * @param id - The identifier of the state machine to pause.
	 */
	pause_statemachine(id: Identifier): void {
		this.statemachines[id].paused = true;
	}

	/**
	 * Resumes the execution of a paused state machine.
	 *
	 * @param id - The identifier of the state machine to resume.
	 */
	resume_statemachine(id: Identifier): void {
		this.statemachines[id].paused = false;
	}

	/**
	 * Pauses all the state machines.
	 */
	pause_all_statemachines(): void {
		for (const id in this.statemachines) {
			this.pause_statemachine(id);
		}
	}

	/**
	 * Pauses all state machines except for the specified one.
	 *
	 * @param to_exclude_id - The identifier of the state machine to exclude from pausing.
	 */
	pause_all_except(to_exclude_id: Identifier): void {
		for (const id in this.statemachines) {
			if (id === to_exclude_id) continue;
			this.pause_statemachine(id);
		}
	}

	/**
	 * Resumes all the statemachines that have been paused.
	 */
	resume_all_statemachines(): void {
		for (const id in this.statemachines) {
			this.resume_statemachine(id);
		}
	}
}

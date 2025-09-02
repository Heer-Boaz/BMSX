import { $ } from '../core/game';
import { Identifiable, Identifier } from '../rompack/rompack';
import { insavegame, onload } from '../serializer/gameserializer';
import { ActiveStateMachines } from './fsmlibrary';
import { type Stateful, type id2sstate } from './fsmtypes';
import { State } from './state';
import { StateDefinition } from './statedefinition';

/**
 * Maximum history size for the state transition stack.
 */
export const BST_MAX_HISTORY = 10;

/**
 * The default BST ID.
 */
export const DEFAULT_BST_ID = 'master';


@insavegame
/**
 * Represents a state machine controller that manages multiple state machines.
 */
export class StateMachineController {
	/**
	 * The substate object that holds the state context for each substate.
	 */
	statemachines: Record<Identifier, State>;

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
	 * The identifier of the current machine.
	 */
	current_machine_id: Identifier;

	/**
	 * Gets the current state machine.
	 * @returns The current state machine.
	 */
	get current_machine(): State { return this.statemachines[this.current_machine_id]; }

	/**
	 * Gets the current state of the current state machine.
	 * @returns The current state of the current state machine.
	 */
	get current_state(): State { return this.current_machine.current; }

	/**
	 * Gets the states of the current machine.
	 * @returns The states of the current machine.
	 */
	get states(): id2sstate { return this.current_machine.substates; }

	/**
	 * Gets the state definition of the current machine.
	 */
	get definition(): StateDefinition { return this.current_machine.definition; }

	constructor(fsm_id?: string, id?: string) {
		this.statemachines = {};
		this.add_statemachine(fsm_id ?? this.constructor.name, id);

		// Get all active state machines with the same ID
		const activeStateMachinesWithSameId = ActiveStateMachines.get(fsm_id) ?? [];

		// Add the current machine to the list of active machines. We want to keep track of all active instances so that we can do hot-swapping!
		ActiveStateMachines.set(fsm_id ?? this.constructor.name, [...activeStateMachinesWithSameId, this.current_machine]);
	}

	/**
	 * Disposes the BFStateMachine and deregisters all machines.
	 */
	public dispose(): void {
		// Deregister all machines
		for (let id in this.statemachines) {
			this.statemachines[id].dispose();
		}
	}

	/**
	 * Starts the state machine by initializing and starting all state machines.
	 */
	start(): void {
		this.initLoadSetup();

		// Start all state machines
		for (const id in this.statemachines) {
			this.statemachines[id].start(); // Start the state machine with the given id (i.e., set the start state as the current state) and run the start state (i.e., run the start state's 'onenter' function)
		}
	}

	@onload
	/**
	 * Initializes all statemachines by subscribing to events defined in the machine definition and allowing dispatching events to the appropriate machines.
	 */
	initLoadSetup(): void {
		for (const id in this.statemachines) {
			const machine = this.statemachines[id];

			// Subscribe to all events that are defined in the machine definition for the machine and its submachines
			const events = machine.definition?.event_list;
			if (events && events.length > 0) {
				events.forEach(event => {
					let scope = event.scope;
					switch (scope) {
						case 'self':
							scope = machine.target.id; // If the scope is 'self', subscribe to the event with the given name and scope and dispatch it to the machine with the given id and scope, using the `target`-object as the event filter (i.e., only dispatch the event if the emitter is the target object)
							break;
						case 'all':
						default:
							scope = undefined; // If the scope is 'all' or undefined, subscribe to the event with the given name and scope and dispatch it to the machine with the given id and global scope, meaning that the event will be dispatched to all machines
							break;
					}
					// Subscribe to the event with the given name and scope and dispatch it to the machine with the given id and scope (or global scope if no scope is provided)
					$.event_emitter.on(event.name, this.auto_dispatch, machine.target, scope);
				});
			}
		}
	}

	/**
	 * Runs the current state of the current state machine.
	 * Also runs all state machines that have 'parallel' set to true.
	 */
	tick(): void {
		// Runs the current state of the current state machine
		this.current_machine.tick();

		// Run all state machines that have 'parallel' set to true
		for (let id in this.statemachines) {
			// Skip the current machine, as it has already been run
			if (id === this.current_machine_id) continue;
			if (this.statemachines[id].is_concurrent) this.statemachines[id].tick();
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
		const dotIndex = newstate.indexOf('.');
		let machineid = dotIndex !== -1 ? newstate.slice(0, dotIndex) : newstate;
		let stateids = dotIndex !== -1 ? newstate.slice(dotIndex + 1) : undefined;

		// Allow for switching to a state in the same machine without having to specify the machineid
		if (!stateids) {
			stateids = machineid; // If no stateid is specified, assume that the stateid is the same as the machineid
			machineid = this.current_machine_id; // If no machineid is specified, assume that the machineid is the same as the current machine
		}

		const machine = this.statemachines[machineid];
		if (!machine) throw new Error(`No machine with ID '${machineid}'`);
		if (!machine.is_concurrent) { // If the machine is not running in parallel, set it as the current machine
			this.current_machine_id = machineid;
		}
		machine.transition_to_path(stateids, ...args);
	}

	/**
	 * Switches the state in the specified state machine.
	 * If no state ID is specified, it assumes that the state ID is the same as the machine ID.
	 * Throws an error if no machine with the specified ID is found.
	 *
	 * @param path - The path to the state machine and state ID, separated by a dot (e.g., 'machineID.stateID').
	 * @param args - Additional arguments to pass to the state switch function.
	 */
	switch_to(path: string, ...args: any[]): void {
		let parts: string[];
		if (typeof path === 'string') {
			parts = path.split('.');
		} else {
			parts = path;
		}
		const [machineid, ...stateids] = parts;

		const machine = this.statemachines[machineid];
		if (!machine) throw new Error(`No machine with ID '${machineid}'`);

		// If no stateid is specified, assume that the stateid is the same as the machineid
		const stateid = stateids.length > 0 ? stateids : machineid;

		// Only switch the state in the specified machine, without changing the current machine
		machine.transition_switch_path(stateid, ...args);
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
		this.current_machine.dispatch_event(event_name, emitter_id, ...args);

		for (const id in this.statemachines) {
			if (this.current_machine_id === id) continue; // Skip the current machine, as the event has already been dispatched to that machine
			if (this.statemachines[id].paused) continue; // Skip paused machines
			if (!this.statemachines[id].is_concurrent) continue; // Skip machines that are not running in parallel
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
	private auto_dispatch(this: Stateful, event_name: string, emitter: Identifier | Identifiable, ...args: any[]): void {
		this.sc.dispatch_event(event_name, emitter, ...args);
	}

	/**
	 * Adds a state machine to the Bfsm instance.
	 *
	 * @param id - The ID of the state machine.
	 * @param target_id - The ID of the target machine.
	 * @param parent_id - The ID of the target object.
	 */
	add_statemachine(id: Identifier, target_id: Identifier): void {
		this.statemachines[id] = State.create(id, target_id, target_id, null);
		// If this is the first id that was added, set it as the current machine
		if (!this.current_machine_id) this.current_machine_id = id;
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
		// const [_targetid, machineid, ...stateids] = id.split(/[:.]/);
		const [machineid, ...stateids] = id.split('.');

		// If there are no more parts, check the state of the current machine
		if (stateids.length === 0) {
			return this.current_machine.matches_state_path(machineid);
		}

		const machine = this.statemachines[machineid];
		if (!machine) {
			throw new Error(`No machine with ID '${machineid}'`);
		}

		// If there are more parts, check the state of the submachine with the given path
		return machine.matches_state_path(stateids);
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
	 * Goes back to the previous state of the current state machine
	 */
	pop_and_transition(): void {
		this.current_machine.pop_and_transition();
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

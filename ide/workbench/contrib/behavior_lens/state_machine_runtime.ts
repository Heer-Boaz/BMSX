import type { Table } from '../../../../machine/ts/machine/cpu/table';
import type { ResourceDomain } from '../../../common/resource';
import type { RuntimeSourceState } from '../../../runtime/sources';
import type { SuspendedGuestSession } from '../../../runtime/suspended_guest';
import type { QuickPickItem } from '../../services/quick_input/provider';
import type { BehaviorInspectionProperty } from './inspection';
import { visitRuntimeComponents } from './runtime_components';
import { inspectBehaviorRuntimeValue } from './runtime_properties';

/** Both choices borrow actual instances, never inferred source/definition ids. */
export type StateMachineInstanceChoice = QuickPickItem & { readonly component: Table; readonly machine: Table };
export type StateMachineStateChoice = QuickPickItem & { readonly state: Table };

export function readStateMachineInstances(sources: RuntimeSourceState, guest: SuspendedGuestSession, domain: ResourceDomain) {
	const items: StateMachineInstanceChoice[] = [];
	const available = visitRuntimeComponents(sources, guest, domain, 'cartlib/fsm/fsm_component', component => {
		const id = guest.formatValue(guest.readStringMember(component, 'id'));
		const ownerId = guest.formatValue(guest.readStringMember(guest.readStringMember(component, 'parent'), 'id'));
		guest.visitTableEntries(guest.readStringMember(component, '_machines_by_id'), (key, machine) => {
			items.push({ label: guest.formatValue(key), description: `COMPONENT ${id}`, detail: `OWNER ${ownerId}`, component, machine: machine as Table });
		});
	});
	return { available, items };
}

/** Only the chosen machine's retained hierarchy. No traversal of other actors' states or parent/root links. */
export function readStateMachineStates(guest: SuspendedGuestSession, machine: Table): StateMachineStateChoice[] {
	const items: StateMachineStateChoice[] = [];
	function visit(state: Table): void {
		const current = guest.readStringMember(state, 'current_id');
		items.push({ label: guest.formatValue(guest.readStringMember(state, 'id')),
			description: current === null ? '' : `CURRENT CHILD: ${guest.formatValue(current)}`, detail: '', state });
		const states = guest.readStringMember(state, 'states') as Table;
		const ids = guest.readStringMember(state, 'state_ids') as Table;
		for (let i = 1; i <= ids.arrayLength; i += 1) visit(states.get(ids.getInteger(i)) as Table);
	}
	visit(machine);
	return items;
}

const DEFINITION_FIELDS = [
	['clock_source', 'CLOCK MASK'],
	['initial', 'INITIAL CHILD'], ['is_concurrent', 'CONCURRENT'], ['state_ids', 'LOADED CHILDREN'],
	['data', 'LOADED DEFAULTS'], ['tags', 'STATE TAGS'], ['actioneffects', 'ACTIONEFFECTS'],
	['entering_state', 'ENTER'], ['update', 'UPDATE'], ['exiting_state', 'EXIT'],
	['can_enter', 'ENTER GUARD'], ['can_exit', 'EXIT GUARD'],
	['input_eval_first', 'INPUT BEFORE UPDATE'],
	['timelines', 'TIMELINES'], ['tag_derivations', 'TAG DERIVATIONS'],
] as const;

export function inspectStateMachineState(
	sources: RuntimeSourceState, guest: SuspendedGuestSession, machine: StateMachineInstanceChoice, choice: StateMachineStateChoice,
): BehaviorInspectionProperty[] {
	const state = choice.state;
	const items: BehaviorInspectionProperty[] = [{ label: 'STATE INSTANCE', value: `${choice.label}\n${machine.description}\n${machine.detail}`,
		description: '', warning: false }];
	items.push(inspectBehaviorRuntimeValue(sources, guest, 'COMPONENT STARTED', guest.readStringMember(machine.component, '_started'), ''));
	items.push(inspectBehaviorRuntimeValue(sources, guest, 'COMPONENT ENABLED', guest.readStringMember(machine.component, 'enabled'), ''));
	items.push(inspectBehaviorRuntimeValue(sources, guest, 'CURRENT CHILD', guest.readStringMember(state, 'current_id'),
		'THE STORED SELECTION, NOT A CLAIM THAT ITS ANCESTORS OR OWNER ARE RUNNING.'));
	items.push(inspectBehaviorRuntimeValue(sources, guest, 'INSTANCE DATA', guest.readStringMember(state, 'data'), ''));
	items.push(inspectBehaviorRuntimeValue(sources, guest, 'CHILD INSTANCES', guest.readStringMember(state, 'state_ids'), ''));
	// Rebind can be stopped between two nodes. Read this node's definition, not the root's replacement tree.
	const definition = guest.readStringMember(state, 'definition');
	items.push({ label: 'LOADED DEFINITION', value: guest.formatValue(guest.readStringMember(definition, 'def_id')),
		description: 'THIS STATE\'S CURRENT DEFINITION. NOT A MATCH TO THE OPEN AUTHORED REGISTRATION.', warning: false });
	for (const [field, label] of DEFINITION_FIELDS) {
		const value = guest.readStringMember(definition, field);
		if (value !== null) items.push(inspectBehaviorRuntimeValue(sources, guest, label, value, ''));
	}
	guest.visitTableEntries(guest.readStringMember(definition, 'on'), (name, handler) => {
		items.push(inspectBehaviorRuntimeValue(sources, guest, `EVENT ${guest.formatValue(name)} / EXECUTION TARGET`,
			guest.readStringMember(handler, 'transition'), `COMPILED TRANSITION. NOT AN AUTHORED PATH OR PREDICTED DESTINATION.\nEMITTER: ${guest.formatValue(guest.readStringMember(handler, 'emitter'))}\nUNFILTERED: ${guest.formatValue(guest.readStringMember(handler, 'unfiltered'))}`));
	});
	const patterns = guest.readStringMember(definition, 'input_patterns') as Table | null;
	if (patterns !== null) {
		const transitions = guest.readStringMember(definition, 'input_transitions') as Table;
		for (let i = 1; i <= patterns.arrayLength; i += 1) {
			items.push(inspectBehaviorRuntimeValue(sources, guest, `INPUT ${guest.formatValue(patterns.getInteger(i))} / EXECUTION TARGET`,
				transitions.getInteger(i), 'COMPILED TRANSITION. THE ORIGINAL HANDLER TABLE IS NO LONGER RETAINED.'));
		}
	}
	return items;
}

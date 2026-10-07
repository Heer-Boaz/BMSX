import type { Table } from '../../../../machine/ts/machine/cpu/table';
import type { ResourceDomain } from '../../../common/resource';
import type { RuntimeSourceState } from '../../../runtime/sources';
import type { SuspendedGuestSession, SuspendedGuestValue } from '../../../runtime/suspended_guest';
import type { QuickPickItem } from '../../services/quick_input/provider';
import { findRuntimeComponent, visitRuntimeComponents } from './runtime_components';
import { BehaviorRuntimeProperties, type RuntimeInspectionProperty } from './runtime_properties';
import type { BehaviorDefinitionChoice } from './runtime_definitions';

/** Both choices borrow actual instances, never inferred source/definition ids. */
export type StateMachineInstance = { readonly component: Table; readonly machine: Table };
export type StateMachineInstanceChoice = QuickPickItem & StateMachineInstance;
export type StateMachineStateChoice = QuickPickItem & { readonly state: Table };

export function findStateMachineState(
	sources: RuntimeSourceState, guest: SuspendedGuestSession, domain: ResourceDomain,
	componentHashId: number, machineHashId: number, stateHashId: number,
): { machine: StateMachineInstance; state: Table } | undefined {
	const component = findRuntimeComponent(sources, guest, domain, 'cartlib/fsm/fsm_component', componentHashId);
	if (component === undefined) return undefined;
	let result: { machine: StateMachineInstance; state: Table } | undefined;
	const machines = guest.readStringMember(component, '_machines') as Table;
	for (let index = 1; index <= machines.arrayLength; index++) {
		const machine = machines.getInteger(index) as Table;
		if (machine.hashId !== machineHashId) continue;
		visitStateMachineHierarchy(guest, machine, state => {
			if (state.hashId === stateHashId) result = { machine: { component, machine }, state };
		});
		break;
	}
	return result;
}

function stateMachineInstanceChoice(guest: SuspendedGuestSession, component: Table, key: SuspendedGuestValue, machine: Table): StateMachineInstanceChoice {
	return { label: guest.formatValue(key), description: `COMPONENT ${guest.formatValue(guest.readStringMember(component, 'id'))}`,
		detail: `OWNER ${guest.formatValue(guest.readStringMember(guest.readStringMember(component, 'parent'), 'id'))}`, component, machine };
}

function stateMachineStateChoice(guest: SuspendedGuestSession, state: Table): StateMachineStateChoice {
	const current = guest.readStringMember(state, 'current_id');
	return { label: guest.formatValue(guest.readStringMember(state, 'id')),
		description: current === null ? '' : `CURRENT CHILD: ${guest.formatValue(current)}`, detail: '', state };
}

export function readStateMachineInstances(sources: RuntimeSourceState, guest: SuspendedGuestSession, domain: ResourceDomain) {
	const items: StateMachineInstanceChoice[] = [];
	const available = visitRuntimeComponents(sources, guest, domain, 'cartlib/fsm/fsm_component', component => {
		const machines = guest.readStringMember(component, '_machines') as Table;
		for (let index = 1; index <= machines.arrayLength; index++) {
			const machine = machines.getInteger(index) as Table;
			items.push(stateMachineInstanceChoice(guest, component, guest.readStringMember(machine, 'localdef_id'), machine));
		}
	});
	return { available, items };
}

/** Only the chosen machine's retained hierarchy. No traversal of other actors' states or parent/root links. */
export function readStateMachineStates(guest: SuspendedGuestSession, machine: Table): StateMachineStateChoice[] {
	const items: StateMachineStateChoice[] = [];
	visitStateMachineHierarchy(guest, machine, state => items.push(stateMachineStateChoice(guest, state)));
	return items;
}

export function readStateMachineDefinitionStates(guest: SuspendedGuestSession, root: Table): BehaviorDefinitionChoice[] {
	const items: BehaviorDefinitionChoice[] = [];
	visitStateMachineHierarchy(guest, root, definition => {
		items.push({ label: guest.formatValue(guest.readStringMember(definition, 'def_id')), description: '', detail: '', definition });
	});
	return items;
}

/** Both retained cartlib hierarchies use explicit child ids; never follow their parent/root backlinks. */
function visitStateMachineHierarchy(guest: SuspendedGuestSession, state: Table, visit: (state: Table) => void): void {
	visit(state);
	const states = guest.readStringMember(state, 'states') as Table;
	const ids = guest.readStringMember(state, 'state_ids') as Table;
	for (let i = 1; i <= ids.arrayLength; i += 1) visitStateMachineHierarchy(guest, states.get(ids.getInteger(i)) as Table, visit);
}

const EVENT_PRESENTATION = { prefix: 'EVENT ', suffix: ' / EXECUTION TARGET' };
const INPUT_PRESENTATION = { prefix: 'INPUT ', suffix: ' / EXECUTION TARGET' };
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
	sources: RuntimeSourceState, guest: SuspendedGuestSession, machine: StateMachineInstance, state: Table,
	properties = new BehaviorRuntimeProperties(sources, guest),
): RuntimeInspectionProperty[] {
	properties.field('instance', 'id', 'STATE INSTANCE', guest.readStringMember(state, 'id'));
	properties.field('component', 'id', 'COMPONENT', guest.readStringMember(machine.component, 'id'));
	properties.field('owner', 'id', 'OWNER', guest.readStringMember(guest.readStringMember(machine.component, 'parent'), 'id'));
	properties.field('component', '_started', 'COMPONENT STARTED', guest.readStringMember(machine.component, '_started'));
	properties.field('component', 'enabled', 'COMPONENT ENABLED', guest.readStringMember(machine.component, 'enabled'));
	properties.field('instance', 'current_id', 'CURRENT CHILD', guest.readStringMember(state, 'current_id'),
		'THE STORED SELECTION, NOT A CLAIM THAT ITS ANCESTORS OR OWNER ARE RUNNING.');
	properties.field('instance', 'data', 'INSTANCE DATA', guest.readStringMember(state, 'data'));
	properties.field('instance', 'state_ids', 'CHILD INSTANCES', guest.readStringMember(state, 'state_ids'));
	// Rebind can be stopped between two nodes. Read this node's definition, not the root's replacement tree.
	return inspectStateMachineDefinition(sources, guest, guest.readStringMember(state, 'definition') as Table, properties);
}

export function inspectStateMachineDefinition(
	sources: RuntimeSourceState, guest: SuspendedGuestSession, definition: Table, properties = new BehaviorRuntimeProperties(sources, guest),
): RuntimeInspectionProperty[] {
	properties.field('definition', 'def_id', 'LOADED DEFINITION', guest.readStringMember(definition, 'def_id'),
		'THE SELECTED RETAINED DEFINITION. NOT A MATCH TO THE OPEN AUTHORED REGISTRATION.');
	for (const [field, label] of DEFINITION_FIELDS) {
		const value = guest.readStringMember(definition, field);
		if (value !== null) properties.field('definition', field, label, value);
	}
	guest.visitTableEntries(guest.readStringMember(definition, 'on'), (name, handler) => {
		properties.entry('event', name, guest.readStringMember(handler, 'transition'), EVENT_PRESENTATION, `COMPILED TRANSITION. NOT AN AUTHORED PATH OR PREDICTED DESTINATION.\nEMITTER: ${guest.formatValue(guest.readStringMember(handler, 'emitter'))}\nUNFILTERED: ${guest.formatValue(guest.readStringMember(handler, 'unfiltered'))}`);
	});
	const patterns = guest.readStringMember(definition, 'input_patterns') as Table | null;
	if (patterns !== null) {
		const transitions = guest.readStringMember(definition, 'input_transitions') as Table;
		for (let i = 1; i <= patterns.arrayLength; i += 1) {
			properties.entry('input', i, transitions.getInteger(i), INPUT_PRESENTATION,
				'COMPILED TRANSITION. THE ORIGINAL HANDLER TABLE IS NO LONGER RETAINED.', undefined, patterns.getInteger(i));
		}
	}
	return properties.finish();
}

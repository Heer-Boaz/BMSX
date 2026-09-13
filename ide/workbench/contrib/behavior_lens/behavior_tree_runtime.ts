import type { Table } from '../../../../machine/ts/machine/cpu/table';
import type { ResourceDomain } from '../../../common/resource';
import type { RuntimeSourceState } from '../../../runtime/sources';
import type { SuspendedGuestSession } from '../../../runtime/suspended_guest';
import type { QuickPickItem } from '../../services/quick_input/provider';
import type { BehaviorInspectionProperty } from './inspection';
import { visitRuntimeComponents } from './runtime_components';
import { inspectBehaviorRuntimeValue } from './runtime_properties';

export type BehaviorTreeInstanceChoice = QuickPickItem & { readonly component: Table };

/** Actual components, not registered programs or authored registrations with matching ids. */
export function readBehaviorTreeInstances(sources: RuntimeSourceState, guest: SuspendedGuestSession, domain: ResourceDomain) {
	const items: BehaviorTreeInstanceChoice[] = [];
	const available = visitRuntimeComponents(sources, guest, domain, 'cartlib/behaviour_tree/bt_component', component => {
		const id = guest.formatValue(guest.readStringMember(component, 'id'));
		const ownerId = guest.formatValue(guest.readStringMember(guest.readStringMember(component, 'parent'), 'id'));
		items.push({ label: guest.formatValue(guest.readStringMember(component, 'tree_id')),
			description: `COMPONENT ${id}`, detail: `OWNER ${ownerId}`, component });
	});
	return { available, items };
}

const EXECUTION_FIELDS = [
	['enabled', 'COMPONENT ENABLED'], ['_execution_waiting', 'WAITING FOR COMPLETION'],
	['_execution_request_pending', 'EXECUTION REQUESTED'], ['_active_service_count', 'ACTIVE SERVICE COUNT'],
	['_execution_state', 'EXECUTION MEMORY'], ['_active_services', 'SERVICE MEMORY'],
	['evaluate', 'EVALUATOR'], ['operand', 'OPERAND'], ['reset', 'RESET'],
] as const;

/** This component's stored layout names its values, including nil slots. Never use programs_by_id. */
export function inspectBehaviorTreeInstance(
	sources: RuntimeSourceState, guest: SuspendedGuestSession, choice: BehaviorTreeInstanceChoice,
): BehaviorInspectionProperty[] {
	const items: BehaviorInspectionProperty[] = [{ label: choice.description, value: choice.detail, description: '', warning: false }];
	const board = guest.readStringMember(choice.component, 'blackboard');
	if (board === null) {
		items.push(inspectBehaviorRuntimeValue(sources, guest, 'BLACKBOARD', board, 'THIS COMPONENT HAS NO BLACKBOARD.'));
	} else {
		const layout = guest.readStringMember(board, '_layout');
		const values = guest.readStringMember(board, '_values') as Table | null;
		// new()/rebind() publish separate fields. At a stop before binding, show
		// their actual nil/table values; do not manufacture named slot values.
		if (layout === null || values === null) {
			items.push(inspectBehaviorRuntimeValue(sources, guest, 'BLACKBOARD LAYOUT', layout, ''));
			items.push(inspectBehaviorRuntimeValue(sources, guest, 'BLACKBOARD STORAGE', values, ''));
		} else {
			const keys = guest.readStringMember(layout, 'keys') as Table;
			const defaults = guest.readStringMember(layout, 'initial_values') as Table;
			if (keys.arrayLength === 0) items.push({ label: 'BLACKBOARD', value: '{}', description: 'NO DECLARED KEYS.', warning: false });
			for (let slot = 1; slot <= keys.arrayLength; slot += 1) {
				items.push(inspectBehaviorRuntimeValue(sources, guest, `BLACKBOARD / ${guest.formatValue(keys.getInteger(slot))}`,
					values.getInteger(slot), `STORED SLOT ${slot}\nLOADED DEFAULT: ${guest.previewValue(defaults.getInteger(slot), 1, 8)}`));
			}
		}
	}
	for (const [field, label] of EXECUTION_FIELDS) {
		items.push(inspectBehaviorRuntimeValue(sources, guest, label, guest.readStringMember(choice.component, field),
			field === '_execution_state' ? 'COMPILER-OWNED SLOTS, NOT AUTHORED NODE IDS.' : ''));
	}
	return items;
}

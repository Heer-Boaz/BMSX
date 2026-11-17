import { asInteger, asTable, canonicalTableKey, isNil, valueInteger, type Value } from '../../../../machine/ts/machine/cpu/value';
import type { ResourceDomain } from '../../../common/resource';
import type { RuntimeInstalledSourceState } from '../../../runtime/sources';
import type { SuspendedGuestSession } from '../../../runtime/suspended_guest';
import type { QuickPickItem } from '../../services/quick_input/provider';
import { visitRuntimeComponents } from './runtime_components';
import { BehaviorRuntimeProperties, type RuntimeInspectionProperty } from './runtime_properties';

export type BehaviorTreeInstanceChoice = QuickPickItem & { readonly component: Value };

function behaviorTreeInstanceChoice(guest: SuspendedGuestSession, component: Value): BehaviorTreeInstanceChoice {
	return { label: guest.formatValue(guest.readStringMember(component, 'tree_id')),
		description: `COMPONENT ${guest.formatValue(guest.readStringMember(component, 'id'))}`,
		detail: `OWNER ${guest.formatValue(guest.readStringMember(guest.readStringMember(component, 'owner'), 'id'))}`, component };
}

/** Actual components, not registered programs or authored registrations with matching ids. */
export function readBehaviorTreeInstances(sources: RuntimeInstalledSourceState, guest: SuspendedGuestSession, domain: ResourceDomain) {
	const items: BehaviorTreeInstanceChoice[] = [];
	const available = visitRuntimeComponents(sources, guest, domain, 'cartlib/behaviour_tree/bt_component', component => {
		items.push(behaviorTreeInstanceChoice(guest, component));
	});
	return { available, items };
}

const BLACKBOARD_PRESENTATION = { prefix: 'BLACKBOARD / ' };
const EXECUTION_FIELDS = [
	['enabled', 'COMPONENT ENABLED'], ['_execution_waiting', 'WAITING FOR COMPLETION'],
	['_execution_request_pending', 'EXECUTION REQUESTED'], ['_active_service_count', 'ACTIVE SERVICE COUNT'],
	['_execution_state', 'EXECUTION MEMORY'], ['_active_services', 'SERVICE MEMORY'],
	['evaluate', 'EVALUATOR'], ['operand', 'OPERAND'], ['reset', 'RESET'],
] as const;

/** This component's stored layout names its values, including nil slots. Never use programs_by_id. */
export function inspectBehaviorTreeInstance(
	sources: RuntimeInstalledSourceState, guest: SuspendedGuestSession, component: Value,
	properties = new BehaviorRuntimeProperties(sources, guest),
): RuntimeInspectionProperty[] {
	properties.field('component', 'id', 'COMPONENT', guest.readStringMember(component, 'id'));
	properties.field('owner', 'id', 'OWNER', guest.readStringMember(guest.readStringMember(component, 'owner'), 'id'));
	const board = guest.readStringMember(component, 'blackboard');
	if (isNil(board)) {
		properties.field('component', 'blackboard', 'BLACKBOARD', board, 'THIS COMPONENT HAS NO BLACKBOARD.');
	} else {
		const layout = guest.readStringMember(board, '_layout');
		const values = guest.readStringMember(board, '_values');
		// new()/rebind() publish separate fields. At a stop before binding, show
		// their actual nil/table values; do not manufacture named slot values.
		if (isNil(layout) || isNil(values)) {
			properties.field('blackboard', '_layout', 'BLACKBOARD LAYOUT', layout);
			properties.field('blackboard', '_values', 'BLACKBOARD STORAGE', values);
		} else {
			const keys = asTable(guest.readStringMember(layout, 'keys'), guest.cpu.gc);
			const defaults = asTable(guest.readStringMember(layout, 'initial_values'), guest.cpu.gc);
			const slotsByKey = asTable(guest.readStringMember(layout, 'slots_by_key'), guest.cpu.gc);
			const valueSlots = asTable(values, guest.cpu.gc);
			const keyCount = keys.length();
			if (keyCount === 0) properties.text('BLACKBOARD', '{}', 'NO DECLARED KEYS.');
			for (let slot = 1; slot <= keyCount; slot += 1) {
				// Logical names use slots_by_key's table-key equality, not raw subtype identity.
				const key = canonicalTableKey(keys.getInteger(slot));
				// compile/rebind resolve semantic keys through slots_by_key. Earlier
				// duplicate declarations remain visible, but are not independent watches.
				const watchable = asInteger(slotsByKey.get(key)) === slot;
				properties.entry(watchable ? 'blackboard' : 'blackboard-slot', watchable ? key : valueInteger(slot),
					valueSlots.getInteger(slot), BLACKBOARD_PRESENTATION, `STORED SLOT ${slot}\nLOADED DEFAULT: `,
					defaults.getInteger(slot), key, watchable);
			}
		}
	}
	for (const [field, label] of EXECUTION_FIELDS) {
		properties.field('component', field, label, guest.readStringMember(component, field),
			field === '_execution_state' ? 'COMPILER-OWNED SLOTS, NOT AUTHORED NODE IDS.' : '');
	}
	return properties.finish();
}

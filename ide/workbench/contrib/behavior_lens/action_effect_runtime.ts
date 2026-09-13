import type { Table } from '../../../../machine/ts/machine/cpu/table';
import { valueIsString } from '../../../../machine/ts/machine/cpu/value';
import type { ResourceDomain } from '../../../common/resource';
import type { RuntimeSourceState } from '../../../runtime/sources';
import type { SuspendedGuestSession } from '../../../runtime/suspended_guest';
import type { QuickPickItem } from '../../services/quick_input/provider';
import { ACTION_EFFECT_FIELDS } from './action_effect_fields';
import type { BehaviorInspectionProperty } from './inspection';
import { visitRuntimeComponents } from './runtime_components';
import { inspectBehaviorRuntimeValue } from './runtime_properties';

/** Borrowed only while the picker owns the suspended read. Never saved in an editor input. */
export type ActionEffectInstanceChoice = QuickPickItem & {
	readonly component: Table;
	readonly effect: Table;
};

/** The actual type index, not a source registration scan or a heap-wide discovery walk. */
export function readActionEffectInstances(sources: RuntimeSourceState, guest: SuspendedGuestSession, domain: ResourceDomain) {
	const items: ActionEffectInstanceChoice[] = [];
	const available = visitRuntimeComponents(sources, guest, domain, 'cartlib/actioneffects/actioneffect_component', component => {
		const id = guest.formatValue(guest.readStringMember(component, 'id'));
		const ownerId = guest.formatValue(guest.readStringMember(guest.readStringMember(component, 'parent'), 'id'));
		guest.visitTableEntries(guest.readStringMember(component, 'effects'), (key, effect) => {
			items.push({ label: guest.formatValue(key), description: `COMPONENT ${id}`, detail: `OWNER ${ownerId}`, component, effect: effect as Table });
		});
	});
	return { available, items };
}

const INSTANCE_FIELDS = [
	['active_count', 'ACTIVE COUNT'], ['cooldown_until_ms', 'COOLDOWN UNTIL (MS)'],
	['next_execution_ms', 'NEXT EXECUTION (MS)'], ['cooldown_pending', 'COOLDOWN PENDING'],
	['pending_cooldown_ms', 'PENDING DURATION (MS)'],
] as const;

/** One selected instance is formatted once. Paint/scroll never read the guest or evaluate a callback. */
export function inspectActionEffectInstance(
	sources: RuntimeSourceState, guest: SuspendedGuestSession, choice: ActionEffectInstanceChoice,
): BehaviorInspectionProperty[] {
	const items: BehaviorInspectionProperty[] = [];
	const parent = guest.readStringMember(choice.component, 'parent');
	const world = guest.readStringMember(parent, 'world');
	const state = [choice.detail, `GAMEPLAY TIME (MS): ${guest.formatValue(guest.readStringMember(world, 'gameplay_time_ms'))}`];
	for (const [field, label] of INSTANCE_FIELDS) {
		const value = guest.readStringMember(choice.effect, field);
		if (value !== null) state.push(`${label}: ${guest.formatValue(value)}`);
	}
	items.push({ label: `INSTANCE / ${choice.description}`, value: state.join('\n'), description: '', warning: false });
	const definition = guest.readStringMember(choice.effect, 'definition');
	items.push({ label: 'LOADED DEFINITION', value: choice.label,
		description: 'THIS INSTANCE\'S CURRENT DEFINITION. NOT A MATCH TO THE OPEN AUTHORED REGISTRATION.', warning: false });
	guest.visitTableEntries(definition, (key, value) => {
		const name = guest.formatValue(key);
		const metadata = valueIsString(key) ? ACTION_EFFECT_FIELDS.get(name) : undefined;
		items.push(inspectBehaviorRuntimeValue(sources, guest, metadata === undefined ? name : metadata.label, value,
			metadata === undefined ? '' : metadata.description));
	});
	return items;
}

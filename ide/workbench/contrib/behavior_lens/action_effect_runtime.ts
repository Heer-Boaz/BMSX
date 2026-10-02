import type { Table } from '../../../../machine/ts/machine/cpu/table';
import { valueIsString } from '../../../../machine/ts/machine/cpu/value';
import type { ResourceDomain } from '../../../common/resource';
import type { RuntimeSourceState } from '../../../runtime/sources';
import type { SuspendedGuestSession, SuspendedGuestValue } from '../../../runtime/suspended_guest';
import type { QuickPickItem } from '../../services/quick_input/provider';
import { ACTION_EFFECT_FIELDS } from './action_effect_fields';
import type { BehaviorInspectionProperty } from './inspection';
import { findRuntimeComponent, visitRuntimeComponents } from './runtime_components';
import { BehaviorRuntimeProperties } from './runtime_properties';

/** Borrowed within one suspended read. Never saved in an editor input. */
export type ActionEffectInstance = {
	readonly component: Table;
	readonly effect: Table;
	readonly key: SuspendedGuestValue;
};
export type ActionEffectInstanceChoice = QuickPickItem & ActionEffectInstance;

export function findActionEffectInstance(sources: RuntimeSourceState, guest: SuspendedGuestSession, domain: ResourceDomain, componentHashId: number, effectHashId: number): ActionEffectInstance | undefined {
	const component = findRuntimeComponent(sources, guest, domain, 'cartlib/actioneffects/actioneffect_component', componentHashId);
	if (component === undefined) return undefined;
	let result: ActionEffectInstance | undefined;
	guest.visitTableEntries(guest.readStringMember(component, 'effects'), (key, value) => {
		const effect = value as Table;
		if (effect.hashId === effectHashId) result = { component, key, effect };
	});
	return result;
}

function actionEffectInstanceChoice(guest: SuspendedGuestSession, component: Table, key: SuspendedGuestValue, effect: Table): ActionEffectInstanceChoice {
	return { label: guest.formatValue(key), description: `COMPONENT ${guest.formatValue(guest.readStringMember(component, 'id'))}`,
		detail: `OWNER ${guest.formatValue(guest.readStringMember(guest.readStringMember(component, 'parent'), 'id'))}`, component, key, effect };
}

/** The actual type index, not a source registration scan or a heap-wide discovery walk. */
export function readActionEffectInstances(sources: RuntimeSourceState, guest: SuspendedGuestSession, domain: ResourceDomain) {
	const items: ActionEffectInstanceChoice[] = [];
	const available = visitRuntimeComponents(sources, guest, domain, 'cartlib/actioneffects/actioneffect_component', component => {
		guest.visitTableEntries(guest.readStringMember(component, 'effects'), (key, effect) => {
			items.push(actionEffectInstanceChoice(guest, component, key, effect as Table));
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
	sources: RuntimeSourceState, guest: SuspendedGuestSession, choice: ActionEffectInstance,
	properties = new BehaviorRuntimeProperties(sources, guest),
): BehaviorInspectionProperty[] {
	const parent = guest.readStringMember(choice.component, 'parent');
	const world = guest.readStringMember(parent, 'world');
	// Values remain independently refreshable; the definition follows in the same document.
	properties.value('COMPONENT', guest.readStringMember(choice.component, 'id'));
	properties.value('OWNER', guest.readStringMember(parent, 'id'));
	properties.value('GAMEPLAY TIME (MS)', guest.readStringMember(world, 'gameplay_time_ms'));
	for (const [field, label] of INSTANCE_FIELDS) {
		const value = guest.readStringMember(choice.effect, field);
		if (value !== null) properties.value(label, value);
	}
	return inspectActionEffectDefinition(sources, guest, guest.readStringMember(choice.effect, 'definition') as Table, guest.formatValue(choice.key), properties);
}

/** Shared property projection for a registry entry or an instance's own retained definition. */
export function inspectActionEffectDefinition(
	sources: RuntimeSourceState, guest: SuspendedGuestSession, definition: Table, id: string, properties = new BehaviorRuntimeProperties(sources, guest),
): BehaviorInspectionProperty[] {
	properties.text('LOADED DEFINITION', id,
		'THE SELECTED RETAINED DEFINITION. NOT A MATCH TO THE OPEN AUTHORED REGISTRATION.');
	guest.visitTableEntries(definition, (key, value) => {
		const name = guest.formatValue(key);
		const metadata = valueIsString(key) ? ACTION_EFFECT_FIELDS.get(name) : undefined;
		properties.value(metadata === undefined ? name : metadata.label, value,
			metadata === undefined ? '' : metadata.description);
	});
	return properties.finish();
}

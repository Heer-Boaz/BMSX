import type { Table } from '../../../../machine/ts/machine/cpu/table';
import { valueIsString, valueIsTable } from '../../../../machine/ts/machine/cpu/value';
import type { ResourceDomain } from '../../../common/resource';
import { readRuntimeLuaModuleExport, runtimeLuaFunctionSource } from '../../../runtime/lua_inspection';
import type { RuntimeSourceState } from '../../../runtime/sources';
import type { SuspendedGuestSession, SuspendedGuestValue } from '../../../runtime/suspended_guest';
import type { QuickPickItem } from '../../services/quick_input/provider';
import { ACTION_EFFECT_FIELDS } from './action_effect_fields';
import type { BehaviorInspectionProperty } from './inspection';

/** Borrowed only while the picker owns the suspended read. Never saved in an editor input. */
export type ActionEffectInstanceChoice = QuickPickItem & {
	readonly component: Table;
	readonly effect: Table;
};

/** The actual type index, not a source registration scan or a heap-wide discovery walk. */
export function readActionEffectInstances(sources: RuntimeSourceState, guest: SuspendedGuestSession, domain: ResourceDomain) {
	const registry = readRuntimeLuaModuleExport(sources, guest, domain, 'cartlib/registry');
	const type = readRuntimeLuaModuleExport(sources, guest, domain, 'cartlib/actioneffects/actioneffect_component');
	const items: ActionEffectInstanceChoice[] = [];
	if (registry.kind === 'unavailable' || type.kind === 'unavailable' || registry.value === null || type.value === null)
		return { available: false, items };
	const index = guest.readStringMember(registry.value, '_entries_by_key') as Table;
	const bucket = index.get(type.value);
	if (bucket !== null) {
		const components = guest.readStringMember(bucket, 'items') as Table;
		for (let i = 1; i <= components.arrayLength; i += 1) {
			const component = components.getInteger(i) as Table;
			const id = guest.formatValue(guest.readStringMember(component, 'id'));
			const ownerId = guest.formatValue(guest.readStringMember(guest.readStringMember(component, 'parent'), 'id'));
			guest.visitTableEntries(guest.readStringMember(component, 'effects'), (key, effect) => {
				items.push({ label: guest.formatValue(key), description: `COMPONENT ${id}`, detail: `OWNER ${ownerId}`, component, effect: effect as Table });
			});
		}
	}
	return { available: true, items };
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
		const source = runtimeLuaFunctionSource(sources, guest, value);
		items.push({ label: metadata === undefined ? name : metadata.label,
			value: source === undefined ? formatLoadedValue(guest, value)
				: `CALL TARGET / ${source.resource.domain === -1 ? 'SYSTEM' : `CART ${source.resource.domain}`}\n${source.resource.path}:${source.range.start.line}:${source.range.start.column}`,
			description: metadata === undefined ? '' : metadata.description, warning: false, source });
	});
	return items;
}

/** Lists retain their actual keys, including holes; no second dense table or evaluated requirements. */
function formatLoadedValue(guest: SuspendedGuestSession, value: SuspendedGuestValue): string {
	if (!valueIsTable(value)) return guest.formatValue(value);
	const lines: string[] = [];
	guest.visitTableEntries(value, (key, entry) => lines.push(`${guest.formatValue(key)}: ${guest.previewValue(entry, 1, 8)}`));
	return lines.length === 0 ? '{}' : lines.join('\n');
}

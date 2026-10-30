import { valueTag, ValueTag, type StringValue } from '../../../../machine/ts/machine/cpu/value';
import type { Table } from '../../../../machine/ts/machine/cpu/table';
import type { RuntimeInstalledSourceState } from '../../../runtime/sources';
import type { SuspendedGuestSession } from '../../../runtime/suspended_guest';
import { inspectActionEffectInstance } from '../behavior_lens/action_effect_runtime';
import { inspectBehaviorTreeInstance } from '../behavior_lens/behavior_tree_runtime';
import { BehaviorRuntimeProperties, type RuntimeInspectionProperty } from '../behavior_lens/runtime_properties';
import { inspectStateMachineState } from '../behavior_lens/state_machine_runtime';
import type { ActorNode } from './runtime';

const PROGRAM_PRESENTATION = { prefix: 'PROGRAM / ' };
const ACTOR_REFERENCE = { label: 'Owner', referenceType: 'Actor' };
const INTERNAL_MEMBER = { internal: true };
const ACTOR_LABELS: Readonly<Record<string, string>> = {
	id: 'ID', definition_id: 'Definition', active: 'Active', spatial: 'Transform',
	tags: 'Tags', data: 'Data', events: 'Events',
};
const TIMELINE_FIELDS = [
	['position_ms', 'Time (ms)'], ['head', 'Frame'], ['playing', 'Playing'],
	['on_finished', 'On finished'], ['bindings', 'Bindings'], ['program', 'Program'],
] as const;

export function inspectActorNode(
	sources: RuntimeInstalledSourceState, guest: SuspendedGuestSession, node: ActorNode,
	properties = new BehaviorRuntimeProperties(sources, guest),
): RuntimeInspectionProperty[] {
	const value = node.value!;
	switch (node.kind) {
		case 'state': case 'machine': return inspectStateMachineState(sources, guest, { component: node.component!, machine: node.receiver! }, value, properties);
		case 'tree': return inspectBehaviorTreeInstance(sources, guest, node.component!, properties);
		case 'effect': return inspectActionEffectInstance(sources, guest, { component: node.component!, key: node.key, effect: value }, properties);
	}
	if (node.kind === 'actor') {
		// Actor gameplay fields come from the stored object, not an inspector
		// DTO with invented position/dimension members. Framework backlinks and
		// private bookkeeping do not become duplicate expandable World trees.
		guest.visitTableEntries(value, (key, item) => {
			if (valueTag(key) !== ValueTag.String) { properties.entry('member', key, item); return; }
			const name = guest.stringText(key as StringValue);
			if (name.startsWith('_') || name === 'world' || name === 'scene') return;
			properties.field('instance', name, ACTOR_LABELS[name] ?? name, item);
		});
	} else if (node.kind === 'timeline') {
		for (const [key, label] of TIMELINE_FIELDS) properties.field('instance', key, label, guest.readStringMember(value, key));
		const program = guest.readStringMember(value, 'program') as Table;
		guest.visitTableEntries(program, (key, item) => properties.entry('program', key, item, PROGRAM_PRESENTATION));
	} else {
		properties.field('instance', 'id', 'ID', guest.readStringMember(value, 'id'));
		properties.field('instance', 'enabled', 'Enabled', guest.readStringMember(value, 'enabled'));
		guest.visitTableEntries(value, (key, item) => {
			const name = valueTag(key) === ValueTag.String ? guest.stringText(key as StringValue) : '';
			if (name === 'id' || name === 'enabled') return;
			properties.entry('member', key, item, name.startsWith('_') ? INTERNAL_MEMBER : name === 'owner' ? ACTOR_REFERENCE : undefined);
		});
		properties.group('storage', 'self', 'Stored fields', value);
	}
	return properties.finish();
}

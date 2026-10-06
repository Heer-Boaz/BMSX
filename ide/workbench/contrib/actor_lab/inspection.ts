import type { Table } from '../../../../machine/ts/machine/cpu/table';
import type { RuntimeSourceState } from '../../../runtime/sources';
import type { SuspendedGuestSession } from '../../../runtime/suspended_guest';
import { inspectActionEffectInstance } from '../behavior_lens/action_effect_runtime';
import { inspectBehaviorTreeInstance } from '../behavior_lens/behavior_tree_runtime';
import type { BehaviorInspectionProperty } from '../behavior_lens/inspection';
import { BehaviorRuntimeProperties } from '../behavior_lens/runtime_properties';
import { inspectStateMachineState } from '../behavior_lens/state_machine_runtime';
import type { ActorNode } from './runtime';

const ACTOR_FIELDS = ['id', 'definition_id', 'active', 'x', 'y', 'z', 'tags', 'data', 'events'] as const;
const TIMELINE_FIELDS = ['position_ms', 'head', 'playing', 'on_finished', 'bindings', 'program'] as const;

export function inspectActorNode(
	sources: RuntimeSourceState, guest: SuspendedGuestSession, node: ActorNode,
	properties = new BehaviorRuntimeProperties(sources, guest),
): BehaviorInspectionProperty[] {
	const value = node.value!;
	switch (node.kind) {
		case 'state': case 'machine': return inspectStateMachineState(sources, guest, { component: node.component!, machine: node.receiver! }, value, properties);
		case 'tree': return inspectBehaviorTreeInstance(sources, guest, node.component!, properties);
		case 'effect': return inspectActionEffectInstance(sources, guest, { component: node.component!, key: node.key, effect: value }, properties);
	}
	if (node.kind === 'actor' || node.kind === 'timeline') {
		for (const key of node.kind === 'actor' ? ACTOR_FIELDS : TIMELINE_FIELDS) {
			properties.value(key, guest.readStringMember(value, key));
		}
		if (node.kind === 'timeline') {
			const program = guest.readStringMember(value, 'program') as Table;
			guest.visitTableEntries(program, (key, item) => properties.value(`PROGRAM / ${guest.formatValue(key)}`, item));
		}
	} else {
		guest.visitTableEntries(value, (key, item) => properties.value(guest.formatValue(key), item));
	}
	return properties.finish();
}

import type { Table } from '../../../../machine/ts/machine/cpu/table';
import type { RuntimeSourceState } from '../../../runtime/sources';
import type { SuspendedGuestSession } from '../../../runtime/suspended_guest';
import { inspectActionEffectInstance } from '../behavior_lens/action_effect_runtime';
import { inspectBehaviorTreeInstance } from '../behavior_lens/behavior_tree_runtime';
import type { BehaviorInspectionProperty } from '../behavior_lens/inspection';
import { inspectBehaviorRuntimeValue } from '../behavior_lens/runtime_properties';
import { inspectStateMachineState } from '../behavior_lens/state_machine_runtime';
import type { ActorNode } from './runtime';

const ACTOR_FIELDS = ['id', 'definition_id', 'active', 'x', 'y', 'z', 'tags', 'data', 'events'] as const;
const TIMELINE_FIELDS = ['position_ms', 'head', 'playing', 'on_finished', 'bindings', 'program'] as const;

export function inspectActorNode(sources: RuntimeSourceState, guest: SuspendedGuestSession, node: ActorNode): BehaviorInspectionProperty[] {
	const value = node.value!;
	const choice = { label: node.label, description: '', detail: '', component: node.component! };
	switch (node.kind) {
		case 'state': case 'machine': return inspectStateMachineState(sources, guest, { ...choice, machine: node.receiver! }, { ...choice, state: value });
		case 'tree': return inspectBehaviorTreeInstance(sources, guest, choice);
		case 'effect': return inspectActionEffectInstance(sources, guest, { ...choice, effect: value });
	}
	const items: BehaviorInspectionProperty[] = [];
	if (node.kind === 'actor' || node.kind === 'timeline') {
		for (const key of node.kind === 'actor' ? ACTOR_FIELDS : TIMELINE_FIELDS) {
			items.push(inspectBehaviorRuntimeValue(sources, guest, key, guest.readStringMember(value, key), ''));
		}
		if (node.kind === 'timeline') {
			const program = guest.readStringMember(value, 'program') as Table;
			guest.visitTableEntries(program, (key, item) => items.push(inspectBehaviorRuntimeValue(sources, guest, `PROGRAM / ${guest.formatValue(key)}`, item, '')));
		}
	} else {
		guest.visitTableEntries(value, (key, item) => items.push(inspectBehaviorRuntimeValue(sources, guest, guest.formatValue(key), item, '')));
	}
	return items;
}

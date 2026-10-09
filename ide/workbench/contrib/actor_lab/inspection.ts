import type { Table } from '../../../../machine/ts/machine/cpu/table';
import type { RuntimeInstalledSourceState } from '../../../runtime/sources';
import type { SuspendedGuestSession } from '../../../runtime/suspended_guest';
import { inspectActionEffectInstance } from '../behavior_lens/action_effect_runtime';
import { inspectBehaviorTreeInstance } from '../behavior_lens/behavior_tree_runtime';
import { BehaviorRuntimeProperties, type RuntimeInspectionProperty } from '../behavior_lens/runtime_properties';
import { inspectStateMachineState } from '../behavior_lens/state_machine_runtime';
import type { ActorNode } from './runtime';

const PROGRAM_PRESENTATION = { prefix: 'PROGRAM / ' };
const ACTOR_FIELDS = ['id', 'definition_id', 'active', 'x', 'y', 'z', 'tags', 'data', 'events'] as const;
const TIMELINE_FIELDS = ['position_ms', 'head', 'playing', 'on_finished', 'bindings', 'program'] as const;

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
	if (node.kind === 'actor' || node.kind === 'timeline') {
		for (const key of node.kind === 'actor' ? ACTOR_FIELDS : TIMELINE_FIELDS) {
			properties.field('instance', key, key, guest.readStringMember(value, key));
		}
		if (node.kind === 'timeline') {
			const program = guest.readStringMember(value, 'program') as Table;
			guest.visitTableEntries(program, (key, item) => properties.entry('program', key, item, PROGRAM_PRESENTATION));
		}
	} else {
		guest.visitTableEntries(value, (key, item) => properties.entry('member', key, item));
	}
	return properties.finish();
}

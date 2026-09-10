import type { BehaviorSourceDocument, BehaviorSourceRowKey } from './model';
import type { StateMachineSourceBody } from './state_machine_model';
import type { StateMachineSourceReference } from './state_machine_selection';
import { indexStateMachineInitialTargets, type StateMachineInitialTarget } from './state_machine_initial';

export type StateMachineSourceIndex = {
	readonly bodies: ReadonlyMap<BehaviorSourceRowKey, StateMachineSourceBody | null>;
	readonly references: ReadonlyMap<BehaviorSourceRowKey, readonly StateMachineSourceReference[]>;
	readonly initialTargets: ReadonlyMap<BehaviorSourceRowKey, StateMachineInitialTarget>;
};

/** Cold, typed source index for graph projection, inspectors and command enablement. */
export function indexStateMachineSource(document: BehaviorSourceDocument): StateMachineSourceIndex {
	const bodies = new Map<BehaviorSourceRowKey, StateMachineSourceBody | null>();
	const references = new Map<BehaviorSourceRowKey, StateMachineSourceReference[]>();
	const initialTargets = new Map<BehaviorSourceRowKey, StateMachineInitialTarget>();
	function addBody(key: BehaviorSourceRowKey, body: StateMachineSourceBody | null): void {
		bodies.set(key, body);
		if (body === null || body.states === null || body.states.kind === 'dynamic') return;
		indexStateMachineInitialTargets(body, initialTargets);
		for (const entry of body.states.entries) if (entry.node.kind === 'state') addBody(entry.node.rowKey, entry.node.body);
	}
	for (const definition of document.definitions) {
		if (definition.behaviorKind !== 'state_machine') continue;
		addBody(definition.rowKey, definition.body);
		for (const entry of definition.entries) {
			if (entry.field === null) continue; // Implicit runtime entry has no authored field to select.
			let items = references.get(entry.owner);
			if (items === undefined) { items = []; references.set(entry.owner, items); }
			items.push({ kind: 'state-entry', rowKey: entry.owner, entry, field: entry.field });
		}
		for (const transition of definition.transitions) {
			const rowKey = transition.slot.source.rowKey;
			references.set(rowKey, transition.outcomes.map(outcome => ({ kind: 'state-outcome', rowKey, transition, outcome })));
		}
	}
	return { bodies, references, initialTargets };
}

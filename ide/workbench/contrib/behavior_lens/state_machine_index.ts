import type { BehaviorSourceDocument, BehaviorSourceRowKey } from './model';
import type { StateMachineScope, StateMachineSourceBody, StateMachineSourceOutcome } from './state_machine_model';
import type { StateMachineSourceReference } from './state_machine_selection';
import { indexStateMachineInitialTargets, type StateMachineInitialTarget } from './state_machine_initial';
import { stateMachineRetargetLiteral } from './state_machine_retarget';

export type StateMachineSourceIndex = {
	readonly bodies: ReadonlyMap<BehaviorSourceRowKey, StateMachineSourceBody | null>;
	readonly references: ReadonlyMap<BehaviorSourceRowKey, readonly StateMachineSourceReference[]>;
	readonly initialTargets: ReadonlyMap<BehaviorSourceRowKey, StateMachineInitialTarget>;
	readonly scopes: ReadonlyMap<BehaviorSourceRowKey, StateMachineScope>;
	readonly retargetable: ReadonlySet<StateMachineSourceOutcome>;
};

const indices = new WeakMap<BehaviorSourceDocument, StateMachineSourceIndex>();

/** Shared immutable generation index, not one rebuild for each definition view. */
export function indexStateMachineSource(document: BehaviorSourceDocument): StateMachineSourceIndex {
	const existing = indices.get(document);
	if (existing !== undefined) return existing;
	const bodies = new Map<BehaviorSourceRowKey, StateMachineSourceBody | null>();
	const references = new Map<BehaviorSourceRowKey, StateMachineSourceReference[]>();
	const initialTargets = new Map<BehaviorSourceRowKey, StateMachineInitialTarget>();
	const scopes = new Map<BehaviorSourceRowKey, StateMachineScope>();
	const retargetable = new Set<StateMachineSourceOutcome>();
	function addBody(key: BehaviorSourceRowKey, body: StateMachineSourceBody | null): void {
		bodies.set(key, body);
		if (body === null || body.states === null || body.states.kind === 'dynamic') return;
		indexStateMachineInitialTargets(body, initialTargets);
		for (const entry of body.states.entries) if (entry.node.kind === 'state') addBody(entry.node.rowKey, entry.node.body);
	}
	for (const definition of document.definitions) {
		if (definition.behaviorKind !== 'state_machine') continue;
		addBody(definition.rowKey, definition.body);
		for (const scope of definition.scopes) scopes.set(scope.rowKey, scope);
		for (const entry of definition.entries) {
			if (entry.field === null) continue; // Implicit runtime entry has no authored field to select.
			let items = references.get(entry.owner);
			if (items === undefined) { items = []; references.set(entry.owner, items); }
			items.push({ kind: 'state-entry', rowKey: entry.owner, entry, field: entry.field });
		}
		for (const transition of definition.transitions) {
			const rowKey = transition.slot.source.rowKey;
			references.set(rowKey, transition.outcomes.map(outcome => ({ kind: 'state-outcome', rowKey, transition, outcome })));
			if (document.syntaxComplete) for (const outcome of transition.outcomes) {
				const literal = stateMachineRetargetLiteral(outcome);
				if (literal !== undefined && literal.range.path === document.resource.path) retargetable.add(outcome);
			}
		}
	}
	const index = { bodies, references, initialTargets, scopes, retargetable };
	indices.set(document, index);
	return index;
}

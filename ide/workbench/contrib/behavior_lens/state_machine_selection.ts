import type { LuaExpression, LuaSourceRange, LuaTableField } from '../../../../toolchain/ts/lua/syntax/ast';
import type { ResourceIdentity } from '../../../common/resource';
import type { EditorTextChange } from '../../../editor/text/text_change';
import { mapTrackedTextLocation, trackedTextLocationsEqual, type TrackedTextLocation } from '../../../editor/text/text_location';
import { luaSourceStartMatchesTextLocation, luaSourceStartToTextLocation, luaSourceRangeMatchesTextLocation, luaSourceRangeToTextLocation, type LuaSourceModels } from '../../../language/lua/source_location';
import type { BehaviorSourceRowKey } from './model';
import type { StateMachineSourceEntry, StateMachineSourceOutcome, StateMachineSourceTransition } from './state_machine_model';

/** A source-generation reference, never an edge ordinal or an endpoint pair. */
export type StateMachineSourceReference = {
	readonly kind: 'state-outcome';
	readonly rowKey: BehaviorSourceRowKey;
	readonly transition: StateMachineSourceTransition;
	readonly outcome: StateMachineSourceOutcome;
} | {
	readonly kind: 'state-entry';
	readonly rowKey: BehaviorSourceRowKey;
	readonly entry: StateMachineSourceEntry;
	readonly field: LuaTableField;
};

type TrackedTransitionProof = {
	readonly slotKind: StateMachineSourceTransition['slot']['kind'];
	readonly bindingKind: LuaExpression['kind'];
	readonly binding: TrackedTextLocation;
} & ({ readonly kind: 'direct' } | {
	readonly kind: 'return';
	readonly callback: TrackedTextLocation;
	/** Return syntax identity, independent of edits to the expression's trailing boundary. */
	readonly statementStart: TrackedTextLocation;
});

/** Input-independent syntax identity; history must not retain a source-generation AST. */
export type StateMachineSourceBookmark = {
	readonly kind: 'state-outcome';
	readonly tracked: TrackedTransitionProof;
} | {
	readonly kind: 'state-entry';
	readonly tracked: TrackedTextLocation & { readonly entryKind: StateMachineSourceEntry['kind'] };
};

export type StateMachineSourceSelection = StateMachineSourceReference & StateMachineSourceBookmark;

/** Only the selected evidence is tracked, not every possible edge in the document. */
export function selectStateMachineSource(reference: StateMachineSourceReference, models: LuaSourceModels): StateMachineSourceSelection {
	if (reference.kind === 'state-entry') return { ...reference,
		tracked: { ...luaSourceStartToTextLocation(models, reference.field.range), entryKind: reference.entry.kind } };
	const proof = reference.outcome.proof;
	const slotKind = reference.transition.slot.kind;
	const tracked: TrackedTransitionProof = proof.kind === 'direct'
		? { kind: 'direct', slotKind, bindingKind: proof.expression.kind, binding: luaSourceRangeToTextLocation(models, proof.expression.range) }
		: { kind: 'return', slotKind, bindingKind: proof.binding.kind, binding: luaSourceRangeToTextLocation(models, proof.binding.range),
			callback: luaSourceRangeToTextLocation(models, proof.callback.range), statementStart: luaSourceStartToTextLocation(models, proof.statement.range) };
	return { ...reference, tracked };
}

export function stateMachineSourceRange(reference: StateMachineSourceReference): LuaSourceRange {
	if (reference.kind === 'state-entry') return reference.field.range;
	const proof = reference.outcome.proof;
	return proof.kind === 'direct' ? proof.expression.range : proof.statement.range;
}

/** Copy coordinates only, never the live reference's transition, outcome or entry. */
export function copyStateMachineSourceBookmark(selection: StateMachineSourceBookmark): StateMachineSourceBookmark {
	if (selection.kind === 'state-entry') return { kind: selection.kind, tracked: { ...selection.tracked } };
	const tracked = selection.tracked;
	return { kind: selection.kind, tracked: tracked.kind === 'direct'
		? { ...tracked, binding: { ...tracked.binding } }
		: { ...tracked, binding: { ...tracked.binding }, callback: { ...tracked.callback }, statementStart: { ...tracked.statementStart } } };
}

export function mapStateMachineSourceSelection(selection: StateMachineSourceBookmark, resource: ResourceIdentity, changes: readonly EditorTextChange[]): void {
	if (selection.kind === 'state-entry') mapTrackedTextLocation(selection.tracked, resource, changes);
	else {
		const tracked = selection.tracked;
		mapTrackedTextLocation(tracked.binding, resource, changes);
		if (tracked.kind === 'return') {
			mapTrackedTextLocation(tracked.callback, resource, changes);
			mapTrackedTextLocation(tracked.statementStart, resource, changes);
		}
	}
}

/** Compare the evidence itself; two returns to the same state are distinct locations. */
export function stateMachineSourceBookmarksEqual(a: StateMachineSourceBookmark, b: StateMachineSourceBookmark): boolean {
	if (a.kind === 'state-entry') return b.kind === 'state-entry' && a.tracked.entryKind === b.tracked.entryKind
		&& trackedTextLocationsEqual(a.tracked, b.tracked);
	if (b.kind !== 'state-outcome') return false;
	const left = a.tracked;
	const right = b.tracked;
	if (left.slotKind !== right.slotKind || left.bindingKind !== right.bindingKind
		|| !trackedTextLocationsEqual(left.binding, right.binding)) return false;
	return left.kind === 'direct' ? right.kind === 'direct' : right.kind === 'return'
		&& trackedTextLocationsEqual(left.callback, right.callback)
		&& trackedTextLocationsEqual(left.statementStart, right.statementStart);
}

/** The caller has already proved the containing registration/slot occurrence. */
export function reconcileStateMachineSourceSelection(
	selection: StateMachineSourceBookmark, references: readonly StateMachineSourceReference[] | undefined, models: LuaSourceModels,
): StateMachineSourceSelection | null {
	if (references === undefined) return null; // The corresponding source node can lose its entry/transition evidence.
	if (selection.kind === 'state-entry') {
		for (const reference of references) {
			if (reference.kind === 'state-entry' && reference.entry.kind === selection.tracked.entryKind
				&& luaSourceStartMatchesTextLocation(models, reference.field.range, selection.tracked)) {
				return { ...reference, tracked: selection.tracked };
			}
		}
		return null;
	}
	const tracked = selection.tracked;
	for (const reference of references) {
		if (reference.kind !== 'state-outcome' || reference.transition.slot.kind !== tracked.slotKind) continue;
		const proof = reference.outcome.proof;
		const binding = proof.kind === 'direct' ? proof.expression : proof.binding;
		if (binding.kind !== tracked.bindingKind || !luaSourceRangeMatchesTextLocation(models, binding.range, tracked.binding)) continue;
		if (proof.kind === 'return') {
			if (tracked.kind !== 'return' || !luaSourceRangeMatchesTextLocation(models, proof.callback.range, tracked.callback)
				|| !luaSourceStartMatchesTextLocation(models, proof.statement.range, tracked.statementStart)) continue;
		} else if (tracked.kind !== 'direct') continue;
		return { ...reference, tracked };
	}
	return null;
}

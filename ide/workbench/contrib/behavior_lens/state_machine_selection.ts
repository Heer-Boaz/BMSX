import type { LuaExpression, LuaSourceRange, LuaTableField } from '../../../../toolchain/ts/lua/syntax/ast';
import type { TextBuffer } from '../../../editor/text/text_buffer';
import { mapTrackedTextRange, type EditorTextChange, type TrackedTextRange } from '../../../editor/text/text_change';
import { luaSourcePositionMatchesTextRange, luaSourcePositionToTextRange, luaSourceRangeMatchesTextRange, luaSourceRangeToTextRange } from '../../../language/lua/source_edits';
import type { BehaviorSourceRowKey } from './model';
import type { StateMachineSourceDefinition, StateMachineSourceEntry, StateMachineSourceOutcome, StateMachineSourceTransition } from './state_machine_model';

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
	readonly bindingKind: LuaExpression['kind'];
	readonly binding: TrackedTextRange;
} & ({ readonly kind: 'direct' } | {
	readonly kind: 'return';
	readonly callback: TrackedTextRange;
	/** Return syntax identity, independent of edits to the expression's trailing boundary. */
	readonly statementStart: TrackedTextRange;
});

export type StateMachineSourceSelection = (Extract<StateMachineSourceReference, { kind: 'state-outcome' }> & {
	readonly tracked: TrackedTransitionProof;
}) | (Extract<StateMachineSourceReference, { kind: 'state-entry' }> & {
	readonly tracked: TrackedTextRange;
});

/** Only the selected evidence is tracked, not every possible edge in the document. */
export function selectStateMachineSource(reference: StateMachineSourceReference, buffer: TextBuffer): StateMachineSourceSelection {
	if (reference.kind === 'state-entry') return { ...reference, tracked: luaSourcePositionToTextRange(buffer, reference.field.range.start) };
	const proof = reference.outcome.proof;
	const tracked: TrackedTransitionProof = proof.kind === 'direct'
		? { kind: 'direct', bindingKind: proof.expression.kind, binding: luaSourceRangeToTextRange(buffer, proof.expression.range) }
		: { kind: 'return', bindingKind: proof.binding.kind, binding: luaSourceRangeToTextRange(buffer, proof.binding.range),
			callback: luaSourceRangeToTextRange(buffer, proof.callback.range), statementStart: luaSourcePositionToTextRange(buffer, proof.statement.range.start) };
	return { ...reference, tracked };
}

export function stateMachineSourceRange(reference: StateMachineSourceReference): LuaSourceRange {
	if (reference.kind === 'state-entry') return reference.field.range;
	const proof = reference.outcome.proof;
	return proof.kind === 'direct' ? proof.expression.range : proof.statement.range;
}

export function mapStateMachineSourceSelection(selection: StateMachineSourceSelection, changes: readonly EditorTextChange[]): void {
	if (selection.kind === 'state-entry') mapTrackedTextRange(selection.tracked, changes);
	else {
		const tracked = selection.tracked;
		mapTrackedTextRange(tracked.binding, changes);
		if (tracked.kind === 'return') {
			mapTrackedTextRange(tracked.callback, changes);
			mapTrackedTextRange(tracked.statementStart, changes);
		}
	}
}

/** The caller has already proved the containing registration/slot occurrence. */
export function reconcileStateMachineSourceSelection(
	selection: StateMachineSourceSelection, definition: StateMachineSourceDefinition, rowKey: BehaviorSourceRowKey, buffer: TextBuffer,
): StateMachineSourceSelection | null {
	if (selection.kind === 'state-entry') {
		for (const entry of definition.entries) {
			if (entry.owner === rowKey && entry.kind === selection.entry.kind && entry.field !== null
				&& luaSourcePositionMatchesTextRange(buffer, entry.field.range.start, selection.tracked)) {
				return { kind: 'state-entry', rowKey, entry, field: entry.field, tracked: selection.tracked };
			}
		}
		return null;
	}
	const tracked = selection.tracked;
	const transition = definition.transitions.find(candidate => candidate.slot.source.rowKey === rowKey
		&& candidate.slot.kind === selection.transition.slot.kind);
	if (transition === undefined) return null; // The authored consumer can change or disappear.
	for (const outcome of transition.outcomes) {
		const proof = outcome.proof;
		const binding = proof.kind === 'direct' ? proof.expression : proof.binding;
		if (binding.kind !== tracked.bindingKind || !luaSourceRangeMatchesTextRange(buffer, binding.range, tracked.binding)) continue;
		if (proof.kind === 'return') {
			if (tracked.kind !== 'return' || !luaSourceRangeMatchesTextRange(buffer, proof.callback.range, tracked.callback)
				|| !luaSourcePositionMatchesTextRange(buffer, proof.statement.range.start, tracked.statementStart)) continue;
		} else if (tracked.kind !== 'direct') continue;
		return { kind: 'state-outcome', rowKey, transition, outcome, tracked };
	}
	return null;
}

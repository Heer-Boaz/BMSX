import type { LuaExpression, LuaSourceRange, LuaTableField } from '../../../../toolchain/ts/lua/syntax/ast';
import type { TextBuffer } from '../../../editor/text/text_buffer';
import { mapTrackedTextRange, type EditorTextChange, type TrackedTextRange } from '../../../editor/text/text_change';
import { luaSourcePositionMatchesTextRange, luaSourcePositionToTextRange, luaSourceRangeMatchesTextRange, luaSourceRangeToTextRange } from '../../../language/lua/source_edits';
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
	readonly binding: TrackedTextRange;
} & ({ readonly kind: 'direct' } | {
	readonly kind: 'return';
	readonly callback: TrackedTextRange;
	/** Return syntax identity, independent of edits to the expression's trailing boundary. */
	readonly statementStart: TrackedTextRange;
});

/** Input-independent syntax identity; history must not retain a source-generation AST. */
export type StateMachineSourceBookmark = {
	readonly kind: 'state-outcome';
	readonly tracked: TrackedTransitionProof;
} | {
	readonly kind: 'state-entry';
	readonly tracked: TrackedTextRange & { readonly entryKind: StateMachineSourceEntry['kind'] };
};

export type StateMachineSourceSelection = StateMachineSourceReference & StateMachineSourceBookmark;

/** Only the selected evidence is tracked, not every possible edge in the document. */
export function selectStateMachineSource(reference: StateMachineSourceReference, buffer: TextBuffer): StateMachineSourceSelection {
	if (reference.kind === 'state-entry') return { ...reference,
		tracked: { ...luaSourcePositionToTextRange(buffer, reference.field.range.start), entryKind: reference.entry.kind } };
	const proof = reference.outcome.proof;
	const slotKind = reference.transition.slot.kind;
	const tracked: TrackedTransitionProof = proof.kind === 'direct'
		? { kind: 'direct', slotKind, bindingKind: proof.expression.kind, binding: luaSourceRangeToTextRange(buffer, proof.expression.range) }
		: { kind: 'return', slotKind, bindingKind: proof.binding.kind, binding: luaSourceRangeToTextRange(buffer, proof.binding.range),
			callback: luaSourceRangeToTextRange(buffer, proof.callback.range), statementStart: luaSourcePositionToTextRange(buffer, proof.statement.range.start) };
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

export function mapStateMachineSourceSelection(selection: StateMachineSourceBookmark, changes: readonly EditorTextChange[]): void {
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

/** Compare the evidence itself; two returns to the same state are distinct locations. */
export function stateMachineSourceBookmarksEqual(a: StateMachineSourceBookmark, b: StateMachineSourceBookmark): boolean {
	if (a.kind === 'state-entry') return b.kind === 'state-entry' && a.tracked.entryKind === b.tracked.entryKind
		&& a.tracked.start === b.tracked.start && a.tracked.end === b.tracked.end;
	if (b.kind !== 'state-outcome') return false;
	const left = a.tracked;
	const right = b.tracked;
	if (left.slotKind !== right.slotKind || left.bindingKind !== right.bindingKind
		|| left.binding.start !== right.binding.start || left.binding.end !== right.binding.end) return false;
	return left.kind === 'direct' ? right.kind === 'direct' : right.kind === 'return'
		&& left.callback.start === right.callback.start && left.callback.end === right.callback.end
		&& left.statementStart.start === right.statementStart.start && left.statementStart.end === right.statementStart.end;
}

/** The caller has already proved the containing registration/slot occurrence. */
export function reconcileStateMachineSourceSelection(
	selection: StateMachineSourceBookmark, references: readonly StateMachineSourceReference[] | undefined, buffer: TextBuffer,
): StateMachineSourceSelection | null {
	if (references === undefined) return null; // The corresponding source node can lose its entry/transition evidence.
	if (selection.kind === 'state-entry') {
		for (const reference of references) {
			if (reference.kind === 'state-entry' && reference.entry.kind === selection.tracked.entryKind
				&& luaSourcePositionMatchesTextRange(buffer, reference.field.range.start, selection.tracked)) {
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
		if (binding.kind !== tracked.bindingKind || !luaSourceRangeMatchesTextRange(buffer, binding.range, tracked.binding)) continue;
		if (proof.kind === 'return') {
			if (tracked.kind !== 'return' || !luaSourceRangeMatchesTextRange(buffer, proof.callback.range, tracked.callback)
				|| !luaSourcePositionMatchesTextRange(buffer, proof.statement.range.start, tracked.statementStart)) continue;
		} else if (tracked.kind !== 'direct') continue;
		return { ...reference, tracked };
	}
	return null;
}

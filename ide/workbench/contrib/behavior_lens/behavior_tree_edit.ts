import type { BehaviorTreeSourceMember } from './behavior_tree_model';
import type { BehaviorLensViewState } from './view_model';
import type { EditorTextModel } from '../../../editor/model/text_model';
import { getTextSnapshot } from '../../../editor/text/source_text';
import { createLuaTableFieldRemovalEdits, readLuaSourceRange } from '../../../language/lua/source_edits';
import { createLuaTableFieldInsertionEdits } from '../../../language/lua/table_field_insertion';
import { createLuaTableFieldMoveEdits } from '../../../language/lua/table_field_moves';
import { createLuaTableFieldTransfer } from '../../../language/lua/table_field_transfer';
import type { BehaviorTreeTransferCheck } from './behavior_tree_transfer';
import { behaviorSourceEditState, captureBehaviorSourceBookmark, mapBehaviorSourceBookmark } from './source_bookmark';
import { getCachedLuaParse } from '../../../../toolchain/ts/lua/analysis/cache';

/** Constant-time command admission from the current projection's source evidence. */
export function behaviorTreeEditTarget(view: BehaviorLensViewState): BehaviorTreeSourceMember | null {
	if (!view.document.syntaxComplete || view.presentation.kind !== 'graph') return null;
	const selection = view.presentation.viewport.selection;
	if (selection === null) return null;
	const member = (selection.kind === 'node' ? selection : selection.child).member;
	// The current editor input owns one write resource; a foreign source use is inspectable, not a workspace edit.
	return member !== null && member.table.range.path === view.resource.path ? member : null;
}

export function behaviorTreeMoveTarget(view: BehaviorLensViewState, direction: -1 | 1): BehaviorTreeSourceMember | undefined {
	const member = behaviorTreeEditTarget(view);
	if (member !== null && member.index + direction >= 0 && member.index + direction < member.branch.entries.length) return member;
	return undefined;
}

/** Remove the authored list entry, not its referenced initializer or a guessed runtime node. */
export function removeBehaviorTreeChild(model: EditorTextModel, member: BehaviorTreeSourceMember): void {
	const parsed = getCachedLuaParse({ path: model.resource.path, source: getTextSnapshot(model.buffer) }).parsed;
	model.pushEditOperations(createLuaTableFieldRemovalEdits(model.buffer, parsed.tokens, member.branch.entries[member.index].field));
}

/** Insert before the retained field: its tracked selection becomes the second occurrence. */
export function duplicateBehaviorTreeChild(model: EditorTextModel, member: BehaviorTreeSourceMember): void {
	const field = member.branch.entries[member.index].field;
	model.pushEditOperations(createLuaTableFieldInsertionEdits(model.buffer, model.resource.path, member.table,
		member.table.fields.indexOf(field), readLuaSourceRange(model.buffer, field.range)));
}

/** Array ranks are not lexical field indices: named metadata stays ordinary Lua. */
export function moveBehaviorTreeChild(model: EditorTextModel, member: BehaviorTreeSourceMember, destination: number): void {
	const fields = member.table.fields;
	model.pushEditOperations(createLuaTableFieldMoveEdits(model.buffer, model.resource.path, member.table,
		fields.indexOf(member.branch.entries[member.index].field), fields.indexOf(member.branch.entries[destination].field)));
}

/** One admitted write resource and one history element, with the destination occurrence selected. */
export function transferBehaviorTreeChild(model: EditorTextModel, view: BehaviorLensViewState,
	member: BehaviorTreeSourceMember, check: Extract<BehaviorTreeTransferCheck, { kind: 'available' }>, insertion: number): void {
	const field = member.branch.entries[member.index].field;
	const { target, table } = check;
	const destination = insertion === target.entries.length ? table.fields.length : table.fields.indexOf(target.entries[insertion].field);
	const transfer = createLuaTableFieldTransfer(model.buffer, model.resource.path, field, table, destination);
	const before = captureBehaviorSourceBookmark(view, view.selection!);
	const after = captureBehaviorSourceBookmark(view, { kind: before.kind === 'tree-edge' ? 'tree-edge' : 'node', rowKey: target.source.rowKey });
	const fieldStart = model.buffer.offsetAt(field.range.start.line - 1, field.range.start.column - 1);
	let prefixLength = before.path.length;
	for (let key = view.selection!.rowKey; key !== member.branch.source.rowKey; key = view.source.parentByRowKey.get(key)!) prefixLength -= 1;
	const suffix = before.path.slice(prefixLength);
	model.pushEditOperations(transfer.edits, behaviorSourceEditState.of(before), changes => {
		mapBehaviorSourceBookmark(after, model.resource, changes);
		return behaviorSourceEditState.of({ ...after, path: [...after.path, ...suffix.map(step => ({ ...step,
			start: transfer.fieldRange.start + step.start - fieldStart, end: transfer.fieldRange.start + step.end - fieldStart }))] });
	});
}

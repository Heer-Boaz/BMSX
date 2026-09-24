import type { TextBuffer } from '../../../editor/text/text_buffer';
import type { BehaviorTreeSourceMember } from './behavior_tree_model';
import type { BehaviorLensViewState } from './view_model';
import type { EditorTextEdit, EditorTextModel } from '../../../editor/model/text_model';
import { createLuaTableFieldRemovalEdits, readLuaSourceRange } from '../../../language/lua/source_edits';
import { createLuaTableFieldInsertionEdits } from '../../../language/lua/table_field_insertion';
import { createLuaTableFieldMoveEdits } from '../../../language/lua/table_field_moves';
import { createLuaTableFieldTransfer } from '../../../language/lua/table_field_transfer';
import type { BehaviorTreeTransferCheck } from './behavior_tree_transfer';
import { behaviorSourceEditState, captureBehaviorSourceBookmark, mapBehaviorSourceBookmark } from './source_bookmark';

/** Constant-time command admission from the current projection's source evidence. */
export function behaviorTreeEditTarget(view: BehaviorLensViewState): BehaviorTreeSourceMember | null {
	if (!view.document.syntaxComplete || view.presentation.kind !== 'graph') return null;
	const selection = view.presentation.viewport.selection;
	if (selection === null) return null;
	const member = (selection.kind === 'node' ? selection : selection.child).member;
	return member;
}

export function behaviorTreeMoveTarget(view: BehaviorLensViewState, direction: -1 | 1): BehaviorTreeSourceMember | undefined {
	const member = behaviorTreeEditTarget(view);
	if (member !== null && member.index + direction >= 0 && member.index + direction < member.branch.entries.length) return member;
	return undefined;
}

/** Remove the authored list entry, not its referenced initializer or a guessed runtime node. */
export function createBehaviorTreeChildRemovalEdits(buffer: TextBuffer, member: BehaviorTreeSourceMember): readonly EditorTextEdit[] {
	return createLuaTableFieldRemovalEdits(buffer, member.file.chunk.locations, member.file.chunk.tokens, member.branch.entries[member.index].field);
}

/** Insert before the retained field: its tracked selection becomes the second occurrence. */
export function createBehaviorTreeChildDuplicateEdits(buffer: TextBuffer, member: BehaviorTreeSourceMember): readonly EditorTextEdit[] {
	const field = member.branch.entries[member.index].field;
	return createLuaTableFieldInsertionEdits(buffer, member.file.chunk, member.table,
		member.table.fields.indexOf(field), readLuaSourceRange(buffer, member.file.chunk.locations.range(field.span)));
}

/** Array ranks are not lexical field indices: named metadata stays ordinary Lua. */
export function createBehaviorTreeChildMoveEdits(buffer: TextBuffer, member: BehaviorTreeSourceMember, destination: number): readonly EditorTextEdit[] {
	const fields = member.table.fields;
	return createLuaTableFieldMoveEdits(buffer, member.file.chunk, member.table,
		fields.indexOf(member.branch.entries[member.index].field), fields.indexOf(member.branch.entries[destination].field));
}

/** One admitted write resource and one history element, with the destination occurrence selected. */
export function transferBehaviorTreeChild(model: EditorTextModel, view: BehaviorLensViewState,
	member: BehaviorTreeSourceMember, check: Extract<BehaviorTreeTransferCheck, { kind: 'available' }>, insertion: number): void {
	const field = member.branch.entries[member.index].field;
	const { target, table } = check;
	const destination = insertion === target.entries.length ? table.fields.length : table.fields.indexOf(target.entries[insertion].field);
	const transfer = createLuaTableFieldTransfer(model.buffer, member.file.chunk, field, table, destination);
	const before = captureBehaviorSourceBookmark(view, view.selection!);
	const after = captureBehaviorSourceBookmark(view, { kind: before.kind === 'tree-edge' ? 'tree-edge' : 'node', rowKey: target.source.rowKey });
	const fieldStart = model.buffer.offsetAt(member.file.chunk.locations.range(field.span).start.line - 1, member.file.chunk.locations.range(field.span).start.column - 1);
	let prefixLength = before.path.length;
	for (let key = view.selection!.rowKey; key !== member.branch.source.rowKey; key = view.source.parentByRowKey.get(key)!) prefixLength -= 1;
	const suffix = before.path.slice(prefixLength);
	model.pushEditOperations(transfer.edits, behaviorSourceEditState.of(before), changes => {
		mapBehaviorSourceBookmark(after, model.resource, changes);
		return behaviorSourceEditState.of({ ...after, path: [...after.path, ...suffix.map(step => ({ ...step,
			start: transfer.fieldRange.start + step.start - fieldStart, end: transfer.fieldRange.start + step.end - fieldStart }))] });
	});
}

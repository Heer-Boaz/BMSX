import type { BehaviorTreeSourceMember } from './behavior_tree_model';
import type { BehaviorLensViewState } from './view_model';
import type { EditorTextModel } from '../../../editor/model/text_model';
import { getTextSnapshot } from '../../../editor/text/source_text';
import { createLuaTableFieldRemovalEdits, readLuaSourceRange } from '../../../language/lua/source_edits';
import { createLuaTableFieldInsertionEdits } from '../../../language/lua/table_field_insertion';
import { createLuaTableFieldMoveEdits } from '../../../language/lua/table_field_moves';
import { getCachedLuaParse } from '../../../../toolchain/ts/lua/analysis/cache';

/** Constant-time command admission from the current projection's source evidence. */
export function behaviorTreeEditTarget(view: BehaviorLensViewState): BehaviorTreeSourceMember | null {
	if (!view.document.syntaxComplete || view.presentation.kind !== 'graph') return null;
	const selection = view.presentation.viewport.selection;
	if (selection === null) return null;
	return (selection.kind === 'node' ? selection : selection.child).member;
}

export function behaviorTreeMoveTarget(view: BehaviorLensViewState, direction: -1 | 1): BehaviorTreeSourceMember | undefined {
	const member = behaviorTreeEditTarget(view);
	if (member !== null && member.index + direction >= 0 && member.index + direction < member.entries.length) return member;
	return undefined;
}

/** Remove the authored list entry, not its referenced initializer or a guessed runtime node. */
export function removeBehaviorTreeChild(model: EditorTextModel, member: BehaviorTreeSourceMember): void {
	const parsed = getCachedLuaParse({ path: model.resource.path, source: getTextSnapshot(model.buffer) }).parsed;
	model.pushEditOperations(createLuaTableFieldRemovalEdits(model.buffer, parsed.tokens, member.entries[member.index].field));
}

/** Insert before the retained field: its tracked selection becomes the second occurrence. */
export function duplicateBehaviorTreeChild(model: EditorTextModel, member: BehaviorTreeSourceMember): void {
	const field = member.entries[member.index].field;
	model.pushEditOperations(createLuaTableFieldInsertionEdits(model.buffer, model.resource.path, member.table,
		member.table.fields.indexOf(field), readLuaSourceRange(model.buffer, field.range)));
}

/** Array ranks are not lexical field indices: named metadata stays ordinary Lua. */
export function moveBehaviorTreeChild(model: EditorTextModel, member: BehaviorTreeSourceMember, destination: number): void {
	const fields = member.table.fields;
	model.pushEditOperations(createLuaTableFieldMoveEdits(model.buffer, model.resource.path, member.table,
		fields.indexOf(member.entries[member.index].field), fields.indexOf(member.entries[destination].field)));
}

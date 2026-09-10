import type { EditorTextModel } from '../../ide/editor/model/text_model';
import { mapTrackedTextRange } from '../../ide/editor/text/text_change';
import { luaSourceRangeToTextRange } from '../../ide/language/lua/source_edits';
import { createLuaTableFieldTransfer } from '../../ide/language/lua/table_field_transfer';
import { behaviorSourceEditState, captureBehaviorSourceBookmark, mapBehaviorSourceBookmark } from '../../ide/workbench/contrib/behavior_lens/source_bookmark';
import type { BehaviorTreeSourceBranch, BehaviorTreeSourceMember } from '../../ide/workbench/contrib/behavior_lens/behavior_tree_model';
import type { BehaviorLensViewState } from '../../ide/workbench/contrib/behavior_lens/view_model';

export const BT_TRANSFER_SOURCE = `local trees<const> = require('cartlib/behaviour_tree/library')
local leaf<const> = { type = 'wait', duration_ticks = 1 }
local moved<const> = { type = 'sequence', children = { leaf } }
local from<const> = { type = 'sequence', children = { leaf, moved, leaf } }
local to<const> = { type = 'sequence', children = { moved } }
local root<const> = { type = 'sequence', children = { from, to, to } }
trees.register('fixture.first', { root = root })
trees.register('fixture.second', { root = root })
`;

/**
 * Explicit language/history probe, NOT graph-command admission or reconnect UI.
 * The fixture supplies actual source membership and a chosen parent occurrence.
 */
export function transferBehaviorFixtureSelection(
	model: EditorTextModel, view: BehaviorLensViewState, member: BehaviorTreeSourceMember,
	target: Extract<BehaviorTreeSourceBranch, { role: 'children' | 'choices' }>,
): void {
	const selection = view.selection!;
	if (selection.kind !== 'node' && selection.kind !== 'tree-edge' || target.source.kind !== 'section') {
		throw new Error('transfer fixture requires a BT selection and complete target list');
	}
	const entry = member.branch.entries[member.index];
	const before = captureBehaviorSourceBookmark(view, selection);
	const moving = captureBehaviorSourceBookmark(view, { kind: selection.kind, rowKey: entry.node.rowKey });
	const destination = captureBehaviorSourceBookmark(view, { kind: selection.kind, rowKey: target.source.rowKey });
	const suffix = before.path.slice(moving.path.length - 1).map(step => ({ ...step }));
	const original = luaSourceRangeToTextRange(model.buffer, entry.field.range);
	const transfer = createLuaTableFieldTransfer(model.buffer, model.resource.path, entry.field, target.source.table,
		target.source.table.fields.length);
	model.pushEditOperations(transfer.edits, behaviorSourceEditState.of(before), changes => {
		mapBehaviorSourceBookmark(destination, changes);
		for (const step of suffix) {
			if (step.start >= original.start && step.end <= original.end) {
				step.start += transfer.fieldRange.start - original.start;
				step.end += transfer.fieldRange.start - original.start;
			} else mapTrackedTextRange(step, changes); // Referenced initializer source does not travel.
		}
		return behaviorSourceEditState.of({ kind: selection.kind, path: [...destination.path, ...suffix] });
	});
}

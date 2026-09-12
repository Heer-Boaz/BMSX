import assert from 'node:assert/strict';
import { medianMilliseconds } from '../../helpers/performance';
import { EditorTextModel } from '../../../ide/editor/model/text_model';
import { EditorFont } from '../../../ide/editor/ui/view/font';
import { editorViewState } from '../../../ide/editor/ui/view/state';
import { buildLuaFileSemanticData } from '../../../toolchain/ts/lua/semantic/model';
import { buildBehaviorSourceDocument } from '../../../ide/workbench/contrib/behavior_lens/recognizer';
import { createBehaviorLensViewState } from '../../../ide/workbench/contrib/behavior_lens/view_model';
import { prepareBehaviorLensLayout, selectBehaviorLensDefinition } from '../../../ide/workbench/contrib/behavior_lens/layout';
import { behaviorTreeEditTarget, duplicateBehaviorTreeChild, removeBehaviorTreeChild } from '../../../ide/workbench/contrib/behavior_lens/behavior_tree_edit';
import { createLuaTableFieldRemovalEdits, readLuaSourceRange } from '../../../ide/language/lua/source_edits';
import { createLuaTableFieldInsertionEdits } from '../../../ide/language/lua/table_field_insertion';
import { getCachedLuaParse } from '../../../toolchain/ts/lua/analysis/cache';

Object.assign(editorViewState, { font: new EditorFont('tiny'), viewportWidth: 384, viewportHeight: 288, lineHeight: 6, codeAreaTop: 24, codeAreaBottom: 276 });
for (const siblings of [24, 1024]) {
	const source = `local trees<const> = require('cartlib/behaviour_tree/library')\nlocal child<const> = { type = 'wait', duration_ticks = 2 }\ntrees.register('profile', { root = { type = 'sequence', children = {\n${'child, -- independent source occurrence\n'.repeat(siblings)} } } })`;
	const model = new EditorTextModel({ domain: 0, path: 'edit.lua', source: { type: 'lua', resid: 'edit' } }, 'lua', source);
	const document = buildBehaviorSourceDocument(model.resource, buildLuaFileSemanticData(source, model.resource.path));
	const state = createBehaviorLensViewState(document, model, 'graph', assert.fail);
	selectBehaviorLensDefinition(state, document.definitions[0].rowKey);
	prepareBehaviorLensLayout(state);
	assert.ok(state.presentation.kind === 'graph');
	const viewport = state.presentation.viewport;
	const graph = viewport.model;
	viewport.selection = graph.nodes[0].children[0].children[siblings / 2];
	const member = behaviorTreeEditTarget(state)!;
	let admitted = 0;
	const admissionMicroseconds = medianMilliseconds(() => {
		for (let index = 0; index < 1000; index += 1) {
			if (!model.readOnly && state.source.isCurrent && behaviorTreeEditTarget(state) === member) admitted += 1;
		}
	});
	assert.ok(admitted > 0);
	const parsed = getCachedLuaParse({ path: model.resource.path, source }).parsed;
	const field = member.branch.entries[member.index].field;
	let constructed = 0;
	const constructMicroseconds = medianMilliseconds(() => {
		for (let index = 0; index < 1000; index += 1) {
			const edits = createLuaTableFieldRemovalEdits(model.buffer, parsed.tokens, field);
			constructed += edits[0].deleteLength + edits[1].deleteLength;
		}
	});
	assert.ok(constructed > 0);
	const edits = createLuaTableFieldRemovalEdits(model.buffer, parsed.tokens, field);
	const applyUndoMicroseconds = medianMilliseconds(() => {
		for (let index = 0; index < 1000; index += 1) {
			model.pushEditOperations(edits);
			model.undo();
		}
	});
	const removeUndoMicroseconds = medianMilliseconds(() => {
		for (let index = 0; index < 1000; index += 1) {
			removeBehaviorTreeChild(model, member);
			model.undo();
		}
	});
	let copied = 0;
	const duplicateConstructMicroseconds = medianMilliseconds(() => {
		for (let index = 0; index < 100; index += 1) {
			const edits = createLuaTableFieldInsertionEdits(model.buffer, model.resource.path, member.table,
				member.table.fields.indexOf(field), readLuaSourceRange(model.buffer, field.range));
			copied += edits[0].text.length;
		}
	}) * 10;
	assert.ok(copied > 0);
	const duplicateEdits = createLuaTableFieldInsertionEdits(model.buffer, model.resource.path, member.table,
		member.table.fields.indexOf(field), readLuaSourceRange(model.buffer, field.range));
	const duplicateApplyUndoMicroseconds = medianMilliseconds(() => {
		for (let index = 0; index < 1000; index += 1) {
			model.pushEditOperations(duplicateEdits);
			model.undo();
		}
	});
	const duplicateUndoMicroseconds = medianMilliseconds(() => {
		for (let index = 0; index < 100; index += 1) {
			duplicateBehaviorTreeChild(model, member);
			model.undo();
		}
	}) * 10;
	assert.equal(model.buffer.getText(), source);
	assert.equal(model.dirty, false);
	assert.equal(model.canUndo, false);
	assert.equal(state.document, document);
	assert.equal(viewport.model, graph);
	console.log(JSON.stringify({ siblings, sourceUtf16: source.length, admissionMicroseconds, constructMicroseconds,
		applyUndoMicroseconds, removeUndoMicroseconds, editCount: edits.length, deletedUtf16: edits.reduce((sum, edit) => sum + edit.deleteLength, 0),
		boundary: '1000-operation batches; 10 warmups, median of 25; retained syntax. Remove+Undo includes snapshot/cache access after Undo, not semantic refresh, graph rebuilding, save/Hot Resume, rendering or total frames; not allocation profiling' }));
	console.log(JSON.stringify({ siblings, sourceUtf16: source.length, duplicateConstructMicroseconds, duplicateApplyUndoMicroseconds,
		duplicateUndoMicroseconds, editCount: duplicateEdits.length, insertedUtf16: duplicateEdits[0].text.length,
		boundary: '100-operation construction/entrypoint batches, 1000-operation apply+Undo batches; 10 warmups, median of 25. Includes the insertion owner lexer, not semantic refresh, graph rebuilding, save/Hot Resume, rendering or total frames; not allocation profiling' }));
}

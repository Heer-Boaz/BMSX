import assert from 'node:assert/strict';
import { medianMilliseconds } from '../../helpers/performance';
import { EditorTextModel } from '../../../ide/editor/model/text_model';
import { codeEditorEditState, createCodeEditorViewState } from '../../../ide/editor/ui/code_editor_state';
import { CodeEditorInputManager } from '../../../ide/workbench/ui/code_tab/input_manager';
import { EditorFont } from '../../../ide/editor/ui/view/font';
import { editorViewState } from '../../../ide/editor/ui/view/state';
import { captureBehaviorSourceBookmark, resolveBehaviorSourceBookmark } from '../../../ide/workbench/contrib/behavior_lens/source_bookmark';
import { createBehaviorLensViewState } from '../../../ide/workbench/contrib/behavior_lens/view_model';
import { buildBehaviorSourceDocument } from '../../../ide/workbench/contrib/behavior_lens/recognizer';
import { buildLuaFileSemanticData } from '../../../toolchain/ts/lua/semantic/model';

editorViewState.font = new EditorFont('tiny');
for (const children of [32, 1024]) {
	const source = `local trees<const> = require('cartlib/behaviour_tree/library')
local leaf<const> = { type = 'wait', duration_ticks = 1 }
trees.register('profile', { root = { type = 'sequence', children = {${'leaf,'.repeat(children)}} } })`;
	const model = new EditorTextModel({ domain: 0, path: 'profile.lua', source: { type: 'lua', resid: 'profile' } }, 'lua', source);
	const document = buildBehaviorSourceDocument(model.resource, buildLuaFileSemanticData(source, model.resource.path));
	const view = createBehaviorLensViewState(document, model, 'graph');
	const root = document.definitions[0];
	assert.ok(root.behaviorKind === 'behavior_tree' && root.root?.kind === 'node');
	const branch = root.root.branches[0];
	assert.ok(branch.role === 'children');
	const key = branch.entries[children - 1].node.rowKey;
	const selection = { kind: 'node' as const, rowKey: key };
	const bookmark = captureBehaviorSourceBookmark(view, selection);
	let observed = 0;
	const captureMicroseconds = medianMilliseconds(() => {
		for (let i = 0; i < 1000; i += 1) observed += captureBehaviorSourceBookmark(view, selection).path.length;
	});
	const resolveMicroseconds = medianMilliseconds(() => {
		for (let i = 0; i < 1000; i += 1) observed += resolveBehaviorSourceBookmark(bookmark, view)!.length;
	});
	assert.ok(observed > 0);
	console.log(JSON.stringify({ children, path: bookmark.path.length, captureMicroseconds, resolveMicroseconds,
		boundary: '1000 explicit operations per sample, 10 warmups / median of 25; retained projection. No parse, layout, drawing, guest, or heap profiling.' }));
	model.dispose();
}

for (const registeredCodeInput of [false, true]) {
	const model = new EditorTextModel({ domain: 0, path: 'typing.lua', source: { type: 'lua', resid: 'typing' } }, 'lua', 'abc');
	const view = createCodeEditorViewState();
	const inputs = new CodeEditorInputManager();
	if (registeredCodeInput) inputs.register({
		id: 'code:0\0typing.lua', title: 'typing.lua', model, view, runtimeErrorOverlay: null, executionStopRow: null,
	});
	const typingAndUndoMicroseconds = medianMilliseconds(() => {
		for (let i = 0; i < 1000; i += 1) {
			model.prepareUndo('typing', false, 0, codeEditorEditState.of({
				cursorRow: 0, cursorColumn: 3, scrollRow: 0, scrollColumn: 0, selectionAnchor: null,
			}));
			model.applyUndoableReplace(3, 0, 'x');
			model.commitEdit(codeEditorEditState.of({
				cursorRow: 0, cursorColumn: 4, scrollRow: 0, scrollColumn: 0, selectionAnchor: null,
			}), null);
			model.undo();
		}
	});
	assert.equal(model.buffer.getText(), 'abc');
	assert.equal(view.cursorColumn, registeredCodeInput ? 3 : 0);
	console.log(JSON.stringify({ registeredCodeInput, typingAndUndoMicroseconds,
		boundary: '1000 cycles per sample; includes code snapshot values/tags, PieceTree, record/events and Undo, optionally retained input event routing. No active widget or GC profiling.' }));
	inputs.clear(); model.dispose();
}

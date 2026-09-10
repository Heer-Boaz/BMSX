import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { EditorTextModel } from '../../ide/editor/model/text_model';
import { EditorFont } from '../../ide/editor/ui/view/font';
import { editorViewState } from '../../ide/editor/ui/view/state';
import { createLuaStringValueEdit, luaSourceRangeToTextRange, readLuaSourceRange } from '../../ide/language/lua/source_edits';
import { installBehaviorLensDocument, selectBehaviorLensDefinition } from '../../ide/workbench/contrib/behavior_lens/layout';
import { selectedBehaviorLensSourceRange } from '../../ide/workbench/contrib/behavior_lens/navigation';
import { buildBehaviorSourceDocument } from '../../ide/workbench/contrib/behavior_lens/recognizer';
import { behaviorSourceEditState, captureBehaviorSourceBookmark, copyBehaviorSourceBookmark, mapBehaviorSourceBookmark } from '../../ide/workbench/contrib/behavior_lens/source_bookmark';
import { mapBehaviorLensSourceRanges } from '../../ide/workbench/contrib/behavior_lens/source_correspondence';
import { retargetStateMachineTransition } from '../../ide/workbench/contrib/behavior_lens/state_machine_edit';
import { StateMachineRetargetAnalysis } from '../../ide/workbench/contrib/behavior_lens/state_machine_retarget';
import { selectStateMachineSource } from '../../ide/workbench/contrib/behavior_lens/state_machine_selection';
import { createBehaviorLensViewState } from '../../ide/workbench/contrib/behavior_lens/view_model';
import { buildLuaFileSemanticData } from '../../toolchain/ts/lua/semantic/model';
import { FSM_RETARGET_SOURCE } from '../helpers/fsm_retarget_fixture';

function fixture(t: TestContext, source = FSM_RETARGET_SOURCE, definitionIndex = 0, branch = 'right', slot = 'direct', outcomeIndex = 0) {
	const oldFont = editorViewState.font;
	editorViewState.font = new EditorFont('tiny');
	t.after(() => { editorViewState.font = oldFont; });
	const model = new EditorTextModel({ domain: 0, path: 'retarget.lua', source: { resid: 'retarget', type: 'lua' } }, 'lua', source);
	t.after(() => model.dispose());
	const project = () => buildBehaviorSourceDocument(model.resource, buildLuaFileSemanticData(model.buffer.getText(), model.resource.path));
	const view = createBehaviorLensViewState(project(), model, 'outline');
	model.onDidChangeContent(event => mapBehaviorLensSourceRanges(view, event.changes, event.editState));
	const definition = view.document.definitions[definitionIndex];
	assert.ok(definition.behaviorKind === 'state_machine');
	const scope = definition.scopes[0].children.get(branch)!;
	const origin = scope.children.get('idle')!;
	const transition = definition.transitions.find(item => item.origin === origin
		&& (slot === 'update' ? item.slot.kind === slot : item.slot.source.label === slot))!;
	const selection = selectStateMachineSource({ kind: 'state-outcome', rowKey: transition.slot.source.rowKey,
		transition, outcome: transition.outcomes[outcomeIndex] }, model.buffer);
	assert.ok(selection.kind === 'state-outcome');
	selectBehaviorLensDefinition(view, definition.rowKey);
	view.selection = selection;
	const target = new StateMachineRetargetAnalysis(view.document, selection.transition, selection.outcome)
		.checkTarget(scope.children.get('other')!);
	assert.ok(target.kind === 'available');
	const refresh = () => { installBehaviorLensDocument(view, project(), model.buffer); view.sourceVersion = model.version; };
	const checkSelection = (text: string, outcome = outcomeIndex) => {
		const selected = view.selection;
		assert.ok(selected?.kind === 'state-outcome');
		const current = view.document.definitions[definitionIndex];
		assert.ok(current.behaviorKind === 'state_machine');
		assert.equal(view.definitionRowKey, current.rowKey);
		assert.equal(selected.transition.origin.rowKey, current.scopes[0].children.get(branch)!.children.get('idle')!.rowKey);
		assert.equal(selected.transition.slot.source.label, transition.slot.source.label);
		assert.equal(selected.outcome, selected.transition.outcomes[outcome], 'exact return syntax, not text or edge ordinal');
		assert.ok(selected.outcome.target.kind === 'path');
		assert.equal(selected.outcome.target.text, text);
		assert.equal(view.selectionBookmark, undefined);
		return selected;
	};
	return { model, view, selection, target, refresh, checkSelection,
		edit: () => retargetStateMachineTransition(model, view, selection, target) };
}

test('retarget history restores exact direct, wrapped and callback evidence in each shared source occurrence', t => {
	for (const [definition, branch] of [[0, 'left'], [0, 'right'], [1, 'left']] as const) {
		for (const [slot, outcome] of [['direct', 0], ['wrapped', 0], ['update', 0], ['update', 1]] as const) {
			const f = fixture(t, FSM_RETARGET_SOURCE, definition, branch, slot, outcome);
			const edit = createLuaStringValueEdit(f.model.buffer, f.target.literal, f.target.text);
			f.edit();
			const expected = FSM_RETARGET_SOURCE.slice(0, edit.offset) + edit.text + FSM_RETARGET_SOURCE.slice(edit.offset + edit.deleteLength);
			assert.equal(f.model.buffer.getText(), expected, 'all exterior bytes, comments, wrappers and extra returns survive');
			assert.equal(f.model.version, 2, 'one edit, one document history element');
			for (const action of ['edit', 'undo', 'redo', 'undo', 'redo']) {
				if (action === 'undo') f.model.undo();
				if (action === 'redo') f.model.redo();
				f.refresh();
				f.checkSelection(action === 'undo' ? '../active' : '../other');
				assert.equal(f.model.dirty, action !== 'undo');
			}
		}
	}
});

test('long strings, quote delimiters, UTF-16 and CRLF still resolve the replaced binding token, including shrinking it', t => {
	for (const value of ["'../active'", '"../active"', '[=[../active]=]', '[=[\n../active]=]']) {
		const source = ('-- 🐉\n' + FSM_RETARGET_SOURCE.replace("--[[direct path]] '../active'", '--[[direct path]] ' + value)).replaceAll('\n', '\r\n');
		const f = fixture(t, source);
		f.edit(); f.refresh();
		f.checkSelection('../other');
		assert.equal(readLuaSourceRange(f.model.buffer, selectedBehaviorLensSourceRange(f.view)!), value[0] === '"' ? '"../other"' : "'../other'");
		f.model.undo(); f.refresh();
		f.checkSelection('../active');
		assert.equal(f.model.buffer.getText(), source);
		f.model.redo(); f.refresh(); f.checkSelection('../other');
	}
});

test('hidden edits map proof coordinates, not history values; identical inserted returns cannot steal selection', t => {
	const f = fixture(t, FSM_RETARGET_SOURCE, 1, 'left', 'update', 1);
	const document = f.view.document;
	f.edit();
	const pending = JSON.stringify(f.view.selectionBookmark);
	f.model.pushEditOperations([{ offset: 0, deleteLength: 0, text: '-- 🐉 hidden\r\n' }]);
	const offset = f.model.buffer.getText().indexOf('\treturn (');
	f.model.pushEditOperations([{ offset, deleteLength: 0, text: "\tif actor.extra then return '../other' end\n" }]);
	assert.equal(f.view.document, document, 'content events never reparse a hidden input');
	f.refresh(); f.checkSelection('../other', 2);
	f.model.undo(); f.model.undo(); f.refresh(); f.checkSelection('../other');
	const record = f.model.undo()!;
	assert.ok(record.afterEditState!.is(behaviorSourceEditState));
	assert.ok(record.afterEditState.value.kind === 'state-outcome');
	assert.equal(JSON.stringify(record.afterEditState.value), pending, 'mapped live coordinates did not alias history');
	assert.deepEqual(Object.keys(record.afterEditState.value).sort(), ['kind', 'path', 'tracked']);
	assert.deepEqual(Object.keys(record.afterEditState.value.tracked).sort(), ['binding', 'bindingKind', 'callback', 'kind', 'slotKind', 'statementStart']);
	f.model.redo(); f.model.undo(); f.refresh(); f.checkSelection('../active');
});

test('the recorded registration is restored even if another definition was chosen before Undo', t => {
	const f = fixture(t, FSM_RETARGET_SOURCE, 1, 'left');
	f.edit(); f.refresh();
	selectBehaviorLensDefinition(f.view, f.view.document.definitions[0].rowKey);
	f.model.undo(); f.refresh(); f.checkSelection('../active');
	selectBehaviorLensDefinition(f.view, f.view.document.definitions[0].rowKey);
	f.model.redo(); f.refresh(); f.checkSelection('../other');
});

test('ordinary replacement of binding, return, callback or parent still deletes pending correspondence, even with hidden Undo', t => {
	for (const part of ['binding', 'return', 'callback', 'parent'] as const) for (const hiddenUndo of [false, true]) {
		const f = fixture(t, FSM_RETARGET_SOURCE, 0, 'right', part === 'binding' ? 'direct' : 'update', part === 'binding' ? 0 : 1);
		f.edit(); f.refresh();
		f.model.undo(); f.model.redo(); // Deliver a new pending history value without projection.
		const selected = f.view.selection!;
		assert.ok(selected.kind === 'state-outcome');
		const proof = selected.outcome.proof;
		const range = part === 'parent' ? selected.transition.slot.source.occurrenceRange
			: proof.kind === 'direct' ? proof.expression.range : part === 'callback' ? proof.callback.range : proof.statement.range;
		const span = luaSourceRangeToTextRange(f.model.buffer, range);
		const text = readLuaSourceRange(f.model.buffer, range);
		f.model.pushEditOperations([{ offset: span.start, deleteLength: span.end - span.start, text }]);
		if (hiddenUndo) f.model.undo();
		f.refresh(); assert.equal(f.view.selection, null, `${part}, hidden Undo ${hiddenUndo}`);
		if (!hiddenUndo) { f.model.undo(); f.refresh(); assert.equal(f.view.selection, null); }
		f.model.undo(); f.refresh(); f.checkSelection('../active');
	}
});

test('unannotated literal replacement never gains the explicit retarget selection policy', t => {
	const f = fixture(t);
	f.model.pushEditOperations([createLuaStringValueEdit(f.model.buffer, f.target.literal, f.target.text)]);
	f.refresh(); assert.equal(f.view.selection, null);
	f.model.undo(); f.refresh(); assert.equal(f.view.selection, null);
});

test('entry bookmarks use the same typed history and distinguish shared initial declarations', t => {
	const f = fixture(t);
	const refs = [...f.view.stateMachines.references.values()].flat();
	const reference = refs.filter(item => item.kind === 'state-entry' && item.entry.kind === 'initial')[2];
	assert.ok(reference.kind === 'state-entry');
	f.view.selection = selectStateMachineSource(reference, f.model.buffer);
	const before = captureBehaviorSourceBookmark(f.view, f.view.selection);
	const after = copyBehaviorSourceBookmark(before);
	const prefix = '-- history probe\n';
	f.model.pushEditOperations([{ offset: 0, deleteLength: 0, text: prefix }], behaviorSourceEditState.of(before), changes => {
		mapBehaviorSourceBookmark(after, changes);
		return behaviorSourceEditState.of(after);
	});
	for (const action of ['edit', 'undo', 'redo']) {
		if (action === 'undo') f.model.undo();
		if (action === 'redo') f.model.redo();
		f.refresh();
		assert.equal(f.view.selection?.kind, 'state-entry');
		assert.equal(readLuaSourceRange(f.model.buffer, selectedBehaviorLensSourceRange(f.view)!), "initial = 'idle'");
		const path = captureBehaviorSourceBookmark(f.view, f.view.selection!).path;
		assert.equal(path[path.length - 1].start, before.path[before.path.length - 1].start + (action === 'undo' ? 0 : prefix.length));
	}
});

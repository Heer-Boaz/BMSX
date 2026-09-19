import { createBehaviorEditFixture } from '../helpers/behavior_edit_fixture';
import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { createLuaStringValueEdit, luaSourceRangeToTextRange, readLuaSourceRange } from '../../ide/language/lua/source_edits';
import { selectBehaviorLensDefinition } from '../../ide/workbench/contrib/behavior_lens/layout';
import { selectedBehaviorLensSourceRange } from '../../ide/workbench/contrib/behavior_lens/navigation';
import { behaviorSourceEditState, captureBehaviorSourceBookmark, copyBehaviorSourceBookmark, mapBehaviorSourceBookmark } from '../../ide/workbench/contrib/behavior_lens/source_bookmark';
import { retargetStateMachineTransition } from '../../ide/workbench/contrib/behavior_lens/state_machine_edit';
import { StateMachineRetargetAnalysis } from '../../ide/workbench/contrib/behavior_lens/state_machine_retarget';
import { selectStateMachineSource } from '../../ide/workbench/contrib/behavior_lens/state_machine_selection';
import { FSM_RETARGET_SOURCE, FSM_RETARGET_IMPORTED_SOURCE, FSM_RETARGET_BRANCH_SOURCE, FSM_RETARGET_CALLBACK_SOURCE } from '../helpers/fsm_retarget_fixture';

function fixture(t: TestContext, source = FSM_RETARGET_SOURCE, definitionIndex = 0, branch = 'right', slot = 'direct', outcomeIndex = 0,
	imports: Readonly<Record<string, string>> = {}) {
	const f = createBehaviorEditFixture(t, 'retarget.lua', source, 'outline', definitionIndex, imports);
	const { view, refresh } = f;
	const definition = view.document.definitions[definitionIndex];
	assert.ok(definition.behaviorKind === 'state_machine');
	const scope = definition.scopes[0].children.get(branch)!;
	const origin = scope.children.get('idle')!;
	const transition = definition.transitions.find(item => item.origin === origin
		&& (slot === 'update' ? item.slot.kind === slot : item.slot.source.label === slot))!;
	const selection = selectStateMachineSource({ kind: 'state-outcome', rowKey: transition.slot.source.rowKey,
		transition, outcome: transition.outcomes[outcomeIndex] }, view.source.models);
	assert.ok(selection.kind === 'state-outcome');
	selectBehaviorLensDefinition(view, definition.rowKey);
	view.selection = selection;
	const target = new StateMachineRetargetAnalysis(view.document, selection.transition, selection.outcome)
		.checkTarget(scope.children.get('other')!);
	assert.ok(target.kind === 'available');
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
	const model = view.source.models.get(target.file.chunk.locations.range(target.literal.span).path)!;
	return { ...f, anchor: f.model, model, selection, target, refresh, checkSelection,
		edit: () => retargetStateMachineTransition(model, view, selection, target) };
}

test('imported transition edits and source bookmarks belong to the literal, not the registration or callback binding', t => {
	for (const [slot, outcome] of [['direct', 0], ['wrapped', 0], ['update', 0], ['update', 1]] as const) {
		const branch = FSM_RETARGET_BRANCH_SOURCE.replace("update = callback,", "update = callback, entering_state = require('observer'),");
		const f = fixture(t, FSM_RETARGET_IMPORTED_SOURCE, 1, 'left', slot, outcome, {
			'branch.lua': branch, 'callback.lua': FSM_RETARGET_CALLBACK_SOURCE, 'observer.lua': 'return function() return nil end',
		});
		const provider = f.models.get('branch.lua')!, callback = f.models.get('callback.lua')!;
		assert.deepEqual(new Set(f.input.getWorkingCopies()), new Set([f.anchor, provider, callback]),
			'only represented declarations and editable return evidence join Save/Undo, not every callback dependency');
		assert.equal(f.model, slot === 'update' ? callback : provider);
		const original = f.model.buffer.getText();
		const untouched = slot === 'update' ? provider : callback;
		const otherSource = untouched.buffer.getText();
		f.anchor.refreshResource({ ...f.anchor.resource, source: { ...f.anchor.resource.source, generated: true } });
		const edit = createLuaStringValueEdit(f.model.buffer, f.target.file.chunk.locations, f.target.literal, f.target.text);
		f.edit(); f.refresh(); f.checkSelection('../other');
		assert.equal(f.model.buffer.getText(), original.slice(0, edit.offset) + edit.text + original.slice(edit.offset + edit.deleteLength));
		assert.equal(untouched.buffer.getText(), otherSource);
		assert.equal(f.anchor.version, 1); assert.equal(f.input.isDirty(), true);
		assert.equal(selectedBehaviorLensSourceRange(f.view)!.path, f.model.resource.path);
		const changed = f.model.buffer.getText();
		f.model.completeSave(f.model.createSnapshot());
		assert.equal(f.input.isDirty(), false);
		for (const direction of ['undo', 'redo', 'undo', 'redo'] as const) {
			const owner = f.service.history.findModel(f.input.getWorkingCopies(), direction)!;
			assert.equal(owner, f.model); owner[direction](); f.refresh();
			f.checkSelection(direction === 'undo' ? '../active' : '../other');
			assert.equal(f.model.buffer.getText(), direction === 'undo' ? original : changed);
		}
		// Losing return evidence must not lose the very resource needed to Undo it.
		f.model.pushEditOperations([{ offset: 0, deleteLength: f.model.buffer.length, text: 'return function(' }]);
		f.refresh();
		assert.equal(f.service.history.findModel(f.input.getWorkingCopies(), 'undo'), f.model);
		f.model.undo(); f.refresh(); assert.equal(f.model.buffer.getText(), changed);
	}
});

test('retarget history restores exact direct, wrapped and callback evidence in each shared source occurrence', t => {
	for (const [definition, branch] of [[0, 'left'], [0, 'right'], [1, 'left']] as const) {
		for (const [slot, outcome] of [['direct', 0], ['wrapped', 0], ['update', 0], ['update', 1]] as const) {
			const f = fixture(t, FSM_RETARGET_SOURCE, definition, branch, slot, outcome);
			const edit = createLuaStringValueEdit(f.model.buffer, f.target.file.chunk.locations, f.target.literal, f.target.text);
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

test('shared FSM source Undo does not retarget another definition view', t => {
	const f = fixture(t, FSM_RETARGET_SOURCE, 1, 'left');
	f.edit(); f.refresh();
	selectBehaviorLensDefinition(f.view, f.view.document.definitions[0].rowKey);
	f.model.undo(); f.refresh();
	assert.equal(f.view.definitionRowKey, f.view.document.definitions[0].rowKey);
	assert.equal(f.view.selection!.rowKey, f.view.definitionRowKey);
	f.model.redo(); f.refresh();
	assert.equal(f.view.definitionRowKey, f.view.document.definitions[0].rowKey);
	assert.equal(f.view.selection!.rowKey, f.view.definitionRowKey);
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
			: proof.kind === 'direct' ? proof.file.chunk.locations.range(proof.expression.span) : part === 'callback' ? proof.callbackFile.chunk.locations.range(proof.callback.span) : proof.callbackFile.chunk.locations.range(proof.statement.span);
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
	f.model.pushEditOperations([createLuaStringValueEdit(f.model.buffer, f.target.file.chunk.locations, f.target.literal, f.target.text)]);
	f.refresh(); assert.equal(f.view.selection, null);
	f.model.undo(); f.refresh(); assert.equal(f.view.selection, null);
});

test('entry bookmarks use the same typed history and distinguish shared initial declarations', t => {
	const f = fixture(t);
	const refs = [...f.view.stateMachines.references.values()].flat();
	const reference = refs.filter(item => item.kind === 'state-entry' && item.entry.kind === 'initial')[2];
	assert.ok(reference.kind === 'state-entry');
	f.view.selection = selectStateMachineSource(reference, f.view.source.models);
	const before = captureBehaviorSourceBookmark(f.view, f.view.selection);
	const after = copyBehaviorSourceBookmark(before);
	const prefix = '-- history probe\n';
	f.model.pushEditOperations([{ offset: 0, deleteLength: 0, text: prefix }], behaviorSourceEditState.of(before), changes => {
		mapBehaviorSourceBookmark(after, f.model.resource, changes);
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

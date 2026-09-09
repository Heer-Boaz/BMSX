import assert from 'node:assert/strict';
import test from 'node:test';
import { EditorTextModel } from '../../ide/editor/model/text_model';
import { luaSourceRangeToTextRange, readLuaSourceRange } from '../../ide/language/lua/source_edits';
import { buildLuaFileSemanticData } from '../../toolchain/ts/lua/semantic/model';
import type { LuaSourceRange } from '../../toolchain/ts/lua/syntax/ast';
import { buildBehaviorSourceDocument } from '../../ide/workbench/contrib/behavior_lens/recognizer';
import { createBehaviorLensViewState } from '../../ide/workbench/contrib/behavior_lens/view_model';
import { installBehaviorLensDocument, rebuildBehaviorLensRows } from '../../ide/workbench/contrib/behavior_lens/layout';
import { selectedBehaviorLensSourceRange } from '../../ide/workbench/contrib/behavior_lens/navigation';
import { mapBehaviorLensSourceRanges } from '../../ide/workbench/contrib/behavior_lens/source_correspondence';
import { selectStateMachineSource, type StateMachineSourceReference } from '../../ide/workbench/contrib/behavior_lens/state_machine_selection';
import { buildStateMachineSourceDetails } from '../../ide/workbench/contrib/behavior_lens/state_machine_details';
import { FSM_PROOF_SOURCE } from '../helpers/fsm_source_fixture';

function fixture(source = FSM_PROOF_SOURCE) {
	const model = new EditorTextModel({ domain: 0, path: 'fsm_proofs.lua', source: { resid: 'fsm_proofs', type: 'lua' } }, 'lua', source);
	const project = () => buildBehaviorSourceDocument(model.resource, buildLuaFileSemanticData(model.buffer.getText(), model.resource.path));
	const view = createBehaviorLensViewState(project(), model, 'outline');
	model.onDidChangeContent(event => mapBehaviorLensSourceRanges(view, event.changes));
	return { model, view, refresh() {
		installBehaviorLensDocument(view, project(), model.buffer);
		view.sourceVersion = model.version;
	}, choose(reference: StateMachineSourceReference) {
		view.selection = selectStateMachineSource(reference, model.buffer);
		view.collapsedRowKeys.clear();
		assert.ok(view.presentation.kind === 'outline');
		rebuildBehaviorLensRows(view, view.presentation);
	}, replace(range: LuaSourceRange, text: string) {
		const span = luaSourceRangeToTextRange(model.buffer, range);
		model.pushEditOperations([{ offset: span.start, deleteLength: span.end - span.start, text }]);
	} };
}

function outcomes(f: ReturnType<typeof fixture>, slot = 'update', use = 0) {
	return [...f.view.stateMachineReferences.values()].filter(references => references[0].kind === 'state-outcome'
		&& references[0].transition.slot.kind === slot)[use];
}

function selectedOutcome(f: ReturnType<typeof fixture>) {
	const selection = f.view.selection;
	assert.ok(selection?.kind === 'state-outcome');
	return selection;
}

test('source evidence distinguishes identical returns, shared callbacks and registrations without edge ordinals', () => {
	const f = fixture();
	const left = outcomes(f);
	const right = outcomes(f, 'update', 1);
	const second = outcomes(f, 'update', 2);
	assert.equal(left.length, 3);
	assert.equal(right.length, 3);
	const details = buildStateMachineSourceDetails(left);
	assert.deepEqual(details.map(item => item.label), ['return next_path', 'return next_path', 'return nil']);
	assert.notEqual(details[0].description, details[1].description, 'equal return text is distinguished by its own source location');
	assert.equal(details[0].detail, 'POSSIBLE PATH: ../active');
	assert.equal(details[2].detail, 'NO RETURNED PATH: nil');
	for (const reference of [left[0], left[1], right[1], second[1]]) {
		f.choose(reference);
		const selected = selectedOutcome(f);
		assert.equal(selected.outcome, reference.kind === 'state-outcome' && reference.outcome);
		assert.equal(readLuaSourceRange(f.model.buffer, selectedBehaviorLensSourceRange(f.view)!), 'return next_path');
	}
	assert.notEqual(left[1].rowKey, right[1].rowKey);
	assert.notEqual(right[1].rowKey, second[1].rowKey);
	f.choose(left[1]);
	const old = selectedOutcome(f);
	f.refresh();
	assert.notEqual(selectedOutcome(f).outcome, old.outcome, 'source generation replaces AST evidence, not just coordinates');
	assert.equal(selectedOutcome(f).outcome.proof.kind, 'return');
});

test('hidden UTF-16 edits and inserting an equal return preserve the actual proof, not its outcome index', () => {
	const f = fixture();
	f.choose(outcomes(f)[1]);
	const oldDocument = f.view.document;
	const prefix = '-- 🐉 source shift\n';
	f.model.pushEditOperations([{ offset: 0, deleteLength: 0, text: prefix }]);
	const offset = f.model.buffer.getText().indexOf('\tif owner.again');
	f.model.pushEditOperations([{ offset, deleteLength: 0, text: '\tif owner.extra then return next_path end\n' }]);
	assert.equal(f.view.document, oldDocument);
	f.refresh();
	const selected = selectedOutcome(f);
	assert.equal(selected.outcome, selected.transition.outcomes[2]);
	assert.equal(selectedBehaviorLensSourceRange(f.view)!.start.line, 7);
	assert.equal(readLuaSourceRange(f.model.buffer, selectedBehaviorLensSourceRange(f.view)!), 'return next_path');
	f.model.undo();
	f.refresh();
	assert.equal(selectedOutcome(f).outcome, selectedOutcome(f).transition.outcomes[1]);
	f.model.redo();
	f.refresh();
	assert.equal(selectedOutcome(f).outcome, selectedOutcome(f).transition.outcomes[2]);
});

test('edited const targets rebind the same return proof through normal Undo/Redo, including unknown targets', () => {
	const f = fixture();
	f.choose(outcomes(f)[1]);
	const offset = f.model.buffer.getText().indexOf("'../active'");
	f.model.pushEditOperations([{ offset, deleteLength: "'../active'".length, text: "'../idle'" }]);
	f.refresh();
	let selected = selectedOutcome(f);
	assert.ok(selected.outcome.target.kind === 'path');
	assert.equal(selected.outcome.target.target, selected.transition.origin);
	f.model.undo();
	f.refresh();
	selected = selectedOutcome(f);
	assert.ok(selected.outcome.target.kind === 'path');
	assert.notEqual(selected.outcome.target.target, selected.transition.origin);
	f.model.redo();
	f.refresh();
	f.model.pushEditOperations([{ offset, deleteLength: "'../idle'".length, text: "'../missing'" }]);
	f.refresh();
	assert.deepEqual(selectedOutcome(f).outcome.target, { kind: 'unresolved', reason: 'missing-state' });
});

test('an inline callback retains its own return evidence through prefix and trailing-expression Undo', () => {
	const f = fixture(FSM_PROOF_SOURCE.replace('update = step', "update = function(owner) if owner.first then return next_path end return next_path end"));
	f.choose(outcomes(f)[1]);
	const proof = selectedOutcome(f).outcome.proof;
	assert.ok(proof.kind === 'return');
	assert.equal(proof.binding, proof.callback, 'the inline use is also the callable body');
	f.model.pushEditOperations([{ offset: 0, deleteLength: 0, text: '-- inline source\n' }]);
	f.refresh();
	const span = luaSourceRangeToTextRange(f.model.buffer, selectedBehaviorLensSourceRange(f.view)!);
	f.model.pushEditOperations([{ offset: span.start + 'return '.length, deleteLength: 'next_path'.length, text: 'nil' }]);
	f.refresh();
	assert.deepEqual(selectedOutcome(f).outcome.target, { kind: 'no-path', reason: 'nil' });
	f.model.undo();
	f.refresh();
	assert.equal(readLuaSourceRange(f.model.buffer, selectedBehaviorLensSourceRange(f.view)!), 'return next_path');
	assert.equal(selectedOutcome(f).outcome, selectedOutcome(f).transition.outcomes[1]);
});

test('partial edits inside a return preserve its syntax occurrence, complete replacement never resurrects it', () => {
	const f = fixture();
	f.choose(outcomes(f)[1]);
	const range = selectedBehaviorLensSourceRange(f.view)!;
	const span = luaSourceRangeToTextRange(f.model.buffer, range);
	f.model.pushEditOperations([{ offset: span.start + 'return '.length, deleteLength: 'next_path'.length, text: 'nil' }]);
	f.refresh();
	assert.deepEqual(selectedOutcome(f).outcome.target, { kind: 'no-path', reason: 'nil' });
	f.model.undo();
	f.refresh();
	assert.equal(readLuaSourceRange(f.model.buffer, selectedBehaviorLensSourceRange(f.view)!), 'return next_path');
	for (const undoBeforeRefresh of [false, true]) {
		const fresh = fixture();
		fresh.choose(outcomes(fresh)[1]);
		fresh.replace(selectedBehaviorLensSourceRange(fresh.view)!, 'return next_path');
		if (undoBeforeRefresh) fresh.model.undo();
		fresh.refresh();
		assert.equal(fresh.view.selection, null);
		if (!undoBeforeRefresh) { fresh.model.undo(); fresh.refresh(); assert.equal(fresh.view.selection, null); }
	}
});

test('deleting the selected proof, binding, callback or parent use clears selection even with hidden Undo', () => {
	for (const part of ['statement', 'binding', 'callback', 'parent'] as const) {
		for (const undoBeforeRefresh of [false, true]) {
			const f = fixture();
			f.choose(outcomes(f, 'update', 1)[1]);
			const selected = selectedOutcome(f);
			const proof = selected.outcome.proof;
			assert.ok(proof.kind === 'return');
			const parent = f.view.sourceNodes.find(node => node.kind === 'state' && node.label === 'right')!;
			const range = part === 'parent' ? parent.occurrenceRange : proof[part].range;
			f.replace(range, '');
			if (undoBeforeRefresh) f.model.undo();
			f.refresh();
			assert.equal(f.view.selection, null, `${part} removed (hidden Undo = ${undoBeforeRefresh})`);
			if (!undoBeforeRefresh) { f.model.undo(); f.refresh(); assert.equal(f.view.selection, null); }
		}
	}
});

test('inserting a new same-named callback cannot transfer selection to its identical return', () => {
	const f = fixture();
	f.choose(outcomes(f)[1]);
	const offset = f.model.buffer.getText().indexOf('local shared<const>');
	f.model.pushEditOperations([{ offset, deleteLength: 0,
		text: 'local step<const> = function(owner) if owner.first then return next_path end return next_path end\n' }]);
	f.refresh();
	assert.equal(f.view.selection, null, 'the new binder-proven callback is not the previously selected callback');
	assert.equal(outcomes(f).length, 2, 'both new returns are still described as new source evidence');
});

test('moving a return into a nested function removes that callback outcome instead of picking its neighbor', () => {
	const f = fixture();
	f.choose(outcomes(f)[1]);
	const span = luaSourceRangeToTextRange(f.model.buffer, selectedBehaviorLensSourceRange(f.view)!);
	f.model.pushEditOperations([{ offset: span.start, deleteLength: 0, text: 'local nested<const> = function() ' },
		{ offset: span.end, deleteLength: 0, text: ' end' }]);
	f.refresh();
	assert.equal(outcomes(f).length, 2);
	assert.equal(f.view.selection, null);
});

test('a new duplicate registration and deleting an unrelated use do not change the selected occurrence', () => {
	const f = fixture();
	f.choose(outcomes(f, 'update', 1)[1]);
	const oldKey = selectedOutcome(f).rowKey;
	const offset = f.model.buffer.getText().indexOf("machines.register('fixture.proofs'");
	f.model.pushEditOperations([{ offset, deleteLength: 0, text: "machines.register('fixture.proofs', shared)\n" }]);
	f.refresh();
	assert.notEqual(selectedOutcome(f).rowKey, oldKey);
	const text = f.model.buffer.getText();
	f.model.pushEditOperations([{ offset: text.indexOf('left = shared, '), deleteLength: 'left = shared, '.length, text: '' }]);
	f.refresh();
	assert.equal(selectedOutcome(f).outcome, selectedOutcome(f).transition.outcomes[1]);
	const definition = f.view.document.definitions[1];
	assert.ok(definition.behaviorKind === 'state_machine');
	assert.equal(selectedOutcome(f).transition, definition.transitions.find(transition => transition.slot.kind === 'update'));
});

test('direct evidence points at the binding use, not its const initializer, and cannot become a callback proof', () => {
	const f = fixture();
	const direct = outcomes(f, 'event')[0];
	f.choose(direct);
	assert.equal(readLuaSourceRange(f.model.buffer, selectedBehaviorLensSourceRange(f.view)!), 'next_path');
	assert.equal(selectedBehaviorLensSourceRange(f.view)!.start.line, 13);
	const offset = f.model.buffer.getText().indexOf("'../active'");
	f.model.pushEditOperations([{ offset, deleteLength: "'../active'".length, text: "function() return '../active' end" }]);
	f.refresh();
	assert.equal(f.view.selection, null, 'the source use survived, but a direct-expression proof is not a return proof');
});

test('explicit entry identity uses its declaring owner and role, not the parent origin or child label', () => {
	const f = fixture();
	const references = [...f.view.stateMachineReferences.values()].find(items => items.length === 2 && items.every(item => item.kind === 'state-entry'))!;
	const concurrent = references.find(item => item.kind === 'state-entry' && item.entry.kind === 'concurrent')!;
	assert.ok(concurrent.kind === 'state-entry');
	assert.notEqual(concurrent.entry.owner, concurrent.entry.origin);
	f.choose(concurrent);
	assert.equal(readLuaSourceRange(f.model.buffer, selectedBehaviorLensSourceRange(f.view)!), 'is_concurrent = true');
	f.replace(concurrent.field.value.range, '0'); // Lua truth, not a host boolean validator.
	f.refresh();
	assert.ok(f.view.selection?.kind === 'state-entry');
	assert.equal(f.view.selection.entry.kind, 'concurrent');
	assert.equal(readLuaSourceRange(f.model.buffer, selectedBehaviorLensSourceRange(f.view)!), 'is_concurrent = 0');
	f.replace(f.view.selection.field.value.range, 'false');
	f.refresh();
	assert.equal(f.view.selection, null, 'the concurrent entry relation no longer exists');
	f.model.undo();
	f.refresh();
	assert.equal(f.view.selection, null, 'the remaining initial relation is not a replacement selection');
});

test('an explicit initial field keeps its own evidence when a longer target is edited and undone', () => {
	const f = fixture();
	const initial = [...f.view.stateMachineReferences.values()].flat().find(reference => reference.kind === 'state-entry'
		&& reference.entry.kind === 'initial' && readLuaSourceRange(f.model.buffer, reference.field.value.range) === "'idle'")!;
	assert.ok(initial.kind === 'state-entry');
	f.choose(initial);
	f.replace(initial.field.value.range, "'active'");
	f.refresh();
	let selection = f.view.selection;
	assert.ok(selection?.kind === 'state-entry' && selection.entry.target.kind === 'state');
	assert.equal(f.view.nodesByRowKey.get(selection.entry.target.rowKey)!.label, 'active');
	f.model.undo();
	f.refresh();
	selection = f.view.selection;
	assert.ok(selection?.kind === 'state-entry' && selection.entry.target.kind === 'state');
	assert.equal(f.view.nodesByRowKey.get(selection.entry.target.rowKey)!.label, 'idle');
});

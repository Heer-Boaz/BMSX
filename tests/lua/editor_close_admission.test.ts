import { TEST_SYSTEM_CONTEXT_ID } from '../helpers/runtime_sources';
import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { setImmediate } from 'node:timers/promises';
import { KeyModifier } from '../../hosts/common/input/text';
import { inputFocus } from '../../ide/input/focus';
import { clearWorkspaceSourceCaches } from '../../ide/workspace/cache';
import type { WorkspaceRecord, WorkspaceRecordProvider } from '../../ide/workspace/record_provider';
import { closeWorkspaceRecords, openWorkspaceRecords } from '../../ide/workspace/records';
import { CodeEditorInput } from '../../ide/workbench/contrib/code_editor/editor_input';
import { selectBehaviorLensDefinition } from '../../ide/workbench/contrib/behavior_lens/layout';
import { createActualSourcePanes } from '../helpers/source_panes';
import { registerLuaSourceRecord } from '../../ide/runtime/source_registry';
import { createScenarioTestSourceRecord } from '../helpers/scenario_sources';

/** Only the filesystem is controlled; close, prompt, working copies and Save are the real workbench owners. */
class CloseFiles implements WorkspaceRecordProvider {
	public readonly persistence = 'workspace';
	public readonly records = new Map<string, WorkspaceRecord>();
	public readonly writes: { path: string; record: WorkspaceRecord; complete(): void }[] = [];
	public delayed = false;
	public failure: Error | undefined;
	public async read(path: string): Promise<WorkspaceRecord | null> { return this.records.get(path) ?? null; }
	public async readDirectory() { return []; }
	public async delete(path: string): Promise<void> { this.records.delete(path); }
	public async write(path: string, record: WorkspaceRecord): Promise<void> {
		if (this.failure !== undefined) throw this.failure;
		if (this.delayed) await new Promise<void>(resolve => this.writes.push({ path, record, complete: resolve }));
		this.records.set(path, record);
	}
}

async function fixture(t: TestContext, sameModel = false) {
	const files = new CloseFiles();
	await openWorkspaceRecords(files);
	// Release accepted I/O even when a preceding assertion fails, before the actual workbench shuts down.
	t.after(() => { files.delayed = false; for (const write of files.writes) write.complete(); });
	const f = createActualSourcePanes(t, sameModel);
	t.after(async () => { await closeWorkspaceRecords(); clearWorkspaceSourceCaches(); });
	return { ...f, files };
}

test('closing a clean Source view retires synchronously without a dirty decision', async t => {
	const f = await fixture(t);
	f.second.code.focusTarget.focus();
	const closing = f.firstGroup.close(f.firstInput.id);
	assert.ok(f.firstGroup.model.findById(f.firstInput.id) === undefined, 'the admitted Source input has retired');
	assert.equal(f.editor.actionPrompt.visible, false);
	assert.ok(inputFocus.target === f.second.code.focusTarget, 'the surviving Source control retains focus');
	assert.equal(await closing, true);
});

test('closing a clean background view does not try to commit the focused sibling draft', async t => {
	const f = await fixture(t), target = f.second.code.focusTarget;
	target.focus();
	const priorEdit = target.edit;
	let attempts = 0;
	const draft = { pending: true, commit() { attempts++; return false; } };
	target.edit = draft;
	t.after(() => { target.edit = priorEdit; });
	const closing = f.firstGroup.close(f.firstInput.id);
	assert.ok(f.firstGroup.model.findById(f.firstInput.id) === undefined, 'the clean background view retires synchronously');
	assert.equal(await closing, true);
	assert.equal(attempts, 0);
	assert.ok(target.edit === draft, 'the surviving sibling retains its own uncommitted draft');
	assert.equal(draft.pending, true);
	assert.ok(inputFocus.target === target, 'closing a background view does not blur the sibling');
	assert.equal(f.editor.actionPrompt.visible, false);
});

test('closing one shared dirty Source view preserves the surviving model, focus and Undo history', async t => {
	const f = await fixture(t, true), model = f.firstInput.workingCopy;
	f.first.code.focusTarget.textInput!.replaceText(6, 11, 'changed');
	f.second.code.focusTarget.focus();
	const closing = f.firstGroup.close(f.firstInput.id);
	assert.ok(f.firstGroup.model.findById(f.firstInput.id) === undefined, 'the admitted Source input has retired');
	assert.equal(f.editor.actionPrompt.visible, false);
	assert.ok(f.secondInput.workingCopy === model, 'the surviving input keeps the same canonical model');
	assert.equal(model.dirty, true);
	assert.equal(model.canUndo, true);
	assert.ok(inputFocus.target === f.second.code.focusTarget, 'the surviving Source control retains focus');
	assert.equal(await closing, true);
	f.key('KeyZ', KeyModifier.ctrl);
	assert.equal(model.buffer.getText(), f.source);
	assert.equal(model.dirty, false);
});

test('closing a non-last dirty view leaves the focused shared-model sibling draft uncommitted', async t => {
	const f = await fixture(t, true), model = f.firstInput.workingCopy, target = f.second.code.focusTarget;
	f.first.code.focusTarget.textInput!.replaceText(6, 11, 'retained');
	target.focus();
	const source = model.buffer.getText(), priorEdit = target.edit;
	let attempts = 0;
	const draft = { pending: true, commit() { attempts++; return false; } };
	target.edit = draft;
	t.after(() => { target.edit = priorEdit; });
	const closing = f.firstGroup.close(f.firstInput.id);
	assert.ok(f.firstGroup.model.findById(f.firstInput.id) === undefined, 'the non-last view retires synchronously');
	assert.equal(await closing, true);
	assert.equal(attempts, 0);
	assert.ok(target.edit === draft, 'the shared-model sibling retains its concrete draft');
	assert.equal(draft.pending, true);
	assert.ok(inputFocus.target === target, 'the surviving sibling retains focus');
	assert.ok(f.secondInput.workingCopy === model, 'the survivor retains the canonical model');
	assert.equal(model.buffer.getText(), source);
	assert.equal(model.dirty, true);
	assert.equal(model.canUndo, true);
	assert.equal(f.editor.actionPrompt.visible, false);
});

test('Cancel on the last dirty Source view retains its source, history and invoking focus', async t => {
	const f = await fixture(t), model = f.firstInput.workingCopy;
	f.first.code.focusTarget.focus();
	f.first.code.focusTarget.textInput!.replaceText(6, 11, 'changed');
	const source = model.buffer.getText(), closing = f.firstGroup.close(f.firstInput.id);
	assert.equal(f.editor.actionPrompt.visible, true);
	assert.ok(f.firstGroup.model.findById(f.firstInput.id) === f.firstInput, 'the requested input remains admitted');
	f.key('Escape');
	assert.equal(await closing, false);
	assert.equal(model.buffer.getText(), source);
	assert.equal(model.dirty, true);
	assert.equal(model.canUndo, true);
	assert.ok(inputFocus.target === f.first.code.focusTarget, 'Cancel returns focus to the invoking Source control');
	assert.equal(f.files.records.size, 0);
});

for (const retire of ['workspace', 'close-owner'] as const) test(`${retire} retirement cancels its pending close decision without reclaiming focus`, async t => {
	const f = await fixture(t);
	f.first.code.focusTarget.focus();
	f.first.code.focusTarget.textInput!.replaceText(6, 11, 'retained');
	const closing = f.firstGroup.close(f.firstInput.id);
	assert.equal(f.editor.actionPrompt.visible, true);
	if (retire === 'workspace') f.ide.models.clear(); else f.editor.editorClose.dispose();
	assert.equal(await closing, false);
	assert.equal(f.editor.actionPrompt.visible, false);
	assert.ok(inputFocus.target !== f.first.code.focusTarget, 'retired admission cannot refocus its old Source control');
	assert.ok(f.firstGroup.model.findById(f.firstInput.id) === f.firstInput, 'user-close admission does not force owner teardown');
	assert.equal(f.files.records.size, 0);
});

test('Save on the last dirty view persists through the actual Save service before retiring its input', async t => {
	const f = await fixture(t), model = f.firstInput.workingCopy;
	f.first.code.focusTarget.focus();
	f.first.code.focusTarget.textInput!.replaceText(6, 11, 'saved');
	const source = model.buffer.getText();
	f.files.delayed = true;
	const closing = f.firstGroup.close(f.firstInput.id);
	f.key('Enter');
	await setImmediate();
	assert.equal(f.files.writes.length, 1);
	assert.ok(f.firstGroup.model.findById(f.firstInput.id) === f.firstInput, 'the requested input remains admitted');
	assert.equal(model.dirty, true);
	f.files.writes[0].complete();
	assert.equal(await closing, true);
	assert.equal(f.files.records.get('first.lua')!.contents, source);
	assert.equal(f.ide.textFileSaves.latestOperation(model)!.result!.status, 'saved');
	assert.equal(model.dirty, false);
	assert.ok(f.firstGroup.model.findById(f.firstInput.id) === undefined, 'the admitted Source input has retired');
});

test('failed Save leaves the dirty view open and an ordinary later close can save it', async t => {
	const f = await fixture(t), model = f.firstInput.workingCopy;
	f.first.code.focusTarget.focus();
	f.first.code.focusTarget.textInput!.replaceText(6, 11, 'retry');
	const source = model.buffer.getText();
	f.files.failure = new Error('controlled source write failure');
	const failed = f.firstGroup.close(f.firstInput.id);
	f.key('Enter');
	assert.equal(await failed, false);
	assert.equal(f.ide.textFileSaves.latestOperation(model)!.result!.status, 'failed');
	assert.equal(model.dirty, true);
	assert.equal(model.buffer.getText(), source);
	assert.ok(f.firstGroup.model.findById(f.firstInput.id) === f.firstInput, 'the requested input remains admitted');
	assert.equal(f.files.records.size, 0);
	f.files.failure = undefined;
	const retry = f.firstGroup.close(f.firstInput.id);
	f.key('Enter');
	assert.equal(await retry, true);
	assert.equal(f.files.records.get('first.lua')!.contents, source);
});

test('Discard on the last dirty view reverts the canonical model without writing a file', async t => {
	const f = await fixture(t), model = f.firstInput.workingCopy;
	f.first.code.focusTarget.focus();
	f.first.code.focusTarget.textInput!.replaceText(6, 11, 'discarded');
	const closing = f.firstGroup.close(f.firstInput.id);
	f.key('Tab'); f.key('Enter');
	assert.equal(await closing, true);
	assert.equal(model.buffer.getText(), f.source);
	assert.equal(model.dirty, false);
	assert.equal(f.files.records.size, 0);
	assert.ok(f.ide.textFileSaves.latestOperation(model) === undefined, 'Discard does not request a source Save');
	assert.ok(f.firstGroup.model.findById(f.firstInput.id) === undefined, 'the admitted Source input has retired');
});

test('an edit while Save is pending requires another dirty decision instead of retiring newer source', async t => {
	const f = await fixture(t), model = f.firstInput.workingCopy;
	f.first.code.focusTarget.focus();
	f.first.code.focusTarget.textInput!.replaceText(6, 11, 'saved');
	const saved = model.buffer.getText();
	f.files.delayed = true;
	const closing = f.firstGroup.close(f.firstInput.id);
	f.key('Enter');
	await setImmediate();
	f.first.code.focusTarget.textInput!.replaceText(6, 11, 'newer');
	const newer = model.buffer.getText();
	f.files.writes[0].complete();
	await setImmediate();
	assert.equal(f.editor.actionPrompt.visible, true);
	assert.equal(f.files.records.get('first.lua')!.contents, saved);
	assert.equal(model.buffer.getText(), newer);
	assert.equal(model.dirty, true);
	assert.ok(f.firstGroup.model.findById(f.firstInput.id) === f.firstInput, 'the requested input remains admitted');
	f.key('Escape');
	assert.equal(await closing, false);
	assert.equal(model.buffer.getText(), newer);
});

test('a new sibling view during Save preserves newer source and its focus when the original retires', async t => {
	const f = await fixture(t), model = f.firstInput.workingCopy;
	f.first.code.focusTarget.focus();
	f.first.code.focusTarget.textInput!.replaceText(6, 11, 'saved');
	f.files.delayed = true;
	const closing = f.firstGroup.close(f.firstInput.id);
	f.key('Enter');
	await setImmediate();
	const sibling = new CodeEditorInput(model);
	f.secondGroup.openEditor(sibling);
	f.second.code.focusTarget.textInput!.replaceText(6, 11, 'newer');
	const newer = model.buffer.getText();
	f.files.writes[0].complete();
	assert.equal(await closing, true);
	assert.ok(f.firstGroup.model.findById(f.firstInput.id) === undefined, 'the admitted Source input has retired');
	assert.ok(f.secondGroup.model.activeTab === sibling, 'the independently opened sibling remains active');
	assert.ok(inputFocus.target === f.second.code.focusTarget, 'the surviving Source control retains focus');
	assert.equal(f.editor.actionPrompt.visible, false);
	assert.equal(model.buffer.getText(), newer);
	assert.equal(model.dirty, true);
	assert.equal(model.canUndo, true);
});

test('Discard waits for an already accepted Save and re-admits any edit made during that wait', async t => {
	const f = await fixture(t), model = f.firstInput.workingCopy;
	f.first.code.focusTarget.focus();
	f.first.code.focusTarget.textInput!.replaceText(6, 11, 'saved');
	const saved = model.buffer.getText();
	f.files.delayed = true;
	const saving = f.ide.textFileSaves.save(model);
	await setImmediate();
	f.first.code.focusTarget.textInput!.replaceText(6, 11, 'discard');
	const closing = f.firstGroup.close(f.firstInput.id);
	f.key('Tab'); f.key('Enter');
	await setImmediate();
	assert.equal(f.editor.actionPrompt.visible, false);
	assert.ok(f.firstGroup.model.findById(f.firstInput.id) === f.firstInput, 'the requested input remains admitted');
	assert.equal(model.buffer.getText(), f.source.replace('alpha', 'discard'));
	f.first.code.focusTarget.textInput!.replaceText(6, 13, 'latest');
	const latest = model.buffer.getText();
	f.files.writes[0].complete();
	await saving.completion;
	await setImmediate();
	assert.equal(f.files.records.get('first.lua')!.contents, saved);
	assert.equal(f.editor.actionPrompt.visible, true);
	assert.equal(model.buffer.getText(), latest);
	assert.equal(model.dirty, true);
	f.key('Tab'); f.key('Enter');
	assert.equal(await closing, true);
	assert.equal(model.buffer.getText(), saved);
	assert.equal(model.dirty, false);
});

test('a captured dirty-close request cannot retire a same-id replacement after its input is removed', async t => {
	const f = await fixture(t), model = f.firstInput.workingCopy;
	f.first.code.focusTarget.focus();
	f.first.code.focusTarget.textInput!.replaceText(6, 11, 'retained');
	const closing = f.firstGroup.close(f.firstInput.id);
	assert.equal(f.editor.actionPrompt.visible, true);
	f.firstGroup.removeEditor(f.firstInput);
	const replacement = new CodeEditorInput(model);
	assert.equal(replacement.id, f.firstInput.id);
	f.firstGroup.openEditor(replacement);
	assert.equal(await closing, false);
	assert.equal(f.editor.actionPrompt.visible, false);
	assert.ok(f.firstGroup.model.activeTab === replacement, 'the replacement remains active');
	assert.ok(f.firstGroup.model.findById(replacement.id) === replacement, 'the retired operation cannot close the replacement');
	assert.equal(model.buffer.getText(), f.source.replace('alpha', 'retained'));
	assert.equal(model.dirty, true);
});

test('an invalid draft in the closing Source control vetoes close without losing the draft or focus', async t => {
	const f = await fixture(t), model = f.firstInput.workingCopy, target = f.first.code.focusTarget;
	target.focus();
	target.textInput!.replaceText(6, 11, 'retained');
	const source = model.buffer.getText(), priorEdit = target.edit;
	let attempts = 0;
	const draft = { pending: true, commit() { attempts++; return false; } };
	target.edit = draft;
	t.after(() => { target.edit = priorEdit; });
	assert.equal(await f.firstGroup.close(f.firstInput.id), false);
	assert.equal(attempts, 1);
	assert.ok(target.edit === draft, 'close retains the concrete uncommitted draft');
	assert.equal(draft.pending, true);
	assert.ok(inputFocus.target === target, 'close does not blur the retained control');
	assert.equal(f.editor.actionPrompt.visible, false);
	assert.ok(f.firstGroup.model.findById(f.firstInput.id) === f.firstInput, 'the requested input remains admitted');
	assert.equal(model.buffer.getText(), source);
	assert.equal(model.dirty, true);
});

test('an invalid focused sibling draft vetoes root-modal close admission without blurring that control', async t => {
	const f = await fixture(t), model = f.firstInput.workingCopy, target = f.second.code.focusTarget;
	f.first.code.focusTarget.textInput!.replaceText(6, 11, 'retained');
	target.focus();
	const priorEdit = target.edit;
	let attempts = 0;
	const draft = { pending: true, commit() { attempts++; return false; } };
	target.edit = draft;
	t.after(() => { target.edit = priorEdit; });
	assert.equal(await f.firstGroup.close(f.firstInput.id), false);
	assert.equal(attempts, 1);
	assert.ok(target.edit === draft, 'close retains the concrete uncommitted draft');
	assert.equal(draft.pending, true);
	assert.ok(inputFocus.target === target, 'close does not blur the retained control');
	assert.equal(f.editor.actionPrompt.visible, false);
	assert.ok(f.firstGroup.model.findById(f.firstInput.id) === f.firstInput, 'the requested input remains admitted');
	assert.equal(model.dirty, true);
	assert.equal(f.secondInput.workingCopy.buffer.getText(), f.otherSource);
});

test('retiring a saved view does not commit a sibling draft entered while its Save was pending', async t => {
	const f = await fixture(t), target = f.second.code.focusTarget;
	f.first.code.focusTarget.focus();
	f.first.code.focusTarget.textInput!.replaceText(6, 11, 'saved');
	f.files.delayed = true;
	const closing = f.firstGroup.close(f.firstInput.id);
	f.key('Enter');
	await setImmediate();
	target.focus();
	const priorEdit = target.edit;
	let attempts = 0;
	const draft = { pending: true, commit() { attempts++; return false; } };
	target.edit = draft;
	t.after(() => { target.edit = priorEdit; });
	f.files.writes[0].complete();
	assert.equal(await closing, true);
	assert.equal(attempts, 0);
	assert.ok(target.edit === draft, 'close retains the concrete uncommitted draft');
	assert.equal(draft.pending, true);
	assert.ok(inputFocus.target === target, 'close does not blur the retained control');
	assert.equal(f.editor.actionPrompt.visible, false);
	assert.equal(f.secondInput.workingCopy.buffer.getText(), f.otherSource);
});

test('a close reentered by the focused draft commit joins its original operation and publishes once', async t => {
	const f = await fixture(t), model = f.firstInput.workingCopy, target = f.first.code.focusTarget;
	target.focus();
	const priorEdit = target.edit, version = model.version;
	let pending = true, attempts = 0, reentered: Promise<boolean> | undefined;
	target.edit = { get pending() { return pending; }, commit() {
		attempts++; pending = false;
		target.textInput!.replaceText(6, 11, 'published');
		reentered = f.firstGroup.close(f.firstInput.id);
		return true;
	} };
	t.after(() => { target.edit = priorEdit; });
	const closing = f.firstGroup.close(f.firstInput.id);
	assert.ok(reentered === closing, 'reentrant close joins the already admitted operation');
	assert.equal(attempts, 1);
	assert.equal(model.version, version + 1);
	assert.equal(model.buffer.getText(), f.source.replace('alpha', 'published'));
	assert.equal(f.editor.actionPrompt.visible, true);
	f.key('Escape');
	assert.equal(await closing, false);
	assert.equal(await reentered, false);
	assert.ok(f.firstGroup.model.findById(f.firstInput.id) === f.firstInput, 'the requested input remains admitted');
});

test('closing a genuine imported-effect lens considers every represented working copy before any Discard', async t => {
	const f = await fixture(t), main = f.firstInput.workingCopy, imported = f.secondInput.workingCopy;
	registerLuaSourceRecord(f.sources.catalog.getContext(TEST_SYSTEM_CONTEXT_ID).luaSources, createScenarioTestSourceRecord('cartlib/actioneffects.lua', 0, ''));
	const registration = "local effects<const> = require('cartlib/actioneffects')\neffects.register_effect('close.fixture', require('second'))";
	const definition = "return { period_ms = 40, blocked_tags = { 'busy' }, handler = function(owner) owner:act() end }";
	f.first.code.focusTarget.textInput!.replaceText(0, main.buffer.length, registration);
	f.second.code.focusTarget.textInput!.replaceText(0, imported.buffer.length, definition);
	const lens = f.editor.behaviorLens.createInput(main, 'properties');
	selectBehaviorLensDefinition(lens.view, lens.view.document.definitions[0].rowKey);
	lens.updateDefinition();
	assert.equal(lens.getWorkingCopies().length, 2);
	assert.ok(lens.getWorkingCopies().includes(main), 'the lens represents its registration source');
	assert.ok(lens.getWorkingCopies().includes(imported), 'the real imported definition participates in close admission');
	f.firstGroup.openEditor(lens);
	assert.equal(await f.firstGroup.close(f.firstInput.id), true);
	assert.equal(await f.secondGroup.close(f.secondInput.id), true);
	assert.equal(f.editor.actionPrompt.visible, false);
	const cancelled = f.firstGroup.close(lens.id);
	f.key('Tab'); f.key('Enter');
	await setImmediate();
	assert.equal(f.editor.actionPrompt.visible, true);
	assert.equal(main.buffer.getText(), registration);
	assert.equal(imported.buffer.getText(), definition);
	assert.equal(main.dirty, true);
	assert.equal(imported.dirty, true);
	f.key('Escape');
	assert.equal(await cancelled, false);
	assert.ok(f.firstGroup.model.findById(lens.id) === lens, 'Cancel leaves the composite input admitted');
	assert.equal(main.buffer.getText(), registration);
	assert.equal(imported.buffer.getText(), definition);
	const discarded = f.firstGroup.close(lens.id);
	f.key('Tab'); f.key('Enter');
	await setImmediate();
	assert.equal(f.editor.actionPrompt.visible, true);
	f.key('Tab'); f.key('Enter');
	assert.equal(await discarded, true);
	assert.equal(main.buffer.getText(), f.source);
	assert.equal(imported.buffer.getText(), f.otherSource);
	assert.equal(main.dirty, false);
	assert.equal(imported.dirty, false);
	assert.equal(f.files.records.size, 0);
});

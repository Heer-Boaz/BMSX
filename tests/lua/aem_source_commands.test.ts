import assert from 'node:assert/strict';
import test, { afterEach, type TestContext } from 'node:test';
import { resourceIdentityKey } from '../../ide/common/resource';
import type { EditorCommandId } from '../../ide/common/commands';
import { editorTextModelService } from '../../ide/editor/model/model_service';
import { resetSemanticProjects } from '../../ide/editor/contrib/intellisense/semantic/workspace/state';
import { inputFocus } from '../../ide/input/focus';
import { AemEditorInput } from '../../ide/workbench/contrib/aem/editor_input';
import { AemEditorPane } from '../../ide/workbench/contrib/aem/editor_pane';
import { projectAemSource } from '../../ide/workbench/contrib/aem/source';
import { createStructuredValueEdit } from '../../ide/language/yaml/structured_edits';
import { getTextFileRuntimeSourceStatus } from '../../ide/workbench/services/working_copy/runtime_source_status';
import { createActualSourcePanes } from '../helpers/source_panes';

const SOURCE = '# authored audio\nevents:\n  first: { channel: sfx, rules: [] }\n  second: { channel: music, rules: [] }\nvalues: [first, second]\n';
afterEach(() => { editorTextModelService.clear(); resetSemanticProjects(editorTextModelService); });

function fixture(t: TestContext, source = SOURCE, selection: readonly (string | number)[] = ['events', 'first', 'channel']) {
	const f = createActualSourcePanes(t), path = 'events.aem.yaml';
	f.sources.catalog.registerTextSources(f.sources.systemContextId, [{ type: 'aem', resid: 'events', source_path: path }]);
	const resource = f.sources.catalog.resolveResource({ contextId: f.sources.systemContextId, path })!;
	const model = editorTextModelService.retain(resource, 'aem', source), input = new AemEditorInput(model);
	f.firstGroup.openEditor(input); f.firstGroup.model.pin(input); f.update();
	const pane = f.firstGroup.panes.activePane!;
	assert.ok(pane instanceof AemEditorPane);
	const select = (path: readonly (string | number)[]) => {
		projectAemSource(input);
		input.tree.selectionIndex = input.tree.rows.findIndex(row => row.element.key === JSON.stringify(path));
		assert.ok(input.tree.selectionIndex >= 0);
		input.sourceSelection.select(input.tree.rows[input.tree.selectionIndex].element.sourceIdentity);
	};
	select(selection); pane.focus();
	const target = pane.commandTarget;
	const execute = (command: EditorCommandId, application: boolean) => {
		if (application) f.editor.commands.execute(command, target); else inputFocus.executeCommand(command, target);
	};
	const draft = (text: string) => {
		inputFocus.executeCommand('aem.edit', target);
		const field = f.editor.textTarget, focused = inputFocus.target;
		assert.ok(field !== undefined && focused?.edit !== undefined && focused !== target);
		assert.equal(field.replaceText(0, field.readText().text.length, text), true);
		return focused;
	};
	const installed = () => {
		f.sources.aemSourceApplications.set(`-1\0${resourceIdentityKey(resource)}`, {
			image: f.sources.currentBlua32Media.system!, rom: f.sources.systemRom.bytes, installedSource: source, failed: false,
		});
		t.mock.method(f.editor.actorLab, 'canInteract', () => true);
		const audition = t.mock.method(f.editor.actorLab, 'auditionEvent', () => undefined);
		assert.equal(getTextFileRuntimeSourceStatus(f.sources, model), 'applied');
		return audition;
	};
	return { ...f, input, model, pane, target, select, execute, draft, installed };
}

for (const application of [false, true]) for (const valid of [false, true])
	test(`AEM ${application ? 'application' : 'native'} Remove accepts only the owning valid draft (${valid})`, t => {
		const f = fixture(t), draft = f.draft(valid ? 'music' : '[');
		f.execute('aem.remove', application);
		assert.equal(draft.edit!.pending, !valid);
		assert.equal(f.model.buffer.getText(), valid ? SOURCE.replace('channel: sfx, ', '') : SOURCE);
		if (valid) assert.equal(f.input.sourceSelection.selected, undefined);
	});

for (const application of [false, true])
	test(`AEM ${application ? 'application' : 'native'} accepted scalar replacement preserves its source occurrence through Remove`, t => {
		const f = fixture(t, SOURCE, ['values', 0]), selected = f.input.sourceSelection.selected!;
		f.draft('  "longer accepted scalar"  ');
		f.execute('aem.remove', application);
		assert.equal(selected.property, undefined);
		assert.equal(f.model.buffer.getText(), SOURCE.replace('[first, second]', '[ second]'));
	});

for (const application of [false, true])
	test(`AEM ${application ? 'application' : 'native'} selected A to B to A during acceptance never revives the captured action`, t => {
		const f = fixture(t); f.draft('music');
		let fired = false;
		t.after(f.model.onDidChangeContent(() => {
			if (fired) return; fired = true;
			f.select(['events', 'second', 'channel']); f.select(['events', 'first', 'channel']);
		}));
		f.execute('aem.remove', application);
		assert.equal(fired, true);
		assert.equal(f.model.buffer.getText(), SOURCE.replace('channel: sfx', 'channel: music'));
	});

for (const application of [false, true])
	test(`AEM ${application ? 'application' : 'native'} retired same-input attachment cannot execute after draft acceptance`, t => {
		const f = fixture(t); f.draft('music');
		let fired = false;
		t.after(f.model.onDidChangeContent(() => {
			if (fired) return; fired = true;
			f.firstGroup.openEditor(f.firstInput); f.firstGroup.activate(f.input.id);
		}));
		f.execute('aem.remove', application);
		assert.equal(fired, true);
		assert.equal(f.model.buffer.getText(), SOURCE.replace('channel: sfx', 'channel: music'));
	});

test('AEM source correspondence follows an authored sequence item across insertion, not its old index', t => {
	const f = fixture(t, SOURCE, ['values', 1]), selected = f.input.sourceSelection.selected!, revision = f.input.sourceSelection.revision;
	f.model.pushEditOperations([{ offset: SOURCE.indexOf('first, second'), deleteLength: 0, text: 'inserted, ' }]);
	projectAemSource(f.input);
	assert.equal(f.input.sourceSelection.selected, selected); assert.equal(f.input.sourceSelection.revision, revision);
	assert.deepEqual(selected.property!.path, ['values', 2]);
	inputFocus.executeCommand('aem.remove', f.target);
	assert.equal(f.model.buffer.getText(), SOURCE.replace('[first, second]', '[inserted, first]'));
});

test('AEM key removal and Undo do not revive an old native occurrence', t => {
	const f = fixture(t), selected = f.input.sourceSelection.selected!;
	const offset = SOURCE.indexOf('channel: sfx');
	f.model.pushEditOperations([{ offset, deleteLength: 'channel: sfx, '.length, text: '' }]); projectAemSource(f.input);
	assert.equal(f.input.sourceSelection.selected, undefined); assert.equal(selected.property, undefined);
	f.model.undo(); projectAemSource(f.input);
	assert.equal(f.input.sourceSelection.selected, undefined);
	f.select(['events', 'first', 'channel']); assert.notEqual(f.input.sourceSelection.selected, selected);
});

test('AEM typed scalar acceptance does not overwrite a reentrant explicit selection', t => {
	const f = fixture(t, SOURCE, ['values', 0]), property = f.input.sourceSelection.selected!.property!;
	let fired = false;
	t.after(f.model.onWillChangeContent(() => {
		if (fired) return; fired = true;
		f.select(['values', 1]);
	}));
	f.editor.aemEditor.applyPropertyEdit(f.input, property, createStructuredValueEdit(SOURCE, 'yaml', property.node, '"replacement"'));
	assert.equal(f.input.sourceSelection.selected!.property!.value, 'second');
});

for (const application of [false, true]) for (const valid of [false, true])
	test(`AEM ${application ? 'application' : 'native'} Apply opens its chooser through ordinary ${valid ? 'valid' : 'invalid'} blur`, t => {
		const f = fixture(t), draft = f.draft(valid ? 'music' : '[');
		f.execute('aem.apply', application);
		assert.equal(draft.edit!.pending, false);
		assert.equal(f.model.buffer.getText(), valid ? SOURCE.replace('channel: sfx', 'channel: music') : SOURCE);
		assert.equal(f.firstPart.quickInput.visible, true); assert.equal(f.input.applying, false);
	});

for (const application of [false, true]) for (const valid of [false, true])
	test(`AEM ${application ? 'application' : 'native'} auditions the captured installed event after ordinary ${valid ? 'valid' : 'invalid'} blur`, async t => {
		const f = fixture(t), audition = f.installed(), draft = f.draft(valid ? 'music' : '[');
		f.execute('aem.testEvent', application);
		assert.equal(draft.edit!.pending, false); assert.equal(f.firstPart.quickInput.visible, true);
		assert.equal(getTextFileRuntimeSourceStatus(f.sources, f.model), valid ? 'pending' : 'applied');
		await f.firstPart.quickInput.accept();
		assert.equal(audition.mock.callCount(), 1);
		assert.deepEqual(audition.mock.calls[0].arguments, [f.firstGroup, -1, 'first']);
	});

for (const change of ['select', 'rename', 'delete', 'image', 'rom'] as const)
	test(`AEM installed audition is revoked by ${change}, not retargeted after the chooser`, async t => {
		const f = fixture(t), audition = f.installed();
		inputFocus.executeCommand('aem.testEvent', f.target); assert.equal(f.firstPart.quickInput.visible, true);
		if (change === 'select') { f.select(['events', 'second']); f.select(['events', 'first']); }
		else if (change === 'rename') f.model.pushEditOperations([{ offset: SOURCE.indexOf('first:'), deleteLength: 5, text: 'renamed' }]);
		else if (change === 'delete') f.model.pushEditOperations([{ offset: SOURCE.indexOf('  first:'), deleteLength: '  first: { channel: sfx, rules: [] }\n'.length, text: '' }]);
		else if (change === 'image') f.sources.currentBlua32Media = { ...f.sources.currentBlua32Media, system: { ...f.sources.currentBlua32Media.system! } };
		else f.sources.systemRom = { ...f.sources.systemRom, bytes: f.sources.systemRom.bytes.slice() };
		await f.firstPart.quickInput.accept();
		assert.equal(audition.mock.callCount(), 0);
	});

for (const application of [false, true])
	test(`AEM ${application ? 'application' : 'native'} Add writes in submit before focus-return source callbacks`, async t => {
		const f = fixture(t, SOURCE, ['values']);
		f.execute('aem.add', application); assert.equal(f.firstPart.quickInput.visible, true);
		f.firstPart.quickInput.field.replaceText(0, f.firstPart.quickInput.field.text.length, '"added"');
		let observed = false;
		t.after(inputFocus.onDidChangeTarget(() => {
			if (inputFocus.target !== f.target) return;
			observed = true;
			assert.ok(f.model.buffer.getText().includes('"added"'));
			f.model.pushEditOperations([{ offset: 0, deleteLength: 0, text: '# focus return\n' }]);
		}));
		await f.firstPart.quickInput.accept();
		assert.equal(observed, true);
		assert.ok(f.model.buffer.getText().startsWith('# focus return\n' + SOURCE.slice(0, SOURCE.indexOf('values:'))));
		projectAemSource(f.input);
		assert.deepEqual(f.input.document!.toJS().values, ['first', 'second', 'added']);
	});

test('AEM source A with explicit receiver B consumes only A and leaves B draft pending', t => {
	const f = fixture(t), path = 'receiver.aem.yaml';
	f.sources.catalog.registerTextSources(f.sources.systemContextId, [{ type: 'aem', resid: 'receiver', source_path: path }]);
	const resource = f.sources.catalog.resolveResource({ contextId: f.sources.systemContextId, path })!;
	const model = editorTextModelService.retain(resource, 'aem', SOURCE), input = new AemEditorInput(model);
	f.secondGroup.openEditor(input); f.update();
	input.tree.selectionIndex = input.tree.rows.findIndex(row => row.element.key === '["events","second","channel"]');
	input.sourceSelection.select(input.tree.rows[input.tree.selectionIndex].element.sourceIdentity);
	const target = f.secondGroup.panes.activePane!.commandTarget;
	inputFocus.executeCommand('aem.edit', target);
	const draft = inputFocus.target!, field = f.editor.textTarget!;
	assert.ok(draft.edit !== undefined); field.replaceText(0, field.readText().text.length, '[');
	f.editor.commands.execute('aem.remove', f.target, undefined, target);
	assert.equal(f.model.buffer.getText(), SOURCE.replace('channel: sfx, ', ''));
	assert.equal(model.buffer.getText(), SOURCE); assert.equal(draft.edit.pending, true); assert.equal(inputFocus.target, draft);
});

test('AEM typed scalar Undo publishes new intent and maps through a second source write', t => {
	const f = fixture(t, SOURCE, ['values', 0]);
	f.draft('"accepted"'); assert.equal(inputFocus.commitEdit(f.target.commandContext.scope), true);
	const revision = f.input.sourceSelection.revision;
	let fired = false;
	t.after(f.model.onDidChangeContent(event => {
		if (event.kind !== 'undo' || fired) return; fired = true;
		f.model.pushEditOperations([{ offset: 0, deleteLength: 0, text: '# after Undo\n' }]);
	}));
	inputFocus.executeCommand('undo', f.target); projectAemSource(f.input);
	assert.equal(fired, true); assert.ok(f.input.sourceSelection.revision > revision);
	assert.equal(f.input.sourceSelection.selected!.property!.value, 'first');
	assert.deepEqual(f.input.sourceSelection.selected!.property!.path, ['values', 0]);
	assert.equal(f.model.buffer.getText(), '# after Undo\n' + SOURCE);
	// Undo the independent write, then Redo it: neither is a semantic re-selection.
	f.model.undo(); projectAemSource(f.input);
	assert.equal(f.input.sourceSelection.selected!.property!.value, 'first');
	f.model.redo(); projectAemSource(f.input);
	assert.equal(f.input.sourceSelection.selected!.property!.value, 'first');
});

test('AEM typed scalar history restores its authored occurrence through actual Undo and Redo commands', t => {
	const f = fixture(t, SOURCE, ['values', 0]);
	f.draft('"accepted"'); assert.equal(inputFocus.commitEdit(f.target.commandContext.scope), true);
	const selected = f.input.sourceSelection.selected!, revision = f.input.sourceSelection.revision;
	inputFocus.executeCommand('undo', f.target); projectAemSource(f.input);
	assert.equal(f.input.sourceSelection.selected!.property!.value, 'first');
	assert.ok(f.input.sourceSelection.revision > revision);
	inputFocus.executeCommand('redo', f.target); projectAemSource(f.input);
	assert.equal(f.input.sourceSelection.selected!.property!.value, '"accepted"');
	assert.notEqual(f.input.sourceSelection.selected, selected);
});

test('AEM installed audition cannot revive a key renamed and restored without an intervening projection', async t => {
	const f = fixture(t), audition = f.installed();
	inputFocus.executeCommand('aem.testEvent', f.target); assert.equal(f.firstPart.quickInput.visible, true);
	const revision = f.input.sourceSelection.eventRevision, offset = SOURCE.indexOf('first:') + 1;
	f.model.pushEditOperations([{ offset, deleteLength: 2, text: 'ro' }]);
	f.model.pushEditOperations([{ offset, deleteLength: 2, text: 'ir' }]);
	assert.equal(f.model.buffer.getText(), SOURCE);
	assert.ok(f.input.sourceSelection.eventRevision > revision, 'event-key mutations retire installed audition authority at the source apply boundary');
	await f.firstPart.quickInput.accept();
	assert.equal(audition.mock.callCount(), 0);
});

for (const text of ['x', ' '] as const)
	test(`AEM installed audition distinguishes key suffix ${text === 'x' ? 'name' : 'trivia'} edits without projection`, async t => {
		const f = fixture(t), audition = f.installed();
		inputFocus.executeCommand('aem.testEvent', f.target); assert.equal(f.firstPart.quickInput.visible, true);
		const revision = f.input.sourceSelection.eventRevision, offset = SOURCE.indexOf('first:') + 'first'.length;
		f.model.pushEditOperations([{ offset, deleteLength: 0, text }]);
		f.model.pushEditOperations([{ offset, deleteLength: text.length, text: '' }]);
		assert.equal(f.model.buffer.getText(), SOURCE);
		if (text === 'x') assert.ok(f.input.sourceSelection.eventRevision > revision);
		else assert.equal(f.input.sourceSelection.eventRevision, revision, 'key-adjacent YAML trivia does not change the native event token');
		await f.firstPart.quickInput.accept();
		assert.equal(audition.mock.callCount(), text === 'x' ? 0 : 1);
	});

test('AEM installed audition belongs to its written events section even without an intervening projection', async t => {
	const f = fixture(t), audition = f.installed();
	inputFocus.executeCommand('aem.testEvent', f.target); assert.equal(f.firstPart.quickInput.visible, true);
	const revision = f.input.sourceSelection.eventRevision, offset = SOURCE.indexOf('events:');
	f.model.pushEditOperations([{ offset, deleteLength: 'events'.length, text: 'other' }]);
	f.model.pushEditOperations([{ offset, deleteLength: 'other'.length, text: 'events' }]);
	assert.equal(f.model.buffer.getText(), SOURCE); assert.ok(f.input.sourceSelection.eventRevision > revision);
	await f.firstPart.quickInput.accept(); assert.equal(audition.mock.callCount(), 0);
});

test('AEM installed audition survives unrelated authored keys and value-only source changes', async t => {
	const f = fixture(t), audition = f.installed();
	inputFocus.executeCommand('aem.testEvent', f.target); assert.equal(f.firstPart.quickInput.visible, true);
	const revision = f.input.sourceSelection.eventRevision;
	f.model.pushEditOperations([{ offset: SOURCE.indexOf('values:'), deleteLength: 'values'.length, text: 'unrelated' }]);
	const source = f.model.buffer.getText();
	f.model.pushEditOperations([{ offset: source.indexOf('sfx'), deleteLength: 'sfx'.length, text: 'music' }]);
	assert.equal(f.input.sourceSelection.eventRevision, revision);
	await f.firstPart.quickInput.accept(); assert.equal(audition.mock.callCount(), 1);
});

import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { setImmediate } from 'node:timers/promises';
import { HeadlessClipboard } from '../../hosts/node/headless/clipboard';
import { KeyInputEvent, KeyModifier } from '../../hosts/common/input/text';
import { IdeMicrotaskQueue } from '../../ide/common/microtask_queue';
import { editorRuntimeState } from '../../ide/editor/common/runtime_state';
import { editorTextModelService } from '../../ide/editor/model/model_service';
import { EditorTextModel } from '../../ide/editor/model/text_model';
import { setFieldText } from '../../ide/editor/ui/inline/text_field';
import { configureFontVariant } from '../../ide/editor/ui/view/configuration';
import { editorViewState } from '../../ide/editor/ui/view/state';
import { inputFocus } from '../../ide/input/focus';
import { createLuaSourceRegistry, registerLuaSourceRecord } from '../../ide/runtime/source_registry';
import { RuntimeIdeState } from '../../ide/workbench/state';
import { CodeEditorInput } from '../../ide/workbench/contrib/code_editor/editor_input';
import { captureCodeEditorView } from '../../ide/workbench/contrib/code_editor/view_snapshot';
import type { ProjectContentEntry } from '../../ide/workbench/contrib/resources/content_index';
import { ScenePrimaryClient } from '../../ide/workbench/contrib/scene_editor/primary_client';
import { selectSceneOutlineRow } from '../../ide/workbench/contrib/scene_editor/outline';
import type { QuickPickItem } from '../../ide/workbench/services/quick_input/provider';
import { resolveLuaTextFileModel } from '../../ide/workbench/services/working_copy/text_file_model';
import { clearWorkspaceSourceCaches } from '../../ide/workspace/cache';
import { closeWorkspaceRecords, openWorkspaceRecords, workspaceRecords } from '../../ide/workspace/records';
import { createHostFrameFixture } from '../helpers/host_frame';
import { createTestRuntimeSourceState, createTestSourceOnlyLuaRecord, TEST_CARTRIDGE_CONTEXT_IDS } from '../helpers/runtime_sources';
import { MemoryWorkspaceFiles } from '../helpers/workspace_files';

const FIRST = `local scenes = require('cartlib/world/scene_library')
scenes.register('same', { objects = { { member_id = 'first', definition_id = 'actor', spatial = { local_transform = { 1, 0, 0, 0, 1, 0, 0, 0, 1, 1, 2, 3 } } } } })
scenes.register('same', { objects = { { member_id = 'second', definition_id = 'actor' } } })
`;
const SECOND = `local scenes = require('cartlib/world/scene_library')
scenes.register('same', { objects = { { member_id = 'other file', definition_id = 'actor' } } })
`;

/** Actual workbench composition starts without a document part, input or canonical text model. */
async function fixture(t: TestContext) {
	configureFontVariant('tiny'); editorViewState.viewportWidth = 800; editorViewState.viewportHeight = 320;
	const system = createLuaSourceRegistry('fixture/system', ''), project = createLuaSourceRegistry('fixture/project', '');
	registerLuaSourceRecord(system, createTestSourceOnlyLuaRecord('cartlib/world/scene_library.lua', 'return {}', 'cartlib/world/scene_library.lua'));
	for (const [path, text] of [['first.lua', FIRST], ['second.lua', SECOND], ['notes.lua', 'local value = 1\nreturn missing_from_notes\n']]) {
		registerLuaSourceRecord(project, createTestSourceOnlyLuaRecord(path, text, `fixture/project/${path}`));
	}
	system.can_boot_from_source = true; project.can_boot_from_source = true;
	const sources = createTestRuntimeSourceState(system, [project, null], 0), host = createHostFrameFixture();
	const files = new MemoryWorkspaceFiles('workspace'); await openWorkspaceRecords(files);
	const unused = (): never => { throw new Error('Choosing authored Main work does not request external execution.'); };
	const ide = new RuntimeIdeState(host.runtime, host.presenter, { capture: unused }, unused,
		{ measureDisplay: () => ({ left: 0, top: 0, width: 800, height: 320 }) },
		host.input, host.audio, host.tasks, host.execution, host.rewind, host.clock, new HeadlessClipboard(),
		new IdeMicrotaskQueue(), { log() {} }, 0.3, { width: 800, height: 320 }, sources, new Map(), unused, unused, unused,
		undefined, undefined, workspaceRecords!);
	const editor = ide.editor, update = () => editor.update(0);
	const press = (code: string, modifiers = KeyModifier.none) => {
		editor.dispatchKey(new KeyInputEvent(code, modifiers)); editor.dispatchKey(new KeyInputEvent(code, modifiers, false, false)); update();
	};
	const model = (path: string) => resolveLuaTextFileModel(editorTextModelService, sources.catalog,
		sources.catalog.resolveResource({ contextId: TEST_CARTRIDGE_CONTEXT_IDS[0], path })!);
	editorRuntimeState.active = true; editor.interaction.setActive(true); update(); editor.editorParts.main.activeGroup.focus();
	t.after(async () => {
		inputFocus.setTarget(null); await editor.shutdown(); await closeWorkspaceRecords(); clearWorkspaceSourceCaches();
		host.audio.dispose(); host.input.dispose(); editorTextModelService.clear(); sources.catalog.dispose();
	});
	return { ide, editor, host, sources, files, project, update, press, model, contextId: TEST_CARTRIDGE_CONTEXT_IDS[0] };
}

type Fixture = Awaited<ReturnType<typeof fixture>>;
type ScenePick = QuickPickItem & { entry: Extract<ProjectContentEntry, { kind: 'scene' }> };

function openPicker(f: Fixture) {
	f.editor.commands.execute('sceneEditor.chooseMain', inputFocus.admittedTarget);
	const picker = f.editor.quickInput;
	assert.equal(picker.visible, true); assert.equal(picker.inputBox, false);
	return picker;
}

/** Selection addresses the retained authored occurrence, never a matching display name. */
async function choose(f: Fixture, path: string, occurrence = 0) {
	const picker = f.editor.quickInput;
	const item = (picker.model.items as readonly ScenePick[]).filter(item => item.entry.ownerResource.path === path)[occurrence];
	assert.ok(item !== undefined);
	picker.model.list.selectionIndex = picker.model.list.rows.findIndex(row => row.item === item);
	assert.ok(picker.model.list.selectionIndex >= 0);
	await picker.accept(); await setImmediate(); f.update();
	return item.entry;
}

test('Main Scene chooser is available before any document or working copy exists', async t => {
	const f = await fixture(t);
	assert.equal(f.editor.editorParts.documents.length, 0);
	assert.ok(f.editor.editorParts.groups.every(group => group.model.tabs.length === 0));
	assert.deepEqual([...editorTextModelService.models], []);
	assert.equal(f.editor.commands.isEnabled('sceneEditor.chooseMain', inputFocus.target), true);
	f.editor.commands.execute('sceneEditor.chooseMain', inputFocus.target);
	assert.equal(f.editor.quickInput.visible, true); assert.equal(f.editor.quickInput.inputBox, false);
	assert.equal(f.editor.mainWorkspace.primary, undefined);
	assert.deepEqual([...editorTextModelService.models], []);
	const choices = f.editor.quickInput.model.items as readonly ScenePick[];
	assert.equal(choices.length, 3);
	assert.equal(new Set(choices.map(item => `${item.entry.ownerResource.path}:${item.entry.range.start}`)).size, 3);
	f.press('Escape');
	assert.equal(f.editor.quickInput.visible, false); assert.equal(f.editor.mainWorkspace.primary, undefined);
	assert.deepEqual([...editorTextModelService.models], []); assert.equal(f.files.records.size, 0);
});

test('Main chooser selects an exact same-name occurrence without showing Files or creating document tabs', async t => {
	const f = await fixture(t), panel = f.editor.resourcePanel;
	panel.show(); f.update();
	await Promise.all(f.ide.directories!.roots.map(root => f.ide.directories!.resolve(root, ''))); f.update();
	const root = panel.files.tree.roots.find(node => node.element.kind === 'root' && node.element.contextId === f.contextId)!;
	if (root.collapsed) panel.toggleFileDisclosure(root);
	const file = panel.files.tree.rows.findIndex(node => node.element.kind === 'file' && node.element.path === 'first.lua');
	assert.ok(file >= 0); panel.setSelectionIndex(file); panel.hide(); f.editor.editorParts.main.activeGroup.focus();
	const reading = panel.serialize(), groups = [...f.editor.editorParts.groups];
	openPicker(f); assert.deepEqual([...editorTextModelService.models], []);
	const selected = await choose(f, 'first.lua', 1), client = f.editor.mainWorkspace.primary;
	assert.ok(client instanceof ScenePrimaryClient);
	assert.ok(client.consumer.workingCopy === editorTextModelService.get(selected.ownerResource));
	assert.ok(client.consumer.subject === client.consumer.document!.scenes[1]);
	assert.deepEqual(client.consumer.subject!.range, selected.definition.range);
	assert.deepEqual(f.editor.editorParts.groups, groups); assert.equal(f.editor.editorParts.documents.length, 0);
	assert.ok(groups.every(group => group.model.tabs.length === 0));
	assert.deepEqual(panel.serialize(), reading); assert.equal(panel.isVisible(), false);
	assert.equal([...editorTextModelService.models].length, 1); assert.equal(f.files.records.size, 0);
});

test('Main chooser consumes current canonical memory rather than the packaged registry source', async t => {
	const f = await fixture(t), model = f.model('first.lua');
	model.pushEditOperations([{ offset: model.buffer.length, deleteLength: 0,
		text: "scenes.register('same', { objects = { { member_id = 'new in memory', definition_id = 'actor' } } })\n" }]);
	const source = model.buffer.getText(), version = model.version;
	openPicker(f); await choose(f, 'first.lua', 2);
	const client = f.editor.mainWorkspace.primary; assert.ok(client instanceof ScenePrimaryClient);
	assert.ok(client.consumer.workingCopy === model && client.consumer.subject === client.consumer.document!.scenes[2]);
	assert.equal(model.buffer.getText(), source); assert.equal(model.version, version); assert.equal(model.dirty, true);
	assert.equal(f.project.path2lua['first.lua'].src, FIRST); assert.equal(f.files.records.size, 0);
});

for (const save of [false, true]) test(`choosing another file uses Main's existing dirty release ${save ? 'Save' : 'Cancel'} decision`, async t => {
	const f = await fixture(t); openPicker(f); await choose(f, 'first.lua');
	const previous = f.editor.mainWorkspace.primary; assert.ok(previous instanceof ScenePrimaryClient);
	const model = previous.consumer.workingCopy;
	model.pushEditOperations([{ offset: 0, deleteLength: 0, text: '-- Main edit\n' }]); f.update();
	const source = model.buffer.getText(), release = t.mock.method(f.editor.editorParts.closeController, 'release');
	openPicker(f); await choose(f, 'second.lua');
	assert.ok(f.editor.mainWorkspace.primary === previous);
	const releasing = release.mock.calls[0].result;
	f.press(save ? 'Enter' : 'Escape'); await releasing; await setImmediate(); f.update();
	if (save) {
		const operation = f.ide.textFileSaves.latestOperation(model); assert.ok(operation !== undefined);
		assert.equal((await operation.completion).status, 'saved');
		assert.equal(f.files.records.get('fixture/project/first.lua')!.contents, source); assert.equal(model.dirty, false);
		const current = f.editor.mainWorkspace.primary; assert.ok(current instanceof ScenePrimaryClient && current !== previous);
		assert.equal(current.consumer.workingCopy.identity.path, 'second.lua');
		assert.equal(previous.consumer.isCurrent, false);
	} else {
		assert.ok(f.editor.mainWorkspace.primary === previous); assert.equal(previous.consumer.isCurrent, true);
		assert.equal(model.dirty, true); assert.equal(model.buffer.getText(), source); assert.equal(model.canUndo, true);
		assert.equal(f.files.records.size, 0);
	}
	assert.ok(f.editor.editorParts.groups.every(group => group.model.tabs.length === 0));
});

test('a background canonical Save preserves the chooser query and exact occurrence selection', async t => {
	const f = await fixture(t), model = f.model('notes.lua');
	model.pushEditOperations([{ offset: 0, deleteLength: 0, text: '-- background Save\n' }]);
	const picker = openPicker(f);
	setFieldText(picker.field, 'same', true); picker.update();
	const selected = (picker.model.items as readonly ScenePick[]).find(item => item.entry.ownerResource.path === 'second.lua')!;
	picker.model.list.selectionIndex = picker.model.list.rows.findIndex(row => row.item === selected);
	assert.ok(picker.model.list.selectionIndex >= 0);
	assert.equal((await f.ide.textFileSaves.save(model).completion).status, 'saved');
	assert.equal(picker.visible, true); assert.equal(picker.field.text, 'same');
	assert.ok(picker.model.list.rows[picker.model.list.selectionIndex].item === selected);
	assert.equal(f.editor.mainWorkspace.primary, undefined);
	await picker.accept(); await setImmediate(); f.update();
	const client = f.editor.mainWorkspace.primary; assert.ok(client instanceof ScenePrimaryClient);
	assert.equal(client.consumer.workingCopy.identity.path, 'second.lua');
});

test('a chooser invoked from a real pending Main Details field starts its source lease after ordinary blur', async t => {
	const f = await fixture(t); openPicker(f); await choose(f, 'first.lua');
	const client = f.editor.mainWorkspace.primary; assert.ok(client instanceof ScenePrimaryClient);
	selectSceneOutlineRow(client.view.hierarchy, 1); client.hierarchy.update(); client.details.update();
	const field = client.details.control.controls[0], model = client.consumer.workingCopy, version = model.version;
	assert.equal(field.field.focusTarget.focus(), true); setFieldText(field.field, '123', true);
	assert.equal(field.pending, true);
	const picker = openPicker(f);
	assert.equal(field.pending, false); assert.equal(model.version, version + 1); assert.equal(model.dirty, true);
	assert.ok(model.buffer.getText().includes('0, 0, 1, 123,'));
	for (const item of picker.model.items as readonly ScenePick[]) assert.equal(f.editor.projectContent.isCurrent(item.entry), true);
	f.press('Escape');
	assert.ok(f.editor.mainWorkspace.primary === client && client.consumer.isCurrent);
	assert.equal(model.dirty, true); assert.equal(f.files.records.size, 0);
});

test('choosing Main work preserves an existing document and the actual Problems reading subject', async t => {
	const f = await fixture(t), notes = new CodeEditorInput(f.model('notes.lua'));
	const part = f.editor.editorParts.createDocument(); part.activeGroup.openEditor(notes); f.update();
	notes.context.view.cursorRow = 1; notes.context.view.cursorColumn = 3;
	notes.context.view.selectionAnchor = { row: 0, column: 2 };
	f.ide.diagnostics.computePending();
	const problems = f.editor.problems, main = f.editor.mainWorkspace;
	assert.ok(problems.getDiagnostics().length > 0, 'the synthetic unresolved reference produces real source diagnostics');
	main.setActivityVisible(true); f.update(); problems.setSelectionIndex(0); main.focusActivity();
	const selected = problems.selectedDiagnostic, scroll = problems.getScrollIndex(), activity = main.activities.selectedId;
	const reading = captureCodeEditorView(notes), inputs = [...part.activeGroup.model.tabs], files = f.editor.resourcePanel.serialize();
	openPicker(f); await choose(f, 'first.lua', 1); f.ide.diagnostics.computePending();
	assert.ok(main.primary instanceof ScenePrimaryClient); assert.equal(main.activities.selectedId, activity);
	assert.equal(main.regionLayout.activityVisible, true);
	const current = problems.selectedDiagnostic; assert.ok(current !== undefined && selected !== undefined);
	assert.ok(current.model === selected.model); assert.equal(current.row, selected.row); assert.equal(current.startColumn, selected.startColumn);
	assert.equal(problems.getScrollIndex(), scroll); assert.deepEqual(captureCodeEditorView(notes), reading);
	assert.deepEqual(part.activeGroup.model.tabs, inputs); assert.ok(part.activeGroup.model.activeTab === notes);
	assert.deepEqual(f.editor.resourcePanel.serialize(), files);
	assert.equal(f.editor.editorParts.documents.length, 1);
});

for (const retirement of ['content', 'catalog', 'models', 'editor'] as const) {
	test(`an open Main chooser retires on ${retirement} changes without admitting a Scene`, async t => {
		const f = await fixture(t), notes = f.model('notes.lua'), picker = openPicker(f);
		switch (retirement) {
			case 'content': notes.pushEditOperations([{ offset: 0, deleteLength: 0, text: '-- changed after catalog capture\n' }]); break;
			case 'catalog': registerLuaSourceRecord(f.project, createTestSourceOnlyLuaRecord('added.lua', 'return {}', 'fixture/project/added.lua')); break;
			case 'models': editorTextModelService.clear(); break;
			case 'editor': await f.editor.shutdown(); break;
		}
		assert.equal(picker.visible, false); assert.equal(f.editor.mainWorkspace.primary, undefined);
		assert.ok(f.editor.editorParts.groups.every(group => group.model.tabs.length === 0));
		assert.equal(f.files.records.size, 0);
	});
}

for (const invalidation of ['foreground', 'origin', 'canonical source'] as const) {
	test(`picker return cannot select Main after a newer ${invalidation} takes authority`, async t => {
		const f = await fixture(t), origin = inputFocus.admittedTarget!;
		const notes = new CodeEditorInput(f.model('notes.lua')), part = f.editor.editorParts.createDocument();
		part.activeGroup.openEditor(notes); f.editor.editorParts.main.activeGroup.focus(); f.update();
		const picker = openPicker(f);
		t.after(picker.field.focusTarget.onDidBlur(() => {
			if (invalidation === 'foreground') part.activeGroup.focus();
			else if (invalidation === 'origin') origin.scope.retireContext();
			else {
				const resource = f.sources.catalog.resolveResource({ contextId: f.contextId, path: 'first.lua' })!;
				editorTextModelService.retain(resource, 'lua', 'return {}\n', FIRST, null);
			}
		}));
		await choose(f, 'first.lua', 1);
		assert.equal(f.editor.mainWorkspace.primary, undefined); assert.equal(picker.visible, false);
		assert.deepEqual(part.activeGroup.model.tabs, [notes]); assert.equal(notes.workingCopy.dirty, false);
		if (invalidation === 'foreground') assert.ok(f.editor.editorParts.activePart === part && part.scope.contains(inputFocus.admittedTarget!.scope));
		if (invalidation === 'canonical source') {
			const model = editorTextModelService.get({ contextId: f.contextId, path: 'first.lua' })!;
			assert.equal(model.buffer.getText(), 'return {}\n'); assert.equal(model.dirty, true);
		} else assert.equal(editorTextModelService.get({ contextId: f.contextId, path: 'first.lua' }), undefined);
	});
}

test('canonical model admission cannot steal back foreground published by its own observers', async t => {
	const f = await fixture(t), notes = new CodeEditorInput(f.model('notes.lua')), part = f.editor.editorParts.createDocument();
	part.activeGroup.openEditor(notes); f.editor.editorParts.main.activeGroup.focus(); f.update(); openPicker(f);
	t.after(editorTextModelService.onDidAddModel(model => { if (model.identity.path === 'first.lua') part.activeGroup.focus(); }));
	await choose(f, 'first.lua');
	assert.equal(f.editor.mainWorkspace.primary, undefined);
	assert.ok(f.editor.editorParts.activePart === part && part.scope.contains(inputFocus.admittedTarget!.scope));
	assert.equal(editorTextModelService.get({ contextId: f.contextId, path: 'first.lua' })!.buffer.getText(), FIRST);
	assert.deepEqual(part.activeGroup.model.tabs, [notes]);
});

for (const boundary of ['canonical model', 'content index'] as const) {
	test(`a newer Main clear during ${boundary} admission wins without changing the native Source origin`, async t => {
		const f = await fixture(t);
		if (boundary === 'content index') registerLuaSourceRecord(f.project,
			createTestSourceOnlyLuaRecord('unopened.lua', 'return {}\n', 'fixture/project/unopened.lua'));
		openPicker(f); await choose(f, 'first.lua');
		const previous = f.editor.mainWorkspace.primary; assert.ok(previous instanceof ScenePrimaryClient);
		assert.equal(previous.consumer.workingCopy.dirty, false);
		const notes = new CodeEditorInput(f.model('notes.lua')), group = f.editor.editorParts.main.activeGroup;
		group.openEditor(notes); f.update(); group.focus();
		const origin = inputFocus.admittedTarget!, picker = openPicker(f);
		let clearing: Promise<boolean> | undefined, sameFocus = false;
		const clear = () => {
			clearing = f.editor.mainWorkspace.clearPrimary(f.editor.editorParts.closeController, origin);
			sameFocus = inputFocus.admittedTarget === origin;
		};
		if (boundary === 'canonical model') {
			t.after(editorTextModelService.onDidAddModel(model => { if (model.identity.path === 'second.lua') clear(); }));
		} else {
			const release = f.editor.projectContent.onDidChange(() => { release(); clear(); }); t.after(release);
			t.after(picker.field.focusTarget.onDidBlur(() => {
				const resource = f.sources.catalog.resolveResource({ contextId: f.contextId, path: 'unopened.lua' })!;
				editorTextModelService.retain(resource, 'lua',
					"local scenes = require('cartlib/world/scene_library')\nscenes.register('after return', { objects = {} })\n", 'return {}\n', null);
			}));
		}
		await choose(f, 'second.lua');
		assert.ok(clearing !== undefined); const cleared = await clearing;
		assert.ok(f.editor.mainWorkspace.primary === undefined, 'the older picker must not publish after a newer Main clear intent');
		assert.equal(cleared, true);
		assert.equal(sameFocus, true, 'the new Main intent is independent of native focus authority');
		assert.ok(inputFocus.admittedTarget === origin);
		assert.deepEqual(group.model.tabs, [notes]); assert.ok(group.model.activeTab === notes);
	});
}

for (const replacement of ['model', 'context'] as const) {
	test(`an accepted Main replacement cannot publish a ${replacement} generation retired during its dirty close prompt`, async t => {
		const f = await fixture(t); openPicker(f); await choose(f, 'first.lua');
		const previous = f.editor.mainWorkspace.primary; assert.ok(previous instanceof ScenePrimaryClient);
		const current = previous.consumer.workingCopy;
		current.pushEditOperations([{ offset: 0, deleteLength: 0, text: '-- keep the current Main source\n' }]); f.update();
		const source = current.buffer.getText(), release = t.mock.method(f.editor.editorParts.closeController, 'release');
		openPicker(f); await choose(f, 'second.lua');
		assert.ok(f.editor.mainWorkspace.primary === previous);
		const target = editorTextModelService.get({ contextId: f.contextId, path: 'second.lua' })!;
		if (replacement === 'model') {
			const next = new EditorTextModel(target.resource, 'lua', target.buffer.getText(), editorTextModelService.history);
			const admission = editorTextModelService.replace([...editorTextModelService.models].map(model => model === target ? next : model));
			admission.publish(); admission.dispose(); assert.equal(admission.isCurrent(), true);
			assert.ok(editorTextModelService.get(target.identity) === next);
		} else {
			const context = f.sources.catalog.getContext(f.contextId), registry = createLuaSourceRegistry(context.projectRootPath, '');
			for (const record of context.luaSources.records) registerLuaSourceRecord(registry, { ...record });
			f.sources.catalog.contexts.delete(context.id); f.sources.catalog.admitContext({ ...context, luaSources: registry });
		}
		f.press('Enter'); assert.equal(await release.mock.calls[0].result, false); await setImmediate(); f.update();
		assert.ok(f.editor.mainWorkspace.primary === previous);
		assert.equal(current.buffer.getText(), source); assert.equal(current.dirty, true);
		assert.equal(f.ide.textFileSaves.latestOperation(current), undefined); assert.equal(f.files.records.size, 0);
	});
}

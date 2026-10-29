import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { KeyInputEvent, KeyModifier } from '../../hosts/common/input/text';
import { PointerButton } from '../../hosts/common/input/pointer_event';
import { getActiveIdeThemeVariant, setIdeThemeVariant } from '../../ide/common/constants';
import { editorRuntimeState } from '../../ide/editor/common/runtime_state';
import { editorTextModelService } from '../../ide/editor/model/model_service';
import { getCodeAreaBounds } from '../../ide/editor/ui/view/view';
import { inputFocus } from '../../ide/input/focus';
import { pointerCapture } from '../../ide/input/pointer/capture';
import { ScenePrimaryClient } from '../../ide/workbench/contrib/scene_editor/primary_client';
import { selectSceneOutlineRow } from '../../ide/workbench/contrib/scene_editor/outline';
import { CodeEditorInput } from '../../ide/workbench/contrib/code_editor/editor_input';
import { resolveLuaTextFileModel } from '../../ide/workbench/services/working_copy/text_file_model';
import { TextQuickPickProvider } from '../../ide/workbench/services/quick_input/text_provider';
import type { QuickPickProvider } from '../../ide/workbench/services/quick_input/provider';
import { initializeWorkspaceStorage, restoreWorkspaceStorageSession } from '../../ide/workbench/workspace/storage';
import type { WorkspaceAutosavePayload } from '../../ide/workbench/workspace/models';
import { MemoryStorage } from '../../ide/workspace/memory_storage';
import { joinWorkspacePaths } from '../../ide/workspace/path';
import { WORKSPACE_METADATA_DIR, WORKSPACE_STATE_FILE } from '../../ide/workspace/records';
import { SCENE_VIEWPORT_SOURCE } from '../fixtures/studio/scene_viewport';
import { createActualSourcePanes } from '../helpers/source_panes';
import { MemoryWorkspaceFiles } from '../helpers/workspace_files';

/** A real admitted source write keeps shutdown in its asynchronous drain phase. */
async function fixture(t: TestContext, writeFailure?: Error) {
	const release = Promise.withResolvers<void>(), writing = Promise.withResolvers<void>();
	// Release before the actual Studio fixture's cleanup, including when an assertion fails.
	t.after(() => release.resolve());
	const f = createActualSourcePanes(t, false, [['scene.lua', SCENE_VIEWPORT_SOURCE],
		['cartlib/world/scene_library.lua', 'return {}']]);
	const files = new MemoryWorkspaceFiles('workspace'), context = f.sources.catalog.getContext(f.sources.systemContextId).admission;
	const session = 'shutdown-admission';
	const restored = await initializeWorkspaceStorage(new MemoryStorage(), f.host.clock, context, session,
		f.sources.catalog, files, { log() {} });
	await restoreWorkspaceStorageSession(f.editor, f.sources.catalog, f.ide.debugger, restored);
	const model = f.firstInput.workingCopy, write = files.write.bind(files);
	t.mock.method(files, 'write', async (path, record, overwrite) => {
		if (path === model.resource.sourceFilePath) {
			writing.resolve(); await release.promise;
			if (writeFailure !== undefined) throw writeFailure;
		}
		await write(path, record, overwrite);
	});
	const save = async (fromCommand = false) => {
		model.pushEditOperations([{ offset: 0, deleteLength: 0, text: '-- accepted Save\n' }]);
		if (fromCommand) { f.first.focus(); f.editor.commands.execute('save', f.first.commandTarget); }
		const operation = fromCommand ? f.ide.textFileSaves.latestOperation(model)! : f.ide.textFileSaves.save(model);
		await writing.promise;
		return operation;
	};
	const statePath = joinWorkspacePaths(context.projectRoot, WORKSPACE_METADATA_DIR, 'studio', context.id, session, WORKSPACE_STATE_FILE);
	return { ...f, files, model, save, release, writing: writing.promise, statePath };
}

test('shutdown withdraws native and physical Source authority synchronously while accepted Save drains', { timeout: 10000 }, async t => {
	const f = await fixture(t), save = await f.save();
	f.first.focus();
	assert.ok(f.editor.textTarget !== undefined && f.editor.clipboardTarget !== undefined);
	const bounds = getCodeAreaBounds(f.first.code), x = bounds.textLeft, y = bounds.codeTop + f.first.code.lineHeight / 2;
	f.editor.dispatchPointer({ x, y, buttons: PointerButton.Primary, pressedButtons: PointerButton.Primary,
		releasedButtons: 0, cancelledButtons: 0, modifiers: KeyModifier.none, spaceDown: false, timestamp: f.host.clock.now() });
	assert.equal(pointerCapture.active, true);
	const target = inputFocus.admittedTarget!, generation = target.scope.contextGeneration;
	assert.equal(f.editor.commands.isEnabled('undo', target), true);
	const source = f.model.buffer.getText(), version = f.model.version;
	const stopping = f.editor.shutdown();
	assert.equal(f.ide.textFileSaves.acceptingSaves, false);
	assert.ok(f.editor.textTarget === undefined, 'shutdown ends the native text attachment before awaiting accepted writes');
	assert.ok(f.editor.clipboardTarget === undefined);
	assert.equal(pointerCapture.active, false);
	assert.ok(target.scope.contextGeneration > generation);
	assert.ok(inputFocus.admittedTarget === null);
	assert.equal(f.editor.commands.isEnabled('undo', target), false);
	f.editor.commands.execute('undo', target);
	f.editor.dispatchKey(new KeyInputEvent('Delete', KeyModifier.none));
	f.editor.dispatchKey(new KeyInputEvent('Delete', KeyModifier.none, false, false));
	f.editor.dispatchPointer({ x, y, buttons: 0, pressedButtons: 0, releasedButtons: PointerButton.Primary,
		cancelledButtons: 0, modifiers: KeyModifier.none, spaceDown: false, timestamp: f.host.clock.now() });
	assert.equal(f.model.version, version); assert.equal(f.model.buffer.getText(), source);
	assert.ok(f.ide.models.get(f.model.identity) === f.model && f.model.dirty);
	assert.equal(save.result, undefined);
	f.release.resolve();
	assert.equal((await save.completion).status, 'saved');
	await stopping;
	assert.equal(f.files.records.get(f.model.resource.sourceFilePath!)!.contents, source);
});

test('shutdown retains Main and document mementos plus unsaved canonical source until final recovery', { timeout: 10000 }, async t => {
	const f = await fixture(t);
	const scene = resolveLuaTextFileModel(editorTextModelService, f.sources.catalog,
		f.sources.catalog.resolveResource({ contextId: f.sources.systemContextId, path: 'scene.lua' })!);
	const document = f.ide.sceneSources.get(scene);
	assert.equal(await f.editor.openSceneInMain(scene, { document, sourceVersion: scene.version, scene: document.scenes[0] }, f.first.commandTarget), true);
	const primary = f.editor.mainWorkspace.primary; assert.ok(primary instanceof ScenePrimaryClient);
	selectSceneOutlineRow(primary.view.hierarchy, 1); primary.hierarchy.update(); primary.details.update();
	scene.pushEditOperations([{ offset: 0, deleteLength: 0, text: '-- unsaved Main source\n' }]);
	f.editor.editorParts.main.activeGroup.openEditor(new CodeEditorInput(scene), { pinned: true });
	f.update(); f.first.focus();
	const save = await f.save(); f.update();
	const invocation = primary.commandTarget.getCommand('sceneEditor.removeMember')!.capture!()!;
	assert.equal(invocation.isEnabled(), true);
	const main = f.editor.mainWorkspace.serialize(), parts = f.editor.editorParts.serialize(f.editor.editorInputSerializers);
	const source = scene.buffer.getText();
	const stopping = f.editor.shutdown();
	assert.equal(invocation.isEnabled(), false);
	assert.ok(f.ide.models.get(scene.identity) === scene && scene.dirty);
	assert.equal(scene.buffer.getText(), source);
	assert.deepEqual(f.editor.mainWorkspace.serialize().primary, main.primary);
	assert.deepEqual(f.editor.editorParts.serialize(f.editor.editorInputSerializers), parts);
	f.release.resolve(); await save.completion; await stopping;
	const recovered: WorkspaceAutosavePayload = JSON.parse(f.files.records.get(f.statePath)!.contents);
	assert.deepEqual(recovered.mainWorkspace.primary, main.primary);
	assert.deepEqual(recovered.editorParts, JSON.parse(JSON.stringify(parts)));
	assert.deepEqual(recovered.dirtyFiles.map(entry => ({ contextId: entry.contextId, path: entry.path })), [scene.identity]);
	assert.ok([...f.files.records.values()].some(record => record.contents === source));
});

test('shutdown retires pending document openings and local picker catalogs before accepted Save finishes', { timeout: 10000 }, async t => {
	const f = await fixture(t), save = await f.save();
	const resolved = Promise.withResolvers<void>(), catalog = Promise.withResolvers<QuickPickProvider>();
	t.after(() => resolved.resolve());
	const candidate = new CodeEditorInput(f.model);
	let disposed = 0, accepted = 0;
	candidate.onWillDispose(() => { disposed++; });
	const opening = f.secondGroup.openResolvedEditor(async () => { await resolved.promise; return candidate; });
	f.first.focus();
	f.firstPart.quickInput.pick('Choose source', '', catalog.promise, () => { accepted++; });
	assert.equal(f.firstPart.quickInput.visible, true); assert.equal(f.firstPart.quickInput.busy, true);
	const stopping = f.editor.shutdown();
	assert.equal(f.firstPart.quickInput.visible, false);
	resolved.resolve();
	catalog.resolve(new TextQuickPickProvider([{ label: 'source', description: '', detail: '' }]));
	assert.ok(await opening === undefined);
	assert.equal(disposed, 1); assert.equal(accepted, 0);
	assert.ok(f.secondGroup.model.activeTab === f.secondInput && !f.secondGroup.model.contains(candidate));
	assert.equal(f.firstPart.quickInput.visible, false);
	assert.ok(f.editor.textTarget === undefined && inputFocus.admittedTarget === null);
	assert.equal(save.result, undefined);
	f.release.resolve(); await save.completion; await stopping;
});

test('shutdown has one retained operation and cannot be resumed while accepted Save drains', { timeout: 10000 }, async t => {
	const f = await fixture(t), save = await f.save(); f.first.focus();
	const stopping = f.editor.shutdown();
	assert.ok(f.editor.shutdown() === stopping, 'repeated shutdown joins the same frontend retirement');
	f.editor.activate();
	assert.ok(f.editor.textTarget === undefined && f.editor.clipboardTarget === undefined);
	assert.ok(inputFocus.admittedTarget === null);
	assert.equal(save.result, undefined);
	f.release.resolve(); await save.completion; await stopping;
	assert.ok(f.editor.shutdown() === stopping);
});

test('retirement callbacks join the admitted shutdown without reopening or activating a document', { timeout: 10000 }, async t => {
	const f = await fixture(t), save = await f.save(); f.first.focus();
	const origin = inputFocus.admittedTarget!, inputs = [...f.firstGroup.model.tabs];
	let joined: Promise<void> | undefined;
	t.after(inputFocus.workbenchScope.onDidRetireContext(() => {
		joined = f.editor.shutdown();
		f.editor.commands.execute('home', origin);
		f.editor.activate();
	}));
	const stopping = f.editor.shutdown();
	assert.ok(joined === stopping);
	assert.equal(f.firstGroup.model.tabs.length, inputs.length);
	assert.ok(f.firstGroup.model.tabs.every((input, index) => input === inputs[index]));
	assert.ok(f.firstGroup.model.activeTab === f.firstInput);
	assert.ok(f.editor.textTarget === undefined && inputFocus.admittedTarget === null);
	assert.equal(save.result, undefined);
	f.release.resolve(); await save.completion; await stopping;
});

test('shutdown retires the actual menubar popup opened without a document invoker', { timeout: 10000 }, async t => {
	const f = await fixture(t), save = await f.save();
	inputFocus.setTarget(null);
	f.editor.menubar.toggleFocus();
	assert.equal(f.editor.menubar.expanded, true); assert.equal(f.editor.contextMenu.visible, true);
	assert.ok(f.editor.contextMenu.invocationOrigin === null && inputFocus.admittedTarget === f.editor.contextMenu.focusTarget);
	const inputs = [...f.firstGroup.model.tabs], version = f.model.version;
	const stopping = f.editor.shutdown();
	assert.equal(f.editor.menubar.expanded, false); assert.equal(f.editor.contextMenu.visible, false);
	assert.ok(inputFocus.admittedTarget === null);
	f.editor.dispatchKey(new KeyInputEvent('Enter', KeyModifier.none));
	f.editor.dispatchKey(new KeyInputEvent('Enter', KeyModifier.none, false, false));
	assert.equal(f.firstGroup.model.tabs.length, inputs.length);
	assert.ok(f.firstGroup.model.tabs.every((input, index) => input === inputs[index]));
	assert.equal(f.model.version, version); assert.equal(save.result, undefined);
	f.release.resolve(); await save.completion; await stopping;
});

test('failed accepted Save and a late root picker catalog error cannot revive UI or discard recovery source', { timeout: 10000 }, async t => {
	const failure = new Error('Workspace write failed'), f = await fixture(t, failure), save = await f.save(true);
	const source = f.model.buffer.getText(), version = f.model.version, catalog = Promise.withResolvers<QuickPickProvider>();
	inputFocus.setTarget(null);
	f.editor.quickInput.pick('Choose source', '', catalog.promise, () => assert.fail('a retired root picker cannot accept'));
	assert.equal(f.editor.quickInput.visible, true); assert.equal(f.editor.quickInput.busy, true);
	assert.ok(f.editor.quickInput.invocationOrigin === null && inputFocus.admittedTarget === f.editor.quickInput.field.focusTarget);
	const stopping = f.editor.shutdown();
	assert.equal(f.editor.quickInput.visible, false); assert.ok(inputFocus.admittedTarget === null);
	catalog.reject(new Error('Catalog request failed'));
	await Promise.resolve();
	assert.equal(f.editor.quickInput.visible, false); assert.equal(f.editor.contextMenu.visible, false);
	assert.ok(f.editor.textTarget === undefined && f.editor.clipboardTarget === undefined);
	assert.equal(f.model.version, version); assert.equal(f.model.buffer.getText(), source); assert.equal(f.model.dirty, true);
	f.release.resolve();
	const result = await save.completion;
	assert.equal(result.status, 'failed'); assert.ok(result.status === 'failed' && result.error === failure);
	await stopping;
	assert.equal(f.editor.quickInput.visible, false); assert.equal(f.editor.contextMenu.visible, false);
	assert.ok(inputFocus.admittedTarget === null);
	assert.equal(f.files.records.has(f.model.resource.sourceFilePath!), false);
	const recovered: WorkspaceAutosavePayload = JSON.parse(f.files.records.get(f.statePath)!.contents);
	assert.deepEqual(recovered.dirtyFiles.map(entry => ({ contextId: entry.contextId, path: entry.path })), [f.model.identity]);
	assert.ok([...f.files.records.values()].some(record => record.contents === source));
});

test('root retirement callbacks cannot request a theme change, dirty-source prompt or confirmed action', { timeout: 10000 }, async t => {
	const f = await fixture(t), save = await f.save(), theme = getActiveIdeThemeVariant(), runtimeTheme = editorRuntimeState.themeVariant;
	t.after(() => { setIdeThemeVariant(theme); editorRuntimeState.themeVariant = runtimeTheme; });
	let requestedTheme: string | undefined, promptVisible: boolean | undefined, confirmed: Promise<boolean> | undefined;
	t.after(inputFocus.workbenchScope.onDidRetireContext(() => {
		f.editor.commands.requestAction({ action: 'theme-toggle' });
		requestedTheme = getActiveIdeThemeVariant();
		f.editor.commands.requestAction({ action: 'reboot' });
		promptVisible = f.editor.actionPrompt.visible;
		confirmed = f.editor.commands.executeConfirmedAction({ action: 'theme-toggle' }, false);
	}));
	const stopping = f.editor.shutdown();
	assert.equal(requestedTheme, theme); assert.equal(promptVisible, false);
	assert.equal(await confirmed, false);
	assert.equal(getActiveIdeThemeVariant(), theme); assert.equal(editorRuntimeState.themeVariant, runtimeTheme);
	assert.equal(f.editor.actionPrompt.visible, false); assert.equal(save.result, undefined);
	f.release.resolve(); await save.completion; await stopping;
});

test('Save and Hide stops preparing later writes after shutdown while its already accepted Save completes', { timeout: 10000 }, async t => {
	const f = await fixture(t), second = f.secondInput.workingCopy;
	f.model.pushEditOperations([{ offset: 0, deleteLength: 0, text: '-- first accepted write\n' }]);
	second.pushEditOperations([{ offset: 0, deleteLength: 0, text: '-- second remains unsaved\n' }]);
	const firstSource = f.model.buffer.getText(), secondSource = second.buffer.getText();
	const action = f.editor.commands.executeConfirmedAction({ action: 'close' }, true);
	await f.writing;
	const save = f.ide.textFileSaves.latestOperation(f.model)!;
	assert.ok(save !== undefined && save.result === undefined);
	assert.ok(f.ide.textFileSaves.latestOperation(second) === undefined);
	const stopping = f.editor.shutdown();
	assert.ok(f.ide.models.get(second.identity) === second && second.dirty);
	f.release.resolve();
	assert.equal((await save.completion).status, 'saved');
	assert.equal(await action, false);
	assert.ok(f.ide.textFileSaves.latestOperation(second) === undefined);
	await stopping;
	assert.equal(f.files.records.get(f.model.resource.sourceFilePath!)!.contents, firstSource);
	assert.equal(f.files.records.has(second.resource.sourceFilePath!), false);
	const recovered: WorkspaceAutosavePayload = JSON.parse(f.files.records.get(f.statePath)!.contents);
	assert.deepEqual(recovered.dirtyFiles.map(entry => ({ contextId: entry.contextId, path: entry.path })), [second.identity]);
	assert.ok([...f.files.records.values()].some(record => record.contents === secondSource));
});

import assert from 'node:assert/strict';
import test from 'node:test';
import { setImmediate } from 'node:timers/promises';
import { inputFocus } from '../../ide/input/focus';
import { editorTextModelService } from '../../ide/editor/model/model_service';
import { ValueInput } from '../../ide/editor/ui/inline/value_input';
import { INTEGER_INPUT_FORMAT } from '../../ide/editor/ui/inline/integer_input';
import { openWorkspaceRecords, closeWorkspaceRecords } from '../../ide/workspace/records';
import { clearWorkspaceSourceCaches } from '../../ide/workspace/cache';
import { CodeEditorPane } from '../../ide/workbench/contrib/code_editor/editor_pane';
import { CodeEditorInput } from '../../ide/workbench/contrib/code_editor/editor_input';
import { SceneEditorInput } from '../../ide/workbench/contrib/scene_editor/editor_input';
import { selectSceneOutlineRow } from '../../ide/workbench/contrib/scene_editor/outline';
import { resolveLuaCodeEditorInput } from '../../ide/workbench/ui/code_tab/io';
import { createActualSourcePanes } from '../helpers/source_panes';
import { MemoryWorkspaceFiles } from '../helpers/workspace_files';
import { SCENE_VIEWPORT_SOURCE } from '../fixtures/studio/scene_viewport';
import { PointerButton } from '../../hosts/common/input/pointer_event';
import { KeyModifier } from '../../hosts/common/input/text';
import { getProblemsPanelBounds } from '../../ide/workbench/contrib/problems/panel/layout';
import { problemsPanel } from '../../ide/workbench/contrib/problems/panel/controller';
import { resolveLuaTextFileModel } from '../../ide/workbench/services/working_copy/text_file_model';
import { api } from '../../ide/runtime/overlay_api';
import { COLOR_FRAME } from '../../ide/common/constants';
import { captureCodeEditorView } from '../../ide/workbench/contrib/code_editor/view_snapshot';
import { HostErrorInput } from '../../ide/workbench/contrib/host_error/editor_input';

test('Focus Main changes actual paint and hit order while document inputs and local sessions remain retained', t => {
	const f = createActualSourcePanes(t, true), parts = f.editor.editorParts, main = parts.main;
	const model = f.firstInput.workingCopy, text = model.buffer.getText(), version = model.version;
	const cycles = f.host.runtime.machine.scheduler.nowCycles;
	main.activeGroup.openEditor(new CodeEditorInput(model)); f.update();
	const mainInput = main.activeGroup.model.activeTab!, mainPane = main.activeGroup.panes.activePane!;
	f.second.focus();
	f.secondPart.quickInput.input('', '', 'retained document draft', async value => value, () => {});
	f.first.focus();
	const paintOrder: string[] = [], drawMain = mainPane.draw.bind(mainPane), drawFirst = f.first.draw.bind(f.first);
	t.mock.method(mainPane, 'draw', () => { paintOrder.push('main'); drawMain(); });
	t.mock.method(f.first, 'draw', () => { paintOrder.push('document'); drawFirst(); });
	const fill = api.fill_rect.bind(api), mainChrome = main.surface;
	t.mock.method(api, 'fill_rect', (left, top, right, bottom, z, color) => {
		const bounds = mainChrome.getBounds();
		if (left === bounds.left && top === bounds.top && right === bounds.right && bottom === bounds.bottom
			&& color === COLOR_FRAME) paintOrder.push('main background');
		fill(left, top, right, bottom, z, color);
	});
	// This overlap is the paint/hit stacking contract, not a particular window position.
	const firstBounds = f.firstGroup.panes.contentBounds, mainBounds = main.activeGroup.panes.contentBounds;
	const x = (Math.max(firstBounds.left, mainBounds.left) + Math.min(firstBounds.right, mainBounds.right)) / 2;
	const y = (Math.max(firstBounds.top, mainBounds.top) + Math.min(firstBounds.bottom, mainBounds.bottom)) / 2;
	assert.ok(f.editor.surfaces.hitTest(x, y) === f.firstGroup.paneSurface);
	f.paint();
	assert.deepEqual(paintOrder.filter(event => event !== 'main background'), ['main', 'document']);
	f.editor.commands.execute('window.focusMain', f.first.commandTarget); f.update();
	paintOrder.length = 0; f.paint();
	assert.ok(parts.activePart === main); assert.ok(inputFocus.target === mainPane.commandTarget);
	assert.ok(f.editor.surfaces.hitTest(x, y) === main.activeGroup.paneSurface);
	assert.deepEqual(paintOrder.filter(event => event !== 'main background'), ['document', 'main']);
	assert.ok(paintOrder.indexOf('document') < paintOrder.lastIndexOf('main background'),
		'foreground Main client paints its opaque background after the covered document');
	assert.ok(paintOrder.lastIndexOf('main background') < paintOrder.indexOf('main'));
	f.firstPart.focus(); f.update(); paintOrder.length = 0; f.paint();
	assert.ok(f.editor.surfaces.hitTest(x, y) === f.firstGroup.paneSurface);
	assert.deepEqual(paintOrder.filter(event => event !== 'main background'), ['main', 'document']);
	assert.ok(f.firstGroup.model.activeTab === f.firstInput && f.firstGroup.panes.activePane === f.first);
	assert.ok(f.secondGroup.model.activeTab === f.secondInput && f.secondGroup.panes.activePane === f.second);
	assert.ok(main.activeGroup.model.activeTab === mainInput && main.activeGroup.panes.activePane === mainPane);
	assert.equal(f.secondPart.quickInput.visible, true); assert.equal(f.secondPart.quickInput.field.text, 'retained document draft');
	assert.ok(mainInput.kind === 'code_editor' && mainInput.workingCopy === model && f.secondInput.workingCopy === model);
	assert.equal(model.buffer.getText(), text); assert.equal(model.version, version);
	assert.equal(f.host.runtime.machine.scheduler.nowCycles, cycles);
});

test('document placement transitions retain its exact Source view, local picker and canonical source authority', t => {
	const f = createActualSourcePanes(t, true), part = f.firstPart, window = part.window!;
	const input = f.firstInput, pane = f.first, model = input.workingCopy;
	const text = model.buffer.getText(), version = model.version, cycles = f.host.runtime.machine.scheduler.nowCycles;
	const requested = { ...window.model.requestedBounds }, surface = window.surface, client = window.clientSurface;
	part.quickInput.input('', '', 'retained placement draft', async value => value, () => {});
	for (const placement of ['left', 'right', 'maximized', 'normal'] as const) {
		window.setPlacement(placement); f.update();
		assert.equal(window.model.placement, placement);
		assert.ok(part.activeGroup.model.activeTab === input && part.activeGroup.panes.activePane === pane);
		assert.ok(window.surface === surface && window.clientSurface === client);
		assert.equal(surface!.retired, false); assert.equal(client!.retired, false);
		assert.ok(inputFocus.target === part.quickInput.field.focusTarget);
		assert.equal(part.quickInput.visible, true); assert.equal(part.quickInput.field.text, 'retained placement draft');
		assert.deepEqual(window.model.requestedBounds, requested);
	}
	assert.strictEqual(f.secondInput.workingCopy, model);
	assert.equal(model.buffer.getText(), text); assert.equal(model.version, version);
	assert.equal(f.host.runtime.machine.scheduler.nowCycles, cycles);
});

test('the workspace window picker activates actual MRU parts and restores their retained local input', async t => {
	const f = createActualSourcePanes(t), parts = f.editor.editorParts;
	parts.main.activeGroup.openEditor(new CodeEditorInput(f.firstInput.workingCopy)); f.update();
	const mainPane = parts.main.activeGroup.panes.activePane!, model = f.firstInput.workingCopy;
	const text = model.buffer.getText(), version = model.version, cycles = f.host.runtime.machine.scheduler.nowCycles;
	f.first.focus();
	f.firstPart.quickInput.input('', '', 'retained first draft', async value => value, () => {});
	f.second.focus();
	f.editor.commands.execute('window.showAll', f.second.commandTarget);
	const picker = f.editor.quickInput;
	assert.equal(picker.visible, true); assert.ok(inputFocus.target === picker.field.focusTarget);
	assert.equal(picker.model.list.rows.length, parts.mostRecentlyActive.length);
	picker.model.list.selectionIndex = parts.mostRecentlyActive.indexOf(f.firstPart);
	f.key('Enter');
	assert.equal(picker.visible, false); assert.ok(parts.activePart === f.firstPart);
	assert.ok(inputFocus.target === f.firstPart.quickInput.field.focusTarget);
	assert.equal(f.firstPart.quickInput.field.text, 'retained first draft');
	f.editor.commands.execute('window.showAll', f.firstPart.quickInput.field.focusTarget);
	picker.model.list.selectionIndex = parts.mostRecentlyActive.indexOf(parts.main);
	f.key('Enter');
	assert.equal(picker.visible, false); assert.ok(parts.activePart === parts.main);
	assert.ok(inputFocus.target === mainPane.commandTarget);
	assert.ok(f.firstGroup.model.activeTab === f.firstInput && f.firstGroup.panes.activePane === f.first);
	assert.ok(f.secondGroup.model.activeTab === f.secondInput && f.secondGroup.panes.activePane === f.second);
	assert.equal(f.firstPart.quickInput.visible, true);
	f.editor.commands.execute('window.showAll', mainPane.commandTarget);
	assert.equal(picker.visible, true);
	assert.equal(await parts.close(f.secondPart), true);
	assert.equal(picker.visible, false, 'retiring any listed part retires the picker generation instead of retaining stale part rows');
	assert.equal(f.firstPart.quickInput.visible, true);
	assert.equal(model.buffer.getText(), text); assert.equal(model.version, version);
	assert.equal(f.host.runtime.machine.scheduler.nowCycles, cycles);
});

test('the window picker can foreground a closing document and its actual local decision', async t => {
	const f = createActualSourcePanes(t), parts = f.editor.editorParts;
	f.firstInput.workingCopy.pushEditOperations([{ offset: 0, deleteLength: 0, text: '-- retained close draft\n' }]);
	f.second.focus();
	const closing = parts.close(f.firstPart);
	assert.equal(f.firstPart.closing, true); assert.equal(f.firstPart.actionPrompt.visible, true);
	f.editor.commands.execute('window.showAll', f.second.commandTarget);
	const picker = f.editor.quickInput;
	assert.equal(picker.model.list.rows.length, parts.mostRecentlyActive.length);
	picker.model.list.selectionIndex = parts.mostRecentlyActive.indexOf(f.firstPart);
	f.key('Enter');
	assert.equal(picker.visible, false); assert.ok(parts.activePart === f.firstPart);
	assert.ok(inputFocus.target === f.firstPart.actionPrompt.focusTarget);
	f.key('Escape');
	assert.equal(await closing, false); assert.equal(f.firstPart.retired, false);
	assert.ok(f.firstGroup.model.activeTab === f.firstInput);
	assert.equal(f.firstInput.workingCopy.dirty, true);
});

test('New Editor Window creates an independent empty document without moving or executing the invoking Source', t => {
	const f = createActualSourcePanes(t), parts = f.editor.editorParts, model = f.firstInput.workingCopy;
	const text = model.buffer.getText(), version = model.version, cycles = f.host.runtime.machine.scheduler.nowCycles;
	f.first.focus(); f.editor.commands.execute('window.newEditor', f.first.commandTarget); f.update();
	const created = parts.activePart;
	assert.equal(parts.documents.length, 3); assert.ok(created !== parts.main && created !== f.firstPart && created !== f.secondPart);
	assert.equal(created.activeGroup.model.tabs.length, 0); assert.equal(created.activeGroup.panes.activePane, null);
	assert.equal(created.window!.visible, true); assert.ok(inputFocus.target === created.activeGroup.focusTarget);
	assert.ok(f.firstGroup.model.activeTab === f.firstInput && f.firstGroup.panes.activePane === f.first);
	assert.equal(model.buffer.getText(), text); assert.equal(model.version, version);
	assert.equal(f.host.runtime.machine.scheduler.nowCycles, cycles);
});

test('Focus Main activates and foregrounds its empty container without leaving focus in a covered document', t => {
	const f = createActualSourcePanes(t), parts = f.editor.editorParts, main = parts.main;
	f.first.focus();
	assert.equal(main.activeGroup.model.activeTab, null);
	const mainBounds = main.activeGroup.panes.contentBounds, documentBounds = f.firstGroup.panes.contentBounds;
	// Empty Main must own the same overlapping hit region as an occupied Main.
	const x = (Math.max(mainBounds.left, documentBounds.left) + Math.min(mainBounds.right, documentBounds.right)) / 2;
	const y = (Math.max(mainBounds.top, documentBounds.top) + Math.min(mainBounds.bottom, documentBounds.bottom)) / 2;
	assert.ok(f.editor.surfaces.hitTest(x, y) === f.firstGroup.paneSurface);
	f.editor.commands.execute('window.focusMain', f.first.commandTarget); f.update();
	assert.ok(parts.activePart === main);
	assert.ok(inputFocus.target === main.activeGroup.focusTarget);
	assert.ok(f.editor.surfaces.hitTest(x, y) === main.activeGroup.paneSurface);
	f.key('Enter');
	assert.equal(main.activeGroup.model.activeTab?.kind, 'home', 'the empty container admits its actual Home-opening keyboard behavior');
	assert.ok(f.firstGroup.model.activeTab === f.firstInput && f.firstGroup.panes.activePane === f.first);
});

test('Open Editor in New Window copies Source view state while retaining one canonical model and edit history', async t => {
	const f = createActualSourcePanes(t), parts = f.editor.editorParts, model = f.firstInput.workingCopy;
	parts.main.activeGroup.openEditor(new CodeEditorInput(f.secondInput.workingCopy)); f.update();
	const mainInput = parts.main.activeGroup.model.activeTab, mainPane = parts.main.activeGroup.panes.activePane;
	const original = model.buffer.getText(), cycles = f.host.runtime.machine.scheduler.nowCycles;
	f.first.focus();
	assert.equal(f.first.code.focusTarget.textInput!.replaceText(0, 0, '-- shared window draft\n'), true);
	const view = f.firstInput.context.view;
	view.cursorRow = 1; view.cursorColumn = 7; view.selectionAnchor = { row: 1, column: 0 };
	const selection = captureCodeEditorView(f.firstInput), draft = model.buffer.getText(), version = model.version;
	assert.equal(f.editor.commands.isEnabled('window.copyEditor', f.first.commandTarget), true);
	f.editor.commands.execute('window.copyEditor', f.first.commandTarget); f.update();
	const document = parts.activePart, input = document.activeGroup.model.activeTab, pane = document.activeGroup.panes.activePane!;
	assert.equal(parts.documents.length, 3); assert.ok(document !== f.firstPart && document !== f.secondPart && document !== parts.main);
	assert.ok(input instanceof CodeEditorInput && input !== f.firstInput);
	assert.ok(pane !== f.first && pane.commandTarget !== f.first.commandTarget);
	assert.ok(input.context.view !== view && input.workingCopy === model);
	assert.deepEqual(captureCodeEditorView(input), selection);
	assert.ok(parts.main.activeGroup.model.activeTab === mainInput && parts.main.activeGroup.panes.activePane === mainPane);
	assert.ok(f.firstGroup.model.activeTab === f.firstInput && f.firstGroup.panes.activePane === f.first);
	assert.equal(document.activeGroup.model.previewTab, null, 'the copied view is explicitly retained, not a replaceable preview');
	assert.equal(model.buffer.getText(), draft); assert.equal(model.version, version); assert.equal(model.canUndo, true);
	input.context.view.cursorColumn++;
	assert.deepEqual(captureCodeEditorView(f.firstInput), selection, 'the two controls retain independent reading positions');
	assert.equal(await parts.close(f.firstPart), true);
	assert.equal(f.firstPart.actionPrompt.visible, false, 'closing one copy is not a last-working-copy dirty close');
	assert.ok(document.activeGroup.model.activeTab === input && document.activeGroup.panes.activePane === pane);
	assert.ok(editorTextModelService.get(model.resource) === model); assert.equal(model.dirty, true);
	f.editor.commands.execute('undo', pane.commandTarget); f.update();
	assert.equal(model.buffer.getText(), original); assert.equal(model.canRedo, true);
	assert.ok(parts.main.activeGroup.model.activeTab === mainInput && parts.main.activeGroup.panes.activePane === mainPane);
	assert.equal(f.host.runtime.machine.scheduler.nowCycles, cycles);
});

test('Open Editor in New Window is unavailable for an actual host diagnostic without view-copy capability', t => {
	const f = createActualSourcePanes(t), diagnostic = new HostErrorInput('fixture host diagnostic');
	f.firstGroup.openEditor(diagnostic); f.update();
	const pane = f.firstGroup.panes.activePane!, documents = f.editor.editorParts.documents.length;
	assert.equal(f.editor.commands.isEnabled('window.copyEditor', pane.commandTarget), false);
	f.editor.commands.execute('window.copyEditor', pane.commandTarget);
	assert.equal(f.editor.editorParts.documents.length, documents);
	assert.ok(f.firstGroup.model.activeTab === diagnostic && f.firstGroup.panes.activePane === pane);
});

test('Scene and Source use real sibling groups while canonical edits, Save and Source close retain the authored view', async t => {
	const files = new MemoryWorkspaceFiles(); await openWorkspaceRecords(files);
	const f = createActualSourcePanes(t, false, [
		['authoring_scene.lua', SCENE_VIEWPORT_SOURCE], ['cartlib/world/scene_library.lua', ''],
	]);
	t.after(async () => { await closeWorkspaceRecords(); clearWorkspaceSourceCaches(); });
	const parts = f.editor.editorParts, cycles = f.host.runtime.machine.scheduler.nowCycles;
	parts.clear();
	const sceneGroup = parts.main.activeGroup;
	const resource = f.sources.catalog.resolveResource({ contextId: f.sources.systemContextId, path: 'authoring_scene.lua' })!;
	f.editor.sceneEditor.openResource(sceneGroup, resource); f.update();
	const scene = sceneGroup.model.activeTab;
	assert.ok(scene instanceof SceneEditorInput);
	selectSceneOutlineRow(scene.view.hierarchy, 1); f.update();
	const selection = { ...scene.view.authoring.selectionRange }, scenePane = sceneGroup.panes.activePane!;
	const sourceGroup = parts.splitGroup(sceneGroup, 'right');
	assert.ok(sourceGroup);
	sourceGroup.openEditor(resolveLuaCodeEditorInput(f.sources.catalog, resource)); f.update();
	const source = sourceGroup.panes.getPane('code_editor')!;
	assert.ok(source instanceof CodeEditorPane);
	assert.ok(source.input.workingCopy === scene.workingCopy);
	f.editor.commands.execute('editor.source', scenePane.commandTarget); await setImmediate(); f.update();
	assert.equal(parts.activeGroup, sourceGroup);
	assert.equal(parts.documents.length, 0, 'ordinary Source navigation does not invent a floating host');
	assert.equal(sceneGroup.model.activeTab, scene); assert.equal(sceneGroup.panes.activePane, scenePane);
	assert.deepEqual(scene.view.authoring.selectionRange, selection);
	const model = source.input.workingCopy, offset = model.buffer.getText().indexOf('x = 11') + 4;
	assert.equal(source.code.focusTarget.textInput!.replaceText(offset, offset + 2, '17'), true);
	f.update();
	assert.equal(scene.view.details.properties[0].descriptor.value, 17, 'the sibling Scene inspector consumes the same edited working copy');
	assert.equal(scene.isDirty(), true); assert.equal(source.input.isDirty(), true);
	f.editor.commands.execute('save', source.commandTarget); await setImmediate(); f.update();
	assert.equal(model.dirty, false); assert.equal(scene.isDirty(), false);
	assert.ok([...files.records.values()].some(record => record.contents === model.buffer.getText()), 'Save publishes exact authored source through the shared file owner');
	assert.equal(await sourceGroup.close(source.input.id), true);
	assert.equal(sourceGroup.model.tabs.length, 0);
	assert.equal(sceneGroup.model.activeTab, scene); assert.equal(sceneGroup.panes.activePane, scenePane);
	assert.deepEqual(scene.view.authoring.selectionRange, selection);
	assert.equal(editorTextModelService.get(resource), model);
	assert.equal(f.host.runtime.machine.scheduler.nowCycles, cycles);
});

test('local dirty close preserves an invalid sibling draft and revokes asynchronous openings across Cancel and retirement', async t => {
	const f = createActualSourcePanes(t), model = f.firstInput.workingCopy;
	f.first.code.focusTarget.focus(); f.first.code.focusTarget.textInput!.replaceText(6, 11, 'changed');
	let accepted = 7;
	const draft = new ValueInput(f.second.commandTarget, INTEGER_INPUT_FORMAT, value => { accepted = value; });
	t.after(() => draft.dispose());
	draft.setValue(accepted); draft.layout(f.secondGroup.panes.contentBounds);
	draft.field.focusTarget.focus(); draft.field.focusTarget.textInput!.replaceText(0, 1, '-');
	assert.equal(draft.pending, true);
	const candidate = Promise.withResolvers<CodeEditorInput>();
	const lateOpen = f.firstGroup.openResolvedEditor(() => candidate.promise);
	const closing = f.editor.editorParts.close(f.firstPart);
	assert.equal(f.firstPart.actionPrompt.visible, true, 'a sibling draft cannot block this local close decision');
	assert.equal(draft.pending, true); assert.equal(draft.error, ''); assert.equal(accepted, 7);
	assert.ok(inputFocus.target === draft.field.focusTarget, 'a background close does not blur the sibling');
	assert.ok(f.firstGroup.model.activeTab === f.firstInput); assert.equal(f.firstPart.window!.visible, true);
	const refused = new CodeEditorInput(f.secondInput.workingCopy);
	let refusedDisposed = false; refused.onWillDispose(() => { refusedDisposed = true; });
	assert.ok(f.firstGroup.openEditor(refused) === undefined); assert.equal(refusedDisposed, true);
	f.firstPart.actionPrompt.close('cancel', false);
	assert.equal(await closing, false); assert.equal(f.firstPart.retired, false);
	assert.equal(draft.pending, true); assert.ok(inputFocus.target === draft.field.focusTarget);
	const resolved = new CodeEditorInput(f.secondInput.workingCopy);
	let resolvedDisposed = false; resolved.onWillDispose(() => { resolvedDisposed = true; });
	candidate.resolve(resolved);
	assert.equal(await lateOpen, undefined); assert.equal(resolvedDisposed, true);
	assert.ok(f.firstGroup.model.activeTab === f.firstInput); assert.equal(model.dirty, true);
	f.firstPart.window!.focusTarget.focus();
	const chromeClose = f.editor.editorParts.close(f.firstPart);
	assert.ok(inputFocus.target === f.firstPart.actionPrompt.focusTarget, 'own window chrome belongs to its local decision family');
	f.key('Escape'); assert.equal(await chromeClose, false);
	const fresh = new CodeEditorInput(f.secondInput.workingCopy);
	const freshOpening = f.firstGroup.openEditor(fresh, { preserveFocus: true });
	assert.ok(freshOpening !== undefined, 'Cancel reopens new admission without reviving old requests');
	assert.equal(freshOpening.activated, false); assert.equal(freshOpening.generation, f.firstGroup.panes.openGeneration);
	assert.ok(f.firstGroup.panes.activePane?.input === fresh);
	f.editor.editorParts.clear();
	let retiredResolved = false;
	assert.equal(await f.firstGroup.openResolvedEditor(() => { retiredResolved = true; return new CodeEditorInput(f.secondInput.workingCopy); }), undefined);
	assert.equal(retiredResolved, false); assert.equal(f.firstGroup.panes.activePane, null);
	assert.equal(f.firstGroup.model.tabs.length, 0); assert.equal(f.firstGroup.paneSurface.retired, true);
	assert.equal(f.editor.editorParts.documents.length, 0);
	assert.ok(f.editor.editorParts.activePart === f.editor.editorParts.main);
});

test('a background input attachment preserves a minimized window and sibling focus until explicit activation', async t => {
	const f = createActualSourcePanes(t);
	f.editor.editorParts.minimize(f.firstPart);
	f.second.focus();
	const sibling = inputFocus.target;
	const input = new CodeEditorInput(f.secondInput.workingCopy);
	const result = await f.firstGroup.openResolvedEditor(() => input, { preserveFocus: true });
	assert.equal(result?.activated, false);
	assert.ok(f.firstGroup.panes.activePane!.input === input);
	assert.equal(f.firstPart.window!.model.minimized, true);
	assert.ok(inputFocus.target === sibling);
	assert.ok(f.editor.editorParts.activePart === f.secondPart);
	f.firstGroup.activate(input.id);
	assert.equal(f.firstPart.window!.model.minimized, false);
	assert.ok(inputFocus.target === f.first.commandTarget);
	assert.ok(f.editor.editorParts.activePart === f.firstPart);
});

test('a main tool command opens its own group chooser without creating a floating document', t => {
	const f = createActualSourcePanes(t);
	f.editor.editorParts.clear();
	const main = f.editor.editorParts.main;
	const resource = f.sources.catalog.resolveResource({ contextId: f.sources.systemContextId, path: 'first.lua' })!;
	main.activeGroup.openEditor(resolveLuaCodeEditorInput(f.sources.catalog, resource)); f.update();
	const pane = main.activeGroup.panes.activePane!, model = editorTextModelService.get(resource)!;
	const source = model.buffer.getText(), version = model.version, cycles = f.host.runtime.machine.scheduler.nowCycles;
	f.editor.commands.execute('animation', pane.commandTarget);
	assert.equal(f.editor.editorParts.documents.length, 0);
	const document = main, picker = document.quickInput;
	assert.equal(picker.visible, true); assert.ok(inputFocus.target === picker.field.focusTarget);
	assert.ok(f.editor.editorParts.activePart === document);
	assert.ok(picker.invocationOrigin === pane.commandTarget);
	assert.ok(f.editor.textTarget === picker.field && f.editor.clipboardTarget === picker.field);
	assert.equal(f.editor.textTarget!.replaceText(0, 0, 'definition'), true);
	f.key('Escape');
	assert.equal(picker.visible, false); assert.ok(inputFocus.target === pane.commandTarget);
	assert.ok(f.editor.editorParts.activePart === main);
	assert.ok(main.activeGroup.panes.activePane === pane);
	assert.equal(model.buffer.getText(), source); assert.equal(model.version, version);
	assert.equal(f.host.runtime.machine.scheduler.nowCycles, cycles);
});

test('a floating Scene command stays with its invoking group and retains its Source tab', async t => {
	const f = createActualSourcePanes(t, false, [
		['authoring_scene.lua', SCENE_VIEWPORT_SOURCE], ['cartlib/world/scene_library.lua', ''],
	]);
	const input = f.second.input, source = input.workingCopy.buffer.getText();
	const cycles = f.host.runtime.machine.scheduler.nowCycles;
	f.second.focus();
	f.editor.commands.execute('sceneEditor', f.second.commandTarget);
	const picker = f.secondPart.quickInput;
	assert.equal(picker.visible, true); assert.ok(inputFocus.target === picker.field.focusTarget);
	assert.ok(f.editor.editorParts.activePart === f.secondPart);
	assert.ok(picker.invocationOrigin === f.second.commandTarget);
	assert.ok(f.editor.textTarget === picker.field && f.editor.clipboardTarget === picker.field);
	const field = picker.layout.field, x = (field.left + field.right) / 2, y = (field.top + field.bottom) / 2;
	assert.ok(f.editor.surfaces.hitTest(x, y)?.captureScope === picker.pointerScope, 'the invoking host owns its reachable Scene chooser');
	f.editor.dispatchPointer({ x, y, buttons: PointerButton.Primary, pressedButtons: PointerButton.Primary,
		releasedButtons: 0, cancelledButtons: 0, modifiers: KeyModifier.none, spaceDown: false, timestamp: 1 });
	f.editor.dispatchPointer({ x, y, buttons: 0, pressedButtons: 0,
		releasedButtons: PointerButton.Primary, cancelledButtons: 0, modifiers: KeyModifier.none, spaceDown: false, timestamp: 2 });
	assert.ok(inputFocus.target === picker.field.focusTarget);
	assert.equal(picker.model.list.rows.length, 1, 'the authored Scene registration supplies the actual chooser');
	f.key('Enter'); await setImmediate(); f.update();
	assert.equal(picker.visible, false); assert.ok(f.secondGroup.model.activeTab instanceof SceneEditorInput);
	assert.ok(f.secondGroup.model.tabs.includes(input));
	assert.equal(f.secondGroup.model.activeTab.workingCopy.buffer.getText(), SCENE_VIEWPORT_SOURCE);
	assert.equal(input.workingCopy.buffer.getText(), source);
	assert.equal(f.host.runtime.machine.scheduler.nowCycles, cycles);
});

test('closing the foreground document restores its sibling retained local input', async t => {
	const f = createActualSourcePanes(t);
	f.first.focus();
	f.firstPart.quickInput.input('', '', 'retained draft', async value => value, () => {});
	f.second.focus();
	assert.equal(await f.editor.editorParts.close(f.secondPart), true);
	assert.ok(inputFocus.target === f.firstPart.quickInput.field.focusTarget);
	assert.equal(f.firstPart.quickInput.field.text, 'retained draft');
	assert.ok(f.editor.editorParts.activePart === f.firstPart);
});

test('a foreground tool command does not reveal unrelated minimized hosts to present its own chooser', t => {
	const f = createActualSourcePanes(t), main = f.editor.editorParts.main;
	main.activeGroup.openEditor(new CodeEditorInput(f.firstInput.workingCopy));
	f.editor.editorParts.minimize(f.firstPart); f.editor.editorParts.minimize(f.secondPart);
	f.editor.commands.execute('animation', main.activeGroup.panes.activePane!.commandTarget);
	const part = f.editor.editorParts.activePart;
	assert.ok(part === main && part.quickInput.visible);
	assert.equal(f.firstPart.window!.model.minimized, true); assert.equal(f.secondPart.window!.model.minimized, true);
	assert.ok(inputFocus.target === part.quickInput.field.focusTarget);
	const field = part.quickInput.layout.field, x = (field.left + field.right) / 2, y = (field.top + field.bottom) / 2;
	assert.ok(f.editor.surfaces.hitTest(x, y)?.captureScope === part.quickInput.pointerScope);
	f.key('Escape');
	assert.ok(inputFocus.target === main.activeGroup.panes.activePane!.commandTarget);
});

for (const activation of ['keyboard', 'pointer'] as const) test(`${activation} Problems activation opens Source in the chosen group and retains its Scene tab`, t => {
	const f = createActualSourcePanes(t, false, [
		['authoring_scene.lua', SCENE_VIEWPORT_SOURCE], ['cartlib/world/scene_library.lua', ''],
		['broken.lua', 'local value =\nreturn value'],
	]);
	t.after(() => { problemsPanel.hide(); problemsPanel.setFixedHeightPx(0); });
	const main = f.editor.editorParts.main;
	const sceneResource = f.sources.catalog.resolveResource({ contextId: f.sources.systemContextId, path: 'authoring_scene.lua' })!;
	f.editor.sceneEditor.openResource(main.activeGroup, sceneResource); f.update();
	const scene = main.activeGroup.model.activeTab!, pane = main.activeGroup.panes.activePane!;
	assert.ok(scene instanceof SceneEditorInput);
	selectSceneOutlineRow(scene.view.hierarchy, 1); f.update();
	const selection = { ...scene.view.authoring.selectionRange }, cycles = f.host.runtime.machine.scheduler.nowCycles;
	const resource = f.sources.catalog.resolveResource({ contextId: f.sources.systemContextId, path: 'broken.lua' })!;
	const model = resolveLuaTextFileModel(editorTextModelService, f.sources.catalog, resource);
	f.editor.diagnostics.computePending();
	const diagnostics = problemsPanel.getDiagnostics(), index = diagnostics.findIndex(diagnostic => diagnostic.model === model);
	assert.ok(index >= 0, 'the authored invalid source supplies a real diagnostic');
	const diagnostic = diagnostics[index], text = model.buffer.getText(), version = model.version;
	f.editor.editorParts.minimize(f.firstPart); f.editor.editorParts.minimize(f.secondPart);
	problemsPanel.show(); problemsPanel.setFixedHeightPx(73); f.update();
	problemsPanel.setFocused(true); problemsPanel.setSelectionIndex(index);
	if (activation === 'keyboard') f.key('Enter');
	else {
		const bounds = getProblemsPanelBounds()!, layout = problemsPanel.prepareLayout(bounds);
		problemsPanel.revealSelection(layout, problemsPanel.resolveAvailableWidth(bounds));
		let top = layout.contentTop;
		for (let row = problemsPanel.getScrollIndex(); row < index; row++) top += problemsPanel.getItemLayout(row).height;
		const x = (bounds.left + bounds.right) / 2, y = top + Math.min(problemsPanel.getItemLayout(index).height, layout.contentBottom - top) / 2;
		f.editor.dispatchPointer({ x, y, buttons: PointerButton.Primary, pressedButtons: PointerButton.Primary,
			releasedButtons: 0, cancelledButtons: 0, modifiers: KeyModifier.none, spaceDown: false, timestamp: 1 });
		f.editor.dispatchPointer({ x, y, buttons: 0, pressedButtons: 0,
			releasedButtons: PointerButton.Primary, cancelledButtons: 0, modifiers: KeyModifier.none, spaceDown: false, timestamp: 2 });
	}
	const group = f.editor.editorParts.activeGroup, input = group.model.activeTab!;
	assert.ok(group === main.activeGroup && input instanceof CodeEditorInput);
	assert.ok(input.workingCopy === model);
	assert.equal(input.context.view.cursorRow, diagnostic.row); assert.equal(input.context.view.cursorColumn, diagnostic.startColumn);
	assert.ok(main.activeGroup.model.tabs.includes(scene));
	assert.notEqual(main.activeGroup.panes.activePane, pane);
	assert.deepEqual(scene.view.authoring.selectionRange, selection);
	assert.equal(model.buffer.getText(), text); assert.equal(model.version, version);
	assert.equal(f.host.runtime.machine.scheduler.nowCycles, cycles);
});

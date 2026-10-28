import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { KeyInputEvent, KeyModifier } from '../../hosts/common/input/text';
import { inputFocus } from '../../ide/input/focus';
import { editorTextModelService } from '../../ide/editor/model/model_service';
import { CallHierarchyDirection } from '../../ide/editor/contrib/call_hierarchy/model';
import { getOrCreateSemanticProject, resetSemanticProject } from '../../ide/editor/contrib/intellisense/semantic/workspace/state';
import { navigationState, resetNavigationHistoryState } from '../../ide/navigation/navigation_history';
import { CodeEditorInput, WORKBENCH_TEXT_EDITOR_ID } from '../../ide/workbench/contrib/code_editor/editor_input';
import { CodeEditorPane } from '../../ide/workbench/contrib/code_editor/editor_pane';
import { CallHierarchyInput } from '../../ide/workbench/contrib/call_hierarchy/editor_input';
import { CallHierarchyPane } from '../../ide/workbench/contrib/call_hierarchy/editor_pane';
import { ScenePrimaryClient } from '../../ide/workbench/contrib/scene_editor/primary_client';
import { selectSceneOutlineRow } from '../../ide/workbench/contrib/scene_editor/outline';
import { resolveLuaTextFileModel } from '../../ide/workbench/services/working_copy/text_file_model';
import { createActualSourcePanes } from '../helpers/source_panes';

const CALLS = [
	'local function target() end',
	...Array.from({ length: 24 }, (_, index) => `local function caller_${index}() target() end`),
	'local function shared() caller_0() caller_1() end',
	'return { target = target }',
].join('\n');
const SCENES = [
	"local scenes = require('cartlib/world/scene_library')",
	...Array.from({ length: 48 }, (_, index) => `scenes.register('scene_${index}_${'long_'.repeat(20)}', { objects = { { member_id = 'member', definition_id = 'actor' } } })`),
].join('\n');

async function fixture(t: TestContext, sources: readonly (readonly [string, string])[] = []) {
	const f = createActualSourcePanes(t, false, [['calls.lua', CALLS], ['scene.lua', SCENES], ['cartlib/world/scene_library.lua', 'return {}'], ...sources]);
	const model = (path: string) => resolveLuaTextFileModel(editorTextModelService, f.sources.catalog,
		f.sources.catalog.resolveResource({ contextId: f.sources.systemContextId, path })!);
	const calls = model('calls.lua'), scene = model('scene.lua'), document = f.ide.sceneSources.get(scene);
	assert.equal(await f.editor.openSceneInMain(scene, { document, sourceVersion: scene.version, scene: document.scenes[0] }, inputFocus.target!), true);
	const primary = f.editor.mainWorkspace.primary; assert.ok(primary instanceof ScenePrimaryClient);
	assert.equal(selectSceneOutlineRow(primary.view, 1), true);
	await f.editor.navigation.openResource(f.firstGroup, calls.resource, { editorId: WORKBENCH_TEXT_EDITOR_ID });
	const sourceInput = f.firstGroup.model.activeTab; assert.ok(sourceInput instanceof CodeEditorInput);
	const sourcePane = f.firstGroup.panes.activePane; assert.ok(sourcePane instanceof CodeEditorPane);
	sourcePane.code.view.cursorRow = 0; sourcePane.code.view.cursorColumn = 16;
	sourcePane.focus(); resetNavigationHistoryState();
	const open = () => {
		f.editor.commands.execute('callHierarchy', sourcePane.commandTarget);
		const input = f.firstGroup.model.activeTab, pane = f.firstGroup.panes.activePane;
		assert.ok(input instanceof CallHierarchyInput); assert.ok(pane instanceof CallHierarchyPane);
		f.update(); return { input, pane };
	};
	return { ...f, calls, scene, primary, sourceInput, sourcePane, open };
}

for (const visible of [false, true]) test(`Call Hierarchy opening and Source navigation preserve Files reading state (visible: ${visible})`, async t => {
	const f = await fixture(t), panel = f.editor.resourcePanel;
	panel.show(); f.update();
	panel.queuePendingSelection(f.scene.identity); panel.applyPendingSelection();
	const selected = panel.files.selectedNode; assert.ok(selected !== null && selected.element.kind === 'file');
	panel.toggleFileDisclosure(selected); panel.setScroll(3.5); panel.setHScroll(4);
	assert.ok(panel.scroll > 0 && panel.hscroll > 0);
	if (!visible) panel.hide();
	f.sourcePane.focus();
	const selection = panel.files.selectedNode, disclosure = selected.collapsed, scroll = panel.scroll, hscroll = panel.hscroll;
	const primarySelection = f.primary.consumer.selection;
	const { input, pane } = f.open();
	assert.ok(f.editor.mainWorkspace.primary === f.primary && f.primary.consumer.selection === primarySelection);
	assert.ok(panel.files.selectedNode === selection); assert.equal(selected.collapsed, disclosure);
	assert.equal(panel.scroll, scroll); assert.equal(panel.hscroll, hscroll); assert.equal(panel.visible, visible);
	assert.equal(input.serializable, false);
	const opening = t.mock.method(f.editor.navigation, 'openResource');
	f.editor.commands.execute('editor.source', pane.commandTarget);
	assert.equal(opening.mock.callCount(), 1); await opening.mock.calls[0].result;
	assert.ok(f.firstGroup.model.activeTab instanceof CodeEditorInput);
	assert.ok(f.firstGroup.model.activeTab.workingCopy === f.calls);
	assert.ok(panel.files.selectedNode === selection); assert.equal(selected.collapsed, disclosure);
	assert.equal(panel.scroll, scroll); assert.equal(panel.hscroll, hscroll); assert.equal(panel.visible, visible);
	assert.ok(f.editor.mainWorkspace.primary === f.primary && f.primary.consumer.selection === primarySelection);
});

for (const change of ['reuse pane', 'reselect source', 'new foreground'] as const) test(`Call Hierarchy query admission preserves ${change} published by the semantic producer`, async t => {
	const f = await fixture(t), project = getOrCreateSemanticProject(editorTextModelService, f.calls.identity.contextId);
	const synchronize = project.synchronizeSources.bind(project);
	let published = false;
	t.mock.method(project, 'synchronizeSources', catalog => {
		synchronize(catalog);
		if (published) return;
		published = true;
		if (change === 'reuse pane') f.firstGroup.openEditor(new CodeEditorInput(f.secondInput.workingCopy));
		else if (change === 'reselect source') f.firstGroup.activate(f.sourceInput.id);
		else f.second.focus();
	});
	f.editor.commands.execute('callHierarchy', f.sourcePane.commandTarget);
	assert.equal(published, true);
	if (change !== 'new foreground') {
		assert.equal(f.firstGroup.model.tabs.some(input => input instanceof CallHierarchyInput), false);
		assert.ok(f.firstGroup.model.activeTab instanceof CodeEditorInput
			&& f.firstGroup.model.activeTab.workingCopy === (change === 'reuse pane' ? f.secondInput.workingCopy : f.calls));
	} else {
		assert.ok(f.firstGroup.model.activeTab instanceof CallHierarchyInput);
		assert.ok(inputFocus.admittedTarget === f.second.commandTarget && navigationState.activeOwner === f.secondGroup);
		assert.ok(f.editor.editorParts.activePart === f.secondPart);
		assert.equal(navigationState.back.length, 0);
	}
	assert.ok(f.editor.mainWorkspace.primary === f.primary);
});

test('Back restores the retained selected query result and its reading state without replacing Main primary', async t => {
	const f = await fixture(t), { input, pane } = f.open(), tree = input.tree;
	f.key('End'); f.key('ArrowRight'); f.key('ArrowRight');
	const selected = tree.rows[tree.selectionIndex], scroll = tree.scroll;
	assert.ok(selected !== undefined && selected.parent !== null); assert.ok(scroll > 0);
	const primarySelection = f.primary.consumer.selection;
	const opening = t.mock.method(f.editor.navigation, 'openResource');
	f.editor.commands.execute('editor.source', pane.commandTarget);
	assert.equal(opening.mock.callCount(), 1); await opening.mock.calls[0].result;
	const openedSource = f.firstGroup.model.activeTab;
	assert.ok(openedSource instanceof CodeEditorInput);
	await f.editor.navigation.goBackward();
	assert.ok(f.firstGroup.model.activeTab === input && f.firstGroup.panes.activePane === pane);
	assert.ok(tree.rows[tree.selectionIndex] === selected); assert.equal(tree.scroll, scroll);
	assert.equal(selected.parent.collapsed, false);
	assert.ok(inputFocus.admittedTarget === pane.commandTarget);
	assert.ok(f.editor.mainWorkspace.primary === f.primary && f.primary.consumer.selection === primarySelection);
});

test('moving a query transfers the same retained input and reading state while retiring the departing control', async t => {
	const f = await fixture(t), { input, pane } = f.open(), tree = input.tree;
	f.key('End'); f.key('ArrowRight'); f.key('ArrowRight');
	const selected = tree.rows[tree.selectionIndex], scroll = tree.scroll, generation = pane.inputScope.contextGeneration;
	assert.ok(scroll > 0);
	assert.equal(f.editor.editorParts.moveEditor(f.firstGroup, input, { kind: 'group', group: f.secondGroup }), true);
	const receiver = f.secondGroup.panes.activePane; assert.ok(receiver instanceof CallHierarchyPane && receiver !== pane);
	assert.ok(f.secondGroup.model.activeTab === input && receiver.input === input);
	assert.ok(input.tree === tree && tree.rows[tree.selectionIndex] === selected); assert.equal(tree.scroll, scroll);
	assert.ok(pane.inputScope.contextGeneration > generation); assert.equal(pane.commandTarget.canFocus!(), false);
	assert.equal(f.firstGroup.model.contains(input), false);
	assert.ok(inputFocus.admittedTarget === receiver.commandTarget);
	assert.ok(f.editor.mainWorkspace.primary === f.primary);
});

test('a retained query is not a working-copy consumer that suppresses the final dirty Source close decision', async t => {
	const f = await fixture(t), { input } = f.open();
	assert.ok(f.firstGroup.model.contains(f.sourceInput));
	f.calls.pushEditOperations([{ offset: 0, deleteLength: 0, text: '-- unsaved Source\n' }]);
	const source = f.calls.buffer.getText(), closing = f.firstGroup.close(f.sourceInput.id);
	assert.equal(f.firstPart.actionPrompt.visible, true); assert.equal(input.isDirty(), false);
	f.key('Escape'); assert.equal(await closing, false);
	assert.ok(f.firstGroup.model.contains(f.sourceInput) && f.firstGroup.model.activeTab === input);
	assert.equal(f.calls.buffer.getText(), source); assert.equal(f.calls.dirty, true);
	assert.equal(await f.firstGroup.close(input.id), true);
	assert.ok(f.firstGroup.model.contains(f.sourceInput)); assert.equal(f.firstPart.actionPrompt.visible, false);
	assert.ok(f.editor.mainWorkspace.primary === f.primary);
});

test('Source rejects a selected captured query location after its canonical source generation changes', async t => {
	const f = await fixture(t), { input, pane } = f.open();
	f.key('ArrowDown');
	const selected = input.tree.rows[input.tree.selectionIndex];
	assert.ok(pane.getSourceLocation() !== undefined);
	f.calls.pushEditOperations([{ offset: 0, deleteLength: 0, text: '-- the query observes an older file\n' }]);
	const source = f.calls.buffer.getText(), opening = t.mock.method(f.editor.navigation, 'openResource');
	f.editor.commands.execute('editor.source', pane.commandTarget);
	assert.equal(opening.mock.callCount(), 0);
	assert.ok(f.firstGroup.model.activeTab === input && f.firstGroup.panes.activePane === pane);
	assert.ok(input.tree.rows[input.tree.selectionIndex] === selected && inputFocus.admittedTarget === pane.commandTarget);
	assert.equal(f.calls.buffer.getText(), source); assert.equal(f.calls.dirty, true);
	assert.ok(f.editor.mainWorkspace.primary === f.primary);
});

test('retiring the semantic project ends a retained query snapshot source authority before later canonical edits', async t => {
	const f = await fixture(t), { input, pane } = f.open();
	const capturedProject = input.model.project;
	const replacement = resetSemanticProject(editorTextModelService, f.calls.identity.contextId);
	assert.ok(replacement !== capturedProject);
	f.calls.pushEditOperations([{ offset: 0, deleteLength: 0, text: '-- changed after query project retirement\n' }]);
	const source = f.calls.buffer.getText(), opening = t.mock.method(f.editor.navigation, 'openResource');
	f.editor.commands.execute('editor.source', pane.commandTarget);
	assert.equal(opening.mock.callCount(), 0);
	assert.ok(f.firstGroup.model.activeTab === input && f.firstGroup.panes.activePane === pane);
	assert.ok(inputFocus.admittedTarget === pane.commandTarget && f.editor.mainWorkspace.primary === f.primary);
	assert.equal(f.calls.buffer.getText(), source); assert.equal(f.calls.dirty, true);
});

test('Source rejects a query project retired while its unchanged semantic file proof is being read', async t => {
	const f = await fixture(t), { input, pane } = f.open(), project = input.model.project;
	assert.ok(pane.getSourceLocation() !== undefined);
	const source = f.calls.buffer.getText(), readFile = project.getFileData.bind(project);
	let retired = false;
	t.mock.method(project, 'getFileData', resource => {
		const file = readFile(resource);
		assert.ok(file !== undefined);
		retired = true;
		resetSemanticProject(editorTextModelService, f.calls.identity.contextId);
		return file;
	});
	const opening = t.mock.method(f.editor.navigation, 'openResource');
	f.editor.commands.execute('editor.source', pane.commandTarget);
	assert.equal(retired, true); assert.equal(project.isDisposed, true); assert.equal(opening.mock.callCount(), 0);
	assert.ok(f.firstGroup.model.activeTab === input && f.firstGroup.panes.activePane === pane);
	assert.ok(inputFocus.admittedTarget === pane.commandTarget && f.editor.mainWorkspace.primary === f.primary);
	assert.equal(f.calls.buffer.getText(), source); assert.equal(f.calls.dirty, false);
});

for (const change of ['selection', 'direction'] as const) test(`Source admission preserves newer query ${change} published while retaining its target model`, async t => {
	const f = await fixture(t, [['external_caller.lua', "local api = require('calls')\nlocal function caller() api.target() end\nreturn caller"]]);
	const { input, pane } = f.open(), tree = input.tree;
	const caller = tree.rows.findIndex(row => row.element.resource.path === 'external_caller.lua');
	assert.ok(caller >= 0); tree.select(caller);
	const resource = f.sources.catalog.resolveResource({ contextId: f.sources.systemContextId, path: 'external_caller.lua' })!;
	assert.equal(editorTextModelService.get(resource), undefined);
	let admitted = false;
	const unbind = editorTextModelService.onDidAddModel(model => {
		if (model.resource !== resource) return;
		admitted = true;
		if (change === 'selection') tree.select(0);
		else input.setDirection(CallHierarchyDirection.CallsFrom);
	}); t.after(unbind);
	const opening = t.mock.method(f.editor.navigation, 'openResource');
	f.editor.commands.execute('editor.source', pane.commandTarget);
	assert.equal(admitted, true); assert.equal(opening.mock.callCount(), 0);
	assert.ok(f.firstGroup.model.activeTab === input && f.firstGroup.panes.activePane === pane);
	if (change === 'selection') assert.ok(tree.rows[tree.selectionIndex] === tree.roots[0]);
	else assert.equal(input.direction, CallHierarchyDirection.CallsFrom);
	assert.ok(inputFocus.admittedTarget === pane.commandTarget && f.editor.mainWorkspace.primary === f.primary);
});

for (const change of ['selection', 'direction', 'detach'] as const) test(`a pending popup Source acceptance retires with its query ${change}`, async t => {
	const f = await fixture(t), { input, pane } = f.open(), menu = f.editor.contextMenu;
	f.editor.commands.execute('contextMenu', pane.commandTarget);
	assert.equal(menu.visible, true);
	menu.model.selectedIndex = menu.model.rows.findIndex(row => row.command === 'editor.source');
	assert.ok(menu.model.selectedIndex >= 0 && menu.model.rows[menu.model.selectedIndex].enabled);
	const opening = t.mock.method(f.editor.navigation, 'openResource');
	f.editor.dispatchKey(new KeyInputEvent('Enter', KeyModifier.none));
	assert.equal(menu.visible, true); assert.equal(opening.mock.callCount(), 0);
	if (change === 'selection') input.tree.select(1);
	else if (change === 'direction') input.setDirection(CallHierarchyDirection.CallsFrom);
	else f.firstGroup.activate(f.sourceInput.id);
	assert.equal(menu.visible, false);
	f.editor.dispatchKey(new KeyInputEvent('Enter', KeyModifier.none, false, false));
	assert.equal(opening.mock.callCount(), 0);
	assert.ok(f.firstGroup.model.activeTab === (change === 'detach' ? f.sourceInput : input));
	assert.ok(f.editor.mainWorkspace.primary === f.primary);
});

test('a query captures its authored cursor before opening admission can publish caret changes', async t => {
	const f = await fixture(t);
	const original = f.sourcePane.code.view.cursorRow;
	const release = f.firstGroup.panes.onDidBeginOpen(() => {
		release(); f.sourcePane.code.view.cursorRow = original + 1;
	});
	t.after(release);
	const { input } = f.open();
	assert.ok(input.model.roots[0].range.start.line === original + 1, 'the result belongs to the invocation cursor, not its later neighbor');
	assert.ok(input.model.roots[0].range.start.line !== original + 2);
});

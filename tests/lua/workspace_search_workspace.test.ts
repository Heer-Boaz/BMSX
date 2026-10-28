import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { setImmediate } from 'node:timers/promises';
import { KeyModifier } from '../../hosts/common/input/text';
import { PointerButton } from '../../hosts/common/input/pointer_event';
import type { RectBounds } from '../../machine/ts/common/rect';
import { editorTextModelService } from '../../ide/editor/model/model_service';
import { inputFocus } from '../../ide/input/focus';
import { navigationState, resetNavigationHistoryState } from '../../ide/navigation/navigation_history';
import { CodeEditorInput } from '../../ide/workbench/contrib/code_editor/editor_input';
import { HostErrorInput } from '../../ide/workbench/contrib/host_error/editor_input';
import { ScenePrimaryClient } from '../../ide/workbench/contrib/scene_editor/primary_client';
import { selectSceneOutlineRow } from '../../ide/workbench/contrib/scene_editor/outline';
import { WorkspaceSearchInput } from '../../ide/workbench/contrib/workspace_search/editor_input';
import { WorkspaceSearchPane } from '../../ide/workbench/contrib/workspace_search/editor_pane';
import { resolveLuaTextFileModel } from '../../ide/workbench/services/working_copy/text_file_model';
import { workspaceState } from '../../ide/workbench/workspace/state';
import { clearWorkspaceSourceCaches } from '../../ide/workspace/cache';
import { closeWorkspaceRecords, openWorkspaceRecords } from '../../ide/workspace/records';
import { createActualSourcePanes } from '../helpers/source_panes';
import { MemoryWorkspaceFiles } from '../helpers/workspace_files';

const MATCHES = Array.from({ length: 32 }, (_, index) => `local value_${index} = 'needle'`).join('\n');
const SCENES = `local scenes = require('cartlib/world/scene_library')\n${Array.from({ length: 16 }, (_, index) =>
	`scenes.register('room_${index}_${'long_'.repeat(12)}', { objects = { { member_id = 'unit', definition_id = 'actor' } } })`).join('\n')}`;

async function fixture(t: TestContext, bound = true, additionalSources: readonly (readonly [string, string])[] = []) {
	const files = new MemoryWorkspaceFiles(); await openWorkspaceRecords(files);
	const f = createActualSourcePanes(t, false, [['matches.lua', MATCHES], ['scene.lua', SCENES], ['cartlib/world/scene_library.lua', 'return {}'], ...additionalSources]);
	const previousContext = workspaceState.context;
	const context = f.sources.catalog.getContext(f.sources.systemContextId).admission;
	workspaceState.context = bound ? context : null;
	t.after(async () => { workspaceState.context = previousContext; clearWorkspaceSourceCaches(); await closeWorkspaceRecords(); });
	const resource = (path: string) => f.sources.catalog.resolveResource({ contextId: context.id, path })!;
	const scene = resolveLuaTextFileModel(editorTextModelService, f.sources.catalog, resource('scene.lua'));
	const document = f.ide.sceneSources.get(scene);
	assert.equal(await f.editor.openSceneInMain(scene, { document, sourceVersion: scene.version, scene: document.scenes[0] }, inputFocus.target!), true);
	const primary = f.editor.mainWorkspace.primary; assert.ok(primary instanceof ScenePrimaryClient);
	assert.equal(selectSceneOutlineRow(primary.view, 1), true);
	const activity = new HostErrorInput('fixture activity'); f.firstGroup.openEditor(activity); f.firstGroup.focus(); f.update();
	resetNavigationHistoryState();
	const open = () => {
		f.editor.commands.execute('findGlobal', f.firstGroup.panes.activePane!.commandTarget);
		const group = f.editor.editorParts.activeGroup, input = group.model.activeTab, pane = group.panes.activePane;
		assert.ok(input instanceof WorkspaceSearchInput && pane instanceof WorkspaceSearchPane, `${input?.kind}: ${input?.title}`);
		return { group, input, pane };
	};
	const submit = (pane: WorkspaceSearchPane, query: string) => {
		pane.focusQuery(); const target = f.editor.textTarget; assert.ok(target !== undefined);
		assert.equal(target.replaceText(0, target.readText().text.length, query), true); f.key('Enter');
	};
	const drain = async (input: WorkspaceSearchInput) => {
		while (input.running) { f.update(); await setImmediate(); }
		assert.equal(input.search.status, 'complete'); f.update();
	};
	const addYaml = (source = 'value: needle\nother: needle\n') => {
		f.sources.catalog.registerTextSources(context.id, [{ type: 'data', resid: 'query-data', source_path: 'query.yaml', sourcemeta: { text: source } }]);
		return resource('query.yaml');
	};
	// Arranged bounds drive real Workbench input; their dimensions are not test assertions.
	const pointer = (bounds: Readonly<RectBounds>, down: boolean) => f.editor.dispatchPointer({
		x: (bounds.left + bounds.right) / 2, y: (bounds.top + bounds.bottom) / 2,
		buttons: down ? PointerButton.Primary : 0, pressedButtons: down ? PointerButton.Primary : 0,
		releasedButtons: down ? 0 : PointerButton.Primary, cancelledButtons: 0,
		modifiers: KeyModifier.none, spaceDown: false, timestamp: f.host.clock.now(),
	});
	return { ...f, files, context, resource, primary, scene, activity, open, submit, drain, addYaml, pointer };
}

function selectMatch(input: WorkspaceSearchInput, path: string, occurrence = 0): number {
	const indices = input.tree.rows.flatMap((row, index) => row.element.file.resource.path === path && row.element.match !== undefined ? [index] : []);
	assert.ok(indices[occurrence] !== undefined); input.tree.select(indices[occurrence]); return indices[occurrence];
}

test('workspace search is admitted by the workspace root, not the kind or existence of a Source pane', { timeout: 5000 }, async t => {
	const f = await fixture(t, false);
	assert.equal(f.editor.commands.isEnabled('findGlobal', f.firstGroup.panes.activePane!.commandTarget), false);
	f.editor.commands.execute('findGlobal', f.firstGroup.panes.activePane!.commandTarget);
	assert.ok(f.firstGroup.model.activeTab === f.activity);
	assert.equal(f.editor.editorParts.groups.some(group => group.model.tabs.some(input => input instanceof WorkspaceSearchInput)), false);
	workspaceState.context = f.context;
	assert.equal(f.editor.commands.isEnabled('findGlobal', f.firstGroup.panes.activePane!.commandTarget), true);
	const { input, pane } = f.open();
	f.submit(pane, 'needle'); await f.drain(input);
	assert.equal(input.search.matchCount, 32); assert.equal(input.contextId, f.context.id);
	assert.ok(f.editor.mainWorkspace.primary === f.primary);
});

test('workspace query input captures dirty canonical source without editing it or acquiring a working-copy consumer', { timeout: 5000 }, async t => {
	const f = await fixture(t), model = resolveLuaTextFileModel(editorTextModelService, f.sources.catalog, f.resource('matches.lua'));
	model.pushEditOperations([{ offset: 0, deleteLength: model.buffer.length, text: "local dirty = 'needle'\n" }]);
	const sourceInput = new CodeEditorInput(model); f.secondGroup.openEditor(sourceInput);
	const version = model.version, { input, pane } = f.open();
	f.submit(pane, 'needle'); await f.drain(input);
	const observed = input.search.files.find(file => file.resource.path === model.identity.path)!;
	assert.equal(observed.snapshot.source, model.buffer.getText()); assert.equal(observed.matches.length, 1);
	assert.equal(model.version, version); assert.equal(model.dirty, true); assert.equal(input.isDirty(), false);
	assert.equal(input.serializable, false); assert.equal(input.resource, undefined);
	assert.ok(editorTextModelService.get(model.identity) === model);
	f.secondGroup.focus(); const closing = f.secondGroup.close(sourceInput.id);
	assert.equal(f.secondPart.actionPrompt.visible, true);
	f.key('Escape'); assert.equal(await closing, false);
	assert.ok(f.secondGroup.model.contains(sourceInput) && f.firstGroup.model.activeTab === input);
});

test('Source and Back retain the exact query occurrence while Files and Main retain their own subjects', { timeout: 5000 }, async t => {
	const f = await fixture(t), panel = f.editor.resourcePanel;
	panel.show(); f.update(); panel.queuePendingSelection(f.scene.identity); panel.applyPendingSelection();
	const file = panel.files.selectedNode; assert.ok(file !== null && file.element.kind === 'file'); panel.toggleFileDisclosure(file); panel.setScroll(3.5);
	const selectedFile = panel.files.selectedNode, collapsed = file.collapsed, filesScroll = panel.scroll, primarySelection = f.primary.consumer.selection;
	f.firstGroup.focus(); const { input, pane } = f.open(); f.submit(pane, 'needle'); await f.drain(input);
	assert.equal(pane.canOpenSource, false);
	input.tree.select(0); assert.equal(f.editor.commands.isEnabled('editor.source', pane.commandTarget), false);
	selectMatch(input, 'matches.lua', 24); pane.focus();
	const row = input.tree.rows[input.tree.selectionIndex], scroll = input.tree.scroll;
	assert.equal(f.editor.commands.isEnabled('editor.source', pane.commandTarget), true);
	const opening = t.mock.method(f.editor.navigation, 'openSource'); f.editor.commands.execute('editor.source', pane.commandTarget);
	assert.equal(opening.mock.callCount(), 1); assert.ok(await opening.mock.calls[0].result !== undefined);
	const source = f.firstGroup.model.activeTab; assert.ok(source instanceof CodeEditorInput);
	assert.equal(source.context.view.cursorRow, row.element.match!.row);
	assert.equal(source.context.view.cursorColumn, row.element.match!.start);
	await f.editor.navigation.goBackward();
	assert.ok(f.firstGroup.model.activeTab === input && f.firstGroup.panes.activePane === pane);
	assert.ok(input.tree.rows[input.tree.selectionIndex] === row); assert.equal(input.tree.scroll, scroll);
	assert.ok(panel.files.selectedNode === selectedFile); assert.equal(file.collapsed, collapsed); assert.equal(panel.scroll, filesScroll);
	assert.equal(panel.visible, true); assert.ok(f.editor.mainWorkspace.primary === f.primary && f.primary.consumer.selection === primarySelection);
});

test('moving a pending query transfers its retained operation and the workspace command reveals that actual owner', { timeout: 5000 }, async t => {
	const f = await fixture(t), yaml = f.addYaml(), read = Promise.withResolvers<{ contents: string; updatedAt: number } | null>();
	let reading = false; const readFile = f.files.read.bind(f.files);
	t.mock.method(f.files, 'read', path => { if (path === yaml.sourceFilePath) { reading = true; return read.promise; } return readFile(path); });
	const { input, pane } = f.open(); f.submit(pane, 'needle');
	while (!reading) { f.update(); await setImmediate(); }
	const generation = pane.inputScope.contextGeneration, query = input.query;
	assert.equal(f.editor.editorParts.moveEditor(f.firstGroup, input, { kind: 'group', group: f.secondGroup }), true);
	const receiver = f.secondGroup.panes.activePane; assert.ok(receiver instanceof WorkspaceSearchPane && receiver !== pane);
	assert.ok(receiver.input === input && input.running); assert.equal(input.query, query);
	assert.ok(pane.inputScope.contextGeneration > generation); assert.equal(pane.commandTarget.canFocus!(), false);
	assert.equal(f.firstGroup.model.contains(input), false);
	read.resolve(null); await f.drain(input);
	const selected = selectMatch(input, 'query.yaml'), row = input.tree.rows[selected];
	f.firstGroup.focus(); const reopened = f.open();
	assert.ok(reopened.input === input && reopened.pane === receiver && reopened.group === f.secondGroup);
	assert.ok(input.tree.rows[input.tree.selectionIndex] === row); assert.ok(f.editor.mainWorkspace.primary === f.primary);
	assert.equal(f.editor.editorParts.groups.flatMap(group => group.model.tabs).filter(candidate => candidate instanceof WorkspaceSearchInput).length, 1);
});

test('a stale captured result refuses Source without altering the query, source or destination topology', { timeout: 5000 }, async t => {
	const f = await fixture(t), { input, pane } = f.open(); f.submit(pane, 'needle'); await f.drain(input);
	selectMatch(input, 'matches.lua'); pane.focus();
	const model = resolveLuaTextFileModel(editorTextModelService, f.sources.catalog, f.resource('matches.lua'));
	model.pushEditOperations([{ offset: 0, deleteLength: 0, text: '-- source moved\n' }]);
	const source = model.buffer.getText(), row = input.tree.rows[input.tree.selectionIndex], opening = t.mock.method(f.editor.navigation, 'openSource');
	f.editor.commands.execute('editor.sourceToSide', pane.commandTarget);
	assert.equal(opening.mock.callCount(), 1); assert.equal(await opening.mock.calls[0].result, undefined);
	assert.equal(f.firstPart.groups.length, 1); assert.ok(f.firstGroup.model.activeTab === input);
	assert.ok(input.tree.rows[input.tree.selectionIndex] === row); assert.equal(model.buffer.getText(), source);
	assert.ok(f.editor.mainWorkspace.primary === f.primary);
});

for (const phase of ['pending read', 'model admission'] as const) test(`a newer result selection during Source ${phase} supersedes the captured occurrence`, { timeout: 5000 }, async t => {
	const f = await fixture(t), yaml = f.addYaml(), { input, pane } = f.open();
	f.submit(pane, 'needle'); await f.drain(input); selectMatch(input, 'query.yaml'); pane.focus();
	assert.equal(editorTextModelService.get(yaml), undefined);
	const read = Promise.withResolvers<{ contents: string; updatedAt: number } | null>();
	if (phase === 'pending read') t.mock.method(f.files, 'read', () => read.promise);
	else t.after(editorTextModelService.onDidAddModel(model => { if (model.identity.path === yaml.path) selectMatch(input, 'query.yaml', 1); }));
	const opening = t.mock.method(f.editor.navigation, 'openSource'); f.editor.commands.execute('editor.sourceToSide', pane.commandTarget);
	assert.equal(opening.mock.callCount(), 1);
	if (phase === 'pending read') { selectMatch(input, 'query.yaml', 1); read.resolve(null); }
	assert.equal(await opening.mock.calls[0].result, undefined);
	assert.equal(f.firstPart.groups.length, 1); assert.ok(f.firstGroup.model.activeTab === input);
	assert.equal(input.tree.rows[input.tree.selectionIndex].element.match!.row, 1);
});

test('closing the actual query input retires its pending operation and ignores late file results', { timeout: 5000 }, async t => {
	const f = await fixture(t), yaml = f.addYaml(), read = Promise.withResolvers<{ contents: string; updatedAt: number } | null>();
	let reading = false; const readFile = f.files.read.bind(f.files);
	t.mock.method(f.files, 'read', path => { if (path === yaml.sourceFilePath) { reading = true; return read.promise; } return readFile(path); });
	const { input, pane } = f.open(); f.submit(pane, 'needle');
	while (!reading) { f.update(); await setImmediate(); }
	const generation = pane.inputScope.contextGeneration; let disposed = 0;
	input.onWillDispose(() => { disposed++; });
	assert.equal(await f.firstGroup.close(input.id), true); assert.equal(disposed, 1);
	const focus = inputFocus.admittedTarget, files = input.search.files, revision = input.search.revision;
	assert.equal(input.running, false); assert.ok(pane.inputScope.contextGeneration > generation);
	read.resolve(null); await setImmediate(); f.update(); await setImmediate();
	assert.ok(input.search.files === files); assert.equal(input.search.revision, revision);
	assert.ok(inputFocus.admittedTarget === focus && f.editor.mainWorkspace.primary === f.primary);
	assert.equal(f.firstGroup.model.contains(input), false);
});

for (const change of ['draft replacement', 'rerun'] as const) test(`${change} retires an earlier query history destination instead of redirecting Back to new results`, { timeout: 5000 }, async t => {
	const f = await fixture(t), { input, pane } = f.open(); f.submit(pane, 'needle'); await f.drain(input);
	selectMatch(input, 'matches.lua'); pane.focus();
	const opening = t.mock.method(f.editor.navigation, 'openSource'); f.editor.commands.execute('editor.source', pane.commandTarget);
	assert.ok(await opening.mock.calls[0].result !== undefined);
	const source = f.firstGroup.model.activeTab; assert.ok(source instanceof CodeEditorInput);
	const entry = navigationState.back.find(captured => captured.target.kind === 'input' && captured.target.input === input);
	assert.ok(entry !== undefined && !entry.isDisposed);
	if (change === 'draft replacement') input.setQuery('different draft'); else input.run();
	assert.equal(entry.isDisposed, true); assert.equal(entry.selection!.isDisposed, true);
	assert.equal(navigationState.back.includes(entry), false); assert.equal(navigationState.forward.includes(entry), false);
	assert.ok(f.firstGroup.model.activeTab === source);
	await f.editor.navigation.goBackward();
	assert.notEqual(f.firstGroup.model.activeTab, input); assert.ok(f.editor.mainWorkspace.primary === f.primary);
});

test('query reading changes and same-run file publication preserve an earlier captured result location', { timeout: 5000 }, async t => {
	const f = await fixture(t), yaml = f.addYaml(), read = Promise.withResolvers<{ contents: string; updatedAt: number } | null>();
	let reading = false; const readFile = f.files.read.bind(f.files);
	t.mock.method(f.files, 'read', path => { if (path === yaml.sourceFilePath) { reading = true; return read.promise; } return readFile(path); });
	const { input, pane } = f.open(); f.submit(pane, 'needle');
	while (!reading) { f.update(); await setImmediate(); }
	selectMatch(input, 'matches.lua', 3);
	const files = input.search.files, row = input.tree.rows[input.tree.selectionIndex], scroll = input.tree.scroll, captured = pane.getSelection();
	t.after(() => captured.dispose());
	selectMatch(input, 'matches.lua', 24); input.tree.scroll = 0;
	assert.equal(captured.isDisposed, false);
	read.resolve(null); await f.drain(input);
	assert.ok(input.search.files === files && input.search.files.some(file => file.resource.path === yaml.path));
	assert.equal(captured.isDisposed, false); captured.restore(input);
	assert.ok(input.tree.rows[input.tree.selectionIndex] === row); assert.equal(input.tree.scroll, scroll);
});

for (const publication of ['opening', 'model', 'attachment'] as const) test(`query replacement during Back ${publication} publication cannot restore or focus a retired location`, { timeout: 5000 }, async t => {
	const f = await fixture(t), { input, pane } = f.open(); f.submit(pane, 'needle'); await f.drain(input);
	selectMatch(input, 'matches.lua'); pane.focus();
	const opening = t.mock.method(f.editor.navigation, 'openSource'); f.editor.commands.execute('editor.source', pane.commandTarget);
	assert.ok(await opening.mock.calls[0].result !== undefined);
	const source = f.firstGroup.model.activeTab, focus = inputFocus.admittedTarget;
	const entry = navigationState.back.at(-1)!; assert.ok(entry.target.kind === 'input' && entry.target.input === input);
	const options = t.mock.method(pane, 'setOptions'), activate = t.mock.method(pane, 'focus');
	let replaced = false;
	const replace = () => { if (!replaced) { replaced = true; input.setQuery('newer draft'); } };
	if (publication === 'opening') {
		const unbind = f.firstGroup.panes.onDidBeginOpen(() => { unbind(); replace(); }); t.after(unbind);
	} else if (publication === 'model') t.after(f.firstGroup.model.onDidChange(() => { if (f.firstGroup.model.activeTab === input) replace(); }));
	else {
		const update = pane.update.bind(pane);
		t.mock.method(pane, 'update', () => { replace(); update(); });
	}
	await f.editor.navigation.goBackward();
	assert.equal(replaced, true); assert.equal(entry.isDisposed, true); assert.equal(navigationState.forward.length, 0);
	assert.equal(options.mock.callCount(), 0); assert.equal(activate.mock.callCount(), 0);
	assert.equal(input.query, 'newer draft'); assert.equal(input.tree.rows.length, 0); assert.equal(input.tree.selectionIndex, -1);
	if (publication === 'opening') assert.ok(f.firstGroup.model.activeTab === source && inputFocus.admittedTarget === focus);
	else { assert.equal(f.firstGroup.model.activeTab, input); assert.ok(inputFocus.admittedTarget !== pane.commandTarget); }
});

async function streamingFixture(t: TestContext) {
	const f = await fixture(t, true, [['dense.lua', 'needle '.repeat(32768)]]), opened = f.open();
	f.submit(opened.pane, 'needle');
	while (!opened.input.search.files.some(file => file.resource.path === 'dense.lua')) { f.update(); await setImmediate(); }
	assert.equal(opened.input.running, true); f.update();
	return { ...f, ...opened };
}

for (const command of ['workspaceSearch.run', 'workspaceSearch.cancel'] as const) test(`streamed results preserve the live ${command} press through its physical release`, { timeout: 5000 }, async t => {
	const f = await streamingFixture(t), method = command === 'workspaceSearch.run' ? 'run' : 'cancel';
	const action = f.input.actions.items.find(item => item.command === command)!, execute = t.mock.method(f.input, method);
	assert.equal(action.enabled, true); assert.equal(action.visible && !action.overflowed, true);
	const bounds = { ...action.bounds }, count = f.input.search.matchCount, files = f.input.search.files;
	f.pointer(bounds, true); f.update();
	assert.ok(f.input.search.matchCount > count); assert.equal(f.input.running, true);
	f.pointer(bounds, false);
	assert.equal(execute.mock.callCount(), 1);
	if (method === 'cancel') assert.equal(f.input.running, false);
	else assert.ok(f.input.search.files !== files);
});

for (const change of ['query', 'selection'] as const) test(`a newer ${change} intent revokes an older search action press`, { timeout: 5000 }, async t => {
	const f = await streamingFixture(t), action = f.input.actions.items.find(item => item.command === 'workspaceSearch.cancel')!;
	const execute = t.mock.method(f.input, 'cancel'), bounds = { ...action.bounds };
	f.pointer(bounds, true);
	if (change === 'query') f.input.setQuery('different draft'); else selectMatch(f.input, 'dense.lua', 1);
	f.pointer(bounds, false);
	assert.equal(execute.mock.callCount(), 0);
	if (change === 'query') assert.equal(f.input.query, 'different draft');
	else assert.equal(f.input.tree.rows[f.input.tree.selectionIndex].element.match!.offset, 7);
});

test('streamed observations leave More options open while a new query or result selection retires their subject', { timeout: 5000 }, async t => {
	const f = await streamingFixture(t), menu = f.editor.contextMenu;
	const open = () => { const bounds = { ...f.input.actions.overflow!.button.bounds }; f.pointer(bounds, true); f.pointer(bounds, false); assert.equal(menu.visible, true); };
	open();
	const count = f.input.search.matchCount; f.update();
	assert.ok(f.input.search.matchCount > count); assert.equal(menu.visible, true);
	selectMatch(f.input, 'dense.lua'); assert.equal(menu.visible, false);
	open(); f.input.setQuery('different draft'); assert.equal(menu.visible, false);
});

for (const publication of ['draft', 'search'] as const) test(`closing the actual query from its ${publication} publication leaves neither resumed work nor a delayed query timer`, { timeout: 5000 }, async t => {
	const f = await fixture(t), { input, pane } = f.open();
	let closing: Promise<boolean> | undefined, disposed = 0;
	input.onWillDispose(() => { disposed++; });
	t.after(input.onDidChange(() => {
		if (closing === undefined && (publication === 'draft' ? input.pending : input.search.status === 'running')) closing = f.firstGroup.close(input.id);
	}));
	if (publication === 'search') f.submit(pane, 'needle');
	else {
		pane.focusQuery(); const target = f.editor.textTarget!;
		assert.equal(target.replaceText(0, target.readText().text.length, 'needle'), true);
	}
	assert.ok(closing !== undefined); assert.equal(await closing, true); assert.equal(disposed, 1);
	const revision = input.search.revision, files = input.search.files;
	await setImmediate(); f.update(200); await setImmediate(); f.update();
	assert.equal(input.pending, false); assert.equal(input.running, false);
	assert.equal(input.search.revision, revision); assert.ok(input.search.files === files);
	assert.equal(f.firstGroup.model.contains(input), false);
});

test('workspace Search seeds single-line native Source selection without mutating it and ignores multiline selection', { timeout: 5000 }, async t => {
	const f = await fixture(t), source = f.second.code, sourceInput = f.secondInput, native = source.focusTarget.textInput!;
	source.focusTarget.focus(); native.setSelection(6, 10);
	const before = native.readText(), version = sourceInput.workingCopy.version;
	f.key('KeyF', KeyModifier.ctrl | KeyModifier.shift);
	const input = f.secondGroup.model.activeTab, pane = f.secondGroup.panes.activePane;
	assert.ok(input instanceof WorkspaceSearchInput && pane instanceof WorkspaceSearchPane);
	assert.equal(input.query, before.text.slice(before.selectionStart, before.selectionEnd));
	assert.equal(sourceInput.workingCopy.version, version); assert.equal(sourceInput.workingCopy.buffer.getText(), f.otherSource);
	assert.equal(sourceInput.context.view.cursorColumn, 10); assert.deepEqual(sourceInput.context.view.selectionAnchor, { row: 0, column: 6 });
	assert.ok(f.editor.textTarget === inputFocus.admittedTarget!.textInput);
	assert.equal(f.editor.textTarget!.readText().text, input.query);
	f.secondGroup.activate(sourceInput.id); source.focusTarget.focus(); native.setSelection(0, sourceInput.workingCopy.buffer.length);
	const query = input.query;
	f.key('KeyF', KeyModifier.ctrl | KeyModifier.shift);
	assert.ok(f.secondGroup.model.activeTab === input && f.secondGroup.panes.activePane === pane);
	assert.equal(input.query, query); assert.equal(sourceInput.workingCopy.version, version);
	assert.equal(sourceInput.context.view.cursorRow, 2); assert.equal(sourceInput.context.view.cursorColumn, 0);
	assert.deepEqual(sourceInput.context.view.selectionAnchor, { row: 0, column: 0 });
});

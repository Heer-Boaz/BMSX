import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { PointerButton } from '../../hosts/common/input/pointer_event';
import { KeyModifier } from '../../hosts/common/input/text';
import type { EditorCommandId } from '../../ide/common/commands';
import { editorTextModelService } from '../../ide/editor/model/model_service';
import { editorViewState } from '../../ide/editor/ui/view/state';
import { inputFocus } from '../../ide/input/focus';
import { CartMapInput } from '../../ide/workbench/contrib/cart_maps/editor_input';
import { CodeEditorInput, WORKBENCH_TEXT_EDITOR_ID } from '../../ide/workbench/contrib/code_editor/editor_input';
import { captureCodeEditorView } from '../../ide/workbench/contrib/code_editor/view_snapshot';
import type { FileElement } from '../../ide/workbench/contrib/resources/panel/files_model';
import type { WorkbenchTreeNode } from '../../ide/workbench/ui/tree_view';
import { resolveLuaTextFileModel } from '../../ide/workbench/services/working_copy/text_file_model';
import { clearWorkspaceSourceCaches } from '../../ide/workspace/cache';
import { closeWorkspaceRecords, openWorkspaceRecords } from '../../ide/workspace/records';
import { createActualSourcePanes } from '../helpers/source_panes';
import { MemoryWorkspaceFiles } from '../helpers/workspace_files';

function fixture(t: TestContext, font: 'tiny' | 'msx' = 'tiny', sources: readonly (readonly [string, string])[] = []) {
	const f = createActualSourcePanes(t, false, [['folder/third.lua', 'return 3'], ['folder/other.lua', 'return 4'], ...sources]);
	f.editor.setFontVariant(font); f.update();
	assert.equal(editorViewState.font.variant, font, 'exercise the actual requested font, not a global overwritten by Studio construction');
	f.first.focus(); f.editor.resourcePanel.show(); f.update();
	return { ...f, panel: f.editor.resourcePanel };
}
type Fixture = ReturnType<typeof fixture>;

function reveal(f: Fixture, path: string) {
	f.panel.queuePendingSelection({ contextId: f.sources.systemContextId, path }); f.panel.applyPendingSelection(); f.update();
	const node = f.panel.files.selectedNode;
	assert.ok(node !== null && node.element.kind === 'file');
	return { node, resource: node.element.resource };
}

/** Row geometry locates a physical invocation; outcomes assert topology and actual ownership only. */
function secondary(f: Fixture, node: WorkbenchTreeNode<FileElement>): void {
	const index = f.panel.files.tree.rows.indexOf(node), metrics = f.panel.getItemMetrics(index), layout = f.panel.prepareLayout();
	const x = layout.contentLeft - f.panel.hscroll + metrics.indentWidth + editorViewState.font.advance(' ');
	const y = layout.contentTop + (index - f.panel.scroll + 0.5) * f.panel.lineHeight;
	for (const down of [true, false]) {
		f.host.clock.advance(10);
		f.editor.dispatchPointer({ x, y, buttons: down ? PointerButton.Secondary : 0,
			pressedButtons: down ? PointerButton.Secondary : 0, releasedButtons: down ? 0 : PointerButton.Secondary,
			cancelledButtons: 0, modifiers: KeyModifier.none, spaceDown: false, timestamp: f.host.clock.now() });
	}
}

function accept(f: Fixture, command: EditorCommandId): void {
	const menu = f.editor.contextMenu, index = menu.model.rows.findIndex(row => row.command === command);
	assert.ok(index >= 0 && menu.model.rows[index].enabled);
	f.key('Home'); for (let row = 0; row < index; row++) if (menu.model.rows[row].enabled) f.key('ArrowDown'); f.key('Enter');
}

for (const font of ['tiny', 'msx'] as const) test(`${font} Files side opening is accepted topology intent, cancellation creates nothing and subsequent opens reuse its group`, async t => {
	const f = fixture(t, font), parts = f.editor.editorParts, original = reveal(f, 'folder/third.lua');
	const open = t.mock.method(f.editor.navigation, 'openResource');
	secondary(f, original.node);
	assert.equal(f.editor.contextMenu.model.rows.some(row => row.command === 'resources.source' || row.command === 'resources.sourceToSide'), false,
		'plain source already opens through the text editor and has no redundant Source alternative');
	f.key('Escape');
	assert.equal(f.firstPart.groups.length, 1); assert.equal(parts.documents.length, 2); assert.equal(open.mock.callCount(), 0);
	assert.ok(inputFocus.target === f.panel.focusTarget);
	secondary(f, original.node); accept(f, 'resources.openToSide');
	assert.equal(open.mock.callCount(), 1); await open.mock.calls[0].result;
	const side = f.firstPart.groups.find(group => group !== f.firstGroup)!;
	assert.ok(side !== undefined && parts.partForGroup(side) === f.firstPart && open.mock.calls[0].arguments[0] === side);
	const input = side.model.activeTab;
	assert.ok(input instanceof CodeEditorInput && input.resource === original.resource && side.panes.activePane?.input === input);
	assert.ok(f.firstGroup.model.activeTab === f.firstInput && f.secondGroup.model.activeTab === f.secondInput);
	f.first.focus(); f.panel.setFocused(true); const next = reveal(f, 'folder/other.lua');
	secondary(f, next.node); accept(f, 'resources.openToSide'); await open.mock.calls[1].result;
	assert.equal(f.firstPart.groups.length, 2); assert.equal(parts.documents.length, 2);
	assert.ok(open.mock.calls[1].arguments[0] === side && side.model.activeTab instanceof CodeEditorInput && side.model.activeTab.resource === next.resource);
});

for (const font of ['tiny', 'msx'] as const) test(`${font} Open to Side uses YAML's visual contribution while Source to Side shares its dirty canonical working copy`, async t => {
	await openWorkspaceRecords(new MemoryWorkspaceFiles());
	const f = fixture(t, font), path = 'res/data/castle_map.yaml';
	t.after(async () => { await closeWorkspaceRecords(); clearWorkspaceSourceCaches(); });
	f.sources.catalog.registerTextSources(f.sources.systemContextId, [{ type: 'data', resid: 'map', source_path: path,
		sourcemeta: { text: '1: { map: [".."], objects: [] }\n' } }]);
	f.panel.toggleFilterMode(); const { node, resource } = reveal(f, path), open = t.mock.method(f.editor.navigation, 'openResource');
	secondary(f, node);
	assert.ok(['resources.open', 'resources.openToSide', 'resources.source', 'resources.sourceToSide'].every(
		command => f.editor.contextMenu.model.rows.some(row => row.command === command && row.enabled)));
	accept(f, 'resources.openToSide'); await open.mock.calls[0].result;
	const side = open.mock.calls[0].arguments[0], map = side.model.activeTab;
	assert.ok(map instanceof CartMapInput && map.resource === resource && side !== f.firstGroup);
	map.workingCopy.pushEditOperations([{ offset: 0, deleteLength: 0, text: '# retained canonical source\n' }]);
	const text = map.workingCopy.buffer.getText();
	f.first.focus(); f.panel.setFocused(true); secondary(f, reveal(f, path).node); accept(f, 'resources.sourceToSide');
	await open.mock.calls[1].result;
	const code = side.model.activeTab;
	assert.ok(open.mock.calls[1].arguments[0] === side && code instanceof CodeEditorInput && code.workingCopy === map.workingCopy);
	assert.ok(code.resource === resource && side.model.contains(map) && f.firstGroup.model.activeTab === f.firstInput);
	assert.equal(code.workingCopy.buffer.getText(), text); assert.equal(code.isDirty(), true); assert.equal(code.workingCopy.canUndo, true);
	assert.equal(f.firstPart.groups.length, 2);
});

test('Open to Side resolves beside its captured invoking group instead of borrowing an existing foreign affinity', async t => {
	const f = fixture(t), { resource } = reveal(f, 'folder/third.lua');
	await f.editor.navigation.openResource(f.secondGroup, resource, { editorId: WORKBENCH_TEXT_EDITOR_ID });
	const retained = f.secondGroup.model.activeTab; f.first.focus(); f.panel.setFocused(true);
	const open = t.mock.method(f.editor.navigation, 'openResource'); secondary(f, reveal(f, resource.path).node);
	// Workspace routing may change without replacing this popup's invocation.
	f.editor.editorParts.activate(f.secondPart);
	accept(f, 'resources.openToSide'); assert.equal(open.mock.callCount(), 1); await open.mock.calls[0].result;
	const target = open.mock.calls[0].arguments[0];
	assert.ok(target !== f.firstGroup && f.editor.editorParts.partForGroup(target) === f.firstPart);
	assert.equal(f.firstPart.groups.length, 2); assert.equal(f.secondPart.groups.length, 1);
	assert.ok(f.secondGroup.model.activeTab === retained && target.model.activeTab instanceof CodeEditorInput && target.model.activeTab.resource === resource);
});

test('selection changes during the popup cannot substitute the side action resource', async t => {
	const f = fixture(t), captured = reveal(f, 'folder/third.lua'), open = t.mock.method(f.editor.navigation, 'openResource');
	secondary(f, captured.node); reveal(f, 'folder/other.lua'); assert.equal(f.editor.contextMenu.visible, true);
	accept(f, 'resources.openToSide'); assert.equal(open.mock.callCount(), 1); await open.mock.calls[0].result;
	const target = open.mock.calls[0].arguments[0], input = target.model.activeTab;
	assert.ok(input instanceof CodeEditorInput && input.resource === captured.resource && f.editor.editorParts.partForGroup(target) === f.firstPart);
});

test('retiring the invoked side reference closes the menu even when ordinary Open affinity survives elsewhere', async t => {
	const f = fixture(t), { resource } = reveal(f, 'folder/third.lua');
	await f.editor.navigation.openResource(f.secondGroup, resource); f.first.focus(); f.panel.setFocused(true);
	const open = t.mock.method(f.editor.navigation, 'openResource'); secondary(f, reveal(f, resource.path).node);
	assert.equal(f.editor.contextMenu.visible, true); assert.equal(await f.editor.editorParts.close(f.firstPart), true);
	assert.equal(f.editor.contextMenu.visible, false); assert.equal(open.mock.callCount(), 0);
	assert.equal(f.secondPart.groups.length, 1); assert.ok(f.secondGroup.model.activeTab instanceof CodeEditorInput && f.secondGroup.model.activeTab.resource === resource);
});

for (const retirement of ['filter', 'models'] as const) test(`${retirement} retirement revokes a pending side menu before topology exists`, t => {
	const f = fixture(t), { node } = reveal(f, 'folder/third.lua'), open = t.mock.method(f.editor.navigation, 'openResource');
	secondary(f, node);
	if (retirement === 'filter') f.panel.toggleFilterMode(); else editorTextModelService.clear();
	assert.equal(f.editor.contextMenu.visible, false); assert.equal(open.mock.callCount(), 0); assert.equal(f.firstPart.groups.length, 1);
});

test('a newer foreign focus on menu return aborts side opening before creating a destination', t => {
	const f = fixture(t), { node } = reveal(f, 'folder/third.lua'), open = t.mock.method(f.editor.navigation, 'openResource');
	secondary(f, node); let redirected = false;
	const unbind = f.panel.focusTarget.onDidFocus(() => { unbind(); redirected = true; f.second.focus(); }); t.after(unbind);
	accept(f, 'resources.openToSide');
	assert.equal(redirected, true); assert.equal(open.mock.callCount(), 0); assert.equal(f.firstPart.groups.length, 1);
	assert.ok(inputFocus.target === f.second.commandTarget && f.editor.editorParts.activeGroup === f.secondGroup);
});

test('workspace replacement during accepted side publication cannot open a retired destination', t => {
	const f = fixture(t), { node } = reveal(f, 'folder/third.lua'), parts = f.editor.editorParts;
	const open = t.mock.method(f.editor.navigation, 'openResource'); secondary(f, node); let cleared = false;
	const unbind = f.firstPart.onDidChangeGroups(() => { unbind(); cleared = true; parts.clear(); }); t.after(unbind);
	assert.doesNotThrow(() => accept(f, 'resources.openToSide'));
	assert.equal(cleared, true); assert.equal(open.mock.callCount(), 0); assert.equal(f.firstPart.retired, true);
	assert.equal(parts.groups.length, 1); assert.ok(parts.activeGroup === parts.main.activeGroup);
});

test('a newer real pane focused by side publication retains focus while the explicit split intent remains', t => {
	const f = fixture(t), { node } = reveal(f, 'folder/third.lua'), open = t.mock.method(f.editor.navigation, 'openResource');
	secondary(f, node); let redirected = false;
	const unbind = f.firstPart.onDidChangeGroups(() => { unbind(); redirected = true; f.second.focus(); }); t.after(unbind);
	accept(f, 'resources.openToSide');
	assert.equal(redirected, true); assert.equal(open.mock.callCount(), 0); assert.equal(f.firstPart.groups.length, 2);
	assert.ok(inputFocus.target === f.second.commandTarget && f.editor.editorParts.activeGroup === f.secondGroup);
});

test('Source to Side keeps an exact declaration and reads its current tracked canonical offset', async t => {
	const f = fixture(t, 'tiny', [['cartlib/world/scene_library.lua', 'return {}'], ['definitions.lua',
		"local scenes=require('cartlib/world/scene_library')\nscenes.register('same', { objects={} })\n"]]);
	const { node: file } = reveal(f, 'definitions.lua'); f.panel.toggleFileDisclosure(file); f.update();
	const node = file.children[0]; assert.ok(node !== undefined && node.element.kind === 'definition');
	const entry = node.element.content, model = resolveLuaTextFileModel(editorTextModelService, f.sources.catalog, entry.ownerResource);
	const open = t.mock.method(f.editor.navigation, 'openResource'); secondary(f, node);
	model.pushEditOperations([{ offset: 0, deleteLength: 0, text: '-- prefix\n' }]); f.update();
	assert.equal(f.editor.contextMenu.visible, true); accept(f, 'resources.sourceToSide');
	assert.equal(open.mock.callCount(), 1); await open.mock.calls[0].result;
	const target = open.mock.calls[0].arguments[0], code = target.model.activeTab;
	assert.ok(target !== f.firstGroup && f.editor.editorParts.partForGroup(target) === f.firstPart);
	assert.ok(code instanceof CodeEditorInput && code.workingCopy === model && code.resource === entry.ownerResource);
	assert.equal(captureCodeEditorView(code).cursor, entry.range.start);
});

test('a side destination retired during asynchronous resolution disposes its late candidate without stealing newer focus', async t => {
	const f = fixture(t), { node, resource } = reveal(f, 'folder/third.lua');
	const candidate = new CodeEditorInput(resolveLuaTextFileModel(editorTextModelService, f.sources.catalog, resource));
	const deferred = Promise.withResolvers<CodeEditorInput>(); let disposed = false;
	candidate.onWillDispose(() => { disposed = true; });
	t.mock.method(f.editor.resourceEditors, 'resolveEditorInput', () => deferred.promise);
	const open = t.mock.method(f.editor.navigation, 'openResource'); secondary(f, node); accept(f, 'resources.openToSide');
	assert.equal(open.mock.callCount(), 1); const side = open.mock.calls[0].arguments[0];
	assert.ok(side !== f.firstGroup && side.model.activeTab === null && f.firstPart.groups.length === 2);
	f.second.focus(); assert.equal(await f.editor.editorParts.closeGroup(side), true);
	deferred.resolve(candidate); assert.ok(await open.mock.calls[0].result === undefined);
	assert.equal(disposed, true); assert.equal(side.surface.retired, true); assert.equal(f.firstPart.groups.length, 1);
	assert.ok(inputFocus.target === f.second.commandTarget && f.editor.editorParts.activeGroup === f.secondGroup);
	assert.ok(f.firstGroup.model.activeTab === f.firstInput && f.firstGroup.panes.activePane?.input === f.firstInput);
});

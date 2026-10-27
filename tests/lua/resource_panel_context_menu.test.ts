import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { PointerButton } from '../../hosts/common/input/pointer_event';
import { KeyModifier } from '../../hosts/common/input/text';
import { editorViewState } from '../../ide/editor/ui/view/state';
import { editorTextModelService } from '../../ide/editor/model/model_service';
import { CallHierarchyModel } from '../../ide/editor/contrib/call_hierarchy/model';
import { getOrCreateSemanticProject } from '../../ide/editor/contrib/intellisense/semantic/workspace/state';
import { buildLuaSemanticFrontendFromSnapshot } from '../../toolchain/ts/lua/semantic/frontend';
import { resourceIdentityKey } from '../../ide/common/resource';
import { inputFocus } from '../../ide/input/focus';
import type { EditorCommandId } from '../../ide/common/commands';
import { CodeEditorInput, WORKBENCH_TEXT_EDITOR_ID } from '../../ide/workbench/contrib/code_editor/editor_input';
import { CartMapInput } from '../../ide/workbench/contrib/cart_maps/editor_input';
import type { FileElement } from '../../ide/workbench/contrib/resources/panel/files_model';
import type { WorkbenchTreeNode } from '../../ide/workbench/ui/tree_view';
import { resolveLuaTextFileModel } from '../../ide/workbench/services/working_copy/text_file_model';
import { captureCodeEditorView } from '../../ide/workbench/contrib/code_editor/view_snapshot';
import { registerLuaSourceRecord } from '../../ide/runtime/source_registry';
import { clearWorkspaceSourceCaches } from '../../ide/workspace/cache';
import { closeWorkspaceRecords, openWorkspaceRecords } from '../../ide/workspace/records';
import { createActualSourcePanes } from '../helpers/source_panes';
import { MemoryWorkspaceFiles } from '../helpers/workspace_files';

const SCENES = `local scenes=require('cartlib/world/scene_library')
scenes.register('same', { objects={} })
scenes.register('same', { objects={} })
`;

function fixture(t: TestContext, extra: readonly (readonly [string, string])[] = [], font: 'tiny' | 'msx' = 'tiny') {
	const f = createActualSourcePanes(t, false, [['folder/third.lua', 'return 3'], ['folder/other.lua', 'return 4'], ...extra]);
	f.editor.setFontVariant(font); f.update();
	assert.equal(editorViewState.font.variant, font, 'the actual workbench must use the requested test font');
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

function definition(f: Fixture, path = 'definitions.lua', index = 1) {
	const { node: file } = reveal(f, path);
	if (file.collapsed) f.panel.toggleFileDisclosure(file);
	f.update();
	const node = file.children[index];
	assert.ok(node !== undefined && node.element.kind === 'definition');
	f.panel.setSelectionIndex(f.panel.files.tree.rows.indexOf(node));
	return { node, entry: node.element.content };
}

/** Geometry locates physical input; the assertions below concern ownership and activation only. */
function secondary(f: Fixture, node: WorkbenchTreeNode<FileElement>, gutter = false): void {
	const index = f.panel.files.tree.rows.indexOf(node), metrics = f.panel.getItemMetrics(index), layout = f.panel.prepareLayout();
	const x = layout.contentLeft - f.panel.hscroll + (gutter ? (metrics.markerStartWidth + metrics.markerEndWidth) / 2
		: metrics.indentWidth + editorViewState.font.advance(' '));
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

for (const font of ['tiny', 'msx'] as const) test(`${font} secondary Files selection and directory disclosure gutter do not open or expand a subject`, t => {
	const f = fixture(t, [], font), target = reveal(f, 'folder/third.lua').node, directory = target.parent!;
	const open = t.mock.method(f.editor.navigation, 'openResource'), pane = f.firstGroup.panes.activePane;
	f.panel.setSelectionIndex(f.panel.files.tree.rows.indexOf(directory)); secondary(f, target);
	assert.equal(f.editor.contextMenu.visible, true); assert.ok(f.panel.files.selectedNode === target);
	assert.equal(open.mock.callCount(), 0); assert.ok(f.firstGroup.model.activeTab === f.firstInput && f.firstGroup.panes.activePane === pane);
	f.key('Escape'); assert.ok(inputFocus.target === f.panel.focusTarget);
	f.panel.toggleFileDisclosure(directory); const collapsed = directory.collapsed;
	f.panel.setSelectionIndex(0); secondary(f, directory, true);
	assert.equal(f.editor.contextMenu.visible, true); assert.ok(f.panel.files.selectedNode === directory);
	assert.equal(directory.collapsed, collapsed); assert.equal(open.mock.callCount(), 0);
	f.key('Escape'); assert.ok(inputFocus.target === f.panel.focusTarget);
});

for (const [code, modifiers] of [['ContextMenu', KeyModifier.none], ['F10', KeyModifier.shift]] as const)
	test(`${code} invokes the actual Files selection and cancellation returns to that same control without opening`, t => {
		const f = fixture(t), { node } = reveal(f, 'folder/third.lua'); f.panel.setFocused(true);
		const open = t.mock.method(f.editor.navigation, 'openResource');
		f.key(code, modifiers); assert.equal(f.editor.contextMenu.visible, true);
		assert.ok(f.editor.contextMenu.invocationOrigin === f.panel.focusTarget && f.panel.files.selectedNode === node);
		f.key('Escape'); assert.equal(f.editor.contextMenu.visible, false);
		assert.ok(inputFocus.target === f.panel.focusTarget && f.panel.files.selectedNode === node); assert.equal(open.mock.callCount(), 0);
	});

test('Files default YAML Open selects Map while Open Source retains the same dirty canonical working copy', async t => {
	await openWorkspaceRecords(new MemoryWorkspaceFiles());
	const f = fixture(t); t.after(async () => { await closeWorkspaceRecords(); clearWorkspaceSourceCaches(); });
	const path = 'res/data/castle_map.yaml', source = '1: { map: [".."], objects: [] }\n';
	f.sources.catalog.registerTextSources(f.sources.systemContextId, [{ type: 'data', resid: 'map', source_path: path, sourcemeta: { text: source } }]);
	f.panel.toggleFilterMode(); const { node, resource } = reveal(f, path);
	const open = t.mock.method(f.editor.navigation, 'openResource');
	secondary(f, node); accept(f, 'resources.open'); assert.equal(open.mock.callCount(), 1); await open.mock.calls[0].result;
	const map = f.firstGroup.model.activeTab; assert.ok(map instanceof CartMapInput && map.resource === resource);
	map.workingCopy.pushEditOperations([{ offset: 0, deleteLength: 0, text: '# canonical draft\n' }]); const text = map.workingCopy.buffer.getText();
	f.panel.setFocused(true); secondary(f, reveal(f, path).node); accept(f, 'resources.source');
	assert.equal(open.mock.callCount(), 2); await open.mock.calls[1].result;
	const code = f.firstGroup.model.activeTab;
	assert.ok(code instanceof CodeEditorInput && code.resource === resource && code.workingCopy === map.workingCopy && f.firstGroup.model.contains(map));
	assert.equal(code.workingCopy.buffer.getText(), text); assert.equal(code.isDirty(), true); assert.equal(code.workingCopy.canUndo, true);
});

test('changing Files selection while its popup is open never substitutes the captured file action', async t => {
	const f = fixture(t), original = reveal(f, 'folder/third.lua');
	const open = t.mock.method(f.editor.navigation, 'openResource'); secondary(f, original.node);
	reveal(f, 'folder/other.lua'); assert.equal(f.editor.contextMenu.visible, true);
	accept(f, 'resources.open'); assert.equal(open.mock.callCount(), 1); await open.mock.calls[0].result;
	const code = f.firstGroup.model.activeTab; assert.ok(code instanceof CodeEditorInput && code.resource === original.resource);
});

test('a newer foreign control focused during Files menu return aborts the action instead of borrowing its group', t => {
	const f = fixture(t), { node } = reveal(f, 'folder/third.lua'), open = t.mock.method(f.editor.navigation, 'openResource');
	secondary(f, node); let redirected = false;
	const unbind = f.panel.focusTarget.onDidFocus(() => { unbind(); redirected = true; f.second.focus(); }); t.after(unbind);
	accept(f, 'resources.open'); assert.equal(redirected, true); assert.equal(open.mock.callCount(), 0);
	assert.ok(inputFocus.target === f.second.commandTarget && f.secondGroup.model.activeTab === f.secondInput && f.firstGroup.model.activeTab === f.firstInput);
});

test('retiring the captured default destination closes Files popup authority before another group can inherit it', async t => {
	const f = fixture(t), { node } = reveal(f, 'folder/third.lua');
	const open = t.mock.method(f.editor.navigation, 'openResource'); secondary(f, node);
	assert.equal(f.editor.contextMenu.visible, true); assert.equal(await f.editor.editorParts.close(f.firstPart), true);
	assert.equal(f.editor.contextMenu.visible, false); assert.equal(open.mock.callCount(), 0);
	assert.ok(f.secondGroup.model.activeTab === f.secondInput);
});

test('retiring a distinct captured Source destination revokes the whole file popup rather than keeping its other action live', async t => {
	await openWorkspaceRecords(new MemoryWorkspaceFiles());
	const f = fixture(t), path = 'res/data/castle_map.yml';
	t.after(async () => { await closeWorkspaceRecords(); clearWorkspaceSourceCaches(); });
	f.sources.catalog.registerTextSources(f.sources.systemContextId, [{ type: 'data', resid: 'map', source_path: path,
		sourcemeta: { text: '1: { map: [".."], objects: [] }\n' } }]);
	const resource = f.sources.catalog.resolveResource({ contextId: f.sources.systemContextId, path })!;
	await f.editor.navigation.openResource(f.secondGroup, resource, { editorId: WORKBENCH_TEXT_EDITOR_ID });
	f.first.focus(); f.panel.toggleFilterMode(); const { node } = reveal(f, path); secondary(f, node);
	assert.equal(f.editor.contextMenu.visible, true); assert.equal(await f.editor.editorParts.close(f.secondPart), true);
	assert.equal(f.editor.contextMenu.visible, false); assert.ok(f.firstGroup.model.activeTab === f.firstInput);
});

for (const retirement of ['hide', 'filter', 'model clear'] as const) test(`Files ${retirement} revokes the popup without requiring a changed tree publication`, t => {
	const f = fixture(t), { node } = reveal(f, 'folder/third.lua'); secondary(f, node);
	const revision = f.panel.files.revision;
	if (retirement === 'hide') f.panel.hide();
	else if (retirement === 'filter') f.panel.toggleFilterMode();
	else editorTextModelService.clear();
	assert.equal(f.editor.contextMenu.visible, false);
	if (retirement === 'filter') assert.equal(f.panel.files.revision, revision);
});

test('switching the real panel to Call Hierarchy revokes its Files popup instead of retaining the old resource commands', t => {
	const path = 'calls.lua', f = fixture(t, [[path, 'local function target() end\nlocal function caller() target() end']]);
	const project = getOrCreateSemanticProject(editorTextModelService, f.sources.systemContextId);
	const frontend = buildLuaSemanticFrontendFromSnapshot(project.getSnapshot());
	const symbol = frontend.findSymbolsByPosition(resourceIdentityKey({ contextId: f.sources.systemContextId, path }), 1, 16)!;
	const hierarchy = new CallHierarchyModel(frontend, [symbol.targets[0].id], 'target', project);
	const { node } = reveal(f, 'folder/third.lua'); secondary(f, node); assert.equal(f.editor.contextMenu.visible, true);
	f.panel.showCallHierarchy(hierarchy);
	assert.equal(f.editor.contextMenu.visible, false); assert.equal(f.panel.getMode(), 'command');
	assert.ok(inputFocus.target === f.panel.focusTarget);
});

test('catalog removal and same-path recreation cannot retain the old Files resource popup', t => {
	const f = fixture(t), path = 'folder/third.lua', { node, resource } = reveal(f, path);
	const open = t.mock.method(f.editor.navigation, 'openResource'); secondary(f, node);
	const registry = f.sources.catalog.getContext(f.sources.systemContextId).luaSources, record = registry.path2lua[path];
	registry.records.splice(registry.records.indexOf(record), 1); delete registry.path2lua[path]; delete registry.module2lua[record.module_path];
	f.sources.catalog.rebuildResources(); f.update();
	assert.equal(f.editor.contextMenu.visible, false);
	registerLuaSourceRecord(registry, { ...record, update_timestamp: record.update_timestamp + 1 }); f.update();
	assert.ok(f.sources.catalog.resolveResource(resource) !== resource); assert.equal(open.mock.callCount(), 0);
});

for (const replace of [false, true]) test(`${replace ? 'equal-byte replacement' : 'deletion'} of an exact declaration closes its menu and Undo cannot revive that capability`, t => {
	const f = fixture(t, [['cartlib/world/scene_library.lua', 'return {}'], ['definitions.lua', SCENES]]);
	const { node, entry } = definition(f), model = resolveLuaTextFileModel(editorTextModelService, f.sources.catalog, entry.ownerResource);
	const open = t.mock.method(f.editor.navigation, 'openResource'); secondary(f, node);
	const text = replace ? model.buffer.getTextRange(entry.range.start, entry.range.end) : '';
	model.pushEditOperations([{ offset: entry.range.start, deleteLength: entry.range.end - entry.range.start, text }]); f.update();
	assert.equal(f.editor.contextMenu.visible, false); model.undo(); f.update();
	assert.equal(f.editor.contextMenu.visible, false); assert.equal(open.mock.callCount(), 0);
	assert.ok(f.firstGroup.model.activeTab === f.firstInput);
});

test('a harmless prefix edit keeps the exact declaration action and Source follows its mapped canonical range', async t => {
	const f = fixture(t, [['cartlib/world/scene_library.lua', 'return {}'], ['definitions.lua', SCENES]]);
	const { node, entry } = definition(f), model = resolveLuaTextFileModel(editorTextModelService, f.sources.catalog, entry.ownerResource);
	const open = t.mock.method(f.editor.navigation, 'openResource'), start = entry.range.start;
	secondary(f, node); const prefix = '-- prefix keeps declaration identity\n';
	model.pushEditOperations([{ offset: 0, deleteLength: 0, text: prefix }]); f.update();
	assert.equal(f.editor.contextMenu.visible, true); assert.equal(entry.range.start, start + prefix.length);
	accept(f, 'resources.source'); assert.equal(open.mock.callCount(), 1); await open.mock.calls[0].result;
	const code = f.firstGroup.model.activeTab; assert.ok(code instanceof CodeEditorInput && code.workingCopy === model && code.resource === entry.ownerResource);
	assert.equal(captureCodeEditorView(code).cursor, entry.range.start);
});

test('an imported animation declaration opens Source at its authored table owner instead of its browsed consumer', async t => {
	const f = fixture(t, [['cartlib/component/sprite_animation_component.lua', 'return {}'],
		['frames.lua', "return { frames={'idle.1'}, frame_run=2 }"],
		['consumer.lua', "local sprite=require('cartlib/component/sprite_animation_component'); sprite.factory(require('frames'))"]]);
	const { node, entry } = definition(f, 'consumer.lua', 0); assert.ok(entry.ownerResource !== entry.browserResource);
	const open = t.mock.method(f.editor.navigation, 'openResource'); secondary(f, node); accept(f, 'resources.source');
	assert.equal(open.mock.callCount(), 1); await open.mock.calls[0].result;
	const code = f.firstGroup.model.activeTab; assert.ok(code instanceof CodeEditorInput && code.resource === entry.ownerResource);
	assert.equal(captureCodeEditorView(code).cursor, entry.range.start);
});

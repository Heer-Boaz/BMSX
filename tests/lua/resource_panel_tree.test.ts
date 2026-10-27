import { TEST_CARTRIDGE_CONTEXT_IDS } from '../helpers/runtime_sources';
import { resourceIdentityKey } from '../../ide/common/resource';
import { EditorLuaSemanticProject } from '../../ide/editor/contrib/intellisense/semantic/workspace/project';
import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import type { CartEditor } from '../../ide/cart_editor';
import { CallHierarchyModel } from '../../ide/editor/contrib/call_hierarchy/model';
import { editorTextModelService, EditorTextModelService } from '../../ide/editor/model/model_service';
import { configureFontVariant } from '../../ide/editor/ui/view/configuration';
import { editorViewState } from '../../ide/editor/ui/view/state';
import { inputFocus } from '../../ide/input/focus';
import { pointerHover } from '../../ide/input/pointer/hover';
import { registerLuaSourceRecord, type LuaSourceRecord } from '../../ide/runtime/source_registry';
import { refreshWorkbenchLayout } from '../../ide/workbench/common/layout';
import { createResourceEditorResolver } from '../../ide/workbench/contrib/resources/editor_contributions';
import { EditorNavigationController } from '../../ide/workbench/contrib/resources/navigation';
import { ResourcePanelController } from '../../ide/workbench/contrib/resources/panel/controller';
import { ProjectContentIndex } from '../../ide/workbench/contrib/resources/panel/content_index';
import { BehaviorRegistrationIndex } from '../../ide/workbench/contrib/behavior_lens/registration_index';
import type { FileElement } from '../../ide/workbench/contrib/resources/panel/files_model';
import { Scrollbar } from '../../ide/workbench/ui/scrollbar';
import type { WorkbenchTreeNode } from '../../ide/workbench/ui/tree_view';
import { buildLuaSemanticFrontendFromSnapshot } from '../../toolchain/ts/lua/semantic/frontend';
import { createTestEditorParts } from '../helpers/editor_panes';
import { createScenarioTestSourceRecord, createScenarioTestSourceState } from '../helpers/scenario_sources';
import { KeyInputEvent, KeyModifier } from '../../hosts/common/input/text';
import { CartMapInput } from '../../ide/workbench/contrib/cart_maps/editor_input';
import { openWorkspaceRecords, closeWorkspaceRecords } from '../../ide/workspace/records';
import { clearWorkspaceSourceCaches } from '../../ide/workspace/cache';
import { MemoryWorkspaceFiles } from '../helpers/workspace_files';
import { handleResourcePanelPointer } from '../../ide/input/pointer/resource_panel_content';
import { PointerButton } from '../../hosts/common/input/pointer_event';
import type { FontVariant } from '../../machine/ts/render/shared/bmsx_font';

function fixture(t: TestContext, records: readonly LuaSourceRecord[] = Array.from({ length: 60 }, (_, index) => createScenarioTestSourceRecord(`directory_${index}/child.lua`, 1)), variant: FontVariant = 'tiny') {
	configureFontVariant(variant);
	editorViewState.viewportWidth = 384; editorViewState.viewportHeight = 288; refreshWorkbenchLayout();
	const sources = createScenarioTestSourceState(records);
	const parts = createTestEditorParts(t), group = parts.createDocument().activeGroup;
	const resourceEditors = createResourceEditorResolver(sources.catalog), editor = { editorParts: parts, resourceEditors, isActive: true } as CartEditor;
	const panel = new ResourcePanelController(editor, sources.catalog, { resourceVertical: new Scrollbar('vertical'), resourceHorizontal: new Scrollbar('horizontal') }, 0.35,
		new ProjectContentIndex(editorTextModelService, sources.catalog, new BehaviorRegistrationIndex(editorTextModelService, sources.catalog)));
	const navigation = new EditorNavigationController(sources.catalog, panel, resourceEditors);
	group.focus();
	Object.assign(editor, { navigation }); panel.setFontMetrics(editorViewState.font); panel.show();
	group.panes.layout({ left: 140, top: 20, right: 384, bottom: 270 });
	t.after(() => { panel.dispose(); editorTextModelService.clear(); inputFocus.setTarget(null); pointerHover.clear(); });
	return { panel, sources, group, navigation };
}

for (const variant of ['tiny', 'msx'] as const) test(`${variant} Files pointer discloses an expandable file without activating it; its body retains default activation`, t => {
	const path = `deep/tree/${'wide_name_'.repeat(12)}.lua`;
	const f = fixture(t, [createScenarioTestSourceRecord(path, 1)], variant), panel = f.panel;
	panel.queuePendingSelection({ contextId: TEST_CARTRIDGE_CONTEXT_IDS[0], path }); panel.applyPendingSelection();
	const node = panel.files.selectedNode!;
	assert.ok(node.element.kind === 'file');
	// Tree owners may advertise unresolved children before an explicit expansion.
	node.expandable = true; node.collapsed = true;
	const open = t.mock.method(f.navigation, 'openResource', async () => undefined);
	const index = panel.selectionIndex, metrics = panel.getItemMetrics(index);
	panel.prepareLayout(); panel.setHScroll(panel.files.tree.layout.indentWidth / 2);
	assert.ok(panel.hscroll > 0);
	const layout = panel.prepareLayout();
	const pointer = { valid: true, insideViewport: true,
		viewportX: layout.contentLeft - panel.hscroll + (metrics.markerStartWidth + metrics.markerEndWidth) / 2,
		viewportY: layout.contentTop + (index - panel.scroll + 0.5) * panel.lineHeight,
		pressedButtons: PointerButton.Primary, justPressedButtons: PointerButton.Primary, justReleasedButtons: 0 };
	assert.equal(handleResourcePanelPointer(panel, pointer, true), true);
	assert.equal(node.collapsed, false); assert.equal(open.mock.callCount(), 0);
	assert.equal(panel.files.selectedNode, node); assert.equal(panel.isFocused(), true);
	pointer.viewportX = layout.contentLeft - panel.hscroll + metrics.indentWidth + editorViewState.font.advance(' ');
	assert.equal(handleResourcePanelPointer(panel, pointer, true), true);
	assert.equal(open.mock.callCount(), 1); assert.equal(open.mock.calls[0].arguments[1], node.element.resource);
});

for (const variant of ['tiny', 'msx'] as const) test(`${variant} Files folder disclosure and Left/Right retain navigation focus without resource activation`, t => {
	const path = `deep/tree/${'wide_name_'.repeat(12)}.lua`;
	const f = fixture(t, [createScenarioTestSourceRecord(path, 1)], variant), panel = f.panel;
	panel.queuePendingSelection({ contextId: TEST_CARTRIDGE_CONTEXT_IDS[0], path }); panel.applyPendingSelection();
	panel.navigateFiles('left');
	const node = panel.files.selectedNode!; assert.equal(node.element.kind, 'directory');
	const open = t.mock.method(f.navigation, 'openResource', async () => undefined);
	const index = panel.selectionIndex, metrics = panel.getItemMetrics(index);
	panel.prepareLayout(); panel.setHScroll(panel.files.tree.layout.indentWidth / 2);
	const layout = panel.prepareLayout();
	assert.equal(handleResourcePanelPointer(panel, { valid: true, insideViewport: true,
		viewportX: layout.contentLeft - panel.hscroll + (metrics.markerStartWidth + metrics.markerEndWidth) / 2,
		viewportY: layout.contentTop + (index - panel.scroll + 0.5) * panel.lineHeight,
		pressedButtons: PointerButton.Primary, justPressedButtons: PointerButton.Primary, justReleasedButtons: 0 }, true), true);
	assert.equal(node.collapsed, true); assert.equal(panel.isFocused(), true);
	for (const key of ['ArrowRight', 'ArrowLeft']) {
		const input = new KeyInputEvent(key, KeyModifier.none);
		inputFocus.handleKeyboard(input); inputFocus.handleKeyboard(new KeyInputEvent(key, KeyModifier.none, false, false));
		assert.equal(input.consumed, true); assert.equal(panel.files.selectedNode, node); assert.equal(panel.isFocused(), true);
	}
	assert.equal(node.collapsed, true); assert.equal(open.mock.callCount(), 0);
});

test('folder activation retains Files focus; a leaf invokes the real resource opener and reuses its working copy', async t => {
	const f = fixture(t), original = f.navigation.openResource.bind(f.navigation);
	let opening: ReturnType<EditorNavigationController['openResource']> | undefined;
	const open = t.mock.method(f.navigation, 'openResource', (...args: Parameters<EditorNavigationController['openResource']>) => { opening = original(...args); return opening; });
	f.panel.navigateFiles('home'); f.panel.navigateFiles('right');
	const folder = f.panel.files.selectedNode!; assert.equal(folder.element.kind, 'directory');
	f.panel.openSelected();
	assert.equal(open.mock.callCount(), 0); assert.equal(f.panel.isFocused(), true); assert.equal(folder.collapsed, false);
	f.panel.navigateFiles('right'); const file = f.panel.files.selectedNode!; assert.ok(file.element.kind === 'file');
	f.panel.openSelected(); assert.equal(open.mock.callCount(), 1); await opening;
	assert.ok(open.mock.calls[0].arguments[0] === f.group, 'Files opens in the chosen invoking editor group');
	assert.equal(open.mock.calls[0].arguments[1], file.element.resource);
	const input = f.group.panes.activePane!.input;
	assert.equal(input.resource, file.element.resource); assert.equal(f.panel.isFocused(), false);
	assert.equal(input.isDirty(), false);
	f.panel.setFocused(true); f.panel.openSelected(); await opening;
	assert.equal(f.group.panes.activePane!.input, input);
});

for (const [path, kind, source] of [
	['res/data/castle_map.yaml', 'pietious', '1: { map: [".."], objects: [] }\n'],
	['res/data/castle_map.yml', 'pietious', '1: { map: [".."], objects: [] }\n'],
	['res/data/nemesis_s_stage.yaml', 'nemesis', 'map_rows: ["m "]\n'],
	['res/data/nemesis_s_stage.yml', 'nemesis', 'map_rows: ["m "]\n'],
] as const) test(`Files Enter opens ${path} in its Map contribution and reuses the retained dirty input`, async t => {
	await openWorkspaceRecords(new MemoryWorkspaceFiles());
	const f = fixture(t, []), identity = { contextId: TEST_CARTRIDGE_CONTEXT_IDS[0], path };
	t.after(async () => { clearWorkspaceSourceCaches(); f.sources.catalog.dispose(); await closeWorkspaceRecords(); });
	f.sources.catalog.registerTextSources(identity.contextId, [{ type: 'data', resid: 'map', source_path: path, sourcemeta: { text: source } }]);
	f.panel.toggleFilterMode(); f.panel.queuePendingSelection(identity); f.panel.applyPendingSelection(); f.panel.prepareLayout();
	const selected = f.panel.files.selectedNode!;
	assert.ok(selected.element.kind === 'file');
	const resource = selected.element.resource, original = f.navigation.openResource.bind(f.navigation);
	let opening: ReturnType<EditorNavigationController['openResource']> | undefined;
	const open = t.mock.method(f.navigation, 'openResource', (...args: Parameters<EditorNavigationController['openResource']>) => { opening = original(...args); return opening; });
	f.panel.setFocused(true);
	const enter = new KeyInputEvent('Enter', KeyModifier.none);
	inputFocus.handleKeyboard(enter); inputFocus.handleKeyboard(new KeyInputEvent('Enter', KeyModifier.none, false, false));
	assert.equal(enter.consumed, true); assert.equal(open.mock.callCount(), 1); await opening;
	const input = f.group.model.activeTab!;
	assert.ok(input instanceof CartMapInput);
	assert.equal(input.mapKind, kind); assert.ok(input.resource === resource);
	assert.ok(input.workingCopy === editorTextModelService.get(identity));
	assert.equal(input.workingCopy.buffer.getText(), source);
	assert.equal(f.panel.isFocused(), false);
	input.workingCopy.pushEditOperations([{ offset: 0, deleteLength: 0, text: '# retained draft\n' }]);
	const edited = input.workingCopy.buffer.getText(), version = input.workingCopy.version;
	f.panel.setFocused(true);
	inputFocus.handleKeyboard(new KeyInputEvent('Enter', KeyModifier.none));
	inputFocus.handleKeyboard(new KeyInputEvent('Enter', KeyModifier.none, false, false));
	assert.equal(open.mock.callCount(), 2); await opening;
	assert.ok(f.group.model.activeTab === input && f.group.panes.activePane!.input === input);
	assert.equal(f.group.model.tabs.length, 1);
	assert.equal(input.workingCopy.buffer.getText(), edited); assert.equal(input.workingCopy.version, version);
	assert.equal(input.workingCopy.dirty, true);
});

test('Files separates canonical project, shared and generated ownership while reveal opens the retained dirty resource', async t => {
	const local = createScenarioTestSourceRecord('cartlib/local.lua', 1, 'return 1');
	const shared = createScenarioTestSourceRecord('runtime/world.lua', 1, 'return 42', 'cartlib/world.lua');
	const tests = createScenarioTestSourceRecord('testlib/assert.lua', 1, 'return true', 'testlib/assert.lua');
	const generated = { ...createScenarioTestSourceRecord('bmsx/gpu.lua', 1, 'return {}'), generated: true };
	const f = fixture(t, [local, shared, tests, generated]);
	const reveal = (path: string) => {
		f.panel.queuePendingSelection({ contextId: TEST_CARTRIDGE_CONTEXT_IDS[0], path }); f.panel.applyPendingSelection();
		const node = f.panel.files.selectedNode!; assert.ok(node.element.kind === 'file');
		return node;
	};
	const rootOf = (node: WorkbenchTreeNode<FileElement>) => {
		while (node.parent !== null) node = node.parent;
		return node;
	};
	const localLeaf = reveal(local.source_path), projectRoot = rootOf(localLeaf);
	assert.ok(projectRoot.element.kind === 'root');
	assert.equal(projectRoot.element.locationKind, 'project'); assert.equal(projectRoot.element.path, 'carts/nemesis_s');
	assert.equal(localLeaf.parent!.element.path, 'cartlib', 'a directory name never decides project membership');
	const sharedLeaf = reveal(shared.source_path), workspaceRoot = rootOf(sharedLeaf);
	assert.ok(workspaceRoot.element.kind === 'root'); assert.equal(workspaceRoot.element.locationKind, 'workspace');
	assert.ok(workspaceRoot !== projectRoot); assert.equal(sharedLeaf.parent!.element.path, 'cartlib');
	assert.ok(rootOf(reveal(tests.source_path)) === workspaceRoot);
	const generatedRoot = rootOf(reveal(generated.source_path));
	assert.ok(generatedRoot.element.kind === 'root'); assert.equal(generatedRoot.element.locationKind, 'generated');
	assert.ok(generatedRoot !== projectRoot && generatedRoot !== workspaceRoot);
	reveal(shared.source_path);
	const resource = f.sources.catalog.resources.find(resource => resource.contextId === TEST_CARTRIDGE_CONTEXT_IDS[0] && resource.path === shared.source_path)!;
	await f.navigation.openResource(f.group, resource);
	const input = f.group.panes.activePane!.input;
	const model = editorTextModelService.get(resource)!;
	model.pushEditOperations([{ offset: 0, deleteLength: 0, text: '-- unsaved shared source\n' }]);
	const bytes = model.buffer.getText(); assert.equal(input.isDirty(), true);
	const replacement = { ...shared, update_timestamp: 2 };
	registerLuaSourceRecord(f.sources.catalog.getContext(TEST_CARTRIDGE_CONTEXT_IDS[0]).luaSources, replacement);
	assert.ok(f.sources.catalog.registerLuaResource(TEST_CARTRIDGE_CONTEXT_IDS[0], replacement) === resource);
	f.panel.refresh();
	assert.ok(f.panel.files.selectedNode === sharedLeaf); assert.ok(rootOf(sharedLeaf) === workspaceRoot);
	await f.navigation.openResource(f.group, resource);
	assert.ok(f.group.panes.activePane!.input === input); assert.ok(editorTextModelService.get(resource) === model);
	assert.equal(model.buffer.getText(), bytes); assert.equal(input.isDirty(), true);
	model.undo(); assert.equal(model.buffer.getText(), shared.src); assert.equal(input.isDirty(), false);
});

test('hide/show and Call Hierarchy presentation retain the actual selected folder and independent Files reading position', t => {
	const f = fixture(t);
	f.panel.queuePendingSelection({ contextId: TEST_CARTRIDGE_CONTEXT_IDS[0], path: 'directory_40/child.lua' }); f.panel.applyPendingSelection();
	f.panel.navigateFiles('left'); f.panel.navigateFiles('left');
	const folder = f.panel.files.selectedNode!; assert.equal(folder.collapsed, true);
	f.panel.setScroll(10); const scroll = f.panel.scroll;
	assert.ok(scroll > 0); f.panel.hide(); f.panel.show(); f.panel.prepareLayout();
	assert.equal(f.panel.files.selectedNode, folder); assert.equal(folder.collapsed, true); assert.equal(f.panel.scroll, scroll);
	const project = new EditorLuaSemanticProject(TEST_CARTRIDGE_CONTEXT_IDS[0], new EditorTextModelService());
	const resource = { contextId: TEST_CARTRIDGE_CONTEXT_IDS[0], path: 'calls.lua' };
	project.updateDocument(resource, 'local function target() end\nlocal function caller() target() end');
	t.after(() => project.dispose());
	const frontend = buildLuaSemanticFrontendFromSnapshot(project.getSnapshot());
	const symbol = frontend.findSymbolsByPosition(resourceIdentityKey(resource), 1, 16)!;
	f.panel.showCallHierarchy(new CallHierarchyModel(frontend, [symbol.targets[0].id], 'target', project)); f.panel.prepareLayout();
	f.panel.hide(); f.panel.show(); f.panel.prepareLayout();
	assert.equal(f.panel.files.selectedNode, folder); assert.equal(folder.collapsed, true); assert.equal(f.panel.scroll, scroll);
});

test('manual scrolling does not reveal the untouched selection or convert the view into a second selection cursor', t => {
	const f = fixture(t); f.panel.navigateFiles('home');
	const selected = f.panel.files.selectedNode;
	f.panel.scrollBy(10); const scroll = f.panel.scroll; assert.ok(scroll > 0);
	for (let frame = 0; frame < 10; frame++) { f.panel.refresh(); f.panel.clampHScroll(); f.panel.setScroll(f.panel.scroll); }
	assert.equal(f.panel.scroll, scroll); assert.equal(f.panel.files.selectedNode, selected);
});

test('clean catalog updates preserve hover and cached measurements; a real publication merges before the next interaction', t => {
	const f = fixture(t); f.panel.navigateFiles('home'); f.panel.navigateFiles('right');
	const folder = f.panel.files.selectedNode, revision = f.panel.files.revision;
	f.panel.hoverIndex = f.panel.selectionIndex;
	pointerHover.beginDispatch(); pointerHover.visit(f.panel); pointerHover.endDispatch();
	const font = editorViewState.font, advance = font.advance; let measures = 0;
	font.advance = value => { measures++; return advance.call(font, value); };
	t.after(() => { font.advance = advance; });
	for (let frame = 0; frame < 1000; frame++) { f.panel.refresh(); f.panel.prepareLayout(); }
	assert.equal(measures, 0); assert.equal(f.panel.files.revision, revision);
	assert.equal(f.panel.hoverIndex, f.panel.selectionIndex);
	const source = createScenarioTestSourceRecord('aaa/new.lua', 2);
	registerLuaSourceRecord(f.sources.catalog.getContext(TEST_CARTRIDGE_CONTEXT_IDS[0]).luaSources, source); f.sources.catalog.registerLuaResource(TEST_CARTRIDGE_CONTEXT_IDS[0], source);
	f.panel.refresh();
	assert.equal(f.panel.files.selectedNode, folder); assert.ok(f.panel.files.revision > revision); assert.equal(f.panel.hoverIndex, -1);
});

test('panel refresh owns the active view without rebuilding Call Hierarchy or updating a hidden Files catalog', t => {
	const f = fixture(t);
	const project = new EditorLuaSemanticProject(TEST_CARTRIDGE_CONTEXT_IDS[0], new EditorTextModelService());
	const resource = { contextId: TEST_CARTRIDGE_CONTEXT_IDS[0], path: 'calls.lua' };
	project.updateDocument(resource, 'local function target() end\nlocal function caller() target() end');
	t.after(() => project.dispose());
	const frontend = buildLuaSemanticFrontendFromSnapshot(project.getSnapshot());
	const target = frontend.findSymbolsByPosition(resourceIdentityKey(resource), 1, 16)!;
	const model = new CallHierarchyModel(frontend, [target.targets[0].id], 'target', project);
	f.panel.showCallHierarchy(model);
	const incoming = t.mock.method(model, 'resolveIncomingCalls'), outgoing = t.mock.method(model, 'resolveOutgoingCalls');
	const hasChildren = t.mock.method(model, 'hasChildren');
	const catalog = t.mock.method(f.sources.catalog.resourceByIdentity, Symbol.iterator);
	const selected = f.panel.selectionIndex, metrics = f.panel.getItemMetrics(selected);
	for (let frame = 0; frame < 1000; frame++) f.panel.refresh();
	assert.equal(incoming.mock.callCount(), 0); assert.equal(outgoing.mock.callCount(), 0);
	assert.equal(hasChildren.mock.callCount(), 0); assert.equal(catalog.mock.callCount(), 0);
	assert.equal(f.panel.selectionIndex, selected); assert.equal(f.panel.getItemMetrics(selected), metrics);
	f.panel.toggleCallHierarchyDirection();
	assert.ok(outgoing.mock.callCount() > 0); assert.ok(hasChildren.mock.callCount() > 0);
	f.panel.hide();
	for (let frame = 0; frame < 1000; frame++) f.panel.refresh();
	assert.equal(catalog.mock.callCount(), 0);
});

test('an excluded reveal waits for a changed tree instead of retrying on every frame', t => {
	const f = fixture(t), identity = { contextId: TEST_CARTRIDGE_CONTEXT_IDS[0], path: 'settings.yaml' };
	f.sources.catalog.registerTextSources(identity.contextId, [{ type: 'data', resid: 'settings', source_path: identity.path }]);
	f.panel.refresh();
	const reveal = t.mock.method(f.panel.files, 'reveal');
	f.panel.queuePendingSelection(identity); f.panel.applyPendingSelection();
	assert.equal(reveal.mock.callCount(), 1);
	for (let frame = 0; frame < 1000; frame++) f.panel.refresh();
	assert.equal(reveal.mock.callCount(), 1);
	f.panel.toggleFilterMode();
	assert.equal(reveal.mock.callCount(), 2);
	const selected = f.panel.files.selectedNode!; assert.ok(selected.element.kind === 'file');
	assert.equal(selected.element.resource, f.sources.catalog.resources.find(resource => resource.contextId === identity.contextId && resource.path === identity.path));
});

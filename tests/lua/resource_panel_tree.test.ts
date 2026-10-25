import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { VirtualHeadlessClock } from '../../hosts/node/headless/clock';
import type { CartEditor } from '../../ide/cart_editor';
import { CallHierarchyModel } from '../../ide/editor/contrib/call_hierarchy/model';
import { editorTextModelService } from '../../ide/editor/model/model_service';
import { configureFontVariant } from '../../ide/editor/ui/view/view';
import { editorViewState } from '../../ide/editor/ui/view/state';
import { inputFocus } from '../../ide/input/focus';
import { pointerHover } from '../../ide/input/pointer/hover';
import { registerRuntimeLuaResource, registerWorkspaceTextSources } from '../../ide/runtime/sources';
import { registerLuaSourceRecord, type LuaSourceRecord } from '../../ide/runtime/source_registry';
import { refreshWorkbenchLayout } from '../../ide/workbench/common/layout';
import { EditorSearchController } from '../../ide/workbench/contrib/code_editor/find/search';
import { renameController } from '../../ide/workbench/contrib/code_editor/rename/controller';
import { createResourceEditorResolver } from '../../ide/workbench/contrib/resources/editor_contributions';
import { EditorNavigationController } from '../../ide/workbench/contrib/resources/navigation';
import { ResourcePanelController } from '../../ide/workbench/contrib/resources/panel/controller';
import type { FileElement } from '../../ide/workbench/contrib/resources/panel/files_model';
import { Scrollbar } from '../../ide/workbench/ui/scrollbar';
import { editorTabGroup } from '../../ide/workbench/ui/tab/group_model';
import type { WorkbenchTreeNode } from '../../ide/workbench/ui/tree_view';
import { buildLuaSemanticFrontend } from '../../toolchain/ts/lua/semantic/frontend';
import { createTestEditorPanes } from '../helpers/editor_panes';
import { createScenarioTestSourceRecord, createScenarioTestSourceState } from '../helpers/scenario_sources';

function fixture(t: TestContext, records: readonly LuaSourceRecord[] = Array.from({ length: 60 }, (_, index) => createScenarioTestSourceRecord(`directory_${index}/child.lua`, 1))) {
	configureFontVariant(new VirtualHeadlessClock(), 'tiny', null);
	editorViewState.viewportWidth = 384; editorViewState.viewportHeight = 288; refreshWorkbenchLayout();
	const sources = createScenarioTestSourceState(records);
	const panes = createTestEditorPanes(), editor = { editorPanes: panes, isActive: true } as CartEditor;
	const panel = new ResourcePanelController(editor, sources, { resourceVertical: new Scrollbar('vertical'), resourceHorizontal: new Scrollbar('horizontal') }, 0.35);
	const navigation = new EditorNavigationController(sources, panel, createResourceEditorResolver(sources), panes, new EditorSearchController(sources, renameController));
	Object.assign(editor, { navigation }); panel.setFontMetrics(editorViewState.font); panel.show();
	panes.layout({ left: 140, top: 20, right: 384, bottom: 270 });
	t.after(() => { panel.hide(); panes.dispose(); editorTabGroup.clear(); editorTextModelService.clear(); inputFocus.setTarget(null); pointerHover.clear(); });
	return { panel, sources, panes, navigation };
}

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
	const input = f.panes.activePane!.input;
	assert.equal(input.resource, file.element.resource); assert.equal(f.panel.isFocused(), false);
	assert.equal(input.isDirty(), false);
	f.panel.setFocused(true); f.panel.openSelected(); await opening;
	assert.equal(f.panes.activePane!.input, input);
});

test('Files separates canonical project, shared and generated ownership while reveal opens the retained dirty resource', async t => {
	const local = createScenarioTestSourceRecord('cartlib/local.lua', 1, 'return 1');
	const shared = createScenarioTestSourceRecord('runtime/world.lua', 1, 'return 42', 'cartlib/world.lua');
	const tests = createScenarioTestSourceRecord('testlib/assert.lua', 1, 'return true', 'testlib/assert.lua');
	const generated = { ...createScenarioTestSourceRecord('bmsx/gpu.lua', 1, 'return {}'), generated: true };
	const f = fixture(t, [local, shared, tests, generated]);
	const reveal = (path: string) => {
		f.panel.queuePendingSelection({ domain: 0, path }); f.panel.applyPendingSelection();
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
	const resource = f.sources.resources.find(resource => resource.domain === 0 && resource.path === shared.source_path)!;
	await f.navigation.openResource(resource);
	const input = f.panes.activePane!.input;
	const model = editorTextModelService.get(resource)!;
	model.pushEditOperations([{ offset: 0, deleteLength: 0, text: '-- unsaved shared source\n' }]);
	const bytes = model.buffer.getText(); assert.equal(input.isDirty(), true);
	const replacement = { ...shared, update_timestamp: 2 };
	registerLuaSourceRecord(f.sources.cartridgeSlots[0]!.luaSources, replacement);
	assert.ok(registerRuntimeLuaResource(f.sources, 0, replacement) === resource);
	f.panel.refresh();
	assert.ok(f.panel.files.selectedNode === sharedLeaf); assert.ok(rootOf(sharedLeaf) === workspaceRoot);
	await f.navigation.openResource(resource);
	assert.ok(f.panes.activePane!.input === input); assert.ok(editorTextModelService.get(resource) === model);
	assert.equal(model.buffer.getText(), bytes); assert.equal(input.isDirty(), true);
	model.undo(); assert.equal(model.buffer.getText(), shared.src); assert.equal(input.isDirty(), false);
});

test('hide/show and Call Hierarchy presentation retain the actual selected folder and independent Files reading position', t => {
	const f = fixture(t);
	f.panel.queuePendingSelection({ domain: 0, path: 'directory_40/child.lua' }); f.panel.applyPendingSelection();
	f.panel.navigateFiles('left'); f.panel.navigateFiles('left');
	const folder = f.panel.files.selectedNode!; assert.equal(folder.collapsed, true);
	f.panel.setScroll(10); const scroll = f.panel.scroll;
	assert.ok(scroll > 0); f.panel.hide(); f.panel.show(); f.panel.prepareLayout();
	assert.equal(f.panel.files.selectedNode, folder); assert.equal(folder.collapsed, true); assert.equal(f.panel.scroll, scroll);
	const frontend = buildLuaSemanticFrontend([{ path: 'calls.lua', source: 'local function target() end\nlocal function caller() target() end' }]);
	const symbol = frontend.findSymbolsByPosition('calls.lua', 1, 16)!;
	f.panel.showCallHierarchy(new CallHierarchyModel(frontend, [symbol.targets[0].id], 'target')); f.panel.prepareLayout();
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
	registerLuaSourceRecord(f.sources.cartridgeSlots[0]!.luaSources, source); registerRuntimeLuaResource(f.sources, 0, source);
	f.panel.refresh();
	assert.equal(f.panel.files.selectedNode, folder); assert.ok(f.panel.files.revision > revision); assert.equal(f.panel.hoverIndex, -1);
});

test('panel refresh owns the active view without rebuilding Call Hierarchy or updating a hidden Files catalog', t => {
	const f = fixture(t);
	const frontend = buildLuaSemanticFrontend([{ path: 'calls.lua', source: 'local function target() end\nlocal function caller() target() end' }]);
	const target = frontend.findSymbolsByPosition('calls.lua', 1, 16)!;
	const model = new CallHierarchyModel(frontend, [target.targets[0].id], 'target');
	f.panel.showCallHierarchy(model);
	const incoming = t.mock.method(model, 'resolveIncomingCalls'), outgoing = t.mock.method(model, 'resolveOutgoingCalls');
	const hasChildren = t.mock.method(model, 'hasChildren');
	const catalog = t.mock.method(f.sources.resourceByIdentity, Symbol.iterator);
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
	const f = fixture(t), identity = { domain: 0 as const, path: 'settings.yaml' };
	registerWorkspaceTextSources(f.sources, identity.domain, [{ type: 'data', resid: 'settings', source_path: identity.path }]);
	f.panel.refresh();
	const reveal = t.mock.method(f.panel.files, 'reveal');
	f.panel.queuePendingSelection(identity); f.panel.applyPendingSelection();
	assert.equal(reveal.mock.callCount(), 1);
	for (let frame = 0; frame < 1000; frame++) f.panel.refresh();
	assert.equal(reveal.mock.callCount(), 1);
	f.panel.toggleFilterMode();
	assert.equal(reveal.mock.callCount(), 2);
	const selected = f.panel.files.selectedNode!; assert.ok(selected.element.kind === 'file');
	assert.equal(selected.element.resource, f.sources.resources.find(resource => resource.domain === identity.domain && resource.path === identity.path));
});

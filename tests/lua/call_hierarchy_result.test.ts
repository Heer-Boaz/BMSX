import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { resourceIdentityKey } from '../../ide/common/resource';
import type { EditorCommandRunner } from '../../ide/common/commands';
import { inputFocus } from '../../ide/input/focus';
import { resetNavigationHistoryState } from '../../ide/navigation/navigation_history';
import { EditorTextModelService } from '../../ide/editor/model/model_service';
import { configureFontVariant } from '../../ide/editor/ui/view/configuration';
import { EditorLuaSemanticProject } from '../../ide/editor/contrib/intellisense/semantic/workspace/project';
import { CallHierarchyDirection, CallHierarchyModel } from '../../ide/editor/contrib/call_hierarchy/model';
import { buildLuaSemanticFrontendFromSnapshot } from '../../toolchain/ts/lua/semantic/frontend';
import { CallHierarchyInput } from '../../ide/workbench/contrib/call_hierarchy/editor_input';
import { CallHierarchyPane } from '../../ide/workbench/contrib/call_hierarchy/editor_pane';
import { CallHierarchyNavigationSelection } from '../../ide/workbench/contrib/call_hierarchy/view_snapshot';
import { HostErrorInput } from '../../ide/workbench/contrib/host_error/editor_input';
import { TextEditorInput } from '../../ide/workbench/common/editor_input';
import { EditorGroupView } from '../../ide/workbench/services/editor/editor_group';
import { WorkspaceSourceCatalog } from '../../ide/workspace/source_catalog';
import { createTestEditorPaneContributions, createTestGroupPresentation } from '../helpers/editor_panes';
import { TEST_CARTRIDGE_CONTEXT_IDS } from '../helpers/runtime_sources';

const SOURCE = `local function target() end
local function left() target() end
local function right() target() end
local function shared() left() right() end`;

function fixture(t: TestContext) {
	const models = new EditorTextModelService(), project = new EditorLuaSemanticProject(TEST_CARTRIDGE_CONTEXT_IDS[0], models);
	const resource = { contextId: TEST_CARTRIDGE_CONTEXT_IDS[0], path: 'calls.lua' };
	project.updateDocument(resource, SOURCE);
	const frontend = buildLuaSemanticFrontendFromSnapshot(project.getSnapshot());
	const symbol = frontend.findSymbolsByPosition(resourceIdentityKey(resource), 1, 16)!;
	const model = new CallHierarchyModel(frontend, [symbol.targets[0].id], 'target', project);
	const input = new CallHierarchyInput(model);
	t.after(() => { input.dispose(); project.dispose(); models.clear(); resetNavigationHistoryState(); });
	return { model, input };
}

function paneFixture(t: TestContext) {
	configureFontVariant('tiny');
	const f = fixture(t), catalog = new WorkspaceSourceCatalog(), presentation = createTestGroupPresentation();
	const commands: EditorCommandRunner = {
		isEnabled: (command, target) => target?.getCommand(command)?.isEnabled() === true,
		execute: (command, target) => { const action = target?.getCommand(command); if (action?.isEnabled()) action.run(); },
	};
	const contributions = createTestEditorPaneContributions(commands, presentation.contextMenu);
	contributions.call_hierarchy = { create: group => new CallHierarchyPane(group, commands, catalog, presentation.contextMenu,
		presentation.surfaces, presentation.workArea), measure: (_input, _font, _companion, constraints) => {
		constraints.minimumWidth = 0; constraints.minimumHeight = 0; constraints.companionWidth = undefined;
	} };
	const group = new EditorGroupView(contributions, commands, () => Promise.resolve(false), presentation);
	t.after(() => { inputFocus.setTarget(null); group.dispose(); presentation.contextMenu.dispose(); presentation.surfaces.dispose(); catalog.dispose(); });
	group.layout({ left: 0, top: 0, right: 400, bottom: 100 }, presentation.workArea, true);
	group.openEditor(f.input);
	const pane = group.panes.activePane; assert.ok(pane instanceof CallHierarchyPane);
	return { ...f, group, pane, commands, contextMenu: presentation.contextMenu };
}

test('Call Hierarchy resolves only an explicitly expanded layer and reuses its real query nodes', t => {
	const f = fixture(t), tree = f.input.tree;
	assert.equal(tree.rows.length, 3);
	const left = tree.rows[1];
	assert.ok(left.element.node === f.model.resolveIncomingCalls(f.model.roots[0])[0]);
	const incoming = t.mock.method(f.model, 'resolveIncomingCalls');
	tree.select(1); tree.navigate('right');
	assert.equal(incoming.mock.callCount(), 1);
	assert.ok(tree.rows.some(row => row.parent === left && row.element.node !== undefined));
	const children = [...left.children];
	tree.navigate('left'); tree.navigate('right');
	assert.equal(incoming.mock.callCount(), 1);
	assert.ok(children.every((child, index) => left.children[index] === child));
	assert.ok(left.children.some(child => child.element.node === undefined && child.element.range === left.element.node!.fromRanges[0]));
});

test('direction changes preserve independent topology, selection and reading state instead of rebuilding results', t => {
	const f = fixture(t), incoming = f.input.tree;
	incoming.select(1); incoming.navigate('right'); incoming.navigate('right');
	incoming.updateLayout(0, 0, 100, 10, 10, 10);
	incoming.scroll = incoming.selectionIndex;
	const selected = incoming.rows[incoming.selectionIndex], scroll = incoming.scroll, rows = [...incoming.rows];
	f.input.setDirection(CallHierarchyDirection.CallsFrom);
	assert.ok(f.input.tree !== incoming);
	const outgoing = f.input.tree;
	f.input.setDirection(CallHierarchyDirection.CallsTo);
	assert.ok(f.input.tree === incoming && incoming.rows[incoming.selectionIndex] === selected);
	assert.equal(incoming.scroll, scroll);
	assert.ok(rows.every((row, index) => incoming.rows[index] === row));
	f.input.setDirection(CallHierarchyDirection.CallsFrom);
	assert.ok(f.input.tree === outgoing);
});

test('query identity is distinct from identical captions and never participates as a source working-copy consumer', t => {
	const f = fixture(t), other = new CallHierarchyInput(f.model); t.after(() => other.dispose());
	assert.equal(f.input.matches(other), false);
	assert.equal(f.input.serializable, false); assert.equal(f.input.canMove(), true);
	assert.equal(f.input.isDirty(), false); assert.equal(f.input.resource, undefined);
	assert.equal(f.input instanceof TextEditorInput, false);
	assert.ok(f.input.tree !== other.tree && f.input.tree.rows[0] !== other.tree.rows[0]);
});

test('navigation restores the selected query occurrence and direction without retaining a pane attachment', t => {
	const f = fixture(t), tree = f.input.tree;
	tree.select(1); tree.navigate('right'); tree.navigate('right');
	tree.updateLayout(0, 0, 100, 10, 10, 10); tree.scroll = 0;
	const selected = tree.rows[tree.selectionIndex], location = new CallHierarchyNavigationSelection(f.input);
	t.after(() => location.dispose());
	tree.setCollapsed(0, true); f.input.setDirection(CallHierarchyDirection.CallsFrom);
	assert.equal(location.matches(new CallHierarchyNavigationSelection(f.input)), false);
	location.restore(f.input);
	assert.ok(f.input.tree === tree && tree.rows[tree.selectionIndex] === selected);
	assert.equal(selected.parent!.collapsed, false); assert.equal(tree.roots[0].collapsed, false);
	assert.equal(tree.scroll, 0, 'restoration preserves reading position even when the historical selection is outside it');
});

test('a detached result pane preserves input-owned state and idle layout does not requery semantic branches', t => {
	const f = paneFixture(t), tree = f.input.tree;
	tree.select(1); tree.navigate('right'); tree.navigate('right');
	const selected = tree.rows[tree.selectionIndex], rows = [...tree.rows];
	const snapshot = f.pane.getSelection();
	f.group.openEditor(new HostErrorInput('independent result'));
	assert.ok(f.group.panes.activePane !== f.pane);
	f.group.activate(f.input.id);
	assert.ok(f.group.panes.activePane === f.pane && f.input.tree === tree);
	assert.ok(tree.rows[tree.selectionIndex] === selected && rows.every((row, index) => tree.rows[index] === row));
	const incoming = t.mock.method(f.model, 'resolveIncomingCalls'), outgoing = t.mock.method(f.model, 'resolveOutgoingCalls');
	const children = t.mock.method(f.model, 'hasChildren');
	for (let frame = 0; frame < 100; frame++) f.pane.update();
	assert.equal(incoming.mock.callCount(), 0); assert.equal(outgoing.mock.callCount(), 0); assert.equal(children.mock.callCount(), 0);
	assert.equal(snapshot.matches(f.pane.getSelection()), true); snapshot.dispose();
});

test('a result context menu ends when its retained selection changes or its concrete pane detaches', t => {
	const f = paneFixture(t);
	f.commands.execute('contextMenu', f.pane.commandTarget);
	assert.equal(f.contextMenu.visible, true);
	f.input.tree.select(1);
	assert.equal(f.contextMenu.visible, false);
	f.commands.execute('contextMenu', f.pane.commandTarget);
	assert.equal(f.contextMenu.visible, true);
	f.group.openEditor(new HostErrorInput('other attachment'));
	assert.equal(f.contextMenu.visible, false);
	assert.ok(f.input.tree.selectionIndex === 1);
});

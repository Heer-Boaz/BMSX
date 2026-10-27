import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { resourceIdentityKeyFromParts } from '../../ide/common/resource';
import { editorTextModelService } from '../../ide/editor/model/model_service';
import { createNavigationEntry } from '../../ide/navigation/navigation_history';
import { AemEditorInput } from '../../ide/workbench/contrib/aem/editor_input';
import { AemEditorPane } from '../../ide/workbench/contrib/aem/editor_pane';
import { AemNavigationSelection } from '../../ide/workbench/contrib/aem/navigation_selection';
import { projectAemSource } from '../../ide/workbench/contrib/aem/source';
import { AnimationEditorInput } from '../../ide/workbench/contrib/animation/editor_input';
import { BehaviorRuntimeInspection } from '../../ide/workbench/contrib/behavior_lens/runtime_inspection';
import { CartMapInput } from '../../ide/workbench/contrib/cart_maps/editor_input';
import { GameViewInput } from '../../ide/workbench/contrib/game_view/editor_input';
import { HostErrorInput } from '../../ide/workbench/contrib/host_error/editor_input';
import { LuaProgramInput } from '../../ide/workbench/contrib/lua_program/editor_input';
import { ResourceViewerInput } from '../../ide/workbench/contrib/resources/editor_input';
import { SceneEditorInput } from '../../ide/workbench/contrib/scene_editor/editor_input';
import { captureWorkbenchTreeView, setWorkbenchTreeCollapsed } from '../../ide/workbench/ui/tree_view';
import { createActualSourcePanes } from '../helpers/source_panes';

function aemFixture(t: TestContext) {
	const f = createActualSourcePanes(t), context = f.sources.systemContextId, path = 'events.aem.yaml';
	const source = `# canonical event map\nevents:\n${Array.from({ length: 24 }, (_, index) => `  event_${index}:\n    channel: sfx\n    rules: []\n`).join('')}`;
	f.sources.catalog.registerTextSources(context, [{ type: 'aem', resid: 'events', source_path: path }]);
	const resource = f.sources.catalog.resourceByIdentity.get(resourceIdentityKeyFromParts(context, path))!;
	const model = editorTextModelService.retain(resource, 'aem', source);
	const input = new AemEditorInput(model), receiver = new AemEditorInput(model);
	f.firstGroup.openEditor(input); f.secondGroup.openEditor(receiver); f.firstGroup.activate(input.id); f.update();
	return { ...f, input, receiver, model, authored: source };
}

test('authored inputs own their move capability without lending it to physical or diagnostic inputs', t => {
	const f = aemFixture(t), workingCopy = f.firstInput.workingCopy;
	const behavior = f.editor.behaviorLens.createInput(workingCopy, 'graph');
	const inputs = [new SceneEditorInput(workingCopy), new CartMapInput(f.model, 'nemesis'),
		new AnimationEditorInput(workingCopy, workingCopy.resource.contextId), behavior,
		new LuaProgramInput(workingCopy, 'progression', { start: 0, end: 0 }, f.editor.luaPrograms.guest),
		new ResourceViewerInput(f.sources.catalog, workingCopy.resource)];
	for (const input of inputs) f.editor.editorParts.main.group.model.add(input);
	for (const input of [f.firstInput, f.input, ...inputs]) assert.equal(input.canMove(), true);
	const physical = new GameViewInput(), diagnostic = new HostErrorInput('fixture diagnostic');
	t.after(() => { physical.dispose(); diagnostic.dispose(); });
	assert.equal(physical.canMove(), false); assert.equal(diagnostic.canMove(), false);
	const cycles = f.host.runtime.machine.scheduler.nowCycles;
	const inspection = new BehaviorRuntimeInspection(f.sources, f.editor.luaPrograms.guest, f.host.rewind, -1,
		f.sources.currentBlua32Media.system!, undefined, f.editor.commands.transport);
	behavior.runtimeInspection = inspection;
	assert.equal(behavior.canMove(), false, 'a pane-owned live inspection cannot be silently discarded by moving its authored view');
	behavior.runtimeInspection = undefined; inspection.dispose();
	assert.equal(behavior.canMove(), true);
	assert.equal(f.host.runtime.machine.scheduler.nowCycles, cycles);
});

test('AEM movement retains a busy input but cannot dispose its asynchronous operation through coalescing', t => {
	const f = aemFixture(t), source = f.model.buffer.getText(), version = f.model.version;
	f.input.applying = true; f.input.applyStatus = 'pending physical application';
	assert.equal(f.input.canMove(), true, 'a noncolliding move retains the operation and its input owner');
	assert.equal(f.input.canMove(f.receiver), false);
	f.input.applying = false; f.receiver.applying = true; f.receiver.applyStatus = 'receiver application';
	assert.equal(f.input.canMove(f.receiver), true, 'the receiver is retained, including its own pending application');
	assert.equal(f.receiver.applying, true); assert.equal(f.receiver.applyStatus, 'receiver application');
	assert.equal(f.model.buffer.getText(), source); assert.equal(f.model.version, version);
});

test('AEM navigation restores semantic property, disclosure and reading state through the actual pane and ordinary Back', async t => {
	const f = aemFixture(t), selected = '["events","event_20","channel"]', folded = '["events","event_5"]';
	f.input.tree.selectionIndex = f.input.tree.rows.findIndex(row => row.element.key === selected);
	setWorkbenchTreeCollapsed(f.input.tree, f.input.tree.rows.findIndex(row => row.element.key === folded), true);
	f.input.tree.scroll = 7.5;
	const view = captureWorkbenchTreeView(f.input.tree, element => element.key), version = f.model.version;
	const entry = createNavigationEntry()!;
	assert.ok(entry.selection instanceof AemNavigationSelection); entry.dispose();
	f.firstGroup.activate(f.firstInput.id);
	setWorkbenchTreeCollapsed(f.input.tree, f.input.tree.rows.findIndex(row => row.element.key === folded), false);
	f.input.tree.selectionIndex = 0; f.input.tree.scroll = 0;
	await f.editor.navigation.goBackward();
	assert.ok(f.firstGroup.model.activeTab === f.input && f.firstGroup.panes.activePane instanceof AemEditorPane);
	assert.deepEqual(captureWorkbenchTreeView(f.input.tree, element => element.key), view);
	assert.equal(f.model.buffer.getText(), f.authored); assert.equal(f.model.version, version);
	const selection = f.firstGroup.panes.activePane.getSelection!(); t.after(() => selection.dispose());
	f.receiver.applyStatus = 'receiver status'; f.receiver.applying = true;
	f.secondGroup.panes.activePane!.setOptions(undefined, selection);
	assert.deepEqual(captureWorkbenchTreeView(f.receiver.tree, element => element.key), view);
	assert.equal(f.receiver.applyStatus, 'receiver status'); assert.equal(f.receiver.applying, true);
});

test('AEM navigation identity follows authored keys across reparsing rather than retaining row or parser-node identity', t => {
	const f = aemFixture(t), selected = '["events","event_20","channel"]';
	f.input.tree.selectionIndex = f.input.tree.rows.findIndex(row => row.element.key === selected);
	const before = new AemNavigationSelection(f.input); t.after(() => before.dispose());
	const node = f.input.tree.rows[f.input.tree.selectionIndex].element.node;
	f.model.pushEditOperations([{ offset: f.authored.indexOf('  event_0:'), deleteLength: 0, text: '  earlier: {channel: music}\n' }]);
	projectAemSource(f.input);
	const after = new AemNavigationSelection(f.input); t.after(() => after.dispose());
	assert.equal(before.matches(after), true);
	assert.notEqual(f.input.tree.rows[f.input.tree.selectionIndex].element.node, node);
	f.input.tree.selectionIndex = 0; before.restore(f.input);
	assert.equal(f.input.tree.rows[f.input.tree.selectionIndex].element.key, selected);
	const other = new AemNavigationSelection(f.receiver); t.after(() => other.dispose());
	assert.equal(before.matches(other), false);
});

test('LuaProgram move detachment preserves input execution authority while ordinary deactivation pauses it', t => {
	const program = "local p=require('cartlib/progression'); p.compile_program({rules={},filters={},handlers={}})";
	const f = createActualSourcePanes(t, false, [['program.lua', program], ['cartlib/progression.lua', '']]);
	const resource = f.sources.catalog.resolveResource({ contextId: f.sources.systemContextId, path: 'program.lua' })!;
	f.editor.luaPrograms.openResource(f.firstGroup, resource, 'progression');
	const input = f.firstGroup.model.activeTab;
	assert.ok(input instanceof LuaProgramInput);
	input.inspectRuntime(f.editor.commands.transport); input.interaction.running = true;
	const interaction = input.interaction, transport = interaction.transport, cycles = f.host.runtime.machine.scheduler.nowCycles;
	f.firstGroup.panes.clearEditor('move');
	assert.equal(interaction.running, true); assert.ok(input.interaction === interaction && interaction.transport === transport);
	f.firstGroup.activate(input.id);
	assert.ok(f.firstGroup.panes.activePane!.input === input);
	assert.equal(interaction.running, true);
	assert.ok(f.firstGroup.panes.activePane!.commandTarget.scope.runtimeOwner!.runtime!.interaction === interaction);
	f.firstGroup.panes.clearEditor();
	assert.equal(interaction.running, false); assert.ok(interaction.transport === transport);
	assert.equal(input.workingCopy.buffer.getText(), program);
	assert.equal(f.host.runtime.machine.scheduler.nowCycles, cycles);
});

import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import test, { type TestContext } from 'node:test';
import { Worker } from 'node:worker_threads';
import { KeyModifier } from '../../hosts/common/input/text';
import { INTEGER_INPUT_FORMAT } from '../../ide/editor/ui/inline/integer_input';
import { setFieldText } from '../../ide/editor/ui/inline/text_field';
import { ValueInput } from '../../ide/editor/ui/inline/value_input';
import { inputFocus } from '../../ide/input/focus';
import { CodeEditorInput } from '../../ide/workbench/contrib/code_editor/editor_input';
import { PointerButton } from '../../hosts/common/input/pointer_event';
import { NodeGraphLayoutEngine } from '../../ide/node/graph_layout';
import type { FileElement } from '../../ide/workbench/contrib/resources/panel/files_model';
import { resolveLuaCodeEditorInput } from '../../ide/workbench/ui/code_tab/io';
import type { WorkbenchTreeNode } from '../../ide/workbench/ui/tree_view';
import { createActualSourcePanes } from '../helpers/source_panes';

const MODULES = ['cartlib/world/scene_library', 'cartlib/behaviour_tree/library', 'cartlib/fsm/library', 'cartlib/actioneffects',
	'cartlib/progression', 'cartlib/input/actioneffect/actioneffect_component', 'cartlib/timeline/program'];
const SOURCE = `local scenes=require('cartlib/world/scene_library')
local trees=require('cartlib/behaviour_tree/library')
local machines=require('cartlib/fsm/library')
local effects=require('cartlib/actioneffects')
local progression=require('cartlib/progression')
local input=require('cartlib/input/actioneffect/actioneffect_component')
local timeline=require('cartlib/timeline/program')
scenes.register('room',{objects={}})
trees.register('tree',{root={type='wait',duration_ticks=1}})
machines.register('machine',{states={idle={}},initial='idle'})
effects.register_effect('effect',{})
progression.compile_program({})
input.factory({program={}})
timeline.compile({duration_frames=4})
`;
type DefinitionNode = WorkbenchTreeNode<FileElement> & { readonly element: Extract<FileElement, { kind: 'definition' }> };

function fixture(t: TestContext) {
	const f = createActualSourcePanes(t, false, [...MODULES.map(module => [`${module}.lua`, 'return {}'] as const), ['content.lua', SOURCE]],
		() => new NodeGraphLayoutEngine(new Worker(resolve('ide/node/graph_layout_worker.cjs'))));
	const parts = f.editor.editorParts;
	parts.clear();
	const resource = f.sources.catalog.resolveResource({ contextId: f.sources.systemContextId, path: 'content.lua' })!;
	const panel = f.editor.resourcePanel;
	panel.show(); panel.queuePendingSelection(resource); panel.applyPendingSelection();
	const file = panel.files.selectedNode!;
	assert.ok(file.element.kind === 'file');
	panel.navigateFiles('right');
	const definitions = file.children.filter((node): node is DefinitionNode => node.element.kind === 'definition');
	const activate = (node: DefinitionNode) => {
		panel.setFocused(true); panel.setSelectionIndex(panel.files.tree.rows.indexOf(node)); panel.openSelected(); f.update();
		return parts.activeGroup;
	};
	return { ...f, parts, resource, definitions, activate };
}

test('all authored kinds open in the chosen Main group without creating a floating host', t => {
	const f = fixture(t), main = f.parts.main, group = main.activeGroup;
	const cycles = f.host.runtime.machine.scheduler.nowCycles;
	assert.deepEqual(new Set(f.definitions.map(node => node.element.content.kind)),
		new Set(['scene', 'behavior_tree', 'state_machine', 'action_effect', 'progression', 'input', 'animation']));
	for (const node of f.definitions) {
		assert.ok(f.activate(node) === group, 'normal authored opening stays in its chosen group');
		const input = group.model.activeTab!;
		assert.equal(input.resource, node.element.content.ownerResource);
		assert.equal(f.parts.documents.length, 0);
		assert.ok(f.parts.activePart === main);
	}
	assert.equal(group.model.tabs.length, 7);
	assert.equal(f.host.runtime.machine.scheduler.nowCycles, cycles);
});

test('Source, Scene and tool commands use their invoking split rather than a kind-specific container', async t => {
	const f = fixture(t), main = f.parts.main, first = main.activeGroup;
	const side = f.parts.splitGroup(first, 'right'); assert.ok(side);
	side.openEditor(resolveLuaCodeEditorInput(f.sources.catalog, f.resource)); f.update();
	const source = side.model.activeTab!, sourceControl = side.panes.activePane!;
	f.editor.commands.execute('sceneEditor', sourceControl.commandTarget); f.update();
	assert.ok(f.parts.activeGroup === side);
	assert.equal(side.model.activeTab?.kind, 'scene_editor');
	assert.ok(side.model.tabs.includes(source));
	assert.equal(first.model.tabs.length, 0); assert.equal(f.parts.documents.length, 0);
	const scene = side.model.activeTab!, sceneControl = side.panes.activePane!;
	f.editor.commands.execute('animation', sceneControl.commandTarget);
	assert.equal(main.quickInput.visible, true); assert.ok(f.parts.activeGroup === side);
	f.key('Escape');
	assert.ok(side.model.activeTab === scene); assert.ok(side.panes.activePane === sceneControl);
	assert.equal(f.parts.documents.length, 0);
});

test('group split and navigation keyboard commands operate on actual groups without copying the current input', t => {
	const f = fixture(t), main = f.parts.main, first = main.activeGroup;
	first.openEditor(resolveLuaCodeEditorInput(f.sources.catalog, f.resource)); f.update();
	const source = first.model.activeTab, pane = first.panes.activePane!;
	pane.focus();
	f.key('Backslash', KeyModifier.ctrl);
	assert.equal(main.groups.length, 2);
	const side = f.parts.activeGroup;
	assert.ok(side !== first); assert.equal(side.model.tabs.length, 0);
	assert.ok(first.model.activeTab === source); assert.ok(first.panes.activePane === pane);
	assert.equal(f.parts.documents.length, 0);
	f.editor.commands.execute('group.focusPrevious');
	assert.ok(f.parts.activeGroup === first);
	f.editor.commands.execute('group.focusNext');
	assert.ok(f.parts.activeGroup === side);
	f.editor.commands.execute('group.maximize'); f.update();
	assert.ok(main.arrangement.maximized === side);
	assert.equal(f.editor.commands.isActive('group.maximize'), true);
	f.editor.commands.execute('group.maximize'); f.update();
	assert.equal(main.arrangement.maximized, undefined);
	assert.equal(main.groups.length, 2); assert.ok(first.model.activeTab === source);
});

test('a split tab chooser opens its own retained inputs from the actual pointer action', t => {
	const f = fixture(t), main = f.parts.main, first = main.activeGroup;
	const firstInput = resolveLuaCodeEditorInput(f.sources.catalog, f.firstInput.workingCopy.resource);
	first.openEditor(firstInput);
	const side = f.parts.splitGroup(first, 'right'); assert.ok(side);
	const wanted = resolveLuaCodeEditorInput(f.sources.catalog, f.resource); side.openEditor(wanted);
	for (const resource of f.sources.catalog.luaResources) {
		if (resource.path === firstInput.resource.path || resource.path === f.resource.path) continue;
		side.openEditor(resolveLuaCodeEditorInput(f.sources.catalog, resource), { pinned: true });
	}
	first.panes.activePane!.focus(); f.update();
	const chooser = side.tabStrip.actions.items[0];
	assert.equal(chooser.visible, true); assert.equal(chooser.enabled, true);
	const bounds = chooser.bounds, cycles = f.host.runtime.machine.scheduler.nowCycles;
	for (const down of [true, false]) {
		f.editor.dispatchPointer({ x: (bounds.left + bounds.right) / 2, y: (bounds.top + bounds.bottom) / 2,
			buttons: down ? PointerButton.Primary : 0, pressedButtons: down ? PointerButton.Primary : 0, releasedButtons: down ? 0 : PointerButton.Primary,
			cancelledButtons: 0, modifiers: KeyModifier.none, spaceDown: false, timestamp: down ? 0 : 1 });
		f.update();
	}
	assert.equal(main.quickInput.visible, true); assert.equal(f.editor.quickInput.visible, false);
	assert.equal(main.quickInput.model.list.rows.length, side.model.tabs.length);
	assert.equal(main.quickInput.model.list.rows.some(row => 'input' in row.item && row.item.input === firstInput), false);
	const index = main.quickInput.model.list.rows.findIndex(row => 'input' in row.item && row.item.input === wanted);
	assert.ok(index >= 0); main.quickInput.model.list.selectionIndex = index; f.key('Enter');
	assert.ok(f.parts.activeGroup === side && side.model.activeTab === wanted);
	assert.ok(first.model.activeTab === firstInput); assert.equal(f.parts.documents.length, 0);
	assert.equal(f.host.runtime.machine.scheduler.nowCycles, cycles);
});


for (const route of ['command', 'owner'] as const) for (const destination of ['samePart', 'otherPart'] as const)
	test(`${route} split admission preserves newer ${destination} group focus without creating a split`, t => {
		const f = createActualSourcePanes(t), parts = f.editor.editorParts;
		const newer = destination === 'otherPart' ? f.secondGroup : parts.splitGroup(f.firstGroup, 'right');
		assert.ok(newer);
		if (destination === 'samePart') newer.openEditor(new CodeEditorInput(f.secondInput.workingCopy));
		let accepted = 0;
		const draft = new ValueInput(f.first.commandTarget, INTEGER_INPUT_FORMAT, value => { accepted = value; newer.focus(); });
		t.after(() => draft.dispose());
		draft.setValue(1); draft.layout(f.firstGroup.panes.contentBounds);
		draft.field.focusTarget.focus(); setFieldText(draft.field, '2', true);
		assert.equal(draft.pending, true);
		const groups = [...parts.groups], generation = f.firstGroup.panes.openGeneration;
		const cycles = f.host.runtime.machine.scheduler.nowCycles;
		if (route === 'command') f.editor.commands.execute('group.splitRight', f.first.commandTarget);
		else assert.equal(parts.splitGroup(f.firstGroup, 'right'), undefined);
		assert.equal(accepted, 2); assert.equal(draft.pending, false);
		assert.equal(f.firstGroup.panes.openGeneration, generation, 'newer focus alone does not change source attachment');
		assert.ok(parts.activeGroup === newer && inputFocus.target === newer.panes.activePane!.commandTarget);
		assert.equal(parts.groups.length, groups.length);
		assert.ok(parts.groups.every((group, index) => group === groups[index]));
		assert.ok(f.firstGroup.model.activeTab === f.firstInput);
		assert.equal(f.firstInput.workingCopy.buffer.getText(), f.source);
		assert.equal(f.host.runtime.machine.scheduler.nowCycles, cycles);
	});

test('source command admission accepts a transient returning focus within the invoking group', t => {
	const f = createActualSourcePanes(t), parts = f.editor.editorParts;
	let accepted = 0;
	const draft = new ValueInput(f.first.commandTarget, INTEGER_INPUT_FORMAT, value => {
		accepted = value; draft.field.focusTarget.release();
	});
	t.after(() => draft.dispose());
	draft.setValue(1); draft.layout(f.firstGroup.panes.contentBounds);
	draft.field.focusTarget.focus(); setFieldText(draft.field, '2', true);
	const count = parts.groups.length, cycles = f.host.runtime.machine.scheduler.nowCycles;
	f.editor.commands.execute('group.splitRight', f.first.commandTarget);
	assert.equal(accepted, 2); assert.equal(draft.pending, false);
	assert.equal(parts.groups.length, count + 1); assert.equal(f.firstPart.groups.length, 2);
	assert.ok(parts.activePart === f.firstPart && parts.activeGroup !== f.firstGroup);
	assert.ok(inputFocus.target === parts.activeGroup.focusTarget);
	assert.ok(f.firstGroup.model.activeTab === f.firstInput);
	assert.equal(f.host.runtime.machine.scheduler.nowCycles, cycles);
});

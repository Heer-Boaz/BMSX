import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import test, { type TestContext } from 'node:test';
import { Worker } from 'node:worker_threads';
import { editorTextModelService } from '../../ide/editor/model/model_service';
import { INTEGER_INPUT_FORMAT } from '../../ide/editor/ui/inline/integer_input';
import { setFieldText } from '../../ide/editor/ui/inline/text_field';
import { ValueInput } from '../../ide/editor/ui/inline/value_input';
import { inputFocus } from '../../ide/input/focus';
import { NodeGraphLayoutEngine } from '../../ide/node/graph_layout';
import { AnimationEditorInput } from '../../ide/workbench/contrib/animation/editor_input';
import { BehaviorLensInput } from '../../ide/workbench/contrib/behavior_lens/editor_input';
import { HostErrorInput } from '../../ide/workbench/contrib/host_error/editor_input';
import { LuaProgramInput } from '../../ide/workbench/contrib/lua_program/editor_input';
import type { ProjectContentEntry } from '../../ide/workbench/contrib/resources/panel/content_index';
import type { FileElement } from '../../ide/workbench/contrib/resources/panel/files_model';
import { SceneEditorInput } from '../../ide/workbench/contrib/scene_editor/editor_input';
import { resolveLuaCodeEditorInput } from '../../ide/workbench/ui/code_tab/io';
import type { WorkbenchTreeNode } from '../../ide/workbench/ui/tree_view';
import { createActualSourcePanes } from '../helpers/source_panes';

const API_MODULES = ['cartlib/world/scene_library', 'cartlib/behaviour_tree/library', 'cartlib/fsm/library', 'cartlib/actioneffects',
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
const KINDS = ['scene', 'behavior_tree', 'state_machine', 'action_effect', 'progression', 'input', 'animation'] as const;
type DefinitionNode = WorkbenchTreeNode<FileElement> & { readonly element: Extract<FileElement, { kind: 'definition' }> };

function fixture(t: TestContext, kind: ProjectContentEntry['kind'] = 'progression') {
	const f = createActualSourcePanes(t, false, [...API_MODULES.map(module => [`${module}.lua`, 'return {}'] as const), ['content.lua', SOURCE]],
		() => new NodeGraphLayoutEngine(new Worker(resolve('ide/node/graph_layout_worker.cjs'))));
	const resource = f.sources.catalog.resolveResource({ contextId: f.sources.systemContextId, path: 'content.lua' })!;
	f.firstGroup.openEditor(resolveLuaCodeEditorInput(f.sources.catalog, resource));
	const model = editorTextModelService.get(resource)!;
	const panel = f.editor.resourcePanel;
	panel.show(); panel.queuePendingSelection(resource); panel.applyPendingSelection();
	const file = panel.files.selectedNode!;
	assert.equal(file.element.kind, 'file');
	panel.navigateFiles('right');
	const node = file.children.find((node): node is DefinitionNode => node.element.kind === 'definition' && node.element.content.kind === kind)!;
	assert.ok(node);
	panel.setSelectionIndex(panel.files.tree.rows.indexOf(node));
	const draft = (accept: () => void) => {
		f.firstPart.focus();
		const control = new ValueInput(f.first.commandTarget, INTEGER_INPUT_FORMAT, accept);
		t.after(() => control.dispose());
		control.setValue(1); control.layout(f.firstGroup.panes.contentBounds);
		control.field.focusTarget.focus(); setFieldText(control.field, '2', true);
		assert.equal(control.pending, true);
		return control;
	};
	return { ...f, panel, model, resource, node, entry: node.element.content, draft };
}

test('a rejected document opening never reveals or focuses its inadmissible destination', t => {
	const f = fixture(t), destination = f.secondPart, input = f.secondGroup.model.activeTab;
	f.secondPart.focus(); destination.setOperation('move'); f.panel.setFocused(true);
	const focused = inputFocus.target, active = f.editor.editorParts.activePart;
	f.panel.openSelected();
	assert.ok(inputFocus.target === focused, 'rejected opening preserves the invoking control'); assert.ok(f.editor.editorParts.activePart === active);
	assert.ok(f.secondGroup.model.activeTab === input);
	assert.equal(f.secondGroup.model.tabs.length, 1); assert.equal(destination.operation, 'move');
});

test('later focus published while the destination shows survives the earlier content activation', t => {
	const f = fixture(t);
	f.secondPart.focus(); f.panel.setFocused(true);
	let redirected = false;
	t.after(f.secondGroup.panes.onWillShowEditor(() => {
		if (redirected) return;
		redirected = true; f.firstPart.focus();
	}));
	f.panel.openSelected();
	assert.equal(redirected, true); assert.ok(f.secondGroup.model.activeTab instanceof LuaProgramInput);
	assert.ok(inputFocus.target === f.first.commandTarget, 'later focused Source remains authoritative');
	assert.ok(f.editor.editorParts.activePart === f.firstPart);
});

test('draft acceptance replacing the invoking pane revokes the earlier content activation', t => {
	const f = fixture(t), newer = new HostErrorInput('newer admitted editor');
	const draft = f.draft(() => { f.firstGroup.openEditor(newer); });
	f.panel.openSelected();
	assert.equal(draft.pending, false);
	assert.ok(f.firstGroup.model.activeTab === newer, 'newer origin editor survives admission');
	assert.ok(f.firstGroup.panes.activePane!.input === newer);
	assert.ok(f.editor.editorParts.activePart === f.firstPart);
	assert.equal(f.editor.editorParts.groups.some(group => group.model.tabs.some(input => input instanceof LuaProgramInput)), false);
});

test('draft acceptance publishing a newer part focus does not open content over that part', t => {
	const f = fixture(t), newer = f.secondGroup.model.activeTab;
	const draft = f.draft(() => { f.secondPart.focus(); });
	f.panel.openSelected();
	assert.equal(draft.pending, false);
	assert.ok(f.secondGroup.model.activeTab === newer, 'newer focused editor is not replaced');
	assert.ok(inputFocus.target === f.second.commandTarget);
	assert.ok(f.editor.editorParts.activePart === f.secondPart);
	assert.equal(f.editor.editorParts.groups.some(group => group.model.tabs.some(input => input instanceof LuaProgramInput)), false);
});

test('an accepted transient returning focus within its invoking group still opens the current occurrence', t => {
	const f = fixture(t);
	const draft = f.draft(() => {
		draft.field.focusTarget.release();
		f.model.pushEditOperations([{ offset: 0, deleteLength: 0, text: '-- accepted transient\n' }]);
	});
	f.panel.openSelected();
	assert.equal(draft.pending, false);
	const input = f.editor.editorParts.activeGroup.model.activeTab;
	assert.ok(input instanceof LuaProgramInput);
	assert.ok(input.workingCopy === f.model); assert.deepEqual(input.occurrenceRange, f.entry.range);
});

for (const kind of KINDS) for (const edit of ['move', 'remove'] as const)
	test(`${kind} activation consumes source settled by the actual departing field (${edit})`, t => {
		const f = fixture(t, kind), range = { ...f.entry.range };
		const draft = f.draft(() => f.model.pushEditOperations(edit === 'move'
			? [{ offset: 0, deleteLength: 0, text: '-- admitted field\n' }]
			: [{ offset: range.start, deleteLength: range.end - range.start, text: '' }]));
		f.panel.setFocused(true);
		assert.equal(draft.pending, false); assert.ok(inputFocus.target === f.panel.focusTarget);
		const before = f.editor.editorParts.groups.map(group => group.model.activeTab);
		f.panel.openSelected();
		if (edit === 'remove') {
			assert.ok(f.editor.editorParts.groups.every((group, index) => group.model.activeTab === before[index]));
			assert.ok(inputFocus.target === f.panel.focusTarget);
			return;
		}
		const group = f.editor.editorParts.activeGroup, input = group.model.activeTab;
		assert.ok(group === f.firstGroup, 'all authored kinds retain the invoking group');
		assert.ok(input instanceof SceneEditorInput || input instanceof BehaviorLensInput || input instanceof LuaProgramInput || input instanceof AnimationEditorInput);
		assert.ok(input.workingCopy === f.model);
		assert.equal(f.entry.range.start, range.start + '-- admitted field\n'.length);
		if (input instanceof SceneEditorInput) assert.deepEqual(input.view.authoring.selectionRange, f.entry.range);
		else if (input instanceof LuaProgramInput) assert.deepEqual(input.occurrenceRange, f.entry.range);
		else if (input instanceof AnimationEditorInput) assert.deepEqual(input.definitionRange, f.entry.range);
		else {
			const selected = input.view.source.ranges.get(input.view.definitionRowKey!)!;
			assert.deepEqual({ start: selected.start, end: selected.end }, f.entry.range);
		}
	});

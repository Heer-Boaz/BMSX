import assert from 'node:assert/strict';
import test, { afterEach } from 'node:test';
import { editorTextModelService } from '../../ide/editor/model/model_service';
import { EditorTextModel } from '../../ide/editor/model/text_model';
import { resetSemanticProjects, getOrCreateSemanticProject } from '../../ide/editor/contrib/intellisense/semantic/workspace/state';
import { luaSourceRangeToTextRange } from '../../ide/language/lua/source_edits';
import { collectAnimationDefinitions } from '../../ide/workbench/contrib/animation/definitions';
import { resourceIdentityKey } from '../../ide/common/resource';
import { CodeEditorInput } from '../../ide/workbench/contrib/code_editor/editor_input';
import { LuaProgramInput } from '../../ide/workbench/contrib/lua_program/editor_input';
import { collectLuaPrograms } from '../../ide/workbench/contrib/lua_program/source';
import { AnimationEditorInput } from '../../ide/workbench/contrib/animation/editor_input';
import { selectBehaviorLensDefinition } from '../../ide/workbench/contrib/behavior_lens/layout';
import { resolveLuaTextFileModel } from '../../ide/workbench/services/working_copy/text_file_model';
import { EditorTabGroupModel } from '../../ide/workbench/ui/tab/group_model';
import { createActualSourcePanes } from '../helpers/source_panes';

const PROGRAM = "local p=require('cartlib/progression'); p.compile_program({rules={{id='first',on='hit'}},filters={},handlers={}}); p.compile_program({rules={{id='second',on='hit'}},filters={},handlers={}})";
const PROGRAM_SOURCES = [['program.lua', PROGRAM], ['cartlib/progression.lua', '']] as const;

afterEach(() => { editorTextModelService.clear(); resetSemanticProjects(editorTextModelService); });

for (const transfer of ['editor', 'group'] as const) test(`copied Progress ${transfer} merges into its existing Main editor before retiring the incoming view`, t => {
	const f = createActualSourcePanes(t, false, PROGRAM_SOURCES), parts = f.editor.editorParts, main = parts.main.activeGroup;
	const resource = f.sources.catalog.resolveResource({ contextId: f.sources.systemContextId, path: 'program.lua' })!;
	f.editor.luaPrograms.openResource(main, resource, 'progression'); main.focus(); f.update();
	const original = main.model.activeTab;
	assert.ok(original?.kind === 'lua_program');
	const model = original.workingCopy, version = model.version, history = model.history, cycles = f.host.runtime.machine.scheduler.nowCycles;
	const count = main.model.tabs.length;
	f.editor.commands.execute('window.copyEditor', main.panes.activePane!.commandTarget); f.update();
	const window = parts.activePart, source = window.activeGroup, copy = source.model.activeTab;
	assert.ok(copy?.kind === 'lua_program' && copy !== original && copy.id !== original.id && copy.workingCopy === model);
	let disposed = 0;
	copy.onWillDispose(() => {
		disposed++;
		assert.ok(main.model.activeTab === original && main.panes.activePane?.input === original,
			'the receiving editor must be attached before the incoming view retires');
	});
	assert.equal(transfer === 'editor' ? parts.moveEditor(source, copy, { kind: 'group', group: main })
		: parts.moveGroup(source, { kind: 'group', group: main }), true);
	f.update();
	assert.equal(main.model.tabs.length, count);
	assert.ok(main.model.activeTab === original && main.panes.activePane?.input === original);
	assert.equal(main.model.findById(copy.id), undefined, 'gesture lookup remains exact even when admission coalesces editors');
	assert.equal(disposed, 1); assert.equal(window.retired, transfer === 'group');
	assert.ok(original.workingCopy === model && model.history === history);
	assert.equal(model.buffer.getText(), PROGRAM); assert.equal(model.version, version); assert.equal(model.dirty, false);
	assert.equal(f.host.runtime.machine.scheduler.nowCycles, cycles);
});

test('same-editor admission keeps the attached Progress pane and disposes only the unused candidate', t => {
	const f = createActualSourcePanes(t, false, PROGRAM_SOURCES), group = f.editor.editorParts.main.activeGroup;
	const resource = f.sources.catalog.resolveResource({ contextId: f.sources.systemContextId, path: 'program.lua' })!;
	f.editor.luaPrograms.openResource(group, resource, 'progression');
	const original = group.model.activeTab;
	assert.ok(original?.kind === 'lua_program');
	const candidate = original.createView!(), pane = group.panes.activePane, count = group.model.tabs.length;
	let cleared = 0, disposed = 0;
	const unbind = group.panes.onDidClearEditor(() => { cleared++; }); t.after(unbind);
	candidate.onWillDispose(() => { disposed++; });
	assert.ok(group.openEditor(candidate, { preserveFocus: true }));
	assert.ok(group.model.activeTab === original && group.panes.activePane === pane);
	assert.equal(group.model.tabs.length, count); assert.equal(cleared, 0); assert.equal(disposed, 1);
});

test('Progress matching uses current authored occurrence and kind, not its view ID, title, resource alone or live instance', t => {
	const f = createActualSourcePanes(t, false, PROGRAM_SOURCES), group = f.editor.editorParts.main.activeGroup;
	const resource = f.sources.catalog.resolveResource({ contextId: f.sources.systemContextId, path: 'program.lua' })!;
	const project = getOrCreateSemanticProject(editorTextModelService, resource.contextId); project.synchronizeSources(f.sources.catalog);
	const occurrences = collectLuaPrograms(resource, project.getSnapshot()); assert.equal(occurrences.length, 2);
	const original = f.editor.luaPrograms.openOccurrence(group, occurrences[0])!;
	const copy = original.createView!();
	const other = f.editor.luaPrograms.prepareOccurrence(f.secondGroup, original.workingCopy, occurrences[1])!.input;
	const wrongKind = new LuaProgramInput(original.workingCopy, 'input', original.occurrenceRange, f.editor.luaPrograms.guest);
	const otherModel = new EditorTextModel({ ...resource, contextId: 'another-project' }, 'lua', PROGRAM);
	const otherContext = new LuaProgramInput(otherModel, 'progression', original.occurrenceRange, f.editor.luaPrograms.guest);
	t.after(() => otherModel.dispose());
	copy.title = 'independent caption'; original.inspectRuntime(f.editor.commands.transport);
	assert.equal(original.matches(copy), true); assert.equal(copy.matches(original), true);
	assert.equal(original.matches(other), false); assert.equal(original.matches(wrongKind), false); assert.equal(original.matches(otherContext), false);
	const source = new EditorTabGroupModel(), target = group.model; t.after(() => source.clear());
	source.add(copy); source.activate(copy); target.add(other); target.add(wrongKind); target.add(otherContext);
	const plan = source.planTransferTo(target); assert.ok(plan.entries[0].receiver === original);
	assert.equal(source.findById(copy.id), copy); assert.equal(target.findById(copy.id), undefined);
	assert.equal(target.tabs.length, 4); assert.equal(source.tabs.length, 1, 'a separate group may retain its own view of the same editor');
	const start = original.occurrenceRange.start;
	original.workingCopy.pushEditOperations([{ offset: 0, deleteLength: 0, text: '-- mapped\n' }]);
	assert.equal(original.occurrenceRange.start, start + 10); assert.equal(copy.occurrenceRange.start, start + 10);
	assert.equal(original.matches(copy), true);
	const range = { ...original.occurrenceRange };
	original.workingCopy.pushEditOperations([{ offset: range.start, deleteLength: range.end - range.start, text: '' }]);
	assert.equal(original.occurrenceRange.start, original.occurrenceRange.end);
	assert.equal(original.matches(copy), false, 'removed producer occurrences cannot become another editor solely through collapsed positions');
	assert.equal(original.matches(original), true);
});

test('Animation matching separates resource views, definition occurrences, consumers and project contexts', t => {
	const text = "local c=require('cartlib/component/sprite_animation_component'); c.factory({animations={first={duration_frames=1},second={duration_frames=2}}})";
	const f = createActualSourcePanes(t, false, [['animation.lua', text], ['cartlib/component/sprite_animation_component.lua', '']]);
	const resource = f.sources.catalog.resolveResource({ contextId: f.sources.systemContextId, path: 'animation.lua' })!;
	const model = resolveLuaTextFileModel(editorTextModelService, f.sources.catalog, resource), context = resource.contextId;
	const project = getOrCreateSemanticProject(editorTextModelService, context); project.synchronizeSources(f.sources.catalog);
	const definitions = collectAnimationDefinitions(resource, project.getSnapshot()); assert.equal(definitions.length, 2);
	const ranges = definitions.map(definition => luaSourceRangeToTextRange(model.buffer, definition.file.chunk.locations.range(definition.table.span)));
	const root = new AnimationEditorInput(model, context), rootCopy = new AnimationEditorInput(model, context);
	const selected = new AnimationEditorInput(model, context, ranges[0], 'same title', resourceIdentityKey(resource));
	const copy = new AnimationEditorInput(model, context, ranges[0], 'different title', resourceIdentityKey(resource));
	const otherRange = new AnimationEditorInput(model, context, ranges[1], 'same title', resourceIdentityKey(resource));
	const otherConsumer = new AnimationEditorInput(model, context, ranges[0], 'same title', 'other.lua');
	const otherProject = new AnimationEditorInput(model, 'another-project', ranges[0], 'same title', resourceIdentityKey(resource));
	t.after(() => { for (const input of [root, rootCopy, otherConsumer, otherProject]) input.dispose(); });
	assert.equal(root.matches(rootCopy), true); assert.equal(selected.matches(copy), true); assert.equal(copy.matches(selected), true);
	for (const other of [root, otherRange, otherConsumer, otherProject]) assert.equal(selected.matches(other), false);
	const source = new EditorTabGroupModel(), target = new EditorTabGroupModel(); source.add(copy); target.add(selected); target.add(otherRange);
	t.after(() => { source.clear(); target.clear(); });
	assert.ok(source.planTransferTo(target).entries[0].receiver === selected); assert.equal(target.tabs.length, 2);
	model.pushEditOperations([{ offset: 0, deleteLength: 0, text: '-- mapped\n' }]);
	assert.equal(selected.definitionRange!.start, ranges[0].start + 10); assert.equal(copy.definitionRange!.start, ranges[0].start + 10); assert.equal(selected.matches(copy), true);
});

test('Behavior matching follows the selected registration and its mapped occurrence, not a view ID or graph presentation', t => {
	const text = "local t=require('cartlib/behaviour_tree/library'); t.register('first',{root={type='wait',duration_ticks=1}}); t.register('second',{root={type='wait',duration_ticks=2}})";
	const f = createActualSourcePanes(t, false, [['tree.lua', text], ['cartlib/behaviour_tree/library.lua', '']]);
	const resource = f.sources.catalog.resolveResource({ contextId: f.sources.systemContextId, path: 'tree.lua' })!;
	const model = resolveLuaTextFileModel(editorTextModelService, f.sources.catalog, resource), controller = f.editor.behaviorLens;
	const original = controller.createInput(model, 'graph');
	selectBehaviorLensDefinition(original.view, original.view.document.definitions[0].rowKey); original.updateDefinition();
	const copy = controller.createView(original), other = controller.createView(original);
	selectBehaviorLensDefinition(other.view, other.view.document.definitions[1].rowKey); other.updateDefinition();
	assert.notEqual(original.id, copy.id); assert.equal(original.matches(copy), true); assert.equal(copy.matches(original), true);
	assert.equal(original.matches(other), false);
	const source = new EditorTabGroupModel(), target = new EditorTabGroupModel(); source.add(copy); target.add(original); target.add(other);
	t.after(() => { source.clear(); target.clear(); });
	assert.ok(source.planTransferTo(target).entries[0].receiver === original); assert.equal(target.tabs.length, 2);
	const range = original.view.source.ranges.get(original.view.selectionState.definitionRowKey!)!, start = range.start;
	model.pushEditOperations([{ offset: 0, deleteLength: 0, text: '-- mapped\n' }]);
	assert.equal(range.start, start + 10); assert.equal(original.matches(copy), true);
	assert.ok(original.getWorkingCopies().some(workingCopy => resourceIdentityKey(workingCopy.resource) === resourceIdentityKey(resource)));
});

test('prospective removal selection and actual transfer share the same previous-then-next successor', t => {
	for (const [active, removed, expected] of [[0, 0, 1], [1, 1, 0], [2, 2, 1], [1, 0, 1], [1, 2, 1], [null, 1, null]] as const) {
		const source = new EditorTabGroupModel(), target = new EditorTabGroupModel();
		const models = ['first.lua', 'middle.lua', 'last.lua'].map(path => new EditorTextModel({
			contextId: 'successor-fixture', path, contextLabel: 'Successor fixture', location: { kind: 'workspace', path },
			sourceFilePath: path, source: { type: 'lua', resid: path },
		}, 'lua', 'return 1'));
		const inputs = models.map(model => new CodeEditorInput(model));
		t.after(() => { source.clear(); target.clear(); for (const model of models) model.dispose(); });
		for (const input of inputs) source.add(input);
		if (active !== null) source.activate(inputs[active]);
		const successor = expected === null ? null : inputs[expected];
		assert.ok(source.activeAfterRemoval(inputs[removed]) === successor);
		source.transferTo(target, inputs[removed]).publish();
		assert.ok(source.activeTab === successor);
	}
	const source = new EditorTabGroupModel(), target = new EditorTabGroupModel();
	const model = new EditorTextModel({ contextId: 'successor-fixture', path: 'only.lua', contextLabel: 'Successor fixture',
		location: { kind: 'workspace', path: 'only.lua' }, sourceFilePath: 'only.lua', source: { type: 'lua', resid: 'only' } }, 'lua', 'return 1');
	const input = new CodeEditorInput(model); source.add(input); source.activate(input);
	t.after(() => { source.clear(); target.clear(); model.dispose(); });
	assert.equal(source.activeAfterRemoval(input), null); source.transferTo(target, input).publish(); assert.equal(source.activeTab, null);
});

test('group transfer rechecks its semantic receiver after departing-pane callbacks change the selected definition', t => {
	const text = "local t=require('cartlib/behaviour_tree/library'); t.register('first',{root={type='wait',duration_ticks=1}}); t.register('second',{root={type='wait',duration_ticks=2}})";
	const f = createActualSourcePanes(t, false, [['tree.lua', text], ['cartlib/behaviour_tree/library.lua', '']]);
	const resource = f.sources.catalog.resolveResource({ contextId: f.sources.systemContextId, path: 'tree.lua' })!;
	const model = resolveLuaTextFileModel(editorTextModelService, f.sources.catalog, resource), controller = f.editor.behaviorLens;
	const original = controller.createInput(model, 'graph');
	selectBehaviorLensDefinition(original.view, original.view.document.definitions[0].rowKey); original.updateDefinition();
	const parts = f.editor.editorParts, main = parts.main.activeGroup; main.openEditor(original);
	const window = parts.createDocument(), source = window.activeGroup, copy = controller.createView(original); source.openEditor(copy);
	const count = main.model.tabs.length;
	const unbind = source.panes.onDidClearEditor(() => {
		selectBehaviorLensDefinition(copy.view, copy.view.document.definitions[1].rowKey); copy.updateDefinition();
	}); t.after(unbind);
	assert.equal(parts.moveGroup(source, { kind: 'group', group: main }), false);
	assert.equal(main.model.tabs.length, count); assert.ok(main.model.activeTab === original && source.model.activeTab === copy);
	assert.equal(original.matches(copy), false); assert.equal(window.retired, false);
});

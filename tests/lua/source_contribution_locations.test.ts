import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { staticLuaTableFieldName } from '../../toolchain/ts/lua/syntax/table_fields';
import { editorTextModelService } from '../../ide/editor/model/model_service';
import { INTEGER_INPUT_FORMAT } from '../../ide/editor/ui/inline/integer_input';
import { setFieldText } from '../../ide/editor/ui/inline/text_field';
import { ValueInput } from '../../ide/editor/ui/inline/value_input';
import { resourceIdentityKey } from '../../ide/common/resource';
import { CodeEditorInput } from '../../ide/workbench/contrib/code_editor/editor_input';
import { SceneEditorInput } from '../../ide/workbench/contrib/scene_editor/editor_input';
import { selectSceneOutlineRow } from '../../ide/workbench/contrib/scene_editor/outline';
import { BehaviorLensInput } from '../../ide/workbench/contrib/behavior_lens/editor_input';
import { AnimationEditorInput } from '../../ide/workbench/contrib/animation/editor_input';
import { AnimationEditorController } from '../../ide/workbench/contrib/animation/controller';
import { resolveLuaTextFileModel } from '../../ide/workbench/services/working_copy/text_file_model';
import { luaSourceRangeToTextRange } from '../../ide/language/lua/source_edits';
import { createActualSourcePanes } from '../helpers/source_panes';
import { createScenarioTestSourceRecord, createScenarioTestSourceState } from '../helpers/scenario_sources';
import { TEST_CARTRIDGE_CONTEXT_IDS } from '../helpers/runtime_sources';
import { openWorkspaceRecords, closeWorkspaceRecords } from '../../ide/workspace/records';
import { clearWorkspaceSourceCaches } from '../../ide/workspace/cache';
import { MemoryWorkspaceFiles } from '../helpers/workspace_files';

const SCENE = `local scenes=require('cartlib/world/scene_library')
scenes.register('room',{objects={{member_id='unit',definition_id='actor',options={pos={x=1,y=2,z=3}}}}})
`;
const BEHAVIOR = `local trees=require('cartlib/behaviour_tree/library')
trees.register('tree',{root={type='sequence',children={{type='wait',duration_ticks=1}}}})
`;
const ANIMATION = `return {
 duration_ms=100,
 tracks={{kind='value',keys={{time_ms=0,value=1},{time_ms=100,value=2}}}},
}
`;
const BUILDERS = `local builders={duration=20}
function builders.make(params) error('source navigation must not execute this') end
return builders
`;
const GENERATED = `local builders=require('builders')
local built=builders.make({value=4})
return {frames=built,frame_duration=builders.duration}
`;

function fixture(t: TestContext) {
	return createActualSourcePanes(t, false, [['scene.lua', SCENE], ['tree.lua', BEHAVIOR], ['animation.lua', ANIMATION],
		['cartlib/world/scene_library.lua', 'return {}'], ['cartlib/behaviour_tree/library.lua', 'return {}'],
		['builders.lua', BUILDERS], ['generated.lua', GENERATED], ['frames.lua', "return {'one','two'}"],
		['sprite.lua', "return {frames=require('frames'),frame_run=2}"],
		['program.lua', "local progression=require('cartlib/progression'); progression.compile_program({})"], ['cartlib/progression.lua', 'return {}']]);
}

function openVisual(f: ReturnType<typeof fixture>, kind: 'scene' | 'behavior' | 'animation') {
	const group = f.firstGroup, path = kind === 'scene' ? 'scene.lua' : kind === 'behavior' ? 'tree.lua' : 'animation.lua';
	const resource = f.sources.catalog.resolveResource({ contextId: f.sources.systemContextId, path })!;
	if (kind === 'scene') {
		f.editor.sceneEditor.openResource(group, resource); const input = group.model.activeTab;
		assert.ok(input instanceof SceneEditorInput); input.view.refresh(); selectSceneOutlineRow(input.view, 1);
	} else if (kind === 'animation') {
		const input = f.editor.animations.openResource(group, resource);
		assert.ok(input !== undefined);
		f.editor.animations.selectTrack(input, 1); f.editor.animations.selectKey(input, 0); f.editor.animations.selectProperty(input, 0);
	} else {
		const panel = f.editor.resourcePanel; panel.show(); panel.queuePendingSelection(resource); panel.applyPendingSelection();
		const file = panel.files.selectedNode; assert.ok(file !== null && file.element.kind === 'file'); panel.toggleFileDisclosure(file);
		const node = file.children.find(node => node.element.kind === 'definition' && node.element.content.kind === 'behavior_tree');
		assert.ok(node !== undefined && node.element.kind === 'definition' && node.element.content.kind === 'behavior_tree');
		f.editor.behaviorLens.openDefinition(group, node.element.content.registration); panel.hide();
	}
	const input = group.model.activeTab;
	assert.ok(input instanceof SceneEditorInput || input instanceof BehaviorLensInput || input instanceof AnimationEditorInput);
	const pane = group.panes.activePane!; pane.focus(); return { group, input, pane };
}

for (const kind of ['scene', 'behavior', 'animation'] as const)
	test(`${kind} contributes a fresh canonical caret before a frame and shared Source to Side retains the visual input`, async t => {
		const f = fixture(t), { group, input, pane } = openVisual(f, kind), model = input.workingCopy;
		const before = pane.getSourceLocation!(); assert.ok(before !== undefined && before.selection !== undefined);
		const start = model.buffer.offsetAt(before.selection.row, before.selection.startColumn), prefix = '-- shifted before the next frame\n';
		model.pushEditOperations([{ offset: 0, deleteLength: 0, text: prefix }]);
		const text = model.buffer.getText(), version = model.version, source = t.mock.method(pane, 'getSourceLocation');
		assert.equal(f.editor.commands.isEnabled('editor.sourceToSide', pane.commandTarget), true);
		assert.equal(source.mock.callCount(), 0, 'enablement queries only the attached capability and must not invoke semantic projection');
		const opening = t.mock.method(f.editor.navigation, 'openSource'); f.editor.commands.execute('editor.sourceToSide', pane.commandTarget);
		assert.equal(opening.mock.callCount(), 1); await opening.mock.calls[0].result;
		const side = f.firstPart.groups.find(candidate => candidate !== group)!; assert.ok(side !== undefined);
		const code = side.model.activeTab; assert.ok(code instanceof CodeEditorInput && code.workingCopy === model && code.resource === model.resource);
		assert.equal(code.workingCopy.buffer.offsetAt(code.context.view.cursorRow, code.context.view.cursorColumn), start + prefix.length);
		assert.ok(group.model.activeTab === input && group.panes.activePane === pane && side.panes.activePane?.input === code);
		assert.equal(model.buffer.getText(), text); assert.equal(model.version, version); assert.equal(model.canUndo, true);
	});

test('Scene Source to Side consumes the actual focused draft before reading the selected source generation', async t => {
	const f = fixture(t), { group, input, pane } = openVisual(f, 'scene'), model = input.workingCopy;
	const before = pane.getSourceLocation!(); assert.ok(before?.selection !== undefined);
	const start = model.buffer.offsetAt(before.selection.row, before.selection.startColumn), prefix = '-- accepted source draft\n';
	const field = new ValueInput(pane.commandTarget, INTEGER_INPUT_FORMAT, () => model.pushEditOperations([{ offset: 0, deleteLength: 0, text: prefix }]));
	t.after(() => field.dispose()); field.setValue(1); field.layout(group.panes.contentBounds); field.field.focusTarget.focus(); setFieldText(field.field, '2', true);
	const opening = t.mock.method(f.editor.navigation, 'openSource'); f.editor.commands.execute('editor.sourceToSide', pane.commandTarget);
	assert.equal(field.pending, false); assert.equal(opening.mock.callCount(), 1); await opening.mock.calls[0].result;
	const side = f.firstPart.groups.find(candidate => candidate !== group)!, code = side.model.activeTab;
	assert.ok(code instanceof CodeEditorInput && code.workingCopy === model && group.model.activeTab === input);
	assert.equal(model.buffer.offsetAt(code.context.view.cursorRow, code.context.view.cursorColumn), start + prefix.length);
});

test('Animation frames selection names the written frames field while selected imported frames retain their own owner', t => {
	const f = fixture(t), resource = f.sources.catalog.resolveResource({ contextId: f.sources.systemContextId, path: 'sprite.lua' })!;
	const input = f.editor.animations.openResource(f.firstGroup, resource), controller = f.editor.animations;
	assert.ok(input !== undefined);
	controller.selectTrack(input, input.tracks.rows.findIndex(row => row.frames));
	const document = input.document!, expected = luaSourceRangeToTextRange(input.workingCopy.buffer, document.root.file.chunk.locations.range(document.framesField!.span)).start;
	const frames = controller.getSourceLocation(input); assert.ok(frames?.selection !== undefined && frames.model === input.workingCopy);
	assert.equal(frames.model.buffer.offsetAt(frames.selection.row, frames.selection.startColumn), expected);
	controller.selectProperty(input, 0);
	const property = input.details.rows[input.details.selectionIndex].element;
	assert.ok(property.source.file.file !== resourceIdentityKey(input.workingCopy.resource));
	const selected = controller.getSourceLocation(input); assert.ok(selected?.selection !== undefined);
	assert.ok(selected.model === controller.modelFor(input, property.source.file)); assert.equal(selected.model.resource.path, 'frames.lua');
	assert.equal(selected.modelVersion, selected.model.version);
});

test('Animation Producer Source to Side certifies the imported producer after an external edit without borrowing a foreign view', async t => {
	const f = fixture(t), controller = f.editor.animations;
	const resource = f.sources.catalog.resolveResource({ contextId: f.sources.systemContextId, path: 'generated.lua' })!;
	const input = controller.openResource(f.firstGroup, resource);
	assert.ok(input !== undefined);
	const index = input.details.rows.findIndex(row => staticLuaTableFieldName(row.element.field) === 'frame_duration');
	assert.ok(index >= 0); controller.selectProperty(input, index);
	const before = controller.getProducerSourceLocation(input); assert.ok(before?.selection !== undefined && before.model.resource.path === 'builders.lua');
	const start = before.model.buffer.offsetAt(before.selection.row, before.selection.startColumn), prefix = '-- imported source generation\n';
	const foreign = new CodeEditorInput(before.model); f.secondGroup.openEditor(foreign);
	f.firstGroup.focus(); before.model.pushEditOperations([{ offset: 0, deleteLength: 0, text: prefix }]);
	const source = before.model.buffer.getText(), version = before.model.version, pane = f.firstGroup.panes.activePane!;
	const opening = t.mock.method(f.editor.navigation, 'openSource'); f.editor.commands.execute('animation.producerSourceToSide', pane.commandTarget);
	assert.equal(opening.mock.callCount(), 1); await opening.mock.calls[0].result;
	const side = f.firstPart.groups.find(candidate => candidate !== f.firstGroup)!, code = side.model.activeTab;
	assert.ok(code instanceof CodeEditorInput && code.workingCopy === before.model && code !== foreign);
	assert.equal(code.workingCopy.buffer.offsetAt(code.context.view.cursorRow, code.context.view.cursorColumn), start + prefix.length);
	assert.ok(f.secondGroup.model.activeTab === foreign && f.firstGroup.model.activeTab === input);
	assert.equal(before.model.buffer.getText(), source); assert.equal(before.model.version, version);
});

test('Animation never certifies stale AST coordinates when imported model admission edits the projected owner', t => {
	const sources = createScenarioTestSourceState([createScenarioTestSourceRecord('generated.lua', 1, GENERATED), createScenarioTestSourceRecord('builders.lua', 1, BUILDERS)]);
	const contextId = TEST_CARTRIDGE_CONTEXT_IDS[0], resource = sources.catalog.resolveResource({ contextId, path: 'generated.lua' })!;
	const model = resolveLuaTextFileModel(editorTextModelService, sources.catalog, resource), input = new AnimationEditorInput(model, contextId);
	const controller = new AnimationEditorController(sources.catalog); let edited = false;
	t.after(() => { input.dispose(); editorTextModelService.clear(); });
	t.after(editorTextModelService.onDidAddModel(dependency => {
		if (dependency.resource.path !== 'builders.lua' || edited) return;
		edited = true; model.pushEditOperations([{ offset: 0, deleteLength: 0, text: '-- reentrant source edit\n' }]);
	}));
	const location = controller.getSourceLocation(input);
	assert.equal(edited, true); assert.ok(location === undefined, 'the immutable AST certificate must not be replaced with the newly edited buffer version');
	const current = controller.getSourceLocation(input); assert.ok(current?.model === model); assert.equal(current.modelVersion, model.version);
});

for (const kind of ['AEM', 'Map'] as const) test(`${kind} generic Source to Side forces the text editor over its same canonical working copy`, async t => {
	await openWorkspaceRecords(new MemoryWorkspaceFiles());
	const f = fixture(t); t.after(async () => { await closeWorkspaceRecords(); clearWorkspaceSourceCaches(); });
	const path = kind === 'AEM' ? 'res/data/events.aem.yaml' : 'res/data/castle_map.yaml';
	f.sources.catalog.registerTextSources(f.sources.systemContextId, [{ type: kind === 'AEM' ? 'aem' : 'data', resid: kind, source_path: path,
		sourcemeta: { text: kind === 'AEM' ? 'events: {}\n' : '1: { map: [".."], objects: [] }\n' } }]);
	const resource = f.sources.catalog.resolveResource({ contextId: f.sources.systemContextId, path })!;
	await f.editor.navigation.openResource(f.firstGroup, resource);
	const input = f.firstGroup.model.activeTab; assert.ok(input?.kind === 'aem_editor' || input?.kind === 'cart_map');
	assert.equal(input.kind, kind === 'AEM' ? 'aem_editor' : 'cart_map');
	const pane = f.firstGroup.panes.activePane!, model = input.workingCopy, text = model.buffer.getText(), version = model.version;
	const opening = t.mock.method(f.editor.navigation, 'openSource'); f.editor.commands.execute('editor.sourceToSide', pane.commandTarget);
	assert.equal(opening.mock.callCount(), 1); await opening.mock.calls[0].result;
	const side = f.firstPart.groups.find(group => group !== f.firstGroup)!, code = side.model.activeTab;
	assert.ok(code instanceof CodeEditorInput && code.workingCopy === model && code.resource === resource);
	assert.ok(f.firstGroup.model.activeTab === input && f.firstGroup.panes.activePane === pane);
	assert.equal(model.buffer.getText(), text); assert.equal(model.version, version); assert.equal(model.dirty, false);
});

test('Lua Program generic Source to Side retains its exact program input and canonical authored occurrence', async t => {
	const f = fixture(t), resource = f.sources.catalog.resolveResource({ contextId: f.sources.systemContextId, path: 'program.lua' })!;
	f.editor.luaPrograms.openResource(f.firstGroup, resource, 'progression');
	const input = f.firstGroup.model.activeTab; assert.ok(input?.kind === 'lua_program');
	const pane = f.firstGroup.panes.activePane!, location = pane.getSourceLocation!(); assert.ok(location?.selection !== undefined);
	const model = input.workingCopy, text = model.buffer.getText(), version = model.version;
	const opening = t.mock.method(f.editor.navigation, 'openSource'); f.editor.commands.execute('editor.sourceToSide', pane.commandTarget);
	assert.equal(opening.mock.callCount(), 1); await opening.mock.calls[0].result;
	const side = f.firstPart.groups.find(group => group !== f.firstGroup)!, code = side.model.activeTab;
	assert.ok(code instanceof CodeEditorInput && code.workingCopy === model && f.firstGroup.model.activeTab === input);
	assert.equal(code.context.view.cursorRow, location.selection.row); assert.equal(code.context.view.cursorColumn, location.selection.startColumn);
	assert.equal(model.buffer.getText(), text); assert.equal(model.version, version); assert.equal(model.dirty, false);
});

test('an explicitly retained inactive visual input cannot borrow the active contribution Source capability', t => {
	const f = fixture(t), scene = openVisual(f, 'scene'); scene.group.model.pin(scene.input);
	const animation = openVisual(f, 'animation'), opening = t.mock.method(f.editor.navigation, 'openSource');
	assert.ok(animation.group === scene.group && scene.group.model.contains(scene.input) && animation.group.model.activeTab === animation.input);
	assert.equal(f.editor.commands.isEnabled('editor.sourceToSide', animation.pane.commandTarget, scene.input), false);
	f.editor.commands.execute('editor.sourceToSide', animation.pane.commandTarget, scene.input);
	assert.equal(opening.mock.callCount(), 0); assert.equal(f.firstPart.groups.length, 1);
	assert.ok(animation.group.model.activeTab === animation.input && animation.group.panes.activePane === animation.pane);
});

import { TEST_CARTRIDGE_CONTEXT_IDS } from '../helpers/runtime_sources';
import { resourceIdentityKey } from '../../ide/common/resource';
import { createTestEditorGroup } from '../helpers/editor_panes';
import assert from 'node:assert/strict';
import test from 'node:test';
import { LuaSyntaxKind } from '../../toolchain/ts/lua/syntax/ast';
import { findNamedLuaTableField } from '../../toolchain/ts/lua/syntax/table_fields';
import { buildLuaSemanticWorkspaceSnapshot, LuaSemanticWorkspace } from '../../toolchain/ts/lua/semantic/model';
import { buildResourceLuaSemanticFixtureFile, createResourceModuleProjectFixture } from '../helpers/lua_semantic_project';
import { LuaSourceReader } from '../../ide/language/lua/source_reader';
import { luaSourceRangeToTextRange, readLuaNumberLiteral } from '../../ide/language/lua/source_edits';
import { createLuaTableFieldsInsertionEdits } from '../../ide/language/lua/table_field_insertion';
import { AnimationEditorInput } from '../../ide/workbench/contrib/animation/editor_input';
import { AnimationEditorController } from '../../ide/workbench/contrib/animation/controller';
import { AnimationInputSerializer } from '../../ide/workbench/contrib/animation/editor_serializer';
import { animationDefinitionAtPosition, animationDefinitionAtRange, collectAnimationDefinitions } from '../../ide/workbench/contrib/animation/definitions';
import { buildAnimationSourceDocument } from '../../ide/workbench/contrib/animation/source';
import { EditorTextModel } from '../../ide/editor/model/text_model';
import { mapTrackedTextRange } from '../../ide/editor/text/text_change';
import { editorTextModelService } from '../../ide/editor/model/model_service';
import { getOrCreateSemanticProject } from '../../ide/editor/contrib/intellisense/semantic/workspace/state';
import { createScenarioTestSourceRecord, createScenarioTestSourceState } from '../helpers/scenario_sources';
import { createCartlibProgramHarness } from '../helpers/cartlib_cpu';
import { RunResult } from '../../machine/ts/machine/cpu/cpu';

const resource = { contextLabel: 'Fixture project', sourceFilePath: 'definitions.lua', location: { kind: 'workspace' as const, path: 'definitions.lua' }, contextId: TEST_CARTRIDGE_CONTEXT_IDS[0], path: 'definitions.lua', source: { resid: 'definitions', type: 'lua' as const } };

test('native procedural, duration-only and sequence definitions are source, not manufactured keys', () => {
	for (const source of ['return { frames = function(params) error(params) end, frame_duration = 20 }',
		'return { duration_frames = 4 }', 'return { subsequences = {} }']) {
		const file = buildResourceLuaSemanticFixtureFile(source, resource), snapshot = buildLuaSemanticWorkspaceSnapshot(...createResourceModuleProjectFixture([file], []));
		const document = buildAnimationSourceDocument(resource, snapshot)!;
		assert.equal(document.root.file, file);
		assert.equal(document.tracksSource, undefined);
		assert.deepEqual(document.tracks, []);
		assert.equal(document.root.structural, true);
	}
	assert.equal(buildAnimationSourceDocument(resource, buildLuaSemanticWorkspaceSnapshot(...createResourceModuleProjectFixture([buildResourceLuaSemanticFixtureFile('return { frames_per_step = 4 }', resource)], []))), undefined);
});

test('only import-bound producers and FSM timeline fields enter the invocation catalog', () => {
	const file = buildResourceLuaSemanticFixtureFile(`
		local library = require('cartlib/fsm/library')
		local compiler = require('cartlib/timeline/program')
		local component = require('cartlib/timeline/timeline_component')
		library.register('fsm', {
			timelines = { idle = { def = { duration_frames = 1 } }, idle = { def = { duration_frames = 2 } },
				move = { def = require('shared') } },
			states = { nested = { timelines = { finish = { def = { duration_frames = 3 } } } } },
		})
		compiler.compile({ duration_frames = 4 })
		component:define('colon', { duration_frames = 5 })
		component.define({}, 'dot', { duration_frames = 6 })
		local impostor = { register = function() end, define = function() end }
		impostor.register('not-fsm', { timelines = { wrong = { def = { duration_frames = 90 } } } })
		impostor:define('not-timeline', { duration_frames = 91 })
	`, resource);
	const shared = buildResourceLuaSemanticFixtureFile('return { duration_frames = 7 }', { contextId: TEST_CARTRIDGE_CONTEXT_IDS[0], path: 'shared.lua' });
	const snapshot = buildLuaSemanticWorkspaceSnapshot(...createResourceModuleProjectFixture([file, shared], ['cartlib/fsm/library', 'cartlib/timeline/program', 'cartlib/timeline/timeline_component']));
	const catalog = collectAnimationDefinitions(resource, snapshot);
	const values = catalog.map(definition => readLuaNumberLiteral(findNamedLuaTableField(definition.table, 'duration_frames')!.value));
	assert.deepEqual(values, [4, 5, 6, 2, 7, 3]);
	assert.equal(catalog[4].file, shared);
});

test('explicit Source selection can own a dynamic receiver without misclassifying its call as a registered producer', () => {
	const source = `function configure(self)
		self.timelines:define('first', { frames = function() return {{ x = 0 }} end, frame_duration = 20 })
		self.timelines:define('second', { duration_frames = 2 })
	end`;
	const workspace = new LuaSemanticWorkspace(new Map([[resourceIdentityKey(resource), new Map()]]));
	let file = workspace.updateFile(resourceIdentityKey(resource), source);
	assert.deepEqual(collectAnimationDefinitions(resource, workspace.getSnapshot()), []);
	const model = new EditorTextModel(resource, 'lua', source);
	const selected = animationDefinitionAtPosition(file, 2, 70)!;
	const marker = luaSourceRangeToTextRange(model.buffer, file.chunk.locations.range(selected.span));
	const unbind = model.onDidChangeContent(event => mapTrackedTextRange(marker, event.changes));
	model.pushEditOperations([{ offset: 0, deleteLength: 0, text: '-- keep the selected occurrence\n' }]);
	file = workspace.updateFile(resourceIdentityKey(resource), model.buffer.getText());
	const moved = animationDefinitionAtRange(file, model.buffer, marker)!;
	assert.equal(findNamedLuaTableField(moved, 'frame_duration')!.value.kind, LuaSyntaxKind.NumericLiteralExpression);
	model.pushEditOperations([{ offset: marker.start, deleteLength: marker.end - marker.start, text: '{}' }]);
	file = workspace.updateFile(resourceIdentityKey(resource), model.buffer.getText());
	assert.equal(animationDefinitionAtRange(file, model.buffer, marker), undefined, 'replacing one definition never selects the next occurrence');
	model.undo();
	file = workspace.updateFile(resourceIdentityKey(resource), model.buffer.getText());
	assert.equal(animationDefinitionAtRange(file, model.buffer, marker), undefined, 'Undo restores source, not a retired identity');
	unbind(); model.dispose();
});

test('producer navigation retains call boundaries while closed authored members remain values', () => {
	const file = buildResourceLuaSemanticFixtureFile(`
		local builders = require('builders')
		local built = builders.make({ value = 4 })
		return { frames = built, frame_duration = builders.duration }
	`, resource);
	const builder = buildResourceLuaSemanticFixtureFile(`local builders = { duration = 20 }
		function builders.make(params) error('producer navigation must not execute this') end
		return builders`, { contextId: TEST_CARTRIDGE_CONTEXT_IDS[0], path: 'builders.lua' });
	const reader = new LuaSourceReader(buildLuaSemanticWorkspaceSnapshot(...createResourceModuleProjectFixture([file, builder], [])));
	const root = buildAnimationSourceDocument(resource, reader.snapshot)!.root;
	const frames = findNamedLuaTableField(root.table, 'frames')!, duration = findNamedLuaTableField(root.table, 'frame_duration')!;
	assert.equal(reader.expression(file, frames.value), undefined);
	const producer = reader.producer(file, frames.value)!;
	assert.equal(producer.kind, 'call');
	assert.equal(producer.source.file, builder);
	assert.equal(producer.source.expression.kind, LuaSyntaxKind.FunctionExpression);
	const value = reader.producer(file, duration.value)!;
	assert.equal(value.kind, 'value');
	assert.equal(value.source.file, builder);
	assert.equal(readLuaNumberLiteral(value.source.expression), 20);
	assert.equal(reader.expression(file, frames.value), undefined, 'navigation has not turned a call boundary into a value');
	assert.equal(readLuaNumberLiteral(reader.expression(file, duration.value)!.expression), 20);

	const ambiguous = buildResourceLuaSemanticFixtureFile('local maker = function() end; maker = unknown; return { frames = maker() }', { contextId: TEST_CARTRIDGE_CONTEXT_IDS[0], path: 'ambiguous.lua' });
	const ambiguousReader = new LuaSourceReader(buildLuaSemanticWorkspaceSnapshot(...createResourceModuleProjectFixture([ambiguous], [])));
	const ambiguousRoot = buildAnimationSourceDocument(ambiguous.resource, ambiguousReader.snapshot)!.root;
	assert.equal(ambiguousReader.producer(ambiguous, findNamedLuaTableField(ambiguousRoot.table, 'frames')!.value), undefined);
});

test('a source-authored track extends a native frame builder without replacing it, and executes on the real CPU at O0 and O3', () => {
	const source = `local first = {
		frames = function(params) return {{ x = 0 }, { x = params.end_x }} end,
		frame_duration = 20,
		apply = true,
	}
	local second = { duration_frames = 8 }
	return { first = first, second = second }`;
	const file = buildResourceLuaSemanticFixtureFile(source, resource), model = new EditorTextModel(resource, 'lua', source);
	const selected = animationDefinitionAtPosition(file, 2, 30)!;
	const document = buildAnimationSourceDocument(resource, buildLuaSemanticWorkspaceSnapshot(...createResourceModuleProjectFixture([file], [])), selected)!;
	const frames = findNamedLuaTableField(document.root.table, 'frames')!.value;
	assert.equal(frames.kind, LuaSyntaxKind.FunctionExpression);
	const originalBuilder = model.buffer.getTextRange(luaSourceRangeToTextRange(model.buffer, file.chunk.locations.range(frames.span)).start,
		luaSourceRangeToTextRange(model.buffer, file.chunk.locations.range(frames.span)).end);
	model.pushEditOperations(createLuaTableFieldsInsertionEdits(model.buffer, file.chunk, document.root.table, document.root.table.fields.length,
		["tracks = {{ kind = 'value', interpolation = 'linear', path = {'y'}, keys = {{ frame = 0, value = 10 }, { frame = 1, value = 20 }} }}"]));
	assert.ok(model.buffer.getText().includes(originalBuilder));
	for (const optLevel of [0, 3] as const) {
		const { cpu } = createCartlibProgramHarness(`
			local component = require('cartlib/timeline/timeline_component')
			local owner = { x = -1, y = -1 }
			local definitions = require('definitions')
			local timelines = component.new({ owner = owner })
			timelines:define('first', definitions.first)
			timelines:play('first', { params = { end_x = 11 }, snap_to_start = true })
			assert(owner.x == 0 and owner.y == 10)
			timelines:tick_gameplay(20)
			assert(owner.x == 11 and owner.y == 20)
			assert(definitions.second.duration_frames == 8)
		`, { optLevel, modules: [{ path: 'definitions', source: model.buffer.getText() }] });
		assert.equal(cpu.runUntilDepth(0, 20_000_000), RunResult.Halted);
	}
	model.undo(); assert.equal(model.buffer.getText(), source); model.dispose();
});

test('independent inline views share real documents/history and retire stale session anchors instead of guessing', async t => {
	const source = "local first = {frames=function() end,frame_duration=20}; local second={duration_frames=8}; return {}";
	const sources = createScenarioTestSourceState([createScenarioTestSourceRecord(resource.path, 1, source)]);
	const model = editorTextModelService.retain(sources.catalog.resolveResource(resource)!, 'lua', source);
	const group = createTestEditorGroup(); t.after(() => group.dispose());
	const controller = new AnimationEditorController(sources.catalog);
	const project = getOrCreateSemanticProject(editorTextModelService, TEST_CARTRIDGE_CONTEXT_IDS[0]); project.synchronizeSources(sources.catalog);
	const file = project.getFileData(resource)!;
	const first = animationDefinitionAtPosition(file, 1, 30)!, second = animationDefinitionAtPosition(file, 1, 86)!;
	const input = new AnimationEditorInput(model, model.resource.contextId, luaSourceRangeToTextRange(model.buffer, file.chunk.locations.range(first.span)));
	const other = new AnimationEditorInput(model, model.resource.contextId, luaSourceRangeToTextRange(model.buffer, file.chunk.locations.range(second.span)));
	group.model.add(input); group.model.add(other);
	t.after(() => { group.model.clear(); input.dispose(); other.dispose(); editorTextModelService.clear(); });
	controller.refresh(input); controller.refresh(other);
	assert.equal(controller.authoring.canAddTrack(input), true);
	assert.notEqual(input.id, other.id);
	assert.equal(input.workingCopy, other.workingCopy);
	const revision = input.version, document = input.document;
	for (let index = 0; index < 1000; index++) controller.refresh(input);
	assert.equal(input.document, document);
	assert.equal(input.version, revision);
	model.pushEditOperations([{ offset: 0, deleteLength: 0, text: '-- before both definitions\n' }]);
	controller.refresh(input); controller.refresh(other);
	assert.equal(readLuaNumberLiteral(findNamedLuaTableField(other.document!.root.table, 'duration_frames')!.value), 8);
	assert.equal(input.isDirty(), true); assert.equal(other.isDirty(), true);
	model.undo(); controller.refresh(input); controller.refresh(other);
	assert.equal(input.isDirty(), false); assert.equal(other.isDirty(), false);
	const serializer = new AnimationInputSerializer(sources.catalog, controller), snapshot = serializer.serialize(input);
	const restored = await serializer.deserialize(snapshot);
	assert.equal(restored.workingCopy, model);
	assert.deepEqual(restored.definitionRange, input.definitionRange);
	assert.ok(restored.document !== undefined);
	restored.dispose();
	model.pushEditOperations([{ offset: 0, deleteLength: 0, text: '-- external source changes retire stored geometry\n' }]);
	const retired = await serializer.deserialize(snapshot);
	assert.equal(retired.workingCopy, model);
	assert.equal(retired.document, undefined);
	assert.equal(retired.definitionRange!.start, retired.definitionRange!.end);
	retired.dispose();
});

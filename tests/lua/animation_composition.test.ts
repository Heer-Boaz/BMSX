import { createTestEditorGroup } from '../helpers/editor_panes';
import { resourceIdentityKey } from '../../ide/common/resource';
import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import { buildLuaSemanticWorkspaceSnapshot } from '../../toolchain/ts/lua/semantic/model';
import { buildResourceLuaSemanticFixtureFile, createResourceModuleProjectFixture } from '../helpers/lua_semantic_project';
import { buildAnimationSourceDocument } from '../../ide/workbench/contrib/animation/source';
import { animationDefinitionFamily, collectAnimationDefinitions } from '../../ide/workbench/contrib/animation/definitions';
import { AnimationEditorInput } from '../../ide/workbench/contrib/animation/editor_input';
import { AnimationAuthoring } from '../../ide/workbench/contrib/animation/authoring';
import { AnimationEditorController } from '../../ide/workbench/contrib/animation/controller';
import { AnimationLaneControl } from '../../ide/workbench/contrib/animation/lane_control';
import { AnimationInputSerializer } from '../../ide/workbench/contrib/animation/editor_serializer';
import { EditorTextModel } from '../../ide/editor/model/text_model';
import { editorTextModelService } from '../../ide/editor/model/model_service';
import { getOrCreateSemanticProject } from '../../ide/editor/contrib/intellisense/semantic/workspace/state';
import { rebuildRuntimeSourceResources, resolveRuntimeResource } from '../../ide/runtime/sources';
import { registerLuaSourceRecord } from '../../ide/runtime/source_registry';
import { luaSourceRangeToTextRange } from '../../ide/language/lua/source_edits';
import { createScenarioTestSourceRecord, createScenarioTestSourceState } from '../helpers/scenario_sources';
import { RunResult } from '../../machine/ts/machine/cpu/cpu';
import { createCartlibProgramHarness } from '../helpers/cartlib_cpu';
import { ANIMATION_TRACK_TEMPLATES } from '../../ide/workbench/contrib/animation/track_templates';
import { inputFocus } from '../../ide/input/focus';
import { PointerButton } from '../../hosts/common/input/pointer_event';

import { AnimationEditorPane } from '../../ide/workbench/contrib/animation/editor_pane';
import { measureAnimationEditor } from '../../ide/workbench/contrib/animation/layout';
import type { IdeCommandController } from '../../ide/commands/controller';
import type { EditorCommandRunner } from '../../ide/common/commands';
import type { EditorNavigationController } from '../../ide/workbench/contrib/resources/navigation';
import { ContextMenuController } from '../../ide/workbench/services/context_menu/controller';
import { WorkbenchSurfaceService } from '../../ide/workbench/services/windows/service';
import { editorViewState } from '../../ide/editor/ui/view/state';
import { configureFontVariant } from '../../ide/editor/ui/view/configuration';
import { pointerCapture } from '../../ide/input/pointer/capture';
import { pointerHover } from '../../ide/input/pointer/hover';
import { KeyInputEvent, KeyModifier } from '../../hosts/common/input/text';

const resource = { sourceFilePath: 'parent.lua', location: { kind: 'workspace' as const, path: 'parent.lua' }, domain: 0 as const, path: 'parent.lua', source: { resid: 'parent.lua', type: 'lua' as const } };
const child = "return {duration_ms=100, tracks={{kind='value',interpolation='linear',path={'x'},keys={{time_ms=0,value=0},{time_ms=100,value=100}}}}}";

test('overview key picking does not clear the active occurrence before resolving a hit', t => {
	const source = "return {duration_ms=100,tracks={{kind='value',interpolation='linear',keys={{time_ms=50,value=0},{time_ms=50,value=0}}},{kind='event',keys={{time_ms=25,event='other'}}}}}";
	const sources = createScenarioTestSourceState([createScenarioTestSourceRecord(resource.path, 1, source)]);
	const model = editorTextModelService.retain(resolveRuntimeResource(sources, resource)!, 'lua', source);
	const controller = new AnimationEditorController(sources, undefined!, undefined!, undefined!);
	const input = new AnimationEditorInput(model, model.resource.domain);
	input.tracks.layout.contentTop = 0; input.tracks.layout.rowHeight = 20; input.tracks.layout.visibleRowCount = 3;
	controller.refresh(input); controller.selectTrack(input, 1); controller.selectKey(input, 1);
	input.overview.layout(0, 0, 106, 60); input.keys.range.layout(0, 0, 106, 20);
	const focus = inputFocus.createTarget(); focus.bindKeyboard(() => {});
	const control = new AnimationLaneControl(focus, controller); control.setInput(input);
	t.after(() => { control.dispose(); input.dispose(); editorTextModelService.clear(); inputFocus.setTarget(null); });
	const pointer = { viewportX: input.keys.xAt(50), viewportY: 30, valid: true, insideViewport: true,
		pressedButtons: PointerButton.Primary, justPressedButtons: PointerButton.Primary, justReleasedButtons: 0 };
	control.handlePointer({ ...pointer, viewportX: input.keys.xAt(25), viewportY: 50,
		pressedButtons: PointerButton.Secondary, justPressedButtons: PointerButton.Secondary });
	assert.equal(input.trackIndex, 1); assert.equal(input.keyIndex, 0);
	assert.equal(pointerCapture.active, false, 'secondary overview selection must not start a clip/key edit');
	controller.selectTrack(input, 1); controller.selectKey(input, 1);
	control.handlePointer(pointer);
	assert.equal(input.keys.selected, 1); assert.equal(input.keyIndex, 1);
	control.handlePointer({ ...pointer, viewportX: input.keys.xAt(25), viewportY: 50 });
	assert.equal(input.trackIndex, 1); assert.equal(input.keys.selected, 0);
	assert.equal(model.buffer.getText(), source); assert.equal(model.undo(), null);
});

test('clip trim edits the written parent once, preserves child time and imported ownership at O0/O3', () => {
	const source = "-- untouched\nreturn {duration_ms=100,subsequences={{duration_ms=100,sequence=require('child')}}}\n";
	const model = new EditorTextModel(resource, 'lua', source), input = new AnimationEditorInput(model, model.resource.domain);
	input.document = buildAnimationSourceDocument(resource, buildLuaSemanticWorkspaceSnapshot(...createResourceModuleProjectFixture([buildResourceLuaSemanticFixtureFile(source, resource), buildResourceLuaSemanticFixtureFile(child, { domain: 0, path: 'child.lua' })], [])))!;
	const authoring = new AnimationAuthoring({ modelFor: () => model, refresh() {}, selectKey() {}, selectTrack() {}, selectProperty() {} }, undefined!, undefined!);
	const clip = input.document.clips[0];
	assert.equal(clip.sequence!.file.file, resourceIdentityKey({ domain: 0, path: 'child.lua' }));
	assert.equal(authoring.canEditClip(input, clip, 'start'), true);
	authoring.editClip(input, clip, 'start', 25, 75);
	const changed = buildAnimationSourceDocument(resource, buildLuaSemanticWorkspaceSnapshot(...createResourceModuleProjectFixture([buildResourceLuaSemanticFixtureFile(model.buffer.getText(), resource), buildResourceLuaSemanticFixtureFile(child, { domain: 0, path: 'child.lua' })], [])))!;
	assert.equal(changed.clips[0].start!.value, 25);
	assert.equal(changed.clips[0].duration!.value, 75);
	assert.equal(changed.clips[0].clipIn!.value, 25);
	assert.ok(model.buffer.getText().startsWith('-- untouched\n'));
	for (const optLevel of [0, 3] as const) {
		const { cpu } = createCartlibProgramHarness(`local component=require('cartlib/timeline/timeline_component')
			local owner={x=-1}; local timelines=component.new({parent=owner})
			timelines:define('clip',require('parent')); timelines:play('clip')
			timelines:seek_time('clip',50); assert(owner.x==50)
		`, { optLevel, modules: [{ path: 'parent', source: model.buffer.getText() }, { path: 'child', source: child }] });
		assert.equal(cpu.runUntilDepth(0, 20_000_000), RunResult.Halted);
	}
	model.undo();
	assert.equal(model.buffer.getText(), source);
	assert.equal(model.undo(), null);
	input.dispose(); model.dispose();
});

test('multi-field curve and clip edits preserve independently authored field order and one Undo', () => {
	const cases = [
		"-- curve comment\nreturn {tracks={{kind='value',interpolation='linear',path={'x'},keys={{value=1,time_ms=2}}}}}",
		"-- clip comment\nreturn {subsequences={{clip_in_ms=0,duration_ms=100,start_time_ms=0,sequence={duration_ms=100,tracks={}}}}}",
	];
	for (let index = 0; index < cases.length; index++) {
		const source = cases[index], model = new EditorTextModel(resource, 'lua', source), input = new AnimationEditorInput(model, model.resource.domain);
		input.document = buildAnimationSourceDocument(resource, buildLuaSemanticWorkspaceSnapshot(...createResourceModuleProjectFixture([buildResourceLuaSemanticFixtureFile(source, resource)], [])))!;
		const authoring = new AnimationAuthoring({ modelFor: () => model, refresh() {}, selectKey() {}, selectTrack() {}, selectProperty() {} }, undefined!, undefined!);
		if (index === 0) authoring.editCurveKey(input, input.document.tracks[0].keys[0], 1200, 'value', 2000);
		else authoring.editClip(input, input.document.clips[0], 'start', 25, 75);
		const file = buildResourceLuaSemanticFixtureFile(model.buffer.getText(), resource);
		assert.equal(file.syntaxError, null, 'an edit may not depend on native fields being written in a particular order');
		const document = buildAnimationSourceDocument(resource, buildLuaSemanticWorkspaceSnapshot(...createResourceModuleProjectFixture([file], [])))!;
		if (index === 0) {
			assert.equal(document.tracks[0].keys[0].coordinate!.value, 1200);
			assert.equal(document.tracks[0].keys[0].value!.value, 2000);
		} else {
			assert.equal(document.clips[0].start!.value, 25);
			assert.equal(document.clips[0].duration!.value, 75);
			assert.equal(document.clips[0].clipIn!.value, 25);
		}
		model.undo(); assert.equal(model.buffer.getText(), source);
		assert.equal(model.undo(), null);
		input.dispose(); model.dispose();
	}
});

test('a multiline clip trim inserts missing transport fields as one syntax batch', t => {
	for (const separator of [',', ';']) for (const trailing of ['', separator]) for (const newline of ['\n', '\r\n']) {
		const source = ['-- parent', 'return {subsequences={{', `\tduration_ms=100${separator}`,
			`\tsequence=require('child')${trailing} -- child stays here`, '}}}'].join(newline);
		const model = new EditorTextModel(resource, 'lua', source), input = new AnimationEditorInput(model, model.resource.domain);
		t.after(() => { input.dispose(); model.dispose(); });
		input.document = buildAnimationSourceDocument(resource, buildLuaSemanticWorkspaceSnapshot(...createResourceModuleProjectFixture([buildResourceLuaSemanticFixtureFile(source, resource), buildResourceLuaSemanticFixtureFile(child, { domain: 0, path: 'child.lua' })], [])))!;
		const authoring = new AnimationAuthoring({ modelFor: () => model, refresh() {}, selectKey() {}, selectTrack() {}, selectProperty() {} }, undefined!, undefined!);
		let changes = 0; model.onDidChangeContent(() => changes++);
		authoring.editClip(input, input.document.clips[0], 'start', 25, 75);
		const changed = model.buffer.getText(), file = buildResourceLuaSemanticFixtureFile(changed, resource);
		assert.equal(file.syntaxError, null);
		const document = buildAnimationSourceDocument(resource, buildLuaSemanticWorkspaceSnapshot(...createResourceModuleProjectFixture([file, buildResourceLuaSemanticFixtureFile(child, { domain: 0, path: 'child.lua' })], [])))!;
		assert.equal(document.clips[0].start!.value, 25);
		assert.equal(document.clips[0].duration!.value, 75);
		assert.equal(document.clips[0].clipIn!.value, 25);
		assert.equal(changes, 1);
		assert.ok(changed.includes('-- child stays here'));
		for (const optLevel of [0, 3] as const) {
			const { cpu } = createCartlibProgramHarness(`local component=require('cartlib/timeline/timeline_component')
				local owner={x=-1}; local timeline=component.new({parent=owner})
				timeline:define('clip',require('parent')); timeline:play('clip')
				timeline:seek_time('clip',50); assert(owner.x==50)
			`, { optLevel, modules: [{ path: 'parent', source: changed }, { path: 'child', source: child }] });
			assert.equal(cpu.runUntilDepth(0, 20_000_000), RunResult.Halted);
		}
		model.undo(); assert.equal(model.buffer.getText(), source); assert.equal(model.undo(), null);
		model.redo(); assert.equal(model.buffer.getText(), changed);
	}
});

test('sprite frame definitions are admitted by their imported factory and retain named/source array order', () => {
	const source = "local sprite=require('cartlib/component/sprite_animation_component'); return sprite.factory({animation='idle',animations={idle={frames={'idle.1','idle.2'},frame_run=2},hit={frames={'hit.1'},frame_duration_ms=20}}})";
	const file = buildResourceLuaSemanticFixtureFile(source, resource), snapshot = buildLuaSemanticWorkspaceSnapshot(...createResourceModuleProjectFixture([file], ['cartlib/component/sprite_animation_component']));
	const definitions = collectAnimationDefinitions(resource, snapshot);
	assert.equal(definitions.length, 2);
	for (const definition of definitions) {
		const document = buildAnimationSourceDocument(resource, snapshot, definition.table)!;
		const family = animationDefinitionFamily(document.reader, file, document.root);
		assert.equal(family, 'sprite');
		assert.equal(document.framesSource!.array, true);
		const model = new EditorTextModel(resource, 'lua', source), input = new AnimationEditorInput(model, model.resource.domain);
		input.document = { ...document, family }; input.selectedSource = document.root;
		const authoring = new AnimationAuthoring({ modelFor: () => model, refresh() {}, selectKey() {}, selectTrack() {}, selectProperty() {} }, undefined!, undefined!);
		assert.equal(authoring.canAddFrame(input), true);
		assert.equal(authoring.canAddTrack(input), false);
		assert.equal(authoring.canAddClip(input), false);
		input.dispose(); model.dispose();
	}
});

test('all authored track templates compile through the actual native program and preserve event and tag key domains', () => {
	const tracks = ANIMATION_TRACK_TEMPLATES.map(item => item.create("{'x'}")).join(',');
	const source = `return {duration_ms=1000,tracks={${tracks}}}`;
	const document = buildAnimationSourceDocument(resource, buildLuaSemanticWorkspaceSnapshot(...createResourceModuleProjectFixture([buildResourceLuaSemanticFixtureFile(source, resource)], [])))!;
	assert.equal(document.tracks.length, 7);
	const tag = document.tracks.find(track => track.kind === 'tag')!;
	assert.deepEqual(tag.keys.map(key => key.coordinate!.value), [0, 100]);
	for (const optLevel of [0, 3] as const) {
		const { cpu } = createCartlibProgramHarness("local program=require('cartlib/timeline/program'); local result=program.compile(require('parent')); assert(result.has_evaluation_work)", {
			optLevel, modules: [{ path: 'parent', source }],
		});
		assert.equal(cpu.runUntilDepth(0, 20_000_000), RunResult.Halted);
	}
});

test('imported sprite configuration retains its actual consumer and selected source occurrence through edits and recovery', async t => {
	const config = "-- canonical frames\nreturn {frames={'idle.1','idle.2'},frame_run=2}\n";
	const caller = "local sprite=require('cartlib/component/sprite_animation_component'); return sprite.factory(require('parent'))";
	const sources = createScenarioTestSourceState([createScenarioTestSourceRecord(resource.path, 1, config), createScenarioTestSourceRecord('caller.lua', 1, caller),
		createScenarioTestSourceRecord('cartlib/component/sprite_animation_component.lua', 1, 'return {factory=function(definition) return definition end}')]);
	const model = editorTextModelService.retain(resolveRuntimeResource(sources, resource)!, 'lua', config);
	const group = createTestEditorGroup(); t.after(() => group.dispose());
	const controller = new AnimationEditorController(sources, group, undefined!, undefined!);
	const project = getOrCreateSemanticProject(editorTextModelService, 0); project.synchronizeRuntimeSources(sources);
	const snapshot = project.getSnapshot(), factory = collectAnimationDefinitions({ domain: 0, path: 'caller.lua' }, snapshot)[0];
	assert.equal(factory.file.file, resourceIdentityKey(resource));
	assert.equal(collectAnimationDefinitions(resource, snapshot)[0].consumer, undefined);
	assert.equal(factory.consumer!.file, resourceIdentityKey({ domain: 0, path: 'caller.lua' }), 'raw exports cannot swallow consumer-specific provenance');
	const input = new AnimationEditorInput(model, model.resource.domain, luaSourceRangeToTextRange(model.buffer, factory.file.chunk.locations.range(factory.table.span)), 'sprite', factory.consumer!.file);
	const consumer = controller.modelFor(input, factory.consumer!);
	group.model.add(input);
	t.after(() => { group.model.clear(); input.dispose(); editorTextModelService.clear(); });
	controller.refresh(input); controller.selectTrack(input, input.tracks.rows.length - 1); controller.selectProperty(input, 1);
	assert.equal(input.document!.family, 'sprite');
	controller.authoring.reorder(input, -1);
	assert.deepEqual(input.document!.frames.map(frame => frame.image), ['idle.2', 'idle.1']);
	assert.equal(input.details.selectionIndex, 0);
	controller.authoring.duplicate(input);
	assert.deepEqual(input.document!.frames.map(frame => frame.image), ['idle.2', 'idle.2', 'idle.1']);
	assert.equal(input.details.selectionIndex, 1);
	model.pushEditOperations([{ offset: 0, deleteLength: 0, text: '-- external edit\n' }]); controller.refresh(input);
	assert.equal(input.details.selectionIndex, 1, 'the selected field tracks its shared working copy');
	const serializer = new AnimationInputSerializer(sources, controller);
	const restored = await serializer.deserialize(serializer.serialize(input));
	assert.equal(restored.consumerPath, resourceIdentityKey({ domain: 0, path: 'caller.lua' }));
	assert.equal(restored.document!.family, 'sprite');
	assert.equal(restored.details.selectionIndex, 1); restored.dispose();
	consumer.pushEditOperations([{ offset: 0, deleteLength: consumer.buffer.getText().length, text: "return require('parent')" }]); controller.refresh(input);
	assert.equal(input.document!.family, 'timeline', 'family is current source proof, not a saved flag');
	consumer.undo(); controller.refresh(input);
	assert.equal(input.document!.family, 'sprite');
	model.undo(); model.undo(); model.undo(); controller.refresh(input);
	assert.equal(model.buffer.getText(), config);
	assert.ok(model.buffer.getText().startsWith('-- canonical frames\n'));
});

test('an imported BIOS animation definition retains cart semantic scope through open, refresh and recovery', async t => {
	const biosResource = { domain: -1 as const, path: 'bios_frames.lua' };
	const callerResource = { domain: 0 as const, path: 'caller.lua' };
	const config = "return {frames={'bios.1','bios.2'},frame_run=2}";
	const caller = "local sprite=require('cartlib/component/sprite_animation_component'); return sprite.factory(require('bios_frames'))";
	const sources = createScenarioTestSourceState([
		createScenarioTestSourceRecord(callerResource.path, 1, caller),
		createScenarioTestSourceRecord('cartlib/component/sprite_animation_component.lua', 1, 'return {factory=function(definition) return definition end}'),
	]);
	registerLuaSourceRecord(sources.systemLuaSources, createScenarioTestSourceRecord(biosResource.path, 1, config, 'machine/bios/bios_frames.lua'));
	rebuildRuntimeSourceResources(sources);
	const group = createTestEditorGroup();
	const navigated: Parameters<EditorNavigationController['focusChunkSource']>[] = [];
	const navigation = { focusChunkSource: (...args: Parameters<EditorNavigationController['focusChunkSource']>) => { navigated.push(args); return Promise.resolve(undefined); } } as EditorNavigationController;
	const controller = new AnimationEditorController(sources, group, navigation, undefined!);
	const project = getOrCreateSemanticProject(editorTextModelService, callerResource.domain);
	project.synchronizeRuntimeSources(sources);
	const definition = collectAnimationDefinitions(callerResource, project.getSnapshot())[0];
	assert.equal(definition.file.file, resourceIdentityKey(biosResource));
	assert.equal(definition.consumer!.file, resourceIdentityKey(callerResource));
	const input = controller.openDefinition(callerResource.domain, definition);
	t.after(() => { group.model.clear(); group.dispose(); input.dispose(); editorTextModelService.clear(); });
	assert.equal(input.projectDomain, callerResource.domain);
	assert.deepEqual(input.workingCopy.identity, biosResource);
	assert.equal(input.document!.family, 'sprite');
	assert.equal(controller.openDefinition(callerResource.domain, definition), input, 'open reuses the same definition inside its owning semantic project');
	controller.selectTrack(input, input.tracks.rows.length - 1); controller.selectProperty(input, 1);
	controller.openSource(input);
	assert.deepEqual(navigated[0][0], input.workingCopy.resource, 'source navigation uses the imported definition owner, not the cart scope');
	const consumer = controller.modelFor(input, definition.consumer!);
	consumer.pushEditOperations([{ offset: 0, deleteLength: 0, text: '-- cart revision\n' }]);
	controller.refresh(input);
	assert.equal(input.projectDomain, callerResource.domain);
	assert.equal(input.document!.family, 'sprite', 'the cart consumer remains in scope after refresh of a BIOS working copy');
	const serializer = new AnimationInputSerializer(sources, controller), saved = JSON.parse(serializer.serialize(input));
	assert.equal(saved.projectDomain, callerResource.domain);
	assert.equal(saved.source.resource.domain, biosResource.domain);
	assert.equal(saved.consumer, resourceIdentityKey(callerResource));
	assert.equal(saved.detail.path, resourceIdentityKey(biosResource));
	const restored = await serializer.deserialize(JSON.stringify(saved)); t.after(() => restored.dispose());
	assert.equal(restored.projectDomain, callerResource.domain);
	assert.equal(restored.workingCopy, input.workingCopy);
	assert.equal(restored.consumerPath, resourceIdentityKey(callerResource));
	assert.equal(restored.document!.family, 'sprite');
	controller.openSource(restored);
	assert.deepEqual(navigated[1][0], input.workingCopy.resource);
});

test('a selected mixed-coordinate lane remains Source after a shared working-copy revision', t => {
	const source = "return {tracks={{kind='event',keys={{time_ms=0,event='first'}}},{kind='event',keys={{frame=1,event='second'},{u=1,event='third'}}}}}";
	const sources = createScenarioTestSourceState([createScenarioTestSourceRecord(resource.path, 1, source)]);
	const model = editorTextModelService.retain(resolveRuntimeResource(sources, resource)!, 'lua', source);
	const group = createTestEditorGroup(); t.after(() => group.dispose());
	const controller = new AnimationEditorController(sources, group, undefined!, undefined!);
	const input = new AnimationEditorInput(model, model.resource.domain); group.model.add(input);
	t.after(() => { group.model.clear(); input.dispose(); editorTextModelService.clear(); });
	controller.refresh(input); controller.selectTrack(input, 2);
	assert.equal(input.keys.unit, undefined);
	model.pushEditOperations([{ offset: 0, deleteLength: 0, text: '-- shared edit\n' }]); controller.refresh(input);
	assert.equal(input.trackIndex, 1);
	assert.equal(input.keys.unit, undefined, 'a neighboring millisecond lane does not grant this lane an axis');
	assert.deepEqual(input.keys.positions, [null, null]);
});

test('animation recovery restores the native cursor after the document admits its axis', async t => {
	t.after(() => { editorTextModelService.clear(); });
	for (const unit of ['time_ms', 'frame', 'u'] as const) {
		const source = `return {tracks={{kind='event',keys={{${unit}=0,event='start'},{${unit}=1,event='end'}}}}}`;
		const sources = createScenarioTestSourceState([createScenarioTestSourceRecord(resource.path, 1, source)]);
		const model = editorTextModelService.retain(resolveRuntimeResource(sources, resource)!, 'lua', source);
		const controller = new AnimationEditorController(sources, undefined!, undefined!, undefined!);
		const input = new AnimationEditorInput(model, model.resource.domain);
		controller.refresh(input); controller.selectTrack(input, 1);
		input.keys.setView(0.2, 0.8); input.keys.setCursor(0.625); input.keys.snap = false;
		input.activeClient = 'keys'; input.columnSplit.ratio = 0.9; input.rowSplit.ratio = 0.1;
		const serializer = new AnimationInputSerializer(sources, controller);
		const restored = await serializer.deserialize(serializer.serialize(input));
		assert.equal(restored.keys.unit, unit);
		assert.equal(restored.keys.cursor, 0.625);
		assert.equal(restored.keys.range.minimum, 0.2); assert.equal(restored.keys.range.maximum, 0.8);
		assert.equal(restored.keys.snap, false);
		assert.equal(restored.activeClient, 'keys');
		assert.equal(restored.columnSplit.ratio, 0.9); assert.equal(restored.rowSplit.ratio, 0.1,
			'recovery consumes saved requested intent rather than applying current interactive sash limits');
		assert.equal(restored.workingCopy, model); assert.equal(model.undo(), null);
		restored.dispose(); input.dispose(); editorTextModelService.clear();
	}
});

test('versioned animation recovery persists project ownership and opaque source selections without legacy path inference', async t => {
	const source = "return {duration_ms=100,tracks={{kind='value',keys={{time_ms=0,value=1},{time_ms=100,value=2}}}}}";
	const sources = createScenarioTestSourceState([createScenarioTestSourceRecord(resource.path, 1, source)]);
	const model = editorTextModelService.retain(resolveRuntimeResource(sources, resource)!, 'lua', source);
	const controller = new AnimationEditorController(sources, undefined!, undefined!, undefined!);
	const input = new AnimationEditorInput(model, model.resource.domain);
	t.after(() => { input.dispose(); editorTextModelService.clear(); });
	controller.refresh(input); controller.selectTrack(input, 1); controller.selectKey(input, 1); controller.selectProperty(input, 0);
	input.tracks.scroll = 1; input.keys.setView(10, 90); input.keys.setCursor(50);
	input.activeClient = 'details'; input.columnSplit.resize(0.45); input.rowSplit.resize(0.4);
	const serializer = new AnimationInputSerializer(sources, controller);
	const current = JSON.parse(serializer.serialize(input));
	assert.equal(current.version, 2);
	assert.equal(current.projectDomain, resource.domain);
	for (const selection of [current.track, current.key, current.detail]) assert.equal(selection.path, resourceIdentityKey(resource));
	const restored = await serializer.deserialize(JSON.stringify(current)); t.after(() => restored.dispose());
	assert.equal(restored.projectDomain, resource.domain);
	assert.equal(restored.workingCopy, model); assert.equal(model.buffer.getText(), source); assert.equal(model.undo(), null);
	assert.deepEqual(restored.trackSelection, input.trackSelection); assert.deepEqual(restored.keySelection, input.keySelection);
	assert.deepEqual(restored.detailSelection, input.detailSelection); assert.equal(restored.tracks.scroll, input.tracks.scroll);
	assert.equal(restored.keys.range.minimum, 10); assert.equal(restored.keys.range.maximum, 90); assert.equal(restored.keys.cursor, 50);
	assert.equal(restored.activeClient, input.activeClient);
	assert.equal(restored.columnSplit.ratio, input.columnSplit.ratio); assert.equal(restored.rowSplit.ratio, input.rowSplit.ratio);
	const models = [...editorTextModelService.models];
	for (const version of [undefined, 1, 3]) {
		await assert.rejects(serializer.deserialize(JSON.stringify({ ...current, version,
			source: { ...current.source, resource: { ...current.source.resource, path: 'not-retained.lua' } } })),
			new RegExp(`Unsupported animation editor view version '${version}'`));
		assert.deepEqual([...editorTextModelService.models], models, 'unsupported formats are rejected before resolving or retaining a model');
	}
});

function animationPane(t: TestContext, variant: 'tiny' | 'msx', source = "return {duration_ms=100,tracks={{kind='value',interpolation='linear',keys={{time_ms=0,value=1},{time_ms=100,value=2}}},{kind='event',keys={{time_ms=25,event='other'}}}}}") {
	configureFontVariant(variant);
	editorViewState.viewportWidth = 384; editorViewState.viewportHeight = 288;
	const sources = createScenarioTestSourceState([createScenarioTestSourceRecord(resource.path, 1, source)]);
	const model = editorTextModelService.retain(resolveRuntimeResource(sources, resource)!, 'lua', source);
	const navigated: unknown[][] = [];
	const navigation = { focusChunkSource: (...args: unknown[]) => navigated.push(args) } as unknown as EditorNavigationController;
	const controller = new AnimationEditorController(sources, undefined!, navigation, undefined!);
	const input = new AnimationEditorInput(model, model.resource.domain), menu = new ContextMenuController(inputFocus, pointerCapture);
	const commands: EditorCommandRunner = { isEnabled: (command, target) => inputFocus.getCommand(command, target)?.isEnabled() === true,
		execute: (command, target) => inputFocus.executeCommand(command, target) };
	const measured = measureAnimationEditor(editorViewState.font);
	const surfaces = new WorkbenchSurfaceService(), bounds = { left: 0, top: 24,
		right: measured.expandedWidth + editorViewState.font.advance('M') * 10,
		bottom: 24 + measured.expandedHeight + measured.rowHeight * 3 };
	const root = { ...bounds, right: 384 };
	const owner = surfaces.attach({ role: 'content', captureScope: Symbol('animation pane'), isVisible: () => true,
		getBounds: () => bounds, getClip: () => bounds, draw() {} });
	const pane = new AnimationEditorPane(controller, commands as IdeCommandController, menu, surfaces, owner, root, inputFocus.workbenchScope);
	t.after(() => {
		menu.dispose(); pane.dispose(); input.dispose(); surfaces.dispose(); inputFocus.setTarget(null); pointerCapture.cancel(); pointerHover.clear();
		editorTextModelService.clear();
	});
	pane.setInput(input, bounds); pane.focus();
	const pointer = (x: number, y: number, secondary = true) => pane.handlePointer({ viewportX: x, viewportY: y, valid: true, insideViewport: true,
		pressedButtons: secondary ? PointerButton.Secondary : PointerButton.Primary,
		justPressedButtons: secondary ? PointerButton.Secondary : PointerButton.Primary, justReleasedButtons: 0, modifiers: KeyModifier.none, spaceDown: false }, !secondary, secondary, 0, false);
	return { pane, input, menu, model, controller, pointer, source, navigated, bounds, commands };
}

for (const variant of ['tiny', 'msx'] as const) test(`${variant} Animation context follows the secondary-hit property, track and key without primary gestures`, t => {
	const f = animationPane(t, variant), { pane, input, menu, controller } = f;
	controller.selectTrack(input, 1); controller.selectKey(input, 0); pane.update();
	const tree = input.details, index = tree.rows.findIndex(row => row.element.label === 'value'), property = tree.rows[index].element;
	controller.selectProperty(input, 0);
	const originalFocus = inputFocus.target;
	f.pointer(tree.layout.contentRight - 2, tree.layout.contentTop + (index + 0.5) * tree.layout.rowHeight);
	assert.equal(menu.visible, true);
	const details = menu.invocationOrigin!;
	assert.notEqual(details, originalFocus);
	assert.ok(details.getCommand('contextMenu'));
	assert.deepEqual(input.detailSelection!.range, luaSourceRangeToTextRange(f.model.buffer, property.source.file.chunk.locations.range(property.field.span)));
	assert.equal(menu.model.rows.find(row => row.command === 'animation.edit')!.enabled, true);
	assert.equal(menu.model.rows.find(row => row.command === 'animation.earlier')!.enabled, false);
	const range = property.source.file.chunk.locations.range(property.field.span);
	menu.model.selectedIndex = menu.model.rows.findIndex(row => row.command === 'animation.source'); menu.accept();
	assert.deepEqual(f.navigated, [[f.model.resource, { row: range.start.line - 1, startColumn: range.start.column - 1, endColumn: range.start.column - 1 }]]);
	assert.equal(inputFocus.target, details);
	pane.focus(); details.getCommand('contextMenu')!.run();
	assert.equal(menu.visible, true); assert.equal(menu.invocationOrigin, details); menu.hide();
	assert.equal(inputFocus.target, details);

	const list = input.tracks;
	f.pointer(list.layout.contentRight - 2, list.layout.contentTop + 2.5 * list.layout.rowHeight);
	assert.equal(menu.visible, true); assert.equal(input.trackIndex, 1); assert.equal(input.keyIndex, -1);
	const tracks = menu.invocationOrigin!; assert.notEqual(tracks, details); assert.ok(tracks.getCommand('contextMenu'));
	assert.equal(menu.model.rows.find(row => row.command === 'animation.earlier')!.enabled, true);
	assert.equal(menu.model.rows.find(row => row.command === 'animation.later')!.enabled, false);
	menu.hide(); assert.equal(inputFocus.target, tracks);
	tracks.getCommand('contextMenu')!.run(); assert.equal(menu.visible, true); assert.equal(menu.invocationOrigin, tracks); menu.hide();
	f.pointer(input.overview.bounds.right - 2, input.overview.bounds.bottom - 1);
	assert.equal(menu.visible, false, 'blank overview space has no row context');
	assert.equal(input.trackIndex, 1); assert.equal(input.keyIndex, -1);

	controller.selectTrack(input, 1); controller.selectKey(input, 0); pane.update();
	const keys = input.keys;
	f.pointer(keys.xAt(100), (keys.range.bounds.top + keys.range.bounds.bottom) / 2);
	assert.equal(menu.visible, true); assert.equal(input.keyIndex, 1); assert.equal(pointerCapture.active, false);
	const keyClient = menu.invocationOrigin!; assert.notEqual(keyClient, tracks); assert.ok(keyClient.getCommand('contextMenu'));
	menu.hide(); assert.equal(inputFocus.target, keyClient);
	pane.focus(); keyClient.getCommand('contextMenu')!.run();
	assert.equal(menu.visible, true); assert.equal(menu.invocationOrigin, keyClient);
	input.invalidateProjection(); assert.equal(menu.visible, false); assert.equal(inputFocus.target, keyClient);
	assert.equal(f.model.buffer.getText(), f.source); assert.equal(f.model.undo(), null);
});

test('secondary blank frame-lane space does not reuse the previously selected frame as a context target', t => {
	const f = animationPane(t, 'tiny', "return {frames={'first','second'}}");
	f.controller.selectTrack(f.input, 1); f.controller.selectProperty(f.input, 0); f.pane.update();
	f.input.keys.setView(0, 10);
	const list = f.input.tracks;
	f.pointer(f.input.keys.xAt(9), list.layout.contentTop + 1.5 * list.layout.rowHeight);
	assert.equal(f.menu.visible, false);
	assert.equal(f.model.buffer.getText(), f.source); assert.equal(f.model.undo(), null);
});

test('secondary context on the current clip lane replaces its former Details-property target with that clip occurrence', t => {
	const f = animationPane(t, 'tiny', 'return {subsequences={{start_time_ms=0,duration_ms=100,sequence={duration_ms=100,tracks={}}}}}');
	f.controller.selectTrack(f.input, 1); f.pane.update();
	const clip = f.input.document!.clips[0];
	const property = f.input.details.rows.findIndex(row => row.element.field === clip.duration!.field);
	assert.ok(property >= 0);
	f.controller.selectProperty(f.input, property);
	const list = f.input.tracks;
	f.pointer(f.input.keys.xAt(50), list.layout.contentTop + 1.5 * list.layout.rowHeight);
	assert.equal(f.menu.visible, true); assert.equal(f.input.clipIndex, 0);
	assert.equal(f.input.detailSelection, undefined); assert.equal(f.input.details.selectionIndex, -1);
	assert.equal(f.menu.model.rows.find(row => row.command === 'animation.edit')!.enabled, false);
	const range = clip.file.chunk.locations.range(clip.field.span);
	f.menu.model.selectedIndex = f.menu.model.rows.findIndex(row => row.command === 'animation.source'); f.menu.accept();
	assert.deepEqual(f.navigated, [[f.model.resource, { row: range.start.line - 1, startColumn: range.start.column - 1, endColumn: range.start.column - 1 }]]);
	assert.equal(f.model.buffer.getText(), f.source); assert.equal(f.model.undo(), null);
});

for (const variant of ['tiny', 'msx'] as const) test(`${variant} an actual property draft and focus survive compact, font and sash relayout without publication`, t => {
	const f = animationPane(t, variant), { input, controller, pane, model } = f;
	controller.selectTrack(input, 1); controller.selectKey(input, 0);
	const property = input.details.rows.findIndex(row => row.element.field === input.document!.tracks[0].keys[0].value!.field);
	controller.selectProperty(input, property); pane.update();
	f.commands.execute('animation.details', inputFocus.target!.commandContext);
	f.commands.execute('animation.edit', inputFocus.target!.commandContext);
	const field = inputFocus.target!, draft = field.edit!, text = field.textInput!;
	assert.ok(draft); assert.equal(text.replaceText(0, text.readText().text.length, '999'), true);
	const pending = text.readText(), trackSelection = input.trackSelection, keySelection = input.keySelection, detailSelection = input.detailSelection;
	for (const split of [input.columnSplit, input.rowSplit]) {
		const horizontal = split.orientation === 'horizontal';
		const x = horizontal ? split.position : split.bounds.right - 12;
		const y = horizontal ? split.bounds.top + 4 : split.position;
		f.pointer(x, y, false);
		assert.equal(pointerCapture.active, true);
		const moved = { viewportX: x + (horizontal ? 12 : 0), viewportY: y + (horizontal ? 0 : 12), valid: true, insideViewport: true,
			pressedButtons: PointerButton.Primary, justPressedButtons: 0, justReleasedButtons: 0 };
		pointerCapture.dispatch(moved, false, 0); pane.update();
		pointerCapture.dispatch({ ...moved, pressedButtons: 0, justReleasedButtons: PointerButton.Primary }, false, 0); pane.update();
		assert.equal(inputFocus.target, field); assert.equal(field.edit, draft); assert.deepEqual(text.readText(), pending);
		assert.equal(model.buffer.getText(), f.source); assert.equal(model.undo(), null);
	}
	for (const font of ['tiny', 'msx'] as const) {
		configureFontVariant(font);
		const measured = measureAnimationEditor(editorViewState.font);
		pane.layout({ ...f.bounds, right: measured.compactWidth, bottom: f.bounds.top + measured.compactHeight }); pane.update();
		assert.equal(input.layout.mode, 'compact'); assert.equal(input.layout.detailsVisible, true);
		assert.equal(input.layout.tracksVisible || input.layout.keysVisible, false);
		assert.equal(inputFocus.target, field); assert.equal(field.edit, draft); assert.equal(draft.pending, true);
		assert.deepEqual(text.readText(), pending);
		assert.equal(input.trackSelection, trackSelection); assert.equal(input.keySelection, keySelection); assert.equal(input.detailSelection, detailSelection);
		assert.equal(model.buffer.getText(), f.source); assert.equal(model.undo(), null);
		pane.layout({ ...f.bounds, right: measured.expandedWidth * 2, bottom: f.bounds.top + measured.expandedHeight * 2 }); pane.update();
		assert.equal(input.layout.mode, 'expanded'); assert.equal(inputFocus.target, field); assert.deepEqual(text.readText(), pending);
	}
	inputFocus.handleKeyboard(new KeyInputEvent('Escape', KeyModifier.none));
	assert.equal(model.buffer.getText(), f.source); assert.equal(model.undo(), null);
	assert.equal(input.activeClient, 'details'); assert.notEqual(inputFocus.target, field);
});

test('a key gesture retired by compact relayout or client navigation cannot edit on its later physical release', t => {
	const f = animationPane(t, 'tiny'), { input, controller, pane, model } = f;
	controller.selectTrack(input, 1); controller.selectKey(input, 0); pane.update();
	for (const retire of ['compact', 'client'] as const) {
		pane.layout(f.bounds); pane.update();
		f.commands.execute('animation.keys', inputFocus.target!.commandContext);
		const bounds = input.keys.range.bounds, x = input.keys.xAt(0), y = (bounds.top + bounds.bottom) / 2;
		f.pointer(x, y, false);
		assert.equal(pointerCapture.active, true);
		const moved = { viewportX: x + 20, viewportY: y, valid: true, insideViewport: true,
			pressedButtons: PointerButton.Primary, justPressedButtons: 0, justReleasedButtons: 0 };
		pointerCapture.dispatch(moved, false, 0); assert.notEqual(input.keys.dragValue, undefined);
		const measured = measureAnimationEditor(editorViewState.font);
		pane.layout({ ...f.bounds, right: measured.compactWidth });
		if (retire === 'client') f.commands.execute('animation.tracks', inputFocus.target!.commandContext);
		else pane.update();
		pointerCapture.dispatch({ ...moved, pressedButtons: 0, justReleasedButtons: PointerButton.Primary }, false, 0);
		assert.equal(pointerCapture.active, false); assert.equal(input.keys.dragValue, undefined);
		assert.equal(model.buffer.getText(), f.source); assert.equal(model.undo(), null);
		assert.equal(input.layout.keysVisible, retire === 'compact');
		if (retire === 'client') {
			const track = input.trackSelection, key = input.keySelection;
			f.pointer(moved.viewportX, moved.viewportY);
			assert.equal(f.menu.visible, false); assert.equal(input.trackSelection, track); assert.equal(input.keySelection, key);
		}
	}
});

test('source-only tracks do not expose an unfocusable compact Keys client', t => {
	const f = animationPane(t, 'tiny', "return {tracks={{kind='event',keys={{time_ms=1,event='first'},{frame=2,event='second'}}}}}");
	f.controller.selectTrack(f.input, 1); f.pane.update();
	const context = inputFocus.target!.commandContext, focus = inputFocus.target;
	assert.equal(f.input.keys.unit, undefined);
	assert.equal(f.input.layout.mode, 'compact', 'a source-only definition never reserves an empty numeric workspace');
	assert.equal(f.input.layout.keysVisible || f.input.layout.detailsVisible, false);
	assert.equal(f.commands.isEnabled('animation.keys', context), false);
	f.commands.execute('animation.keys', context);
	assert.equal(f.input.activeClient, 'tracks'); assert.equal(inputFocus.target, focus);
	f.commands.execute('animation.details', context);
	assert.equal(f.input.layout.detailsVisible, true); assert.equal(f.input.layout.tracksVisible || f.input.layout.keysVisible, false);
	assert.equal(f.model.buffer.getText(), f.source); assert.equal(f.model.undo(), null);
});

test('unchanged animation frames reuse measured text and only visible clients participate in compact focus order', t => {
	const f = animationPane(t, 'tiny'), { input, pane } = f;
	f.controller.selectTrack(input, 1); f.controller.selectKey(input, 0); pane.update();
	const measured = measureAnimationEditor(editorViewState.font);
	pane.layout({ ...f.bounds, right: measured.compactWidth }); pane.update();
	for (const client of ['tracks', 'keys', 'details'] as const) {
		f.commands.execute(`animation.${client}`, inputFocus.target!.commandContext);
		const body = inputFocus.target;
		inputFocus.moveFocus(false); assert.equal(input.actionBar.hasFocus, true);
		inputFocus.moveFocus(false); assert.equal(input.clientBar.hasFocus, true);
		inputFocus.moveFocus(false); assert.equal(inputFocus.target, body);
	}
	const font = editorViewState.font, advance = font.advance.bind(font);
	let measurements = 0;
	t.mock.method(font, 'advance', character => { measurements++; return advance(character); });
	for (let frame = 0; frame < 100; frame++) pane.update();
	assert.equal(measurements, 0, 'idle layout, client switching and repeated text projection must not be polled work');
	assert.equal(f.model.buffer.getText(), f.source); assert.equal(f.model.undo(), null);
});

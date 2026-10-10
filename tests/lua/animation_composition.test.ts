import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildLuaFileSemanticData } from '../../toolchain/ts/lua/semantic/model';
import { semanticSnapshot } from './semantic_test_harness';
import { buildAnimationSourceDocument } from '../../ide/workbench/contrib/animation/source';
import { animationDefinitionFamily, collectAnimationDefinitions } from '../../ide/workbench/contrib/animation/definitions';
import { AnimationEditorInput } from '../../ide/workbench/contrib/animation/editor_input';
import { AnimationAuthoring } from '../../ide/workbench/contrib/animation/authoring';
import { AnimationEditorController } from '../../ide/workbench/contrib/animation/controller';
import { AnimationLaneControl } from '../../ide/workbench/contrib/animation/lane_control';
import { AnimationInputSerializer } from '../../ide/workbench/contrib/animation/editor_serializer';
import { EditorTextModel } from '../../ide/editor/model/text_model';
import { editorTextModelService } from '../../ide/editor/model/model_service';
import { editorTabGroup } from '../../ide/workbench/ui/tab/group_model';
import { getOrCreateSemanticProject } from '../../ide/editor/contrib/intellisense/semantic/workspace/state';
import { resolveRuntimeResource } from '../../ide/runtime/sources';
import { luaSourceRangeToTextRange } from '../../ide/language/lua/source_edits';
import { createScenarioTestSourceRecord, createScenarioTestSourceState } from '../helpers/scenario_sources';
import { RunResult } from '../../machine/ts/machine/cpu/cpu';
import { createCartlibProgramHarness } from '../helpers/cartlib_cpu';
import { ANIMATION_TRACK_TEMPLATES } from '../../ide/workbench/contrib/animation/track_templates';
import { inputFocus } from '../../ide/input/focus';
import { PointerButton } from '../../ide/input/pointer/buttons';

const resource = { domain: 0 as const, path: 'parent.lua', source: { resid: 'parent.lua', type: 'lua' as const } };
const child = "return {duration_ms=100, tracks={{kind='value',interpolation='linear',path={'x'},keys={{time_ms=0,value=0},{time_ms=100,value=100}}}}}";

test('overview key picking does not clear the active occurrence before resolving a hit', t => {
	const source = "return {duration_ms=100,tracks={{kind='value',interpolation='linear',keys={{time_ms=50,value=0},{time_ms=50,value=0}}},{kind='event',keys={{time_ms=25,event='other'}}}}}";
	const sources = createScenarioTestSourceState([createScenarioTestSourceRecord(resource.path, 1, source)]);
	const model = editorTextModelService.retain(resolveRuntimeResource(sources, resource)!, 'lua', source);
	const controller = new AnimationEditorController(sources, undefined!, undefined!, undefined!);
	const input = new AnimationEditorInput(model);
	input.tracks.layout.contentTop = 0; input.tracks.layout.rowHeight = 20; input.tracks.layout.visibleRowCount = 3;
	controller.refresh(input); controller.selectTrack(input, 1); controller.selectKey(input, 1);
	input.overview.layout(0, 0, 106, 60); input.keys.range.layout(0, 0, 106, 20);
	const focus = inputFocus.createTarget(); focus.bindKeyboard(() => {});
	const control = new AnimationLaneControl(focus, controller); control.setInput(input);
	t.after(() => { control.dispose(); input.dispose(); editorTextModelService.clear(); inputFocus.setTarget(null); });
	const pointer = { viewportX: input.keys.xAt(50), viewportY: 30, valid: true, insideViewport: true,
		pressedButtons: PointerButton.Primary, justPressedButtons: PointerButton.Primary, justReleasedButtons: 0 };
	control.handlePointer(pointer);
	assert.equal(input.keys.selected, 1); assert.equal(input.keyIndex, 1);
	control.handlePointer({ ...pointer, viewportX: input.keys.xAt(25), viewportY: 50 });
	assert.equal(input.trackIndex, 1); assert.equal(input.keys.selected, 0);
	assert.equal(model.buffer.getText(), source); assert.equal(model.undo(), null);
});

test('clip trim edits the written parent once, preserves child time and imported ownership at O0/O3', () => {
	const source = "-- untouched\nreturn {duration_ms=100,subsequences={{duration_ms=100,sequence=require('child')}}}\n";
	const model = new EditorTextModel(resource, 'lua', source), input = new AnimationEditorInput(model);
	input.document = buildAnimationSourceDocument(resource, semanticSnapshot(buildLuaFileSemanticData(source, resource.path), buildLuaFileSemanticData(child, 'child.lua')))!;
	const authoring = new AnimationAuthoring({ modelFor: () => model, refresh() {}, selectKey() {}, selectTrack() {}, selectProperty() {} }, undefined!, undefined!);
	const clip = input.document.clips[0];
	assert.equal(clip.sequence!.file.file, 'child.lua');
	assert.equal(authoring.canEditClip(input, clip, 'start'), true);
	authoring.editClip(input, clip, 'start', 25, 75);
	const changed = buildAnimationSourceDocument(resource, semanticSnapshot(buildLuaFileSemanticData(model.buffer.getText(), resource.path), buildLuaFileSemanticData(child, 'child.lua')))!;
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
		const source = cases[index], model = new EditorTextModel(resource, 'lua', source), input = new AnimationEditorInput(model);
		input.document = buildAnimationSourceDocument(resource, semanticSnapshot(buildLuaFileSemanticData(source, resource.path)))!;
		const authoring = new AnimationAuthoring({ modelFor: () => model, refresh() {}, selectKey() {}, selectTrack() {}, selectProperty() {} }, undefined!, undefined!);
		if (index === 0) authoring.editCurveKey(input, input.document.tracks[0].keys[0], 1200, 'value', 2000);
		else authoring.editClip(input, input.document.clips[0], 'start', 25, 75);
		const file = buildLuaFileSemanticData(model.buffer.getText(), resource.path);
		assert.equal(file.syntaxError, null, 'an edit may not depend on native fields being written in a particular order');
		const document = buildAnimationSourceDocument(resource, semanticSnapshot(file))!;
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
		const model = new EditorTextModel(resource, 'lua', source), input = new AnimationEditorInput(model);
		t.after(() => { input.dispose(); model.dispose(); });
		input.document = buildAnimationSourceDocument(resource, semanticSnapshot(buildLuaFileSemanticData(source, resource.path), buildLuaFileSemanticData(child, 'child.lua')))!;
		const authoring = new AnimationAuthoring({ modelFor: () => model, refresh() {}, selectKey() {}, selectTrack() {}, selectProperty() {} }, undefined!, undefined!);
		let changes = 0; model.onDidChangeContent(() => changes++);
		authoring.editClip(input, input.document.clips[0], 'start', 25, 75);
		const changed = model.buffer.getText(), file = buildLuaFileSemanticData(changed, resource.path);
		assert.equal(file.syntaxError, null);
		const document = buildAnimationSourceDocument(resource, semanticSnapshot(file, buildLuaFileSemanticData(child, 'child.lua')))!;
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
	const file = buildLuaFileSemanticData(source, resource.path), snapshot = semanticSnapshot(file);
	const definitions = collectAnimationDefinitions(resource, snapshot);
	assert.equal(definitions.length, 2);
	for (const definition of definitions) {
		const document = buildAnimationSourceDocument(resource, snapshot, definition.table)!;
		const family = animationDefinitionFamily(document.reader, file, document.root);
		assert.equal(family, 'sprite');
		assert.equal(document.framesSource!.array, true);
		const model = new EditorTextModel(resource, 'lua', source), input = new AnimationEditorInput(model);
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
	const document = buildAnimationSourceDocument(resource, semanticSnapshot(buildLuaFileSemanticData(source, resource.path)))!;
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
	const sources = createScenarioTestSourceState([createScenarioTestSourceRecord(resource.path, 1, config), createScenarioTestSourceRecord('caller.lua', 1, caller)]);
	const model = editorTextModelService.retain(resolveRuntimeResource(sources, resource)!, 'lua', config);
	const controller = new AnimationEditorController(sources, undefined!, undefined!, undefined!);
	const project = getOrCreateSemanticProject(editorTextModelService, 0); project.synchronizeRuntimeSources(sources);
	const snapshot = project.getSnapshot(), factory = collectAnimationDefinitions({ domain: 0, path: 'caller.lua' }, snapshot)[0];
	assert.equal(factory.file.file, resource.path);
	assert.equal(collectAnimationDefinitions(resource, snapshot)[0].consumer, undefined);
	assert.equal(factory.consumer!.file, 'caller.lua', 'raw exports cannot swallow consumer-specific provenance');
	const input = new AnimationEditorInput(model, luaSourceRangeToTextRange(model.buffer, factory.file.chunk.locations.range(factory.table.span)), 'sprite', factory.consumer!.file);
	const consumer = controller.modelFor(input, factory.consumer!);
	editorTabGroup.add(input);
	const unbind = editorTextModelService.onDidChangeContent((model, event) => controller.onDidChangeContent(model, event));
	t.after(() => { unbind(); editorTabGroup.clear(); input.dispose(); editorTextModelService.clear(); });
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
	assert.equal(restored.consumerPath, 'caller.lua');
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

test('a selected mixed-coordinate lane remains Source after a shared working-copy revision', t => {
	const source = "return {tracks={{kind='event',keys={{time_ms=0,event='first'}}},{kind='event',keys={{frame=1,event='second'},{u=1,event='third'}}}}}";
	const sources = createScenarioTestSourceState([createScenarioTestSourceRecord(resource.path, 1, source)]);
	const model = editorTextModelService.retain(resolveRuntimeResource(sources, resource)!, 'lua', source);
	const controller = new AnimationEditorController(sources, undefined!, undefined!, undefined!);
	const input = new AnimationEditorInput(model); editorTabGroup.add(input);
	const unbind = editorTextModelService.onDidChangeContent((model, event) => controller.onDidChangeContent(model, event));
	t.after(() => { unbind(); editorTabGroup.clear(); input.dispose(); editorTextModelService.clear(); });
	controller.refresh(input); controller.selectTrack(input, 2);
	assert.equal(input.keys.unit, undefined);
	model.pushEditOperations([{ offset: 0, deleteLength: 0, text: '-- shared edit\n' }]); controller.refresh(input);
	assert.equal(input.trackIndex, 1);
	assert.equal(input.keys.unit, undefined, 'a neighboring millisecond lane does not grant this lane an axis');
	assert.deepEqual(input.keys.positions, [null, null]);
});

test('animation recovery restores the native cursor after the document admits its axis', async t => {
	t.after(() => { editorTabGroup.clear(); editorTextModelService.clear(); });
	for (const unit of ['time_ms', 'frame', 'u'] as const) {
		const source = `return {tracks={{kind='event',keys={{${unit}=0,event='start'},{${unit}=1,event='end'}}}}}`;
		const sources = createScenarioTestSourceState([createScenarioTestSourceRecord(resource.path, 1, source)]);
		const model = editorTextModelService.retain(resolveRuntimeResource(sources, resource)!, 'lua', source);
		const controller = new AnimationEditorController(sources, undefined!, undefined!, undefined!);
		const input = new AnimationEditorInput(model);
		controller.refresh(input); controller.selectTrack(input, 1);
		input.keys.setView(0.2, 0.8); input.keys.setCursor(0.625); input.keys.snap = false;
		const serializer = new AnimationInputSerializer(sources, controller);
		const restored = await serializer.deserialize(serializer.serialize(input));
		assert.equal(restored.keys.unit, unit);
		assert.equal(restored.keys.cursor, 0.625);
		assert.equal(restored.keys.range.minimum, 0.2); assert.equal(restored.keys.range.maximum, 0.8);
		assert.equal(restored.keys.snap, false);
		assert.equal(restored.workingCopy, model); assert.equal(model.undo(), null);
		restored.dispose(); input.dispose(); editorTextModelService.clear();
	}
});

import { TEST_CARTRIDGE_CONTEXT_IDS } from '../helpers/runtime_sources';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildLuaSemanticWorkspaceSnapshot } from '../../toolchain/ts/lua/semantic/model';
import { buildResourceLuaSemanticFixtureFile, createResourceModuleProjectFixture } from '../helpers/lua_semantic_project';
import { buildAnimationSourceDocument } from '../../ide/workbench/contrib/animation/source';
import { AnimationKeyViewport } from '../../ide/workbench/contrib/animation/key_viewport';
import { AnimationEditorInput } from '../../ide/workbench/contrib/animation/editor_input';
import { AnimationAuthoring } from '../../ide/workbench/contrib/animation/authoring';
import { EditorTextModel } from '../../ide/editor/model/text_model';
import { RunResult } from '../../machine/ts/machine/cpu/cpu';
import { createCartlibProgramHarness } from '../helpers/cartlib_cpu';

const resource = { contextLabel: 'Fixture project', sourceFilePath: 'animation.lua', location: { kind: 'workspace' as const, path: 'animation.lua' }, contextId: TEST_CARTRIDGE_CONTEXT_IDS[0], path: 'animation.lua', source: { resid: 'animation.lua', type: 'lua' as const } };
const source = `return { duration_ms=100, tracks={
	{kind='value', interpolation='cubic', path={'x'}, keys={
		{time_ms=0,value=0,arrive_tangent=0,leave_tangent=2},
		{time_ms=100,value=100,arrive_tangent=0,leave_tangent=0}}},
	{kind='value',interpolation='linear',path={'y'},keys={{time_ms=200,value=1}}}}}`;

test('written cubic geometry agrees with the native Hermite slopes at O0 and O3', () => {
	const document = buildAnimationSourceDocument(resource, buildLuaSemanticWorkspaceSnapshot(...createResourceModuleProjectFixture([buildResourceLuaSemanticFixtureFile(source, resource)], [])))!;
	const view = new AnimationKeyViewport(); view.bind(document.tracks[0], 0, document);
	view.range.layout(0, 0, 806, 20); view.curve.layout(0, 30, 806, 230); view.curve.update(view);
	assert.equal(view.extentMaximum, 200, 'same-unit lanes share the written extent');
	// x=25 is an actual retained sample: width 800, first span 100, 100 samples.
	const point = view.curve.paths[0].indexOf(view.xAt(25));
	assert.notEqual(point, -1);
	assert.equal(view.curve.paths[0][point + 1], view.curve.yAt(43.75));
	for (const optLevel of [0, 3] as const) {
		const { cpu } = createCartlibProgramHarness(`
			local component=require('cartlib/timeline/timeline_component')
			local owner={x=-1,y=-1}
			local timelines=component.new({owner=owner})
			timelines:define('curve',require('animation')); timelines:play('curve')
			timelines:seek_time('curve',25); assert(owner.x==43.75)
		`, { optLevel, modules: [{ path: 'animation', source }] });
		assert.equal(cpu.runUntilDepth(0, 20_000_000), RunResult.Halted);
	}
});

test('a step channel has no authored value before its first key, as in the native runtime', () => {
	const source = "return {duration_ms=100,tracks={{kind='value',interpolation='step',path={'x'},keys={{time_ms=50,value=10},{time_ms=100,value=20}}}}}";
	for (const optLevel of [0, 3] as const) {
		const { cpu } = createCartlibProgramHarness(`
			local component=require('cartlib/timeline/timeline_component'); local owner={x=17}
			local timeline=component.new({owner=owner}); timeline:define('step',require('animation')); timeline:play('step')
			timeline:seek_time('step',25); assert(owner.x==17)
			timeline:seek_time('step',75); assert(owner.x==10)
		`, { optLevel, modules: [{ path: 'animation', source }] });
		assert.equal(cpu.runUntilDepth(0, 20_000_000), RunResult.Halted);
	}
	const document = buildAnimationSourceDocument(resource, buildLuaSemanticWorkspaceSnapshot(...createResourceModuleProjectFixture([buildResourceLuaSemanticFixtureFile(source, resource)], [])))!;
	const view = new AnimationKeyViewport(); view.bind(document.tracks[0], -1, document);
	view.range.layout(0, 0, 806, 20); view.curve.layout(0, 30, 806, 230);
	view.setView(0, 25); view.curve.update(view);
	assert.equal(view.curve.pathCount, 0, 'there is no first-value clamp for a native step channel');
	view.setView(60, 90); view.curve.update(view);
	assert.deepEqual(view.curve.paths[0], [view.xAt(60), view.curve.yAt(10), view.xAt(90), view.curve.yAt(10)]);
});

test('curve previews and view navigation do not mutate written keys or invent normalized tangents', () => {
	const document = buildAnimationSourceDocument(resource, buildLuaSemanticWorkspaceSnapshot(...createResourceModuleProjectFixture([buildResourceLuaSemanticFixtureFile(source, resource)], [])))!;
	const view = new AnimationKeyViewport(); view.bind(document.tracks[0], 0, document); view.range.layout(0, 0, 206, 20);
	view.curve.preview('leave', 3); view.preview(10);
	assert.equal(view.curve.fieldValue(view, 0, 'leave'), 3);
	assert.equal(document.tracks[0].keys[0].leave!.value, 2);
	assert.equal(document.tracks[0].keys[0].coordinate!.value, 0);
	view.cancel(); assert.equal(view.curve.fieldValue(view, 0, 'leave'), 2);
	const anchor = view.valueAt(103); view.zoom(103, 0.5); assert.equal(view.valueAt(103), anchor);
	view.fit(); assert.equal(view.range.maximum, 200);
	view.setView(300, 400); view.curve.update(view);
	assert.deepEqual(view.curve.paths[0], [view.xAt(300), view.curve.yAt(100), view.xAt(400), view.curve.yAt(100)], 'the native last-value clamp remains visible beyond the written keys');
	view.setView(-100, -1); view.curve.update(view);
	assert.deepEqual(view.curve.paths[0], [view.xAt(-100), view.curve.yAt(0), view.xAt(-1), view.curve.yAt(0)]);
	view.fit();
	view.bind(document.tracks[1], 0, document); assert.equal(view.range.maximum, 200);
	const dynamic = buildAnimationSourceDocument(resource, buildLuaSemanticWorkspaceSnapshot(...createResourceModuleProjectFixture([buildResourceLuaSemanticFixtureFile("return {tracks={{kind='value',interpolation='cubic',keys={{u=0,value=0,arrive_tangent=0,leave_tangent=0}}}}}", resource)], [])))!;
	view.bind(dynamic.tracks[0], 0, dynamic); assert.equal(view.curve.available, false);
});

test('native steep slopes have bounded screen handles without changing their authored magnitude', () => {
	const source = "return {duration_ms=1000,tracks={{kind='value',interpolation='cubic',keys={{time_ms=500,value=0,arrive_tangent=0,leave_tangent=12},{time_ms=501,value=1,arrive_tangent=0,leave_tangent=0}}}}}";
	const document = buildAnimationSourceDocument(resource, buildLuaSemanticWorkspaceSnapshot(...createResourceModuleProjectFixture([buildResourceLuaSemanticFixtureFile(source, resource)], [])))!;
	const view = new AnimationKeyViewport(); view.bind(document.tracks[0], 0, document);
	view.range.layout(0, 0, 806, 20); view.curve.layout(0, 30, 806, 230); view.curve.update(view);
	const handle = view.curve.leaveHandle;
	assert.ok(handle[3] > view.curve.bounds.top && handle[3] < view.curve.bounds.bottom, 'the selected slope must have a reachable hit target');
	assert.ok(Math.hypot(handle[2] - handle[0], handle[3] - handle[1]) <= 32.0000000001);
	assert.equal(view.curve.handleAt(handle[2], handle[3]), 'leave');
	assert.equal(document.tracks[0].keys[0].leave!.value, 12);
	assert.equal(view.curve.arriveHandle.length, 0, 'the first key has no incoming native segment');
	view.select(1); view.curve.update(view);
	assert.equal(view.curve.leaveHandle.length, 0, 'the final key has no outgoing native segment');
});

test('cubic display requires the slopes used by native segments, not unused endpoint fields', () => {
	for (const [source, value] of [
		["return {tracks={{kind='value',interpolation='cubic',path={'x'},keys={{time_ms=0,value=0,leave_tangent=2},{time_ms=100,value=100,arrive_tangent=0}}}}}", 43.75],
		["return {tracks={{kind='value',interpolation='cubic',path={'x'},keys={{time_ms=100,value=100,arrive_tangent=0},{time_ms=0,value=0,leave_tangent=2}}}}}", 43.75],
		["return {tracks={{kind='value',interpolation='cubic',path={'x'},keys={{time_ms=50,value=7}}}}}", 7],
	] as const) {
		const document = buildAnimationSourceDocument(resource, buildLuaSemanticWorkspaceSnapshot(...createResourceModuleProjectFixture([buildResourceLuaSemanticFixtureFile(source, resource)], [])))!;
		const view = new AnimationKeyViewport(); view.bind(document.tracks[0], 0, document);
		assert.equal(view.curve.available, true);
		view.range.layout(0, 0, 806, 20); view.curve.layout(0, 30, 806, 230); view.curve.update(view);
		for (const optLevel of [0, 3] as const) {
			const { cpu } = createCartlibProgramHarness(`local component=require('cartlib/timeline/timeline_component'); local owner={x=-1}
				local timelines=component.new({owner=owner}); timelines:define('curve',require('animation')); timelines:play('curve')
				timelines:seek_time('curve',25); assert(owner.x==${value})
			`, { optLevel, modules: [{ path: 'animation', source }] });
			assert.equal(cpu.runUntilDepth(0, 20_000_000), RunResult.Halted);
		}
	}
	const missing = buildAnimationSourceDocument(resource, buildLuaSemanticWorkspaceSnapshot(...createResourceModuleProjectFixture([buildResourceLuaSemanticFixtureFile("return {tracks={{kind='value',interpolation='cubic',keys={{time_ms=0,value=0},{time_ms=1,value=1}}}}}", resource)], [])))!;
	const view = new AnimationKeyViewport(); view.bind(missing.tracks[0], 0, missing);
	assert.equal(view.curve.available, true, 'known values remain editable without a supplied slope');
	view.range.layout(0, 0, 806, 20); view.curve.layout(0, 30, 806, 230); view.curve.update(view);
	assert.equal(view.curve.pathCount, 0); assert.equal(view.curve.markers.length, 6);
});

test('moving an endpoint past its neighbor does not consume an unwritten slope during preview', () => {
	const source = "return {tracks={{kind='value',interpolation='cubic',path={'x'},keys={{time_ms=0,value=0,leave_tangent=2},{time_ms=100,value=100,arrive_tangent=0}}}}}";
	const document = buildAnimationSourceDocument(resource, buildLuaSemanticWorkspaceSnapshot(...createResourceModuleProjectFixture([buildResourceLuaSemanticFixtureFile(source, resource)], [])))!;
	for (const [index, moved] of [[0, 150], [1, -50]] as const) {
		const view = new AnimationKeyViewport(); view.bind(document.tracks[0], index, document);
		view.range.layout(0, 0, 806, 20); view.curve.layout(0, 30, 806, 230); view.setView(-100, 200); view.curve.update(view);
		assert.equal(view.curve.available, true);
		view.preview(moved); view.update(); view.curve.update(view);
		assert.equal(view.curve.available, true, 'a reordered unresolved segment does not remove its keys');
		assert.equal(view.curve.markers.length, 6);
		assert.equal(view.curve.pathCount, 2);
		const neighbor = document.tracks[0].keys[1 - index].coordinate!.value!;
		for (let run = 0; run < view.curve.pathCount; run++) {
			const path = view.curve.paths[run];
			assert.ok(path[path.length - 2] <= view.xAt(Math.min(moved, neighbor)) || path[0] >= view.xAt(Math.max(moved, neighbor)), 'no drawn run crosses the unresolved segment');
		}
		assert.equal(view.pixels.length, 4, 'the visible native key strip remains navigable');
		view.cancel(); view.curve.update(view);
		assert.equal(view.curve.available, true);
		assert.ok(view.curve.paths[0].length > 0);
		assert.equal(document.tracks[0].keys[index].coordinate!.value, index === 0 ? 0 : 100);
	}
});

test('curve fit includes the analytical Hermite and quadratic extrema', () => {
	for (const [arrive, maximum] of [[0, 32 / 27], [-8, 2]]) {
		const source = `return {tracks={{kind='value',interpolation='cubic',keys={{time_ms=0,value=0,arrive_tangent=0,leave_tangent=8},{time_ms=1,value=0,arrive_tangent=${arrive},leave_tangent=0}}}}}`;
		const document = buildAnimationSourceDocument(resource, buildLuaSemanticWorkspaceSnapshot(...createResourceModuleProjectFixture([buildResourceLuaSemanticFixtureFile(source, resource)], [])))!;
		const view = new AnimationKeyViewport(); view.bind(document.tracks[0], -1, document);
		assert.ok(Math.abs(view.curve.minimum + maximum * 0.2) < 1e-12);
		assert.ok(Math.abs(view.curve.maximum - maximum * 1.2) < 1e-12);
	}
});

test('known scalar keys and segments remain editable around unresolved source fields', () => {
	for (const interpolation of ['linear', 'cubic', 'step'] as const) {
		const keys = interpolation === 'cubic'
			? '{time_ms=0,value=0,arrive_tangent=0,leave_tangent=1},{time_ms=100,value=100,arrive_tangent=1,leave_tangent=0},{time_ms=200,value=25,arrive_tangent=unknown,leave_tangent=0},{time_ms=300,value=75,arrive_tangent=0}'
			: '{time_ms=0,value=0},{time_ms=100,value=100},{time_ms=200,value=unknown},{time_ms=300,value=75},{time_ms=400,value=80}';
		const source = `return {tracks={{kind='value',interpolation='${interpolation}',keys={${keys}}}}}`;
		const document = buildAnimationSourceDocument(resource, buildLuaSemanticWorkspaceSnapshot(...createResourceModuleProjectFixture([buildResourceLuaSemanticFixtureFile(source, resource)], [])))!;
		const view = new AnimationKeyViewport(); view.bind(document.tracks[0], 1, document);
		assert.equal(view.curve.available, true, 'one unresolved field does not remove the scalar editor');
		view.range.layout(0, 0, 806, 20); view.curve.layout(0, 30, 806, 230); view.curve.update(view);
		assert.equal(view.curve.pathCount, 2);
		assert.equal(view.curve.markers.length, 12);
		const first = view.curve.paths[0], second = view.curve.paths[1];
		assert.equal(first[first.length - 2], view.xAt(interpolation === 'step' ? 200 : 100));
		assert.equal(second[0], view.xAt(interpolation === 'cubic' ? 200 : 300));
		assert.equal(view.curve.keyAt(view, view.xAt(100), view.curve.yAt(100)), 1);
		if (interpolation === 'cubic') {
			assert.ok(view.curve.leaveHandle.length > 0, 'a written slope remains editable even when its neighbor slope is unresolved');
			view.select(2); view.setView(-100, 400); Object.freeze(view.curve.paths);
			for (let iteration = 0; iteration < 40; iteration++) {
				view.preview(-50); view.curve.update(view);
				assert.equal(view.curve.pathCount, 1, 'the unresolved arrive field is unused after this key becomes the first');
				view.cancel(); view.curve.update(view);
				assert.equal(view.curve.pathCount, 2);
			}
			assert.equal(view.curve.paths[0], first); assert.equal(view.curve.paths[1], second);
			assert.equal(document.tracks[0].keys[2].arrive!.value, null, 'the editor does not replace the unresolved expression');
		}
	}
});

test('unresolved key positions do not acquire inferred segment neighbors or endpoint clamps', () => {
	const source = "return {tracks={{kind='value',interpolation='linear',keys={{time_ms=0,value=0},{time_ms=unknown,value=50},{time_ms=100,value=100}}}}}";
	const document = buildAnimationSourceDocument(resource, buildLuaSemanticWorkspaceSnapshot(...createResourceModuleProjectFixture([buildResourceLuaSemanticFixtureFile(source, resource)], [])))!;
	const view = new AnimationKeyViewport(); view.bind(document.tracks[0], 0, document);
	view.range.layout(0, 0, 806, 20); view.curve.layout(0, 30, 806, 230); view.setView(-50, 150);
	view.curve.update(view);
	assert.equal(view.curve.available, true);
	assert.equal(view.curve.markers.length, 6);
	assert.equal(view.curve.pathCount, 0, 'an unknown key time prevents inferring chronological adjacency');
	assert.equal(view.curve.keyAt(view, view.xAt(100), view.curve.yAt(100)), 2);
});

test('source bounds are retained across selection and recalculated for a new source generation', () => {
	const document = buildAnimationSourceDocument(resource, buildLuaSemanticWorkspaceSnapshot(...createResourceModuleProjectFixture([buildResourceLuaSemanticFixtureFile(source, resource)], [])))!;
	const track = document.tracks[0], firstValue = track.keys[0].value!, value = firstValue.value;
	let reads = 0;
	Object.defineProperty(firstValue, 'value', { get() { reads++; return value; } });
	const view = new AnimationKeyViewport(); view.bind(track, 0, document);
	assert.ok(reads > 0);
	reads = 0;
	view.bind(track, 1, document);
	assert.equal(reads, 0, 'changing selection must not refit the same authored curve');
	const previousMaximum = view.curve.maximum;
	const changed = buildAnimationSourceDocument(resource, buildLuaSemanticWorkspaceSnapshot(...createResourceModuleProjectFixture([buildResourceLuaSemanticFixtureFile(source.replace('value=100', 'value=200'), resource)], [])))!;
	view.bind(changed.tracks[0], 1, changed);
	assert.ok(view.curve.maximum > previousMaximum);
});

test('negative authored values and slopes survive graphical editing and source reprojection', () => {
	const source = `local first = -25; local slope = -8
return {tracks={{kind='value',interpolation='cubic',keys={
	{time_ms=first,value=-2,arrive_tangent=slope,leave_tangent=-4},
	{time_ms=1,value=0,arrive_tangent=-8,leave_tangent=0}}}}}`;
	const model = new EditorTextModel(resource, 'lua', source), input = new AnimationEditorInput(model, model.resource.contextId);
	input.document = buildAnimationSourceDocument(resource, buildLuaSemanticWorkspaceSnapshot(...createResourceModuleProjectFixture([buildResourceLuaSemanticFixtureFile(source, resource)], [])))!;
	const key = input.document.tracks[0].keys[0];
	assert.equal(key.coordinate!.value, -25);
	assert.equal(key.arrive!.value, -8);
	const authoring = new AnimationAuthoring({ modelFor: () => model, refresh() {}, selectKey() {}, selectTrack() {}, selectProperty() {} }, undefined!);
	assert.equal(authoring.canEditCurveField(input, key, 'arrive'), false, 'an alias is readable, not a literal field to overwrite');
	assert.equal(authoring.canEditCurveField(input, key, 'value'), true);
	authoring.editCurveKey(input, key, undefined, 'value', -3);
	const changed = buildAnimationSourceDocument(resource, buildLuaSemanticWorkspaceSnapshot(...createResourceModuleProjectFixture([buildResourceLuaSemanticFixtureFile(model.buffer.getText(), resource)], [])))!;
	assert.equal(changed.tracks[0].keys[0].value!.value, -3);
	input.keys.bind(changed.tracks[0], 0, changed);
	assert.equal(input.keys.curve.available, true);
	model.undo(); assert.equal(model.buffer.getText(), source);
	input.dispose(); model.dispose();
});

test('the curve commits time and value as one native source edit and idle geometry does no projection work', () => {
	const model = new EditorTextModel(resource, 'lua', source), input = new AnimationEditorInput(model, model.resource.contextId);
	input.document = buildAnimationSourceDocument(resource, buildLuaSemanticWorkspaceSnapshot(...createResourceModuleProjectFixture([buildResourceLuaSemanticFixtureFile(source, resource)], [])))!;
	const authoring = new AnimationAuthoring({ modelFor: () => model, refresh() {}, selectKey() {}, selectTrack() {}, selectProperty() {} }, undefined!);
	authoring.editCurveKey(input, input.document.tracks[0].keys[1], 120, 'value', 200);
	const changed = buildAnimationSourceDocument(resource, buildLuaSemanticWorkspaceSnapshot(...createResourceModuleProjectFixture([buildResourceLuaSemanticFixtureFile(model.buffer.getText(), resource)], [])))!;
	assert.equal(changed.tracks[0].keys[1].coordinate!.value, 120);
	assert.equal(changed.tracks[0].keys[1].value!.value, 200);
	input.keys.bind(changed.tracks[0], 1, changed);
	input.keys.range.layout(0, 0, 806, 20); input.keys.curve.layout(0, 30, 806, 230);
	input.keys.update(); input.keys.curve.update(input.keys);
	Object.freeze(input.keys.pixels); Object.freeze(input.keys.curve.paths); for (const path of input.keys.curve.paths) Object.freeze(path); Object.freeze(input.keys.curve.markers);
	for (let index = 0; index < 1000; index++) { input.keys.update(); input.keys.curve.update(input.keys); }
	model.undo(); assert.equal(model.buffer.getText(), source);
	assert.equal(model.undo(), null, 'time and value are one shared history operation');
	input.dispose(); model.dispose();
});

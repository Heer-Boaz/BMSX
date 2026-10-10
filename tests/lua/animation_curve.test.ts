import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildLuaFileSemanticData } from '../../toolchain/ts/lua/semantic/model';
import { semanticSnapshot } from './semantic_test_harness';
import { buildAnimationSourceDocument } from '../../ide/workbench/contrib/animation/source';
import { AnimationKeyViewport } from '../../ide/workbench/contrib/animation/key_viewport';
import { AnimationEditorInput } from '../../ide/workbench/contrib/animation/editor_input';
import { AnimationAuthoring } from '../../ide/workbench/contrib/animation/authoring';
import { EditorTextModel } from '../../ide/editor/model/text_model';
import { RunResult } from '../../machine/ts/machine/cpu/cpu';
import { createCartlibProgramHarness } from '../helpers/cartlib_cpu';

const resource = { domain: 0 as const, path: 'animation.lua', source: { resid: 'animation.lua', type: 'lua' as const } };
const source = `return { duration_ms=100, tracks={
	{kind='value', interpolation='cubic', path={'x'}, keys={
		{time_ms=0,value=0,arrive_tangent=0,leave_tangent=2},
		{time_ms=100,value=100,arrive_tangent=0,leave_tangent=0}}},
	{kind='value',interpolation='linear',path={'y'},keys={{time_ms=200,value=1}}}}}`;

test('written cubic geometry agrees with the native Hermite slopes at O0 and O3', () => {
	const document = buildAnimationSourceDocument(resource, semanticSnapshot(buildLuaFileSemanticData(source, resource.path)))!;
	const view = new AnimationKeyViewport(); view.bind(document.tracks[0], 0, document);
	view.range.layout(0, 0, 806, 20); view.curve.layout(0, 30, 806, 230); view.curve.update(view);
	assert.equal(view.extentMaximum, 200, 'same-unit lanes share the written extent');
	// x=25 is an actual retained sample: width 800, first span 100, 100 samples.
	const point = view.curve.points.indexOf(view.xAt(25));
	assert.notEqual(point, -1);
	assert.equal(view.curve.points[point + 1], view.curve.yAt(43.75));
	for (const optLevel of [0, 3] as const) {
		const { cpu } = createCartlibProgramHarness(`
			local component=require('cartlib/timeline/timeline_component')
			local owner={x=-1,y=-1}
			local timelines=component.new({parent=owner})
			timelines:define('curve',require('animation')); timelines:play('curve')
			timelines:seek_time('curve',25); assert(owner.x==43.75)
		`, { optLevel, modules: [{ path: 'animation', source }] });
		assert.equal(cpu.runUntilDepth(0, 20_000_000), RunResult.Halted);
	}
});

test('curve previews and view navigation do not mutate written keys or invent normalized tangents', () => {
	const document = buildAnimationSourceDocument(resource, semanticSnapshot(buildLuaFileSemanticData(source, resource.path)))!;
	const view = new AnimationKeyViewport(); view.bind(document.tracks[0], 0, document); view.range.layout(0, 0, 206, 20);
	view.curve.preview('leave', 3); view.preview(10);
	assert.equal(view.curve.fieldValue(view, 0, 'leave'), 3);
	assert.equal(document.tracks[0].keys[0].leave!.value, 2);
	assert.equal(document.tracks[0].keys[0].coordinate!.value, 0);
	view.cancel(); assert.equal(view.curve.fieldValue(view, 0, 'leave'), 2);
	const anchor = view.valueAt(103); view.zoom(103, 0.5); assert.equal(view.valueAt(103), anchor);
	view.fit(); assert.equal(view.range.maximum, 200);
	view.setView(300, 400); view.curve.update(view);
	assert.deepEqual(view.curve.points, [view.xAt(300), view.curve.yAt(100), view.xAt(400), view.curve.yAt(100)], 'the native last-value clamp remains visible beyond the written keys');
	view.setView(-100, -1); view.curve.update(view);
	assert.deepEqual(view.curve.points, [view.xAt(-100), view.curve.yAt(0), view.xAt(-1), view.curve.yAt(0)]);
	view.fit();
	view.bind(document.tracks[1], 0, document); assert.equal(view.range.maximum, 200);
	const dynamic = buildAnimationSourceDocument(resource, semanticSnapshot(buildLuaFileSemanticData("return {tracks={{kind='value',interpolation='cubic',keys={{u=0,value=0,arrive_tangent=0,leave_tangent=0}}}}}", resource.path)))!;
	view.bind(dynamic.tracks[0], 0, dynamic); assert.equal(view.curve.available, false);
});

test('the curve commits time and value as one native source edit and idle geometry does no projection work', () => {
	const model = new EditorTextModel(resource, 'lua', source), input = new AnimationEditorInput(model);
	input.document = buildAnimationSourceDocument(resource, semanticSnapshot(buildLuaFileSemanticData(source, resource.path)))!;
	const authoring = new AnimationAuthoring({ modelFor: () => model, refresh() {}, selectKey() {}, selectTrack() {}, selectProperty() {} }, undefined!, undefined!);
	authoring.editCurveKey(input, input.document.tracks[0].keys[1], 120, 'value', 200);
	const changed = buildAnimationSourceDocument(resource, semanticSnapshot(buildLuaFileSemanticData(model.buffer.getText(), resource.path)))!;
	assert.equal(changed.tracks[0].keys[1].coordinate!.value, 120);
	assert.equal(changed.tracks[0].keys[1].value!.value, 200);
	input.keys.bind(changed.tracks[0], 1, changed);
	input.keys.range.layout(0, 0, 806, 20); input.keys.curve.layout(0, 30, 806, 230);
	input.keys.update(); input.keys.curve.update(input.keys);
	Object.freeze(input.keys.pixels); Object.freeze(input.keys.curve.points); Object.freeze(input.keys.curve.markers);
	for (let index = 0; index < 1000; index++) { input.keys.update(); input.keys.curve.update(input.keys); }
	model.undo(); assert.equal(model.buffer.getText(), source);
	assert.equal(model.undo(), null, 'time and value are one shared history operation');
	input.dispose(); model.dispose();
});

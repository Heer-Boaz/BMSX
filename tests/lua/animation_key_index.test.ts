import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildLuaSemanticWorkspaceSnapshot } from '../../toolchain/ts/lua/semantic/model';
import { buildResourceLuaSemanticFixtureFile, createResourceModuleProjectFixture } from '../helpers/lua_semantic_project';
import { buildAnimationSourceDocument } from '../../ide/workbench/contrib/animation/source';
import { AnimationKeyViewport } from '../../ide/workbench/contrib/animation/key_viewport';
import { AnimationEditorInput } from '../../ide/workbench/contrib/animation/editor_input';
import { EditorTextModel } from '../../ide/editor/model/text_model';

const resource = { sourceFilePath: 'animation.lua', location: { kind: 'workspace' as const, path: 'animation.lua' }, domain: 0 as const, path: 'animation.lua', source: { resid: 'animation', type: 'lua' as const } };

test('coincident key picking keeps the selected authored occurrence without overriding a nearer key', () => {
	const source = "return {duration_ms=100,tracks={{kind='value',interpolation='linear',keys={{time_ms=50,value=0},{time_ms=50,value=0},{time_ms=51,value=1}}}}}";
	const document = buildAnimationSourceDocument(resource, buildLuaSemanticWorkspaceSnapshot(...createResourceModuleProjectFixture([buildResourceLuaSemanticFixtureFile(source, resource)], [])))!;
	const view = new AnimationKeyViewport(); view.bind(document.tracks[0], -1, document);
	view.range.layout(0, 0, 106, 20); view.curve.layout(0, 30, 106, 142); view.curve.update(view);
	const x = view.xAt(50), y = view.curve.yAt(0);
	assert.equal(view.keyAt(x), 0); assert.equal(view.curve.keyAt(view, x, y), 0);
	view.select(1);
	assert.equal(view.keyAt(x), 1); assert.equal(view.curve.keyAt(view, x, y), 1);
	assert.equal(view.keyAt(view.xAt(51)), 2);
	assert.equal(view.curve.keyAt(view, view.xAt(51), view.curve.yAt(1)), 2);
	view.preview(51); view.curve.preview('value', 1);
	assert.equal(view.keyAt(view.xAt(51)), 1);
	assert.equal(view.curve.keyAt(view, view.xAt(51), view.curve.yAt(1)), 1);
	view.cancel(); view.select(0);
	assert.equal(view.keyAt(x), 0); assert.equal(view.curve.keyAt(view, x, y), 0);
	assert.equal(document.tracks[0].keys[1].coordinate!.value, 50);
	assert.equal(document.tracks[0].keys[1].value!.value, 0);
});

test('unselected key navigation searches from the current native cursor, without wrapping backwards', () => {
	for (const unit of ['time_ms', 'frame', 'u'] as const) {
		const source = `return {tracks={{kind='event',keys={{${unit}=100,event='a'},{${unit}=0,event='b'},{${unit}=50,event='c'},{${unit}=50,event='d'},{${unit}=200,event='e'}}}}}`;
		const document = buildAnimationSourceDocument(resource, buildLuaSemanticWorkspaceSnapshot(...createResourceModuleProjectFixture([buildResourceLuaSemanticFixtureFile(source, resource)], [])))!;
		const view = new AnimationKeyViewport(); view.bind(document.tracks[0], -1, document);
		for (const [cursor, before, after] of [[75, 3, 0], [50, 1, 0], [-1, -1, 1], [201, 4, -1]] as const) {
			view.setCursor(cursor);
			assert.equal(view.adjacentKey('ArrowLeft'), before);
			assert.equal(view.adjacentKey('ArrowRight'), after);
			assert.equal(view.cursor, cursor); assert.equal(view.selected, -1);
		}
		assert.equal(view.adjacentKey('Home'), 1); assert.equal(view.adjacentKey('End'), 4);
		view.select(2); assert.equal(view.adjacentKey('ArrowRight'), 3, 'selected coincident keys remain separately navigable');
	}
});

test('chronological lookup and crossing previews retain authored order and equal-time priority', () => {
	const source = "return {tracks={{kind='event',keys={{time_ms=100,event='a'},{time_ms=0,event='b'},{time_ms=50,event='c'},{time_ms=50,event='d'},{time_ms=200,event='e'}}}}}";
	const document = buildAnimationSourceDocument(resource, buildLuaSemanticWorkspaceSnapshot(...createResourceModuleProjectFixture([buildResourceLuaSemanticFixtureFile(source, resource)], [])))!;
	const track = document.tracks[0], view = new AnimationKeyViewport();
	Object.freeze(track.keyIndex.order); Object.freeze(track.keyIndex.positions);
	view.bind(track, 0, document);
	assert.deepEqual(view.timeOrder, [1, 2, 3, 0, 4]);
	assert.equal(view.timeIndex(50), 1); assert.equal(view.timeIndex(50, true), 3);
	view.preview(50); assert.deepEqual(view.timeOrder, [1, 0, 2, 3, 4]);
	assert.equal(view.timeIndex(50), 1); assert.equal(view.timeIndex(50, true), 4);
	assert.equal(view.adjacentKey('ArrowRight'), 2);
	view.preview(-1); assert.deepEqual(view.timeOrder, [0, 1, 2, 3, 4]);
	view.preview(201); assert.deepEqual(view.timeOrder, [1, 2, 3, 4, 0]);
	view.cancel(); assert.deepEqual(view.timeOrder, [1, 2, 3, 0, 4]);
	assert.equal(view.adjacentKey('ArrowLeft'), 3);
	assert.deepEqual(track.keyIndex.positions, [100, 0, 50, 50, 200]);
});

test('a shared native axis retains its cursor, while changing units admits a new cursor', () => {
	const source = "return {tracks={{kind='event',keys={{time_ms=100,event='first'}}},{kind='event',keys={{time_ms=200,event='second'}}}},frames={'idle','move'}}";
	const document = buildAnimationSourceDocument(resource, buildLuaSemanticWorkspaceSnapshot(...createResourceModuleProjectFixture([buildResourceLuaSemanticFixtureFile(source, resource)], [])))!;
	const view = new AnimationKeyViewport();
	view.bind(document.tracks[0], -1, document); view.setCursor(500);
	view.bind(document.tracks[1], -1, document);
	assert.equal(view.cursor, 500);
	view.bind(undefined, -1, document, 'frame');
	assert.equal(view.cursor, view.extentMinimum, 'milliseconds cannot become a frame index');
	assert.equal(view.cursor, 0);
	view.setCursor(1); view.bind(undefined, -1, document, 'frame');
	assert.equal(view.cursor, 1);
});

test('overview visits the visible key interval, keeps spanning tags and performs no idle reprojection', t => {
	const keys = Array.from({ length: 512 }, (_, index) => `{time_ms=${1023 - index * 2},event='sample'}`).join(',');
	const source = `return {tracks={{kind='event',keys={${keys}}},{kind='tag',name='activity',tag='activity',start={time_ms=0},['end']={time_ms=2048}}}}`;
	const document = buildAnimationSourceDocument(resource, buildLuaSemanticWorkspaceSnapshot(...createResourceModuleProjectFixture([buildResourceLuaSemanticFixtureFile(source, resource)], [])))!;
	let reads = 0;
	const positions = new Proxy(document.tracks[0].keyIndex.positions, { get(target, property) {
		if (property !== 'length') reads++;
		return Reflect.get(target, property);
	} });
	const track = { ...document.tracks[0], keyIndex: { ...document.tracks[0].keyIndex, positions } };
	const model = new EditorTextModel(resource, 'lua', source), input = new AnimationEditorInput(model, model.resource.domain);
	t.after(() => { input.dispose(); model.dispose(); });
	input.document = { ...document, tracks: [track, document.tracks[1]] };
	for (const lane of input.document.tracks) input.tracks.rows.push({ track: lane, clip: undefined, frames: false, label: lane.label, text: '' });
	input.tracks.layout.rowHeight = 18; input.tracks.layout.visibleRowCount = 2;
	input.keys.bind(track, -1, input.document); input.keys.range.layout(0, 0, 806, 20);
	input.overview.layout(0, 0, 806, 36); input.keys.setView(500, 520);
	reads = 0; input.overview.update(input);
	assert.equal(input.overview.lanes[0].dots.length / 2, 10);
	assert.ok(reads < 64, 'view changes must not rescan all 512 coordinates');
	assert.equal(input.overview.lanes[1].dots.length, 0, 'both tag boundaries lie outside this viewport');
	assert.deepEqual(input.overview.lanes[1].cells, [input.keys.xAt(0), input.keys.xAt(2048)]);
	const projectedReads = reads;
	for (const lane of input.overview.lanes) { Object.freeze(lane.dots); Object.freeze(lane.cells); }
	for (let index = 0; index < 1000; index++) input.overview.update(input);
	assert.equal(reads, projectedReads);
});

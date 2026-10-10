import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildLuaFileSemanticData } from '../../toolchain/ts/lua/semantic/model';
import { semanticSnapshot } from './semantic_test_harness';
import { buildAnimationSourceDocument } from '../../ide/workbench/contrib/animation/source';
import { AnimationKeyViewport } from '../../ide/workbench/contrib/animation/key_viewport';
import { AnimationEditorInput } from '../../ide/workbench/contrib/animation/editor_input';
import { EditorTextModel } from '../../ide/editor/model/text_model';

const resource = { domain: 0 as const, path: 'animation.lua', source: { resid: 'animation', type: 'lua' as const } };

test('chronological lookup and crossing previews retain authored order and equal-time priority', () => {
	const source = "return {tracks={{kind='event',keys={{time_ms=100,event='a'},{time_ms=0,event='b'},{time_ms=50,event='c'},{time_ms=50,event='d'},{time_ms=200,event='e'}}}}}";
	const document = buildAnimationSourceDocument(resource, semanticSnapshot(buildLuaFileSemanticData(source, resource.path)))!;
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
	const document = buildAnimationSourceDocument(resource, semanticSnapshot(buildLuaFileSemanticData(source, resource.path)))!;
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
	const document = buildAnimationSourceDocument(resource, semanticSnapshot(buildLuaFileSemanticData(source, resource.path)))!;
	let reads = 0;
	const positions = new Proxy(document.tracks[0].keyIndex.positions, { get(target, property) {
		if (property !== 'length') reads++;
		return Reflect.get(target, property);
	} });
	const track = { ...document.tracks[0], keyIndex: { ...document.tracks[0].keyIndex, positions } };
	const model = new EditorTextModel(resource, 'lua', source), input = new AnimationEditorInput(model);
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

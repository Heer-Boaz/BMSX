import assert from 'node:assert/strict';
import { test } from 'node:test';
import { RunResult } from '../../machine/ts/machine/cpu/cpu';
import { createCartlibProgramHarness } from '../helpers/cartlib_cpu';
import { buildLuaFileSemanticData } from '../../toolchain/ts/lua/semantic/model';
import { semanticSnapshot } from './semantic_test_harness';
import { buildAnimationSourceDocument } from '../../ide/workbench/contrib/animation/source';
import { AnimationKeyViewport } from '../../ide/workbench/contrib/animation/key_viewport';
import { EditorTextModel } from '../../ide/editor/model/text_model';
import { createLuaTableFieldNumberEdits } from '../../ide/language/lua/source_edits';
import { createLuaTableFieldInsertionEdits } from '../../ide/language/lua/table_field_insertion';
import { newLuaSource } from '../../ide/workbench/contrib/resources/create/source_templates';

const resource = { domain: 0 as const, path: 'animation.lua', source: { resid: 'animation.lua', type: 'lua' as const } };
function project(source: string, imports: readonly { path: string; source: string }[] = []) {
	return buildAnimationSourceDocument(resource, semanticSnapshot(buildLuaFileSemanticData(source, resource.path),
		...imports.map(item => buildLuaFileSemanticData(item.source, item.path))));
}

test('imported key definitions retain their authored owner and coordinate domain', () => {
	const document = project("return {frame_duration=20,duration_ms=100,tracks=require('tracks')}", [{ path: 'tracks.lua',
		source: "return {{kind='value',interpolation='linear',path={'visual','offset_x'},keys={{time_ms=100,value=20},{time_ms=0,value=0}}}}" }])!;
	const track = document.tracks[0];
	assert.equal(document.root.file.file, 'animation.lua');
	assert.equal(track.source!.file.file, 'tracks.lua');
	assert.equal(track.keys[0].source!.file.file, 'tracks.lua');
	assert.equal(track.unit, 'time_ms');
	assert.deepEqual(track.keys.map(key => key.coordinate!.value), [100, 0]);
	const viewport = new AnimationKeyViewport();
	viewport.bind(track, -1, document);
	assert.deepEqual(viewport.timeOrder, [1, 0]);
	assert.equal(viewport.adjacentKey('Home'), 1);
	viewport.select(1);
	assert.equal(viewport.adjacentKey('ArrowRight'), 0);
	assert.deepEqual(track.keys.map(key => key.coordinate!.value), [100, 0], 'presentation ordering never rewrites source ordering');
});

test('coordinate selection follows nil semantics without estimating mixed units or dynamic producers', () => {
	const document = project("return {tracks={{kind='value',keys={{time_ms=nil,frame=2,value=0},{frame=nil,u=0.5,value=10}}},{kind='value',keys={{time_ms=unknown,frame=4,value=0}}}}}")!;
	assert.deepEqual(document.tracks[0].keys.map(key => key.coordinate!.unit), ['frame', 'u']);
	assert.equal(document.tracks[0].unit, undefined);
	assert.equal(document.tracks[1].unit, 'time_ms');
	assert.equal(document.tracks[1].keys[0].coordinate!.value, null);
	const viewport = new AnimationKeyViewport();
	viewport.bind(document.tracks[0], -1, document);
	assert.deepEqual(viewport.positions, [null, null]);
	assert.equal(project('return make_animation()'), undefined);
});

test('mutating a containing definition cannot grant structural authority to its old keys', () => {
	const document = project("local definition={tracks={{kind='value',keys={{time_ms=0,value=0},{time_ms=100,value=1}}}}}; definition.tracks=make_tracks(); return definition")!;
	assert.equal(document.root.structural, false);
	assert.equal(document.tracksSource!.structural, false);
	assert.equal(document.tracks[0].keys[0].source!.structural, false);
});

test('a key gesture is presentation only until one shared document edit, with native cartlib execution at O0 and O3', () => {
	const source = "return {frame_duration=20,duration_ms=100,tracks={{kind='value',interpolation='linear',path={'x'},keys={{time_ms=0,value=0},{time_ms=100,value=100}}}}}";
	const model = new EditorTextModel(resource, 'lua', source);
	const document = project(source)!, track = document.tracks[0], key = track.keys[1];
	const viewport = new AnimationKeyViewport();
	viewport.bind(track, 1, document); viewport.preview(50);
	assert.equal(model.buffer.getText(), source);
	assert.equal(key.coordinate!.value, 100);
	viewport.cancel();
	assert.equal(viewport.dragValue, undefined);
	model.pushEditOperations(createLuaTableFieldNumberEdits(model.buffer, key.source!.file.chunk.locations, key.coordinate!.field, 50)!);
	for (const optLevel of [0, 3] as const) {
		const { cpu } = createCartlibProgramHarness(`
			local component = require('cartlib/timeline/timeline_component')
			local owner = {x=-1}
			local timelines = component.new({parent=owner})
			timelines:define('movement', require('animation'))
			timelines:play('movement')
			assert(owner.x==0)
			timelines:tick_gameplay(25)
			assert(owner.x==50)
			timelines:seek_time('movement',50)
			assert(owner.x==100)
		`, { optLevel, modules: [{ path: 'animation', source: model.buffer.getText() }] });
		assert.equal(cpu.runUntilDepth(0, 20_000_000), RunResult.Halted);
	}
	model.undo(); assert.equal(model.buffer.getText(), source);
	model.redo(); assert.equal(project(model.buffer.getText())!.tracks[0].keys[1].coordinate!.value, 50);
});

test('the creation template receives ordinary tracks through the shared table edit owner', () => {
	const model = new EditorTextModel(resource, 'lua', newLuaSource('animation', resource.path));
	const document = project(model.buffer.getText())!, tracks = document.tracksSource!;
	model.pushEditOperations(createLuaTableFieldInsertionEdits(model.buffer, tracks.file.chunk, tracks.table, 0,
		"{kind='value',interpolation='step',path={'imgid'},keys={{time_ms=0,value='idle'},{time_ms=100,value='strike'}}}"));
	const authored = project(model.buffer.getText())!;
	assert.equal(authored.tracks[0].interpolation, 'step');
	assert.equal(authored.tracks[0].keys.length, 2);
	model.undo(); assert.equal(model.buffer.getText(), newLuaSource('animation', resource.path));
});

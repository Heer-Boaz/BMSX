import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { SceneAuthoringContext } from '../../ide/workbench/contrib/scene_editor/authoring_context';
import { SceneSpatialProjection } from '../../ide/workbench/contrib/scene_editor/spatial_projection';
import type { SceneSourceObject } from '../../ide/workbench/contrib/scene_editor/model';
import { resolveLuaTextFileModel } from '../../ide/workbench/services/working_copy/text_file_model';
import { stringLiteralValue } from '../../toolchain/ts/lua/syntax/literals';
import { createSceneSourceFixture } from '../helpers/scene_sources';

const PREFABS = `local prefab = require('cartlib/world/prefab')
prefab.define({def_id='node2',class=require('cartlib/world/object_2d')})
prefab.define({def_id='node3',class=require('cartlib/world/object_3d')})
prefab.define({def_id='body',class=require('cartlib/world/object_2d')})
prefab.define({def_id='body3',class=require('cartlib/world/object_3d')})
prefab.define({def_id='default',class=require('cartlib/world/object_3d'),transform = { xx = 2, xy = 0, xz = 0, yx = 1, yy = 3, yz = 0, zx = 0, zy = 1, zz = -4, ox = 8, oy = 9, oz = 10 }})`;

function fixture(t: TestContext, objects: string, prefix = '') {
	const source = `local scenes=require('cartlib/world/scene_library')
require('prefabs')
${prefix}
scenes.register('fixture',{objects={${objects}}})`;
	const f = createSceneSourceFixture(t, source, 'scene.lua', undefined, [
		['cartlib/world/prefab.lua', 'return { define=function() end }'], ['prefabs.lua', PREFABS],
	]);
	const context = new SceneAuthoringContext(f.model, f.documents); t.after(() => context.dispose());
	const scene = () => { context.refresh(); const document = f.documents.get(f.model);
		return f.documents.getSpatialProjection(f.model, document)!.readScene(document, document.scenes[0]); };
	const select = (id: string) => {
		const document = f.documents.get(f.model), sourceScene = document.scenes[0];
		assert.ok(sourceScene, JSON.stringify(document.analysis.chunk.syntaxError));
		const index = sourceScene.objects.findIndex(entry => entry.kind === 'object' && stringLiteralValue(entry.memberId) === id);
		assert.notEqual(index, -1);
		context.select(document, f.model.version, { kind: 'member', scene: sourceScene, entry: sourceScene.objects[index], index });
		return sourceScene.objects[index] as SceneSourceObject;
	};
	return { ...f, source, context, scene, select };
}

test('translation retains exact subtree poses, composes full sheared/reflected affines and commits one Undo edit', t => {
	const f = fixture(t, `
 {member_id='leaf',definition_id='node3',parent='child',transform = { xx = 0, xy = 0, xz = 0, yx = 1, yy = 1, yz = 0, zx = 0, zy = 0, zz = -1, ox = 2, oy = 3, oz = 4 }},
 {member_id='child',definition_id='node3',parent=parent_alias,transform = { xx = basis, xy = 0, xz = 0, yx = 0, yy = 0, yz = 0, zx = 0, zy = 1, zz = -1, ox = 4, oy = 5, oz = 6 }},
 {member_id='parent',definition_id='node3',transform = { xx = 2, xy = 0, xz = 0, yx = 1, yy = -1, yz = 0, zx = 0, zy = 1, zz = 3, ox = 10, oy = 20, oz = 30 }},
 {member_id='other',definition_id='node3'},
 {member_id='unknown',definition_id='node3',parent='child',transform=make_pose()},`,
		`local parent_alias='parent'\nlocal basis=1`);
	const entry = f.select('child'), original = f.scene(), initial = { ...original.worlds.get(entry)! };
	const writer = t.mock.method(SceneSpatialProjection.prototype, 'translationEdits');
	for (let index = 0; index < 20; index++) assert.equal(f.context.canTranslateSelectedMember(), true);
	const request = f.context.captureTranslation()!; assert.ok(request);
	const worlds = request.preview.worlds, poses = [...worlds.values()], revision = request.preview.revision;
	assert.equal(request.entry, entry); assert.equal(worlds.size, 3); assert.equal(worlds.get(entry), request.currentWorld);
	assert.notEqual(request.currentWorld, original.worlds.get(entry));
	assert.equal(request.translate(6, 0, 6), true);
	assert.equal(request.preview.revision, revision + 1); assert.equal(request.preview.worlds, worlds);
	assert.deepEqual([...worlds.values()], poses, 'all known pose objects are retained in place');
	assert.deepEqual(original.worlds.get(entry), initial, 'preview cannot mutate the shared source pose');
	assert.equal(f.model.buffer.getText(), f.source); assert.equal(writer.mock.callCount(), 0);
	assert.deepEqual(request.initialWorld, initial); assert.equal(request.currentWorld.family, '3d');
	assert.deepEqual([request.currentWorld.ox, request.currentWorld.oy, request.currentWorld.family === '3d' && request.currentWorld.oz], [29, 21, 54]);
	const unknown = original.entries.find(value => stringLiteralValue(value.memberId) === 'unknown')!;
	assert.equal(worlds.has(unknown), true); assert.equal(worlds.get(unknown), undefined);
	assert.equal(request.translate(6, 0, 6), true); assert.equal(request.preview.revision, revision + 1);
	let events = 0; t.after(f.model.onDidChangeContent(() => events++));
	assert.equal(request.commit(), true); assert.equal(events, 1); assert.equal(writer.mock.callCount(), 1);
	assert.equal(request.isCurrent(), false); assert.equal(request.commit(), false); assert.equal(request.translate(1, 2, 3), false);
	assert.ok(f.model.buffer.getText().includes('parent=parent_alias,transform = { xx = basis, xy = 0, xz = 0, yx = 0, yy = 0, yz = 0, zx = 0, zy = 1, zz = -1, ox = 4, oy = 5, oz = 6 }'));
	const canonical = f.scene();
	for (const [oldEntry, pose] of worlds) {
		const next = canonical.entries.find(value => stringLiteralValue(value.memberId) === stringLiteralValue(oldEntry.memberId))!;
		assert.deepEqual(canonical.worlds.get(next), pose, 'preview exactly matches the committed source composition');
	}
	f.model.undo(); assert.equal(f.model.buffer.getText(), f.source); assert.equal(f.model.undo(), null);
});

test('2D translation converts displacement through the complete parent basis without inverting a singular child', t => {
	const f = fixture(t, `{member_id='child',definition_id='node2',parent='parent',transform = { xx = 0, xy = 0, yx = 0, yy = 0, ox = 2, oy = 3 }},
{member_id='parent',definition_id='node2',transform = { xx = 0, xy = 2, yx = -4, yy = 1, ox = 50, oy = 60 }}`);
	f.select('child'); const request = f.context.captureTranslation()!; assert.ok(request);
	assert.equal(request.translate(8, 6, 1), false); assert.equal(request.preview.revision, 0);
	assert.equal(request.translate(8, 6, 0), true); assert.equal(request.commit(), true);
	assert.ok(f.model.buffer.getText().includes('transform = { xx = 0, xy = 0, yx = 0, yy = 0, ox = 2, oy = 3 }'));
	assert.ok(f.model.buffer.getText().includes('position = { x = 6, y = 1 }'));
});

test('zero, rounded-away and returned-to-origin proposals consume no edit or Undo element', t => {
	const f = fixture(t, `{member_id='huge',definition_id='node3',position={x=${2 ** 60},y=0,z=0}}`);
	f.select('huge'); let request = f.context.captureTranslation()!;
	const writer = t.mock.method(f.model, 'pushEditOperations');
	request.translate(1, 0, 0); assert.equal(request.preview.revision, 0);
	assert.equal(request.commit(), true); assert.equal(f.model.version, 1); assert.equal(f.model.undo(), null);
	assert.equal(writer.mock.calls[0].arguments[0].length, 0);
	request = f.context.captureTranslation()!; request.translate(1024, 0, 0); request.translate(0, 0, 0);
	assert.deepEqual(request.currentWorld, request.initialWorld); request.commit();
	assert.equal(f.model.buffer.getText(), f.source); assert.equal(f.model.undo(), null);
});

test('known inherited and shared transforms become consumer overrides without mutating providers or direct parent expressions', t => {
	const f = fixture(t, `{member_id='inherited',definition_id='default'},
{member_id='shared',definition_id='node3',parent=parent_alias,transform=pose},
{member_id='aliased',definition_id='node3',parent=placement.parent,transform=placement.transform},
{member_id='parent',definition_id='node3'},
{member_id='nil',definition_id='node3',parent=nil,transform=nil}`, `local parent_alias='parent'
local pose={ xx = 1, xy = 0, xz = 0, yx = 0, yy = 1, yz = 0, zx = 0, zy = 0, zz = 1, ox = 1, oy = 2, oz = 3 }
local placement={parent=parent_alias,transform=pose}`);
	for (const id of ['inherited', 'shared', 'aliased', 'nil']) {
		f.select(id); const request = f.context.captureTranslation()!; assert.ok(request, id);
		request.translate(2, 3, 4); assert.equal(request.commit(), true);
	}
	const text = f.model.buffer.getText();
	assert.ok(text.includes("local pose={ xx = 1, xy = 0, xz = 0, yx = 0, yy = 1, yz = 0, zx = 0, zy = 0, zz = 1, ox = 1, oy = 2, oz = 3 }"));
	assert.ok(text.includes('local placement={parent=parent_alias,transform=pose}'));
	assert.ok(text.includes('parent=parent_alias,transform=pose'));
	assert.ok(text.includes('position = { x = 3, y = 5, z = 7 }'));
	assert.ok(text.includes('parent=placement.parent,transform=placement.transform'));
	assert.ok(text.includes('position = { x = 10, y = 12, z = 14 }'));
	assert.equal(f.scene().worlds.size, 5, 'all overrides remain admitted source poses');
});

test('admission is local to a known topology, rejects singular parents without imposing a transform-authority profile', t => {
	const f = fixture(t, `{member_id='valid',definition_id='node3'}, unknown_member(),
{member_id='child',definition_id='node3',parent='singular'},
{member_id='singular',definition_id='node3',transform = { xx = 0, xy = 0, xz = 0, yx = 0, yy = 0, yz = 0, zx = 0, zy = 0, zz = 0, ox = 0, oy = 0, oz = 0 }},
{member_id='computed',definition_id='node3',transform=make_pose()},
{member_id='body',definition_id='body'},
{member_id='body3',definition_id='body3',transform = { xx = 2, xy = 0, xz = 0, yx = 0, yy = 1, yz = 0, zx = 0, zy = 0, zz = 1, ox = 0, oy = 0, oz = 0 }},
{member_id='parentedbody',definition_id='body',parent='body'},
{member_id='dangling',definition_id='node3',parent='missing'}`);
	for (const id of ['valid', 'singular', 'body', 'body3', 'parentedbody']) { f.select(id); assert.equal(f.context.canTranslateSelectedMember(), true, id); }
	for (const id of ['child', 'computed', 'dangling']) {
		f.select(id); assert.equal(f.context.canTranslateSelectedMember(), false, id); assert.equal(f.context.captureTranslation(), undefined);
	}
	f.select('body'); const request = f.context.captureTranslation()!; request.translate(3, 4, 0); assert.equal(request.commit(), true);
	assert.ok(f.model.buffer.getText().includes('position = { x = 3, y = 4 }'));
});

test('requests retire on source, dependency, selection, readonly, explicit cancellation and context lifetime', t => {
	const f = fixture(t, `{member_id='one',definition_id='node3'},{member_id='two',definition_id='node3'}`);
	const capture = () => { f.select('one'); return f.context.captureTranslation()!; };
	let request = capture(); request.translate(3, 4, 5); request.cancel();
	assert.equal(request.isCurrent(), false); assert.equal(request.commit(), false); assert.equal(f.model.buffer.getText(), f.source);
	request = capture(); f.select('two'); assert.equal(request.translate(1, 0, 0), false); assert.equal(request.commit(), false);
	request = capture();
	const provider = resolveLuaTextFileModel(f.models, f.sources.catalog,
		f.sources.catalog.resolveResource({ contextId: f.resource.contextId, path: 'prefabs.lua' })!);
	provider.pushEditOperations([{ offset: 0, deleteLength: 0, text: '-- changed dependency\n' }]);
	assert.equal(request.isCurrent(), false); assert.equal(request.commit(), false);
	request = capture(); f.model.pushEditOperations([{ offset: 0, deleteLength: 0, text: '-- changed source\n' }]);
	assert.equal(request.commit(), false); f.model.undo();
	request = capture(); f.model.refreshResource({ ...f.resource, source: { ...f.resource.source, generated: true } }); assert.equal(request.isCurrent(), false); assert.equal(request.commit(), false);
	f.model.refreshResource(f.resource); request = capture(); f.context.dispose(); assert.equal(request.commit(), false);
	assert.equal(f.model.buffer.getText(), f.source);
});

test('source admission callbacks cannot revive a cancelled request or retarget an exact occurrence', t => {
	const f = fixture(t, `{member_id='one',definition_id='node3'},{member_id='two',definition_id='node3'}`);
	f.select('one'); const request = f.context.captureTranslation()!;
	t.after(f.context.onDidChangeSpatialGeneration(() => { request.cancel(); f.select('two'); }));
	const provider = resolveLuaTextFileModel(f.models, f.sources.catalog,
		f.sources.catalog.resolveResource({ contextId: f.resource.contextId, path: 'prefabs.lua' })!);
	provider.pushEditOperations([{ offset: 0, deleteLength: 0, text: '-- dependency\n' }]);
	assert.equal(request.translate(3, 4, 5), false); assert.equal(request.commit(), false);
	assert.equal(f.model.buffer.getText(), f.source);
});

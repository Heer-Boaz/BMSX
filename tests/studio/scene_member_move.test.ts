import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { SceneAuthoringContext } from '../../ide/workbench/contrib/scene_editor/authoring_context';
import type { SceneSourceDocument, SceneSourceObject } from '../../ide/workbench/contrib/scene_editor/model';
import { SceneSpatialProjection } from '../../ide/workbench/contrib/scene_editor/spatial_projection';
import { resolveLuaTextFileModel } from '../../ide/workbench/services/working_copy/text_file_model';
import { stringLiteralValue } from '../../toolchain/ts/lua/syntax/literals';
import { createSceneSourceFixture } from '../helpers/scene_sources';

const PREFABS = `local prefab=require('cartlib/world/prefab')
prefab.define({def_id='node2',class=require('cartlib/world/object_2d')})
prefab.define({def_id='node3',class=require('cartlib/world/object_3d')})`;

function fixture(t: TestContext, objects: string) {
	const source = `local scenes=require('cartlib/world/scene_library')
require('prefabs')
scenes.register('room',{objects={
${objects}
}})
scenes.register('other',{objects={{member_id='other',definition_id='node2'}}})`;
	const f = createSceneSourceFixture(t, source, 'scene.lua', undefined,
		[['cartlib/world/prefab.lua', 'return {define=function() end}'], ['prefabs.lua', PREFABS]]);
	const context = new SceneAuthoringContext(f.model, f.documents);
	t.after(() => context.dispose());
	const member = (id: string, document: SceneSourceDocument = f.documents.get(f.model)): SceneSourceObject => {
		const entry = document.scenes[0].objects.find(entry => entry.kind === 'object' && stringLiteralValue(entry.memberId) === id);
		assert.ok(entry?.kind === 'object'); return entry;
	};
	const select = (id: string) => {
		const document = f.documents.get(f.model), scene = document.scenes[0], entry = member(id, document);
		assert.equal(context.select(document, f.model.version, { kind: 'member', scene, entry, index: scene.objects.indexOf(entry) }), true);
		return entry;
	};
	const ids = () => f.documents.get(f.model).scenes[0].objects.map(entry => entry.kind === 'object' ? stringLiteralValue(entry.memberId) : 'dynamic');
	const world = (id: string) => {
		const document = f.documents.get(f.model), scene = document.scenes[0];
		const affine = f.documents.getSpatialProjection(f.model, document)!.readScene(document, scene).worlds.get(member(id, document))!;
		// Compare the geometric origin and unit-axis endpoints, not signed-zero
		// coefficient artifacts of an equivalent parent-space solve.
		return [affine.ox, affine.oy, affine.ox + affine.xx, affine.oy + affine.xy, affine.ox + affine.yx, affine.oy + affine.yy];
	};
	return { ...f, source, context, member, select, ids, world };
}

test('sibling slots preserve exact selected source, comments and one Undo without preparing edits during admission', t => {
	const f = fixture(t, ` -- selected documentation
 {member_id='a',definition_id='node2',options={note='keep bytes'}};
 -- second documentation
 {member_id='b',definition_id='node2'},
 {member_id='c',definition_id='node2'}`);
	f.select('a');
	const writer = t.mock.method(SceneSpatialProjection.prototype, 'reparentEdits');
	const request = f.context.captureMemberMove()!, scene = request.scene, version = f.model.version;
	assert.equal(request.canPlace(undefined, f.member('b'), 'keep_world'), false, 'the existing sibling slot is not a source move');
	for (let frame = 0; frame < 100; frame++) assert.equal(request.canPlace(undefined, f.member('c'), 'keep_world'), true);
	assert.equal(writer.mock.callCount(), 0); assert.equal(f.model.version, version);
	let changes = 0; t.after(f.model.onDidChangeContent(() => changes++));
	assert.equal(request.apply(undefined, f.member('c'), 'keep_world'), true);
	assert.equal(request.isCurrent(), false); assert.equal(request.apply(undefined, scene.objects[1], 'keep_world'), false);
	assert.deepEqual(f.ids(), ['b', 'a', 'c']); assert.equal(changes, 1);
	assert.ok(f.model.buffer.getText().includes("-- selected documentation\n {member_id='a',definition_id='node2',options={note='keep bytes'}};"));
	assert.ok(f.context.selection?.kind === 'member' && f.context.selection.entry.kind === 'object');
	assert.equal(stringLiteralValue(f.context.selection.entry.memberId), 'a');
	assert.equal(f.context.selection.index, 1);
	f.model.undo(); assert.equal(f.model.buffer.getText(), f.source); assert.equal(f.model.dirty, false);
	assert.ok(f.context.selection?.kind === 'member'); assert.equal(f.context.selection.index, 0);
});

test('combined reparent and sibling order keep world poses and descendants in one tracked canonical edit', t => {
	const f = fixture(t, ` -- selected documentation
 {member_id='child',definition_id='node2',parent='old',position={x=2,y=3},options={note='unchanged'}},
 {member_id='descendant',definition_id='node2',parent='child',position={x=5,y=6}},
 {member_id='first',definition_id='node2',parent='target'},
 {member_id='old',definition_id='node2',position={x=100,y=200}},
 {member_id='last',definition_id='node2',parent='target'},
 {member_id='target',definition_id='node2',position={x=10,y=20}}`);
	const initialWorld = f.world('child'), descendantWorld = f.world('descendant');
	f.select('child'); const request = f.context.captureMemberMove()!, version = f.model.version;
	assert.equal(request.canPlace(f.member('target'), f.member('last'), 'keep_world'), true);
	let changes = 0; t.after(f.model.onDidChangeContent(() => changes++));
	assert.equal(request.apply(f.member('target'), f.member('last'), 'keep_world'), true);
	assert.equal(f.model.version, version + 1); assert.equal(changes, 1);
	assert.deepEqual(f.ids(), ['descendant', 'first', 'old', 'child', 'last', 'target']);
	assert.deepEqual(f.world('child'), initialWorld); assert.deepEqual(f.world('descendant'), descendantWorld);
	assert.ok(f.model.buffer.getText().includes("parent='target'"));
	assert.ok(f.model.buffer.getText().includes("options={note='unchanged'}"));
	assert.ok(f.context.selection?.kind === 'member' && f.context.selection.entry.kind === 'object');
	assert.equal(stringLiteralValue(f.context.selection.entry.memberId), 'child');
	assert.equal(f.context.selection.index, 3);
	f.model.undo(); assert.equal(f.model.buffer.getText(), f.source);
	assert.ok(f.context.selection?.kind === 'member'); assert.equal(f.context.selection.index, 0);
});

test('inside appends to actual siblings and an empty parent admits a parent-only edit at the same source rank', t => {
	const f = fixture(t, `{member_id='target',definition_id='node2',position={x=10}},
 {member_id='child',definition_id='node2',position={x=20}},
 {member_id='otherRoot',definition_id='node2'}`);
	f.select('child'); const initial = f.world('child'), request = f.context.captureMemberMove()!;
	assert.equal(request.canPlace(f.member('target'), undefined, 'keep_world'), true);
	assert.equal(request.apply(f.member('target'), undefined, 'keep_world'), true);
	assert.deepEqual(f.ids(), ['target', 'child', 'otherRoot']); assert.deepEqual(f.world('child'), initial);
	assert.ok(f.context.selection?.kind === 'member'); assert.equal(f.context.selection.index, 1);
	f.select('otherRoot'); const append = f.context.captureMemberMove()!;
	assert.equal(append.apply(f.member('target'), undefined, 'keep_world'), true);
	f.context.refresh();
	const document = f.documents.get(f.model), parents = f.context.getSpatialParents(document.scenes[0]);
	assert.equal(parents.get(f.member('otherRoot')), f.member('target'));
	assert.deepEqual(f.ids(), ['target', 'child', 'otherRoot']);
});

test('same-parent no-op slots do not shuffle interleaved descendants or require a computable pose', t => {
	const f = fixture(t, `{member_id='a',definition_id='node2'},
 {member_id='descendant',definition_id='node2',parent='a'},
 {member_id='b',definition_id='node2',transform=compute_pose()},
 {member_id='c',definition_id='node2'}`);
	f.select('a'); const first = f.context.captureMemberMove()!;
	assert.equal(first.canPlace(undefined, f.member('b'), 'keep_world'), false);
	f.select('b'); const second = f.context.captureMemberMove()!;
	assert.equal(second.canPlace(undefined, f.member('c'), 'keep_world'), false);
	assert.equal(second.canPlace(undefined, f.member('a'), 'keep_world'), true);
	assert.equal(second.apply(undefined, f.member('a'), 'keep_world'), true);
	assert.deepEqual(f.ids(), ['b', 'a', 'descendant', 'c']);
	assert.ok(f.model.buffer.getText().includes('transform=compute_pose()'));
	f.select('c'); const last = f.context.captureMemberMove()!;
	assert.equal(last.canPlace(undefined, undefined, 'keep_world'), false);
	assert.equal(last.apply(undefined, undefined, 'keep_world'), false);
});

for (const barrier of ['computed_member()', '[computed_key()]=computed_member()', "{member_id='unknown',definition_id='node2',parent=choose_parent()}"])
	test(`source ordering does not cross an unproved field barrier: ${barrier}`, t => {
		const f = fixture(t, `{member_id='a',definition_id='node2'}, ${barrier},
 {member_id='b',definition_id='node2'}, {member_id='c',definition_id='node2'}`);
		f.select('a'); assert.equal(f.context.captureMemberMove(), undefined); assert.equal(f.context.canMoveSelectedMember(1), false);
		f.select('b'); const request = f.context.captureMemberMove()!;
		assert.equal(f.context.canMoveSelectedMember(-1), false);
		assert.equal(request.canPlace(undefined, f.member('a'), 'keep_world'), false);
		assert.equal(request.canPlace(undefined, undefined, 'keep_world'), true);
		assert.equal(request.apply(undefined, undefined, 'keep_world'), true);
		assert.equal(f.ids().slice(-2).join(','), 'c,b');
		f.model.undo(); assert.equal(f.model.buffer.getText(), f.source);
	});

test('global append never means chain append, while before a visible barrier names its exact safe source boundary', t => {
	const f = fixture(t, `{member_id='a',definition_id='node2'}, {member_id='b',definition_id='node2'},
 computed_member(), {member_id='d',definition_id='node2'}`);
	f.select('a'); const request = f.context.captureMemberMove()!, barrier = request.scene.objects[2];
	assert.equal(request.canPlace(undefined, undefined, 'keep_world'), false, 'root append is after every root, not before the barrier');
	assert.equal(request.canPlace(undefined, f.member('d'), 'keep_world'), false);
	assert.equal(request.canPlace(undefined, barrier, 'keep_world'), true);
	assert.equal(request.apply(undefined, barrier, 'keep_world'), true);
	assert.deepEqual(f.ids(), ['b', 'a', 'dynamic', 'd']);
	f.model.undo(); assert.equal(f.model.buffer.getText(), f.source);
	f.select('b'); const unchanged = f.context.captureMemberMove()!;
	assert.equal(unchanged.canPlace(undefined, unchanged.scene.objects[2], 'keep_world'), false, 'the existing final chain slot is not a source move');
});

test('a trailing dynamic row also prevents treating the last proved chain as the global root end', t => {
	const f = fixture(t, `{member_id='a',definition_id='node2'}, {member_id='b',definition_id='node2'}, computed_member()`);
	f.select('a'); const request = f.context.captureMemberMove()!;
	assert.equal(request.canPlace(undefined, undefined, 'keep_world'), false);
	assert.equal(request.canPlace(undefined, request.scene.objects[2], 'keep_world'), true);
});

test('keep-world drops reject descendants, singular or different-family parents and foreign sibling slots', t => {
	const f = fixture(t, `{member_id='a',definition_id='node2'},
 {member_id='descendant',definition_id='node2',parent='a'},
 {member_id='target',definition_id='node2'},
 {member_id='foreignSibling',definition_id='node2',parent='target'},
 {member_id='singular',definition_id='node2',scale={x=0,y=0}},
 {member_id='mesh',definition_id='node3'}`);
	f.select('a'); const request = f.context.captureMemberMove()!;
	for (const id of ['a', 'descendant', 'singular', 'mesh']) {
		assert.equal(request.canPlace(f.member(id), undefined, 'keep_world'), false);
		assert.equal(request.apply(f.member(id), undefined, 'keep_world'), false);
	}
	assert.equal(request.canPlace(undefined, f.member('foreignSibling'), 'keep_world'), false);
	assert.equal(request.canPlace(f.member('target'), f.member('mesh'), 'keep_world'), false);
	assert.equal(request.canPlace(f.member('target'), f.member('foreignSibling'), 'keep_world'), true);
	assert.equal(f.model.buffer.getText(), f.source); assert.equal(f.model.dirty, false);
});

for (const mode of ['keep_world', 'keep_local'] as const) for (const change of ['selection', 'source', 'provider', 'readOnly', 'dispose'] as const)
	test(`a captured ${mode} member move retires on ${change} without writing its stale source coordinates`, t => {
		const f = fixture(t, `{member_id='a',definition_id='node2'}, {member_id='b',definition_id='node2'}`);
		f.select('a'); const request = f.context.captureMemberMove()!, target = f.member('b');
		switch (change) {
			case 'selection': f.select('b'); break;
			case 'source': f.model.pushEditOperations([{ offset: 0, deleteLength: 0, text: '-- changed\n' }]); break;
			case 'provider': {
				const resource = f.sources.catalog.resolveResource({ contextId: f.resource.contextId, path: 'prefabs.lua' })!;
				resolveLuaTextFileModel(f.models, f.sources.catalog, resource).pushEditOperations([{ offset: 0, deleteLength: 0, text: '-- changed\n' }]); break;
			}
			case 'readOnly': f.model.refreshResource({ ...f.model.resource, source: { ...f.model.resource.source, generated: true } }); break;
			case 'dispose': f.context.dispose(); break;
		}
		const source = f.model.buffer.getText(), version = f.model.version;
		assert.equal(request.isCurrent(), false); assert.equal(request.canPlace(target, undefined, mode), false);
		assert.equal(request.apply(target, undefined, mode), false);
		assert.equal(f.model.buffer.getText(), source); assert.equal(f.model.version, version);
	});

for (const mode of ['keep_world', 'keep_local'] as const) test(`a canonical ${mode} move publication preserves a newer explicit selection instead of restoring the dragged member`, t => {
	const f = fixture(t, `{member_id='a',definition_id='node2'}, {member_id='b',definition_id='node2'}, {member_id='c',definition_id='node2'}`);
	f.select('a'); const request = f.context.captureMemberMove()!;
	const release = f.model.onDidChangeContent(() => { release(); f.select('b'); }); t.after(release);
	assert.equal(request.apply(undefined, undefined, mode), true);
	assert.deepEqual(f.ids(), ['b', 'c', 'a']);
	assert.ok(f.context.selection?.kind === 'member' && f.context.selection.entry.kind === 'object');
	assert.equal(stringLiteralValue(f.context.selection.entry.memberId), 'b');
});


test('local-only reparent preserves authored expressions through one source edit and Undo', t => {
	const f = fixture(t, `{member_id='child',definition_id='node2',transform=compute_pose()},
 {member_id='singular',definition_id='node2',scale={x=0,y=0}}`);
	f.select('child'); const request = f.context.captureMemberMove()!, parent = f.member('singular');
	assert.ok(request); assert.equal(request.canPlace(parent, undefined, 'keep_world'), false);
	assert.equal(request.canPlace(parent, undefined, 'keep_local'), true);
	assert.equal(request.apply(parent, undefined, 'keep_world'), false);
	const version = f.model.version; let changes = 0; t.after(f.model.onDidChangeContent(() => changes++));
	assert.equal(request.apply(parent, undefined, 'keep_local'), true);
	assert.equal(f.model.version, version + 1); assert.equal(changes, 1);
	assert.ok(f.model.buffer.getText().includes('transform=compute_pose()'));
	f.context.refresh(); const selection = f.context.selection;
	assert.ok(selection?.kind === 'member' && selection.entry.kind === 'object');
	assert.equal(stringLiteralValue(f.context.getSpatialParents(selection.scene).get(selection.entry)!.memberId), 'singular');
	f.model.undo(); assert.equal(f.model.buffer.getText(), f.source); assert.equal(f.model.canUndo, false);
});

test('local mode respects cycles, family and same-parent ordering', t => {
	const f = fixture(t, `{member_id='a',definition_id='node2',transform=compute_pose()},
 {member_id='child',definition_id='node2',parent='a'},
 {member_id='b',definition_id='node2'}, {member_id='three',definition_id='node3'}`);
	f.select('a'); const request = f.context.captureMemberMove()!;
	for (const id of ['a', 'child', 'three']) assert.equal(request.canPlace(f.member(id), undefined, 'keep_local'), false);
	assert.equal(request.canPlace(undefined, f.member('b'), 'keep_local'), false);
	assert.equal(request.canPlace(undefined, undefined, 'keep_local'), true);
	assert.equal(request.apply(undefined, undefined, 'keep_local'), true);
	assert.ok(f.model.buffer.getText().includes('transform=compute_pose()'));
	f.model.undo(); assert.equal(f.model.buffer.getText(), f.source);
});


test('a drag with no world placements still admits a local-only detach', t => {
	const f = fixture(t, `{member_id='singular',definition_id='node2',scale={x=0,y=0}},
 {member_id='child',definition_id='node2',parent='singular',transform=compute_pose()}`);
	f.select('child'); const request = f.context.captureMemberMove()!;
	assert.ok(request); assert.equal(request.canPlace(undefined, undefined, 'keep_world'), false);
	assert.equal(request.canPlace(undefined, undefined, 'keep_local'), true);
	assert.equal(request.apply(undefined, undefined, 'keep_local'), true);
	assert.ok(f.model.buffer.getText().includes('transform=compute_pose()'));
	f.model.undo(); assert.equal(f.model.buffer.getText(), f.source);
});


test('3D local reparent retains the authored local position while changing world pose', t => {
	const f = fixture(t, `{member_id='child',definition_id='node3',position={x=2,y=3,z=4}},
 {member_id='parent',definition_id='node3',position={x=50,y=60,z=70}}`);
	f.select('child'); const request = f.context.captureMemberMove()!, parent = f.member('parent');
	assert.equal(request.canPlace(parent, undefined, 'keep_local'), true);
	assert.equal(request.apply(parent, undefined, 'keep_local'), true);
	assert.ok(f.model.buffer.getText().includes('position={x=2,y=3,z=4}'));
	const document = f.documents.get(f.model), scene = document.scenes[0], child = f.member('child', document);
	const spatial = f.documents.getSpatialProjection(f.model, document)!.readScene(document, scene);
	const pose = spatial.worlds.get(child);
	assert.ok(pose?.family === '3d');
	assert.deepEqual([pose.ox, pose.oy, pose.oz], [52, 63, 74]);
	f.model.undo(); assert.equal(f.model.buffer.getText(), f.source);
});

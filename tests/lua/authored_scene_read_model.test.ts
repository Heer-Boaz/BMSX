import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { SceneAuthoringContext } from '../../ide/workbench/contrib/scene_editor/authoring_context';
import { resolveLuaTextFileModel } from '../../ide/workbench/services/working_copy/text_file_model';
import { stringLiteralValue } from '../../toolchain/ts/lua/syntax/literals';
import { createSceneSourceFixture } from '../helpers/scene_sources';

const PREFABS = `local prefab=require('cartlib/world/prefab')
prefab.define({def_id='node2',class={},spatial={family='2d',authority='affine'}})
prefab.define({def_id='node3',class={},spatial={family='3d',authority='affine'}})
prefab.define({def_id='controller',class={}})`;

function fixture(t: TestContext, objects: string, index = 0, prefabs = PREFABS) {
	const source = `local scenes=require('cartlib/world/scene_library')
require('prefabs')
scenes.register('first',{objects={${objects}}})
scenes.register('second',{objects={{member_id='other',definition_id='node2'}}})`;
	const f = createSceneSourceFixture(t, source, 'scene.lua', undefined,
		[['cartlib/world/prefab.lua', 'return { define=function() end }'], ['prefabs.lua', prefabs]]);
	const document = f.documents.get(f.model), scene = document.scenes[index];
	const context = new SceneAuthoringContext(f.model, f.documents, { document, scene, sourceVersion: f.model.version });
	t.after(() => context.dispose());
	const member = (id: string) => context.spatialScene!.entries.find(entry => stringLiteralValue(entry.memberId) === id)!;
	return { ...f, source, context, member };
}

test('authored viewport reads exact 2D/3D world affines from the existing source forest without selecting or editing', t => {
	const f = fixture(t, `
 {member_id='child2',definition_id='node2',spatial={parent_id='root2',local_transform={1,0,0,1,4,5}}},
 {member_id='root2',definition_id='node2',spatial={local_transform={2,0,1,-3,10,20}}},
 {member_id='root3',definition_id='node3',spatial={local_transform={1,0,0,2,1,0,0,1,-1,10,20,30}}},
 {member_id='child3',definition_id='node3',spatial={parent_id='root3',local_transform={1,0,0,0,0,0,0,0,-1,4,5,6}}},
 {member_id='controller',definition_id='controller'},`);
	const read = f.context.spatialScene!, child2 = f.member('child2'), root2 = f.member('root2');
	assert.ok(child2 === f.context.subject!.objects[0]);
	assert.ok(read.parents.get(child2) === root2);
	assert.deepEqual(read.worlds.get(child2), { family: '2d', xx: 2, xy: 0, yx: 1, yy: -3, ox: 23, oy: 5 });
	assert.deepEqual(read.worlds.get(f.member('child3')),
		{ family: '3d', xx: 1, xy: 0, xz: 0, yx: 0, yy: 0, yz: 0, zx: 0, zy: -1, zz: 1, ox: 24, oy: 31, oz: 24 });
	assert.equal(read.worlds.get(f.member('controller')), undefined, 'nonspatial content has no invented identity pose');
	assert.equal(f.context.selection, undefined);
	assert.equal(f.model.buffer.getText(), f.source);
	assert.equal(f.model.canUndo, false);
});

test('one retained scene read materializes all poses once and steady viewport reads do not traverse or allocate a graph', t => {
	const f = fixture(t, `{member_id='root',definition_id='node2'}, {member_id='child',definition_id='node2',spatial={parent_id='root'}}`);
	const read = f.context.spatialScene!, child = f.member('child'), world = read.worlds.get(child);
	const reads = t.mock.method(read.worlds, 'has');
	for (let index = 0; index < 1000; index++) assert.ok(f.context.spatialScene === read);
	assert.equal(reads.mock.callCount(), 0, 'steady publication consumes the fully admitted read model, not another per-node query pass');
	assert.ok(read.worlds.get(child) === world);
	assert.ok(f.context.getSpatialParents(f.context.subject!) === read.parents, 'hierarchy and viewport share the admitted parent index');
});

test('invalid, missing, cyclic and dynamic ancestry remains unavailable instead of becoming a root pose', t => {
	const f = fixture(t, `
 {member_id='root',definition_id='node2'},
 {member_id='missing',definition_id='node2',spatial={parent_id='absent'}},
 {member_id='cycle_a',definition_id='node2',spatial={parent_id='cycle_b'}},
 {member_id='cycle_b',definition_id='node2',spatial={parent_id='cycle_a'}},
 {member_id='dynamic',definition_id='node2',spatial={local_transform=runtime_pose()}},
 {member_id='under_dynamic',definition_id='node2',spatial={parent_id='dynamic'}},
 {member_id='wrong_family',definition_id='node3',spatial={parent_id='root'}},`);
	const read = f.context.spatialScene!;
	assert.ok(read.worlds.get(f.member('root')) !== undefined);
	for (const id of ['missing', 'cycle_a', 'cycle_b', 'dynamic', 'under_dynamic', 'wrong_family'])
		assert.equal(read.worlds.get(f.member(id)), undefined, id);
	assert.equal(f.model.canUndo, false);
});

test('source dependency changes publish new poses while an older admitted read remains immutable', t => {
	const prefabs = PREFABS.replace("authority='affine'}", "authority='affine',local_transform={1,0,0,1,7,9}}" );
	const f = fixture(t, `{member_id='root',definition_id='node2'}, {member_id='child',definition_id='node2',spatial={parent_id='root'}}`, 0, prefabs);
	const old = f.context.spatialScene!, oldChild = f.member('child'), world = old.worlds.get(oldChild)!;
	assert.deepEqual(world, { family: '2d', xx: 1, xy: 0, yx: 0, yy: 1, ox: 14, oy: 18 });
	const resource = f.sources.catalog.resolveResource({ contextId: f.resource.contextId, path: 'prefabs.lua' })!;
	const provider = resolveLuaTextFileModel(f.models, f.sources.catalog, resource);
	const offset = provider.buffer.getText().indexOf('7,9');
	provider.pushEditOperations([{ offset, deleteLength: 3, text: '11,13' }]);
	f.context.refresh();
	const current = f.context.spatialScene!;
	assert.notEqual(current, old);
	assert.deepEqual(current.worlds.get(f.member('child')), { family: '2d', xx: 1, xy: 0, yx: 0, yy: 1, ox: 22, oy: 26 });
	assert.ok(old.worlds.get(oldChild) === world);
	assert.equal(world.ox, 14); assert.equal(world.oy, 18);
	assert.equal(f.model.canUndo, false);
});

test('a primary scene read never infers its subject from selection, another declaration or a document tab', t => {
	const f = fixture(t, `{member_id='first',definition_id='node2'}`, 1);
	assert.equal(stringLiteralValue(f.context.spatialScene!.entries[0].memberId), 'other');
	const document = f.documents.get(f.model), unbound = new SceneAuthoringContext(f.model, f.documents);
	t.after(() => unbound.dispose());
	unbound.select(document, f.model.version, { kind: 'scene', scene: document.scenes[0] });
	assert.equal(unbound.spatialScene, undefined, 'a selection in an ordinary Scene document does not bind Main');
	f.model.pushEditOperations([{ offset: 0, deleteLength: f.source.length, text: 'return {}' }]);
	f.context.refresh(); assert.equal(f.context.availability, 'unavailable');
	assert.equal(f.context.spatialScene, undefined);
});

test('a deep flat-authored chain projects iteratively, including forward parents, without a cloned scene tree', t => {
	const count = 4096, objects: string[] = [];
	for (let index = count - 1; index >= 0; index--) objects.push(`{member_id='n${index}',definition_id='node2',spatial={${index === 0 ? '' : `parent_id='n${index - 1}',`}local_transform={1,0,0,1,1,2}}}`);
	const f = fixture(t, objects.join(',')), read = f.context.spatialScene!;
	assert.equal(read.entries.length, count);
	const last = f.member(`n${count - 1}`), world = read.worlds.get(last)!;
	assert.equal(world.ox, count); assert.equal(world.oy, count * 2);
	assert.ok(read.parents.get(last) === f.member(`n${count - 2}`));
	assert.equal(f.model.canUndo, false);
});

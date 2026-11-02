import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { SceneAuthoringContext } from '../../ide/workbench/contrib/scene_editor/authoring_context';
import { SceneDetailsProjection } from '../../ide/workbench/contrib/scene_editor/details_projection';
import { SceneSpatialProjection } from '../../ide/workbench/contrib/scene_editor/spatial_projection';
import { resolveLuaTextFileModel } from '../../ide/workbench/services/working_copy/text_file_model';
import { stringLiteralValue } from '../../toolchain/ts/lua/syntax/literals';
import { LuaSyntaxKind } from '../../toolchain/ts/lua/syntax/ast';
import { findNamedLuaTableField } from '../../toolchain/ts/lua/syntax/table_fields';
import { createSceneSourceFixture } from '../helpers/scene_sources';

const PREFABS = `local prefab=require('cartlib/world/prefab')
local object_2d=require('cartlib/world/object_2d')
local object_3d=require('cartlib/world/object_3d')
prefab.define({def_id='node2',class=object_2d})
prefab.define({def_id='node3',class=object_3d})
prefab.define({def_id='inherited',class=object_2d,position={x=7,y=9},rotation=0,scale={x=-2,y=3}})
prefab.define({def_id='logic'})`;

function fixture(t: TestContext, members: string, prefix = '', prefabs = PREFABS) {
	const source = `local scenes=require('cartlib/world/scene_library')
${prefix}
scenes.register('fixture',{objects={${members}}})`;
	const f = createSceneSourceFixture(t, source, 'scene.lua', undefined,
		[['cartlib/world/prefab.lua', 'return {define=function() end}'], ['prefabs.lua', prefabs]]);
	const context = new SceneAuthoringContext(f.model, f.documents);
	t.after(() => context.dispose());
	const select = (id: string) => {
		context.refresh(); const document = f.documents.get(f.model), scene = document.scenes[0];
		const index = scene.objects.findIndex(entry => entry.kind === 'object' && stringLiteralValue(entry.memberId) === id);
		assert.notEqual(index, -1);
		context.select(document, f.model.version, { kind: 'member', scene, entry: scene.objects[index], index });
		return scene.objects[index];
	};
	return { ...f, source, context, select };
}

test('reparent and parent removal never replace an aliased coordinate to preserve its world pose', t => {
	const f = fixture(t, `{member_id='parent',definition_id='node2',position={x=10,y=0}},
 {member_id='sibling',definition_id='node2',parent='parent',position={x=1,y=2}},
 {member_id='child',definition_id='node2',parent='parent',position={x=offset,y=2}}`, 'local offset<const> = 8');
	f.select('child');
	const world = f.context.captureReparent('keep_world');
	assert.ok(world === undefined || world.choices.every(choice => choice.parent !== undefined));
	const local = f.context.captureReparent('keep_local')!;
	const root = local.choices.find(choice => choice.parent === undefined)!;
	assert.ok(root); assert.equal(local.apply(root), true);
	assert.ok(f.model.buffer.getText().includes('x=offset'));
	f.model.undo(); assert.equal(f.model.buffer.getText(), f.source);
	f.select('parent');
	assert.equal(f.context.canRemoveSelectedMember(), false);
	assert.equal(f.context.removeSelectedMember(), false);
	assert.equal(f.context.canRemoveSelectedSubtree(), true);
	assert.equal(f.model.buffer.getText(), f.source); assert.equal(f.model.canUndo, false);
});

test('reparent keeps an aliased complete position when no coordinate needs rewriting', t => {
	const f = fixture(t, `{member_id='parent',definition_id='node2'},
 {member_id='child',definition_id='node2',parent='parent',position=shared}`, 'local shared<const> = {x=4,y=5}');
	f.select('child'); const request = f.context.captureReparent('keep_world')!;
	assert.equal(request.apply(request.choices.find(choice => choice.parent === undefined)!), true);
	assert.ok(f.model.buffer.getText().includes('position=shared'));
	assert.ok(f.model.buffer.getText().includes('local shared<const> = {x=4,y=5}'));
	f.model.undo(); assert.equal(f.model.buffer.getText(), f.source);
});

test('a basis rewrite cannot remove an earlier duplicate position containing an expression', t => {
	const f = fixture(t, `{member_id='parent',definition_id='node2',transform={xx=2,xy=0,yx=0,yy=2,ox=0,oy=0}},
 {member_id='child',definition_id='node2',parent='parent',position={x=offset,y=5},position={x=4,y=5}}`, 'local offset<const> = 4');
	f.select('child'); const request = f.context.captureReparent('keep_world');
	assert.ok(request === undefined || request.choices.every(choice => choice.parent !== undefined));
	assert.ok(f.context.captureReparent('keep_local')!.choices.some(choice => choice.parent === undefined));
	f.select('parent'); assert.equal(f.context.canRemoveSelectedMember(), false);
	assert.equal(f.model.buffer.getText(), f.source); assert.equal(f.model.canUndo, false);
});

test('world-preserving reparent can change an independent literal axis without replacing an aliased axis', t => {
	const f = fixture(t, `{member_id='parent',definition_id='node2',position={x=0,y=10}},
 {member_id='child',definition_id='node2',parent='parent',position={x=offset,y=2}}`, 'local offset<const> = 8');
	f.select('child'); const request = f.context.captureReparent('keep_world')!;
	const root = request.choices.find(choice => choice.parent === undefined)!;
	assert.ok(root); assert.equal(request.apply(root), true);
	assert.ok(f.model.buffer.getText().includes('x=offset'));
	assert.ok(f.model.buffer.getText().includes('y=12'));
	f.model.undo(); assert.equal(f.model.buffer.getText(), f.source);
});

test('world-preserving placement does not replace a shared transform expression when the basis changes', t => {
	const f = fixture(t, `{member_id='parent',definition_id='node2',transform={xx=2,xy=0,yx=0,yy=2,ox=0,oy=0}},
 {member_id='child',definition_id='node2',parent='parent',transform=shared}`,
	'local shared<const> = {xx=1,xy=0,yx=0,yy=1,ox=4,oy=5}');
	f.select('child'); const world = f.context.captureReparent('keep_world');
	assert.ok(world === undefined || world.choices.every(choice => choice.parent !== undefined));
	assert.ok(f.context.captureReparent('keep_local')!.choices.some(choice => choice.parent === undefined));
	f.select('parent'); assert.equal(f.context.canRemoveSelectedMember(), false);
	assert.equal(f.context.canRemoveSelectedSubtree(), true);
	assert.equal(f.model.buffer.getText(), f.source); assert.equal(f.model.canUndo, false);
});

test('3D world-preserving placement protects aliased coordinates and retains literal-only cases', t => {
	const f = fixture(t, `{member_id='parent',definition_id='node3',position={x=0,y=0,z=10}},
 {member_id='protected',definition_id='node3',parent='parent',position={x=1,y=2,z=offset}},
 {member_id='editable',definition_id='node3',parent='parent',position={x=1,y=2,z=3}}`, 'local offset<const> = 8');
	f.select('protected'); const protectedRequest = f.context.captureReparent('keep_world');
	assert.ok(protectedRequest === undefined || protectedRequest.choices.every(choice => choice.parent !== undefined));
	assert.ok(f.context.captureReparent('keep_local')!.choices.some(choice => choice.parent === undefined));
	f.select('editable'); const request = f.context.captureReparent('keep_world')!;
	assert.equal(request.apply(request.choices.find(choice => choice.parent === undefined)!), true);
	assert.equal(f.context.selectedLocalTransform!.family, '3d');
	assert.ok(f.model.buffer.getText().includes('z=offset'));
	f.model.undo(); assert.equal(f.model.buffer.getText(), f.source);
	f.select('parent'); assert.equal(f.context.canRemoveSelectedMember(), false);
	assert.equal(f.context.canRemoveSelectedSubtree(), true);
});

test('a basis rewrite cannot erase unknown authored members of a literal position table', t => {
	const f = fixture(t, `{member_id='parent',definition_id='node2',transform={xx=2,xy=0,yx=0,yy=2,ox=0,oy=0}},
 {member_id='child',definition_id='node2',parent='parent',position={x=4,y=5,note='authored'}}`);
	f.select('child'); const world = f.context.captureReparent('keep_world');
	assert.ok(world === undefined || world.choices.every(choice => choice.parent !== undefined));
	assert.ok(f.context.captureReparent('keep_local')!.choices.some(choice => choice.parent === undefined));
	f.select('parent'); assert.equal(f.context.canRemoveSelectedMember(), false);
	assert.equal(f.model.buffer.getText(), f.source); assert.equal(f.model.canUndo, false);
});

for (const [definition, field] of [['inherited', ''], ['inherited', ',position=nil'], ['inherited3', ''], ['inherited3', ',position=nil']] as const)
	test(`${definition} ${field || 'implicit position'} changes only the selected inherited axis`, t => {
		const prefabs = PREFABS + "\nprefab.define({def_id='inherited3',class=object_3d,position={x=7,y=9,z=11}})";
		const f = fixture(t, `{member_id='child',definition_id='${definition}'${field}}`, '', prefabs);
		f.select('child'); const request = f.context.captureLocalPosition()!;
		assert.equal(request.apply('x', 5), true);
		const selected = f.select('child'); assert.equal(selected.kind, 'object');
		assert.ok(selected.position?.value.kind === LuaSyntaxKind.TableConstructorExpression);
		assert.ok(findNamedLuaTableField(selected.position.value, 'x'));
		assert.equal(findNamedLuaTableField(selected.position.value, 'y'), null);
		assert.equal(findNamedLuaTableField(selected.position.value, 'z'), null);
		const provider = resolveLuaTextFileModel(f.models, f.sources.catalog,
			f.sources.catalog.resolveResource({ contextId: f.resource.contextId, path: 'prefabs.lua' })!);
		const target = definition === 'inherited3' ? 'x=7,y=9,z=11' : 'x=7,y=9';
		const replacement = definition === 'inherited3' ? 'x=7,y=19,z=21' : 'x=7,y=19';
		const offset = provider.buffer.getText().indexOf(target);
		provider.pushEditOperations([{ offset, deleteLength: target.length, text: replacement }]);
		f.select('child'); const pose = f.context.selectedLocalTransform!;
		assert.equal(pose.ox, 5); assert.equal(pose.oy, 19);
		if (definition === 'inherited3') { assert.equal(pose.family, '3d'); if (pose.family === '3d') assert.equal(pose.oz, 21); }
		f.model.undo(); assert.equal(f.model.buffer.getText(), f.source);
	});

test('semantic placement derives dimension from actual class lineage and keeps ordinary fields separate', t => {
	const f = fixture(t, `
 {member_id='child',definition_id='node2',parent='parent',position={x=12.25,y=-3.5},rotation=.25,scale={x=-2,y=3},skew=.5,options={health=7}},
 {member_id='parent',definition_id='node2'},
 {member_id='mesh',definition_id='node3',position={x=30,y=40,z=50}},
 {member_id='computed',definition_id='node2',position=build_position()},
 {member_id='logic',definition_id='logic',position={x=1,y=2}},`);
	const projection = new SceneDetailsProjection(f.context);
	f.select('child'); projection.refresh();
	assert.deepEqual(projection.subject!.properties.map(property => property.value), [12.25, -3.5]);
	assert.deepEqual(projection.subject!.optionProperties.map(property => property.label), ['health']);
	assert.equal(f.context.selectedLocalTransform!.family, '2d');
	f.select('mesh'); projection.refresh();
	assert.deepEqual(projection.subject!.properties.map(property => property.value), [30, 40, 50]);
	for (const id of ['computed', 'logic']) { f.select(id); projection.refresh(); assert.equal(projection.subject!.properties.length, 0); }
	assert.equal(f.model.buffer.getText(), f.source); assert.equal(f.model.canUndo, false);
});

test('numeric position edits preserve exact parent, rotation, scale and comments in one shared document Undo', t => {
	const f = fixture(t, `{member_id='child',definition_id='node2',parent='parent',
 position={x=(12.25),y=-3.5}, -- placement stays
 rotation=.25,scale={x=-2,y=3},skew=.5,options={health=7}},
 {member_id='parent',definition_id='node2'}`);
	f.select('child'); const request = f.context.captureLocalPosition()!;
	assert.equal(request.apply('x', -125), true);
	assert.equal(f.model.buffer.getText(), f.source.replace('12.25', '-125'));
	f.model.undo(); assert.equal(f.model.buffer.getText(), f.source); assert.equal(f.model.canUndo, false);
});

test('Delete Member materializes exact sheared survivor poses before editing the parent and leaves descendants attached', t => {
	const f = fixture(t, `
 -- child documentation stays
 {member_id='child',definition_id='node2',parent='obsolete',parent='parent',
 transform={xx=1,xy=0,yx=2,yy=-1,ox=6,oy=7},options={team='blue'}},
 {member_id='ancestor',definition_id='node2',transform={xx=2,xy=0,yx=1,yy=3,ox=10,oy=20}},
 {member_id='parent',definition_id='node2',parent='ancestor',transform={xx=0,xy=1,yx=-1,yy=0,ox=4,oy=5}},
 {member_id='sibling',definition_id='node2',parent='parent',position={x=1,y=2}},
 {member_id='leaf',definition_id='node2',parent='child',position={x=8,y=9}},`);
	const before = f.documents.get(f.model), beforeScene = before.scenes[0];
	const read = f.documents.getSpatialProjection(f.model, before)!.readScene(before, beforeScene);
	const expected = new Map(read.entries.map(entry => [stringLiteralValue(entry.memberId), read.worlds.get(entry)]));
	f.select('parent'); const projection = t.mock.method(SceneSpatialProjection.prototype, 'memberRemovalEdits');
	assert.equal(f.context.canRemoveSelectedMember(), true);
	const admitted = projection.mock.calls[0].result;
	for (let index = 0; index < 20; index++) assert.equal(f.context.canRemoveSelectedMember(), true);
	assert.ok(projection.mock.calls.every(call => call.result === admitted));
	let changes = 0; t.after(f.model.onDidChangeContent(() => changes++));
	assert.equal(f.context.removeSelectedMember(), true); assert.equal(changes, 1);
	f.select('child'); assert.deepEqual(f.context.selectedLocalTransform, expected.get('child'));
	const next = f.documents.get(f.model), nextScene = next.scenes[0], nextRead = f.documents.getSpatialProjection(f.model, next)!.readScene(next, nextScene);
	assert.deepEqual(nextScene.objects.map(entry => entry.kind === 'object' ? stringLiteralValue(entry.memberId) : undefined), ['child', 'ancestor', 'sibling', 'leaf']);
	for (const entry of nextRead.entries) assert.deepEqual(nextRead.worlds.get(entry), expected.get(stringLiteralValue(entry.memberId)));
	assert.ok(f.model.buffer.getText().includes("options={team='blue'}"));
	assert.ok(f.model.buffer.getText().includes('-- child documentation stays'));
	f.model.undo(); assert.equal(f.model.buffer.getText(), f.source); assert.equal(f.model.canUndo, false);
});

test('3D survivor detachment retains shear and a singular child without requiring any inverse', t => {
	const f = fixture(t, `{member_id='child',definition_id='node3',parent='parent',
 transform={xx=2,xy=0,xz=0,yx=0,yy=0,yz=0,zx=2,zy=1,zz=-1,ox=4,oy=5,oz=6}},
 {member_id='parent',definition_id='node3',transform={xx=1,xy=0,xz=0,yx=2,yy=-1,yz=0,zx=0,zy=3,zz=0,ox=10,oy=20,oz=30}}`);
	const document = f.documents.get(f.model), scene = document.scenes[0], read = f.documents.getSpatialProjection(f.model, document)!.readScene(document, scene);
	const expected = read.worlds.get(read.entries[0]);
	f.select('parent'); assert.equal(f.context.removeSelectedMember(), true);
	const child = f.select('child'); assert.equal(child.kind, 'object');
	assert.deepEqual(f.context.selectedLocalTransform, expected);
	f.model.undo(); assert.equal(f.model.buffer.getText(), f.source);
});

test('inherited semantic defaults stay source-owned and consumer overrides follow the current provider generation', t => {
	const f = fixture(t, `{member_id='child',definition_id='inherited',parent='parent'},
 {member_id='parent',definition_id='node2'}`);
	f.select('child'); assert.equal(f.context.selectedLocalTransform!.ox, 7);
	const resource = f.sources.catalog.resolveResource({ contextId: f.resource.contextId, path: 'prefabs.lua' })!;
	const provider = resolveLuaTextFileModel(f.models, f.sources.catalog, resource);
	provider.pushEditOperations([{ offset: PREFABS.indexOf('x=7'), deleteLength: 3, text: 'x=11' }]);
	f.select('child'); assert.equal(f.context.selectedLocalTransform!.ox, 11);
	const beforeProvider = provider.buffer.getText();
	assert.equal(f.context.captureLocalPosition()!.apply('y', 13), true);
	assert.equal(provider.buffer.getText(), beforeProvider);
	assert.equal(f.context.selectedLocalTransform!.xx, -2); assert.equal(f.context.selectedLocalTransform!.yy, 3);
	f.model.undo(); assert.equal(f.model.buffer.getText(), f.source);
});

test('shared named affine inputs are borrowed exactly and translation edits only the consuming semantic position', t => {
	const f = fixture(t, `{member_id='first',definition_id='node2',transform=shared},
 {member_id='second',definition_id='node2',transform=shared}`, 'local shared={xx=2,xy=0,yx=1,yy=3,ox=10,oy=20} -- provider stays');
	f.select('first'); assert.equal(f.context.captureLocalPosition()!.apply('x', 17), true);
	f.select('first'); assert.equal(f.context.selectedLocalTransform!.ox, 17);
	assert.ok(f.model.buffer.getText().includes('local shared={xx=2,xy=0,yx=1,yy=3,ox=10,oy=20} -- provider stays'));
	assert.ok(f.model.buffer.getText().includes('transform=shared'));
	f.select('second'); assert.equal(f.context.selectedLocalTransform!.ox, 10);
	f.model.undo(); assert.equal(f.model.buffer.getText(), f.source);
});

test('unavailable affected geometry or parent expressions veto removal without changing canonical bytes', t => {
	for (const child of ["parent='parent',position=compute_position()", 'parent=choose_parent()']) {
		const f = fixture(t, `{member_id='parent',definition_id='node2'}, {member_id='child',definition_id='node2',${child}}`);
		f.select('parent'); assert.equal(f.context.canRemoveSelectedMember(), false);
		assert.equal(f.context.removeSelectedMember(), false); assert.equal(f.model.buffer.getText(), f.source);
	}
});

test('successive member deletions round-trip overflowed affine Numbers through canonical named source', t => {
	const f = fixture(t, `{member_id='parent',definition_id='node2',transform={xx=1e308,xy=0,yx=0,yy=1,ox=0,oy=0}},
 {member_id='child',definition_id='node2',parent='parent',transform={xx=2,xy=0,yx=0,yy=1,ox=0,oy=0}},
 {member_id='leaf',definition_id='node2',parent='child'}`);
	for (const [id, expected] of [['child', [Infinity,0,0,1,0,0]], ['leaf', [Infinity,0,NaN,1,NaN,0]]] as const) {
		f.context.refresh(); const document=f.documents.get(f.model),scene=document.scenes[0];
		f.context.select(document,f.model.version,{kind:'member',scene,entry:scene.objects[0],index:0});
		assert.equal(f.context.removeSelectedMember(),true); f.select(id);
		const local=f.context.selectedLocalTransform!;
		assert.deepEqual([local.xx,local.xy,local.yx,local.yy,local.ox,local.oy],expected);
	}
	f.model.undo(); f.model.undo(); assert.equal(f.model.buffer.getText(),f.source);
});

test('world-preserving reparent can rewrite a transform produced with closed Number encodings', t => {
	const f = fixture(t, `{member_id='parent',definition_id='node2',transform={xx=1e308,xy=0,yx=0,yy=1,ox=0,oy=0}},
 {member_id='child',definition_id='node2',parent='parent',transform={xx=2,xy=0,yx=0,yy=1,ox=0,oy=0}},
 {member_id='target',definition_id='node2',transform={xx=2,xy=0,yx=0,yy=2,ox=0,oy=0}}`);
	f.select('child');
	const initialDetach = f.context.captureReparent('keep_world')!;
	assert.equal(initialDetach.apply(initialDetach.choices.find(choice => choice.parent === undefined)!), true);
	f.select('child'); const before = f.context.selectedLocalTransform!;
	assert.equal(before.xx, Infinity); assert.ok(f.model.buffer.getText().includes('(1 / 0)'));
	const request = f.context.captureReparent('keep_world')!;
	const target = f.select('target'); f.select('child');
	const fresh = f.context.captureReparent('keep_world')!;
	assert.equal(request.apply(request.choices.find(choice => choice.parent === target)!), false, 'selection retirement invalidates the previous request');
	assert.equal(fresh.apply(fresh.choices.find(choice => choice.parent === target)!), true);
	f.select('child'); assert.equal(f.context.selectedLocalTransform!.xx, Infinity);
	const detach = f.context.captureReparent('keep_world')!;
	assert.equal(detach.apply(detach.choices.find(choice => choice.parent === undefined)!), true);
	f.model.undo(); f.model.undo(); f.model.undo();
	assert.equal(f.model.buffer.getText(), f.source); assert.equal(f.model.canUndo, false);
});

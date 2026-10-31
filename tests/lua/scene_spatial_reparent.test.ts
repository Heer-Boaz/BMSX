import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { readFileSync } from 'node:fs';
import { SceneAuthoringContext } from '../../ide/workbench/contrib/scene_editor/authoring_context';
import { SceneSpatialProjection } from '../../ide/workbench/contrib/scene_editor/spatial_projection';
import { relativeAffine2 } from '../../ide/common/affine2';
import { relativeAffine3 } from '../../machine/ts/common/affine3';
import { resolveLuaTextFileModel } from '../../ide/workbench/services/working_copy/text_file_model';
import { stringLiteralValue } from '../../toolchain/ts/lua/syntax/literals';
import { formatLuaNumberExpression } from '../../toolchain/ts/lua/syntax/number_expression';
import { createSceneSourceFixture } from '../helpers/scene_sources';
import { createCartlibProgramHarness } from '../helpers/cartlib_cpu';
import { materializeCpuCompletionValues } from './cpu_test_harness';
import { RunResult } from '../../machine/ts/machine/cpu/cpu';

const PREFABS = `local prefab = require('cartlib/world/prefab')
prefab.define({def_id='node2',class=require('cartlib/world/object_2d')})
prefab.define({def_id='node3',class=require('cartlib/world/object_3d')})
prefab.define({def_id='body',class=require('cartlib/world/object_2d')})`;

function fixture(t: TestContext, objects: string, prefabs = PREFABS) {
	const source = `local scenes = require('cartlib/world/scene_library')\nrequire('prefabs')\nscenes.register('fixture', {objects={\n${objects}\n}})`;
	const f = createSceneSourceFixture(t, source, 'scene.lua', undefined, [['cartlib/world/prefab.lua', 'return { define=function() end }'], ['prefabs.lua', prefabs], ['other.lua', 'return false']]);
	const context = new SceneAuthoringContext(f.model, f.documents); t.after(() => context.dispose());
	const select = (id: string) => {
		const document = f.documents.get(f.model), scene = document.scenes[0];
		const index = scene.objects.findIndex(entry => entry.kind === 'object' && stringLiteralValue(entry.memberId) === id);
		assert.notEqual(index, -1);
		assert.equal(context.select(document, f.model.version, { kind: 'member', scene, entry: scene.objects[index], index }), true);
		return { document, scene, member: scene.objects[index] };
	};
	const values = (id: string) => {
		const { member } = select(id); assert.ok(member.kind === 'object');
		const local=context.selectedLocalTransform!;
		return local.family === '2d' ? [local.xx,local.xy,local.yx,local.yy,local.ox,local.oy]
			: [local.xx,local.xy,local.xz,local.yx,local.yy,local.yz,local.zx,local.zy,local.zz,local.ox,local.oy,local.oz];
	};
	return { ...f, context, source, select, values };
}

test('reparent publishes a full affine and parent as one source edit without prebuilding candidate edits', t => {
	const f = fixture(t, `
 {member_id='child',definition_id='node2',parent='old',position = { x = 2, y = 3 },options={note='untouched'}},
 {member_id='old',definition_id='node2',position = { x = 100, y = 200 }},
 {member_id='target',definition_id='node2',position = { x = 10, y = 20 }},
 {member_id='Scene Root',definition_id='node2'},
 {member_id='leaf',definition_id='node2',parent='child'},`);
	f.select('child');
	const writer = t.mock.method(SceneSpatialProjection.prototype, 'reparentEdits');
	const request = f.context.captureReparent()!; assert.ok(request);
	for (let index = 0; index < 50; index++) assert.equal(f.context.canReparentSelectedMember(), true);
	assert.equal(writer.mock.callCount(), 0, 'command admission does not serialize every possible source edit');
	assert.equal(f.context.captureReparent()!.choices, request.choices, 'cold candidate admission is shared by the source generation');
	assert.ok(!request.choices.some(choice => choice.label === 'child' || choice.label === 'leaf' || choice.label === 'old'));
	const roots = request.choices.filter(choice => choice.label === 'Scene Root');
	assert.equal(roots.length, 2); assert.notEqual(roots[0].description, roots[1].description);
	let changes = 0; t.after(f.model.onDidChangeContent(() => changes++));
	assert.equal(request.apply(request.choices.find(choice => choice.label === 'target')!), true);
	assert.equal(writer.mock.callCount(), 1); assert.equal(changes, 1);
	assert.deepEqual(f.values('child'), [1, 0, 0, 1, 92, 183]);
	assert.ok(f.model.buffer.getText().includes("options={note='untouched'}"));
	assert.equal(request.apply(request.choices[0]), false);
	f.model.undo(); assert.equal(f.model.buffer.getText(), f.source);
});

test('Keep Local admits computed local data and singular parents while class dimensions remain intrinsic', t => {
	const f = fixture(t, `
 {member_id='child',definition_id='node2',transform=build_pose()},
 {member_id='singular',definition_id='node2',transform = { xx = 0, xy = 0, yx = 0, yy = 0, ox = 8, oy = 9 }},
 {member_id='body',definition_id='body'},
 {member_id='mesh',definition_id='node3'},`);
	f.select('child'); assert.equal(f.context.captureReparent(), undefined);
	const local = f.context.captureReparent('keep_local')!;
	assert.ok(!local.choices.some(choice => choice.label === 'mesh'));
	assert.equal(local.apply(local.choices.find(choice => choice.label === 'singular')!), true);
	assert.ok(f.model.buffer.getText().includes('transform=build_pose()'));
	f.select('body'); assert.equal(f.context.canReparentSelectedMember('keep_local'), true);
});

test('3D Keep World preserves singular child affines and detaches without any parent inverse', t => {
	const f = fixture(t, `
 {member_id='child',definition_id='node3',parent='old',transform = { xx = 1, xy = 0, xz = 0, yx = 0, yy = 0, yz = 0, zx = 0, zy = 0, zz = -1, ox = 4, oy = 5, oz = 6 }},
 {member_id='old',definition_id='node3',transform = { xx = 2, xy = 0, xz = 0, yx = 1, yy = -1, yz = 0, zx = 0, zy = 1, zz = 3, ox = 10, oy = 20, oz = 30 }},
 {member_id='target',definition_id='node3',position = { x = 100, y = -20, z = 5 }},
 {member_id='singular',definition_id='node3',transform = { xx = 0, xy = 0, xz = 0, yx = 0, yy = 0, yz = 0, zx = 0, zy = 0, zz = 0, ox = 0, oy = 0, oz = 0 }},`);
	f.select('child'); const request = f.context.captureReparent()!;
	assert.ok(!request.choices.some(choice => choice.label === 'singular'));
	assert.equal(request.apply(request.choices.find(choice => choice.label === 'target')!), true);
	assert.deepEqual(f.values('child'), [2, 0, 0, 0, 0, 0, 0, -1, -3, -77, 41, 43]);
	const detach = f.context.captureReparent()!;
	assert.equal(detach.apply(detach.choices.find(choice => choice.parent === undefined)!), true);
	assert.deepEqual(f.values('child'), [2, 0, 0, 0, 0, 0, 0, -1, -3, 23, 21, 48]);
});

test('captured operations retire on source, selection and semantic dependency changes without writing', t => {
	const f = fixture(t, `{member_id='child',definition_id='node2'}, {member_id='target',definition_id='node2'},`);
	f.select('child'); const request = f.context.captureReparent()!;
	const resource = f.sources.catalog.resolveResource({ contextId: f.resource.contextId, path: 'prefabs.lua' })!;
	const provider = resolveLuaTextFileModel(f.models, f.sources.catalog, resource);
	provider.pushEditOperations([{ offset: 0, deleteLength: 0, text: '-- provider generation\n' }]);
	assert.equal(request.apply(request.choices[0]), false);
	assert.equal(f.model.buffer.getText(), f.source);
	f.select('child'); const rename = f.context.captureRename()!; f.select('target');
	assert.equal(rename.apply('renamed'), false);
	f.select('child'); const edited = f.context.captureReparent()!;
	f.model.pushEditOperations([{ offset: 0, deleteLength: 0, text: '-- source generation\n' }]);
	assert.equal(edited.apply(edited.choices[0]), false);
});

test('hierarchy facts are stable between admitted generations and unknown edges never become roots or siblings', t => {
	const f = fixture(t, `
 {member_id='a',definition_id='node2'},
 {member_id='unknown',definition_id='node2',parent=choose_parent()},
 {member_id='b',definition_id='node2'},
 {member_id='missing',definition_id='node2',parent='absent'},
 {member_id='cycle1',definition_id='node2',parent='cycle2'},
 {member_id='cycle2',definition_id='node2',parent='cycle1'},`);
	const { scene } = f.select('b'); f.context.refresh();
	const parents = f.context.getSpatialParents(scene), generation = f.context.spatialGeneration;
	const admissions = t.mock.method(f.documents, 'get');
	for (let index = 0; index < 100; index++) assert.equal(f.context.getSpatialParents(scene), parents);
	assert.equal(admissions.mock.callCount(), 0, 'row facts do not synchronize source once per Scene per frame');
	assert.equal(parents.size, 2); assert.equal(f.context.canMoveSelectedMember(-1), false);
	const resource = f.sources.catalog.resolveResource({ contextId: f.resource.contextId, path: 'other.lua' })!;
	resolveLuaTextFileModel(f.models, f.sources.catalog, resource).pushEditOperations([{ offset: 7, deleteLength: 5, text: 'true' }]);
	f.context.refresh(); assert.notEqual(f.context.spatialGeneration, generation);
	assert.equal(f.context.getSpatialParents(scene), parents, 'unrelated dependencies preserve published topology identity');
});

test('known rejected incoming edges disable ordinary and subtree deletion instead of leaving invalid source behind', t => {
	for (const definition of ['node3']) {
		const f = fixture(t, `{member_id='parent',definition_id='node2',transform = { xx = 2, xy = 0, yx = 0, yy = 2, ox = 10, oy = 20 }},
 {member_id='child',definition_id='${definition}',parent='parent'},`);
		f.select('parent'); assert.equal(f.context.canRemoveSelectedMember(), false); assert.equal(f.context.canRemoveSelectedSubtree(), false);
		assert.equal(f.context.removeSelectedMember(), false); assert.equal(f.context.removeSelectedSubtree(), false);
		assert.equal(f.model.buffer.getText(), f.source);
	}
});

test('required prefab source proof rejects computed class or pose contributions rather than inventing defaults', t => {
	for (const fields of ["class=choose_class()", "class=require('cartlib/world/object_2d'),[unknown_key()]='3d'", "class=require('cartlib/world/object_2d'),position=build_position()"]) {
		const f = fixture(t, `{member_id='child',definition_id='node2'}, {member_id='target',definition_id='node2'},`,
			`local prefab=require('cartlib/world/prefab')\nprefab.define({def_id='node2',${fields}})`);
		f.select('child'); assert.equal(f.context.canReparentSelectedMember(), false);
		assert.equal(f.model.buffer.getText(), f.source);
	}
});

for (const optLevel of [0, 3] as const) test(`host parent-space solves mirror actual guest scalar order (O${optLevel})`, () => {
	const parent2 = { xx: 2, xy: .25, yx: -1, yy: 3, ox: 1e15, oy: -1e15 };
	const world2 = { xx: .5, xy: 2, yx: -3, yy: 1, ox: 1e15 + 4, oy: -1e15 + 8 };
	const parent3 = { xx: 2, xy: .25, xz: -1, yx: 1, yy: -3, yz: .5, zx: -.5, zy: 1, zz: 4, ox: 1e15, oy: -1e15, oz: 1e14 };
	const world3 = { xx: .5, xy: 2, xz: 1, yx: 0, yy: 0, yz: 0, zx: -3, zy: 1, zz: .25, ox: 1e15 + 4, oy: -1e15 + 8, oz: 1e14 - 2 };
	const result2 = { ...world2 }, result3 = { ...world3 };
	assert.equal(relativeAffine2(result2, result2, parent2), true); assert.equal(relativeAffine3(result3, result3, parent3), true);
	const source = `local a2=require('cartlib/math/affine2') local a3=require('cartlib/math/affine3')
local p2={${Object.entries(parent2).map(([key, value]) => 'w' + key + '=' + formatLuaNumberExpression(value)).join(',')}}
local c2={${Object.entries(world2).map(([key, value]) => 'w' + key + '=' + formatLuaNumberExpression(value)).join(',')}}
local p3={${Object.entries(parent3).map(([key, value]) => 'w' + key + '=' + formatLuaNumberExpression(value)).join(',')}}
local c3={${Object.entries(world3).map(([key, value]) => 'w' + key + '=' + formatLuaNumberExpression(value)).join(',')}}
local r2=a2.relative_world(c2,p2) local r3=a3.relative_world(c3,p3)
return r2,r3,${Object.keys(world2).map(key => 'c2.' + key).join(',')},${Object.keys(world3).map(key => 'c3.' + key).join(',')}`;
	const { cpu } = createCartlibProgramHarness(source, { optLevel, modules: ['cartlib/math/affine2', 'cartlib/math/affine3'].map(path => ({ path, source: readFileSync(path + '.lua', 'utf8') })) });
	assert.equal(cpu.runUntilDepth(0, 20_000_000), RunResult.Halted);
	assert.deepEqual(materializeCpuCompletionValues(cpu), [true, true, ...Object.values(result2), ...Object.values(result3)]);
});

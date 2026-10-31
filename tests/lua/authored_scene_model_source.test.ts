import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test, { type TestContext } from 'node:test';
import { LuaSourceReader } from '../../ide/language/lua/source_reader';
import { SceneAuthoringContext } from '../../ide/workbench/contrib/scene_editor/authoring_context';
import { resolveLuaTextFileModel } from '../../ide/workbench/services/working_copy/text_file_model';
import { createSceneSourceFixture } from '../helpers/scene_sources';

const IMPORTS = `local prefab=require('cartlib/world/prefab')
local models=require('cartlib/component/static_model_component')\n`;

function fixture(t: TestContext, definitions: string, members: string, providers: readonly (readonly [string, string])[] = []) {
	const source = `local scenes=require('cartlib/world/scene_library')
scenes.register('main',{objects={${members}}})`;
	const f = createSceneSourceFixture(t, source, 'scene.lua', undefined, [
		['cartlib/world/prefab.lua', 'return {define=function() end}'],
		['cartlib/component/static_model_component.lua', 'return {new=function() end,factory=function() end}'],
		['cartlib/world/world_object.lua', 'return {}'],
		['prefabs.lua', IMPORTS + definitions], ...providers,
	]);
	const document = f.documents.get(f.model), context = new SceneAuthoringContext(f.model, f.documents,
		{ document, scene: document.scenes[0], sourceVersion: f.model.version });
	t.after(() => context.dispose());
	return { ...f, context, source };
}

test('model construction retains exact occurrence, local inputs and owner x attachment x presentation Number affine', t => {
	const f = fixture(t, `
prefab.define({def_id='parent',class={},spatial={family='3d',authority='affine'}})
prefab.define({def_id='model',class={},spatial={family='3d',authority='affine'},defaults={visible=false},
 components={models.factory({id_local='body',model_id='scene',scene_index=0,enabled=0,visible='',
 attachment_affine={1,1,0,0,1,0,0,0,1,2,3,4},presentation_affine={-1,0,0,2,1,0,0,0,0.5,4,5,6}})}})`, `
 {member_id='child',definition_id='model',spatial={parent_id='parent',local_transform={1,0,0,0,1,0,0,0,1,4,5,6}},
  options={visible=0,active=false,model_id='not-component-config'}},
 {member_id='parent',definition_id='parent',spatial={local_transform={2,0,0,1,3,0,0,0,-2,10,20,30}}}`);
	const read = f.context.visualScene!, model = read.models[0];
	assert.equal(read.models.length, 1); assert.equal(read.sprites.length, 0);
	assert.ok(model.entry === f.context.subject!.objects[0]);
	assert.equal(model.model, 'scene'); assert.equal(model.sceneIndex, 0);
	assert.deepEqual(model.affine, { xx: -3, xy: -3, xz: 0, yx: 7, yy: 9, yz: 0,
		zx: 0, zy: 0, zz: -1, ox: 47, oy: 71, oz: -2 });
	assert.equal(f.context.selection, undefined); assert.equal(f.model.buffer.getText(), f.source); assert.equal(f.model.canUndo, false);
});

test('model factories own static configuration rather than reading gameplay options', t => {
	const f = fixture(t, `
prefab.define({def_id='factory',class={},spatial={family='3d',authority='affine'},
 components={models.factory({id_local='body',model_id='factory',scene_index=3,
 attachment_affine={2,0,0,0,3,0,0,0,4,5,6,7}})}})
prefab.define({def_id='direct',class={},spatial={family='3d',authority='affine'},
 components={models.factory({model_id='direct'})}})
prefab.define({def_id='missing_factory_source',class={},spatial={family='3d',authority='affine'},
 components={models.factory({})}})`, `
 {member_id='nil',definition_id='factory',options={model_id=nil,scene_index=nil,attachment_affine=false}},
 {member_id='false',definition_id='factory',options={model_id=false,scene_index=false}},
 {member_id='direct',definition_id='direct'},
 {member_id='cannot_rescue_factory',definition_id='missing_factory_source',options={model_id='override'}}`);
	const models = f.context.visualScene!.models;
	assert.deepEqual(models.map(model => [model.model, model.sceneIndex]), [['factory', 3], ['factory', 3], ['direct', undefined]]);
	assert.deepEqual(models[0].affine, { xx: 2, xy: 0, xz: 0, yx: 0, yy: 3, yz: 0,
		zx: 0, zy: 0, zz: 4, ox: 5, oy: 6, oz: 7 });
});

test('model aliases and reexports need actual builtin callable identities, not similarly named wrappers', t => {
	const f = fixture(t, `
local bridge=require('model_bridge')
local admitted=bridge.factory({id_local='body',model_id='alias'})
local function factory() return models.factory({model_id='guessed'}) end
prefab.define({def_id='model',class={},spatial={family='3d',authority='affine'},
 components={admitted,bridge.factory({model_id='direct'}),factory()}})`, `{member_id='source',definition_id='model'}`, [
		['model_bridge.lua', "return require('cartlib/component/static_model_component')"],
	]);
	assert.deepEqual(f.context.visualScene!.models.map(model => model.model), ['alias', 'direct']);
});

test('production model component exports retain their authored constructor correspondence without executing resource resolution', t => {
	const f = fixture(t, `
prefab.define({def_id='model',class={},spatial={family='3d',authority='affine'},
 components={models.new,models.factory({id_local='body',model_id='factory',scene_index=0})}})`,
		`{member_id='source',definition_id='model'}`, [
			['cartlib/component/static_model_component.lua', readFileSync('cartlib/component/static_model_component.lua', 'utf8')],
		]);
	assert.deepEqual(f.context.visualScene!.models.map(model => [model.model, model.sceneIndex]), [['factory', 0]]);
});

test('model profiles ignore unrelated gameplay options while dynamic owner visibility and unresolved factories remain unavailable', t => {
	const f = fixture(t, `
prefab.define({def_id='model',class={},spatial={family='3d',authority='affine'},components={models.factory({model_id='factory'})}})
prefab.define({def_id='unknown_id',class={},spatial={family='3d',authority='affine'},components={models.factory({model_id='factory',id_local=choose()})}})
prefab.define({def_id='unknown_default',class={},spatial={family='3d',authority='affine'},components={models.factory({model_id=choose()})}})
prefab.define({def_id='duplicate',class={},spatial={family='3d',authority='affine'},components={models.new}})
prefab.define({def_id='duplicate',class={},spatial={family='3d',authority='affine'},components={models.new}})`, `
 {member_id='dynamic_model',definition_id='model',options={model_id=choose()}},
 {member_id='dynamic_scene',definition_id='model',options={scene_index=choose()}},
 {member_id='dynamic_inputs',definition_id='model',options=choose()},
 {member_id='dynamic_attachment',definition_id='model',options={attachment_affine=choose()}},
 {member_id='dynamic_presentation',definition_id='model',options={presentation_affine=choose()}},
 {member_id='wrong_family',definition_id='model',options={attachment_affine={1,0,0,1,0,0}}},
 {member_id='unknown_keys',definition_id='model',options={[choose()]=false}},
 {member_id='dynamic_options',definition_id='model',options=choose()},
 {member_id='unknown_id',definition_id='unknown_id'},
 {member_id='unknown_default',definition_id='unknown_default',options={model_id='override'}},
 {member_id='duplicate',definition_id='duplicate',options={model_id='duplicate'}},
 {member_id='proved',definition_id='model'}`);
	const models = f.context.visualScene!.models;
	assert.deepEqual(models.map(model => f.context.subject!.objects.indexOf(model.entry)), [0, 1, 3, 4, 5, 8, 11]);
	assert.equal(models[0].sceneIndex, undefined);
});

test('model owner options, defaults and class visibility share component nil-only visibility semantics', t => {
	const f = fixture(t, `
prefab.define({def_id='hidden',class={visible=false},spatial={family='3d',authority='affine'},
 components={models.factory({model_id='hidden'})}})
prefab.define({def_id='visible',class={visible=0},base={visible=false},spatial={family='3d',authority='affine'},
 components={models.factory({model_id='visible'})}})
prefab.define({def_id='defaults',class={visible=false},defaults={visible=true},spatial={family='3d',authority='affine'},
 components={models.factory({model_id='defaults',enabled=false,visible=false})}})
prefab.define({def_id='unknown',class={},base=unknown,spatial={family='3d',authority='affine'},
 components={models.factory({model_id='unknown'})}})`, `
 {member_id='class_hidden',definition_id='hidden'},
 {member_id='class_visible',definition_id='visible'},
 {member_id='options_show',definition_id='hidden',options={visible=''}},
 {member_id='options_hide',definition_id='visible',options={visible=false}},
 {member_id='disabled',definition_id='defaults'},
 {member_id='false_enabled',definition_id='visible',options={enabled=false}},
 {member_id='false_visible',definition_id='visible',options={visible=false}},
 {member_id='truthy',definition_id='defaults',options={enabled=0,visible=''}},
 {member_id='unknown_inheritance',definition_id='unknown'},
 {member_id='known_override',definition_id='unknown',options={visible=true}}`);
	const scene = f.context.subject!;
	assert.deepEqual(f.context.visualScene!.models.map(model => scene.objects.indexOf(model.entry)), [1, 2, 5, 9]);
});

test('replaced model constructor members and prefab registration cannot grant builtin source correspondence', t => {
	for (const replacement of [
		'models.new=function(context) return {} end',
		'models.factory=function(definition) return function(context) return {} end end',
		'models[key()]=function() return {} end',
		'prefab.define=function(definition) return definition end',
	]) {
		const f = fixture(t, `${replacement}
prefab.define({def_id='model',class={},spatial={family='3d',authority='affine'},
 components={models.new,models.factory({model_id='factory'})}})`, `{member_id='source',definition_id='model'}`);
		assert.deepEqual(f.context.visualScene!.models.map(model => model.model), []);
	}
});

test('model visual source generations remain retained and preserve canonical source and exact occurrences', t => {
	const f = fixture(t, `prefab.define({def_id='model',class={},spatial={family='3d',authority='affine'},
 components={models.factory({model_id='before'})}})`, `{member_id='source',definition_id='model'}`);
	const before = f.context.visualScene!, calls = t.mock.method(LuaSourceReader.prototype, 'call');
	for (let frame = 0; frame < 100; frame++) assert.ok(f.context.visualScene === before);
	assert.equal(calls.mock.callCount(), 0, 'steady reads reuse admitted model records');
	const resource = f.sources.catalog.resolveResource({ contextId: f.resource.contextId, path: 'prefabs.lua' })!;
	const provider = resolveLuaTextFileModel(f.models, f.sources.catalog, resource);
	provider.pushEditOperations([{ offset: provider.buffer.getText().indexOf('before'), deleteLength: 6, text: 'after' }]);
	f.context.refresh(); const after = f.context.visualScene!;
	assert.notEqual(after, before); assert.equal(after.models[0].model, 'after'); assert.equal(before.models[0].model, 'before');
	assert.ok(after.models[0].entry === before.models[0].entry);
	assert.equal(f.model.buffer.getText(), f.source); assert.equal(f.model.canUndo, false);
	const unbound = new SceneAuthoringContext(f.model, f.documents); t.after(() => unbound.dispose());
	const document = f.documents.get(f.model), scene = document.scenes[0];
	unbound.select(document, f.model.version, { kind: 'scene', scene });
	assert.equal(unbound.visualScene, undefined);
	f.context.dispose(); assert.equal(f.context.visualScene, undefined);
});

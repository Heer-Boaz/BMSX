import assert from 'node:assert/strict';
import test from 'node:test';
import { SceneAuthoringContext } from '../../ide/workbench/contrib/scene_editor/authoring_context';
import { createSceneSourceFixture } from '../helpers/scene_sources';

test('Scene placement cannot edit through a falsely fixed class prototype', t => {
	for (const construction of [
		`local class={}; setmetatable(class,{__index=object2})
local target=external and class or {}; setmetatable(target,{__index=object3})`,
		`local class={}; if external then setmetatable(class,{__index=object2}) end`,
		`local class={}; local function never() setmetatable(class,{__index=object2}) end`,
		`local mt={}; local function never() mt.__index=object2 end
local class={}; setmetatable(class,mt)`,
	]) {
		const source = `local scenes=require('cartlib/world/scene_library')
scenes.register('fixture',{objects={
 {member_id='parent',definition_id='node'},
 {member_id='child',definition_id='node',parent='parent',position={x=4,y=5}},
}})`;
		const prefabs = `local prefab=require('cartlib/world/prefab')
local object2=require('cartlib/world/object_2d')
local object3=require('cartlib/world/object_3d')
${construction}
prefab.define({def_id='node',class=class})`;
		const f = createSceneSourceFixture(t, source, 'scene.lua', undefined, [
			['cartlib/world/prefab.lua', 'return {define=function() end}'], ['prefabs.lua', prefabs],
		]);
		const context = new SceneAuthoringContext(f.model, f.documents);
		t.after(() => context.dispose());
		const document = f.documents.get(f.model), scene = document.scenes[0];
		context.select(document, f.model.version, { kind: 'member', scene, entry: scene.objects[1], index: 1 });
		assert.equal(context.selectedLocalTransform, undefined, construction);
		assert.equal(context.captureLocalPosition(), undefined, construction);
		assert.equal(context.canReparentSelectedMember('keep_world'), false, construction);
		assert.equal(context.captureReparent('keep_world'), undefined, construction);
		assert.equal(f.model.buffer.getText(), source);
		assert.equal(f.model.canUndo, false);
	}
});

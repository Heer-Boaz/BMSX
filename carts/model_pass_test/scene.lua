local prefab<const> = require('cartlib/world/prefab')
local scenes<const> = require('cartlib/world/scene_library')
local model<const> = require('cartlib/component/static_model_component')
local camera<const> = require('cartlib/component/model_renderer_component')

prefab.define({def_id='model_pass.group',class={},spatial={family='3d',authority='affine'}})
prefab.define({def_id='model_pass.mesh',class={},spatial={family='3d',authority='affine'},
	components={model.factory({model_id='fixture'})}})
prefab.define({def_id='model_pass.camera',class={},spatial={family='3d',authority='affine'},
	components={camera.new}})

scenes.register('model_pass.fixture',{name='Static models',launchable=true,objects={
	{member_id='assembly',definition_id='model_pass.group'},
	{member_id='left',definition_id='model_pass.mesh',spatial={parent_id='assembly',
		local_transform={0.5,0,-0.8660254037844386,0,1,0,0.8660254037844386,0,0.5,-1.4,0,0}}},
	{member_id='right',definition_id='model_pass.mesh',spatial={parent_id='assembly',
		local_transform={-0.5,0,-0.8660254037844386,0,1,0,-0.8660254037844386,0,0.5,1.4,0,0}}},
	{member_id='camera',definition_id='model_pass.camera',spatial={
		local_transform={1,0,0,0,1,0,0,0,1,0,0,5}}},
}})

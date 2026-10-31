local object_3d<const> = require('cartlib/world/object_3d')
local prefab<const> = require('cartlib/world/prefab')
local scenes<const> = require('cartlib/world/scene_library')
local model<const> = require('cartlib/component/static_model_component')
local camera<const> = require('cartlib/component/model_renderer_component')

prefab.define({ def_id = 'model_pass.group', class = object_3d })
prefab.define({ def_id = 'model_pass.mesh', class = object_3d,
	components = { model.factory({ model_id = 'fixture' }) } })
prefab.define({ def_id = 'model_pass.camera', class = object_3d,
	components = { camera.new } })

scenes.register('model_pass.fixture', {
	name = 'Static models', launchable = true,
	objects = {
		{ member_id = 'assembly', definition_id = 'model_pass.group' },
		{
			member_id = 'left', definition_id = 'model_pass.mesh', parent = 'assembly',
			position = { x = -1.4 },
			rotation = { x = 0, y = 0.5, z = 0, w = 0.8660254037844386 },
		},
		{
			member_id = 'right', definition_id = 'model_pass.mesh', parent = 'assembly',
			position = { x = 1.4 },
			rotation = { x = 0, y = -0.5, z = 0, w = 0.8660254037844386 },
			scale = { x = -1 },
		},
		{ member_id = 'camera', definition_id = 'model_pass.camera', position = { z = 5 } },
	},
})

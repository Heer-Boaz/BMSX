local prefab<const> = require('cartlib/world/prefab')
local object_3d<const> = require('cartlib/world/object_3d')
local model<const> = require('cartlib/component/static_model_component')
local camera<const> = require('cartlib/component/model_renderer_component')
local scenes<const> = require('cartlib/world/scene_library')

prefab.define({ def_id = 'studio_test.textured', class = object_3d,
	components = { model.factory({ model_id = 'studio_test_textured' }) } })
prefab.define({ def_id = 'studio_test.camera', class = object_3d,
	components = { camera.factory({ width = 256, height = 192, focal_length = 128, near = 1 }) } })

scenes.register('studio_test.textured', { objects = {
	{ member_id = 'panels', definition_id = 'studio_test.textured' },
	{ member_id = 'camera', definition_id = 'studio_test.camera' },
} })

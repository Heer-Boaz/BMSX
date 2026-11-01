local prefab<const> = require('cartlib/world/prefab')
local object_3d<const> = require('cartlib/world/object_3d')
local model<const> = require('cartlib/component/static_model_component')
local scenes<const> = require('cartlib/world/scene_library')

prefab.define({ def_id = 'studio_test.mesh', class = object_3d,
	components = { model.factory({ model_id = 'studio_test_mesh' }) } })

scenes.register('studio_test.space', { objects = {} })

local custom_visual_component<const> = require('cartlib/component/custom_visual_component')
local prefab<const> = require('cartlib/world/prefab')

local scene<const> = {}
scene.__index = scene

scene.definition_id = 'studio.conformance.object'

local draw_scene_object<const> = function(comp, draw)
	local obj<const> = comp.parent
	draw:rect(obj.x, obj.y, obj.x + obj.sx, obj.y + obj.sy, 0xff315b8a)
end

local new_scene_visual<const> = custom_visual_component.factory({
	id_local = 'body',
	draw = draw_scene_object,
	edit_area = { left = 0, top = 0, right = 48, bottom = 32 },
})

function scene.register()
	prefab.define({
		def_id = scene.definition_id,
		class = scene,
		components = { new_scene_visual },
		defaults = { sx = 48, sy = 32 },
	})
end

return scene

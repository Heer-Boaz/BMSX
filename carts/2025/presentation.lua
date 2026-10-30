local prefab<const> = require('cartlib/world/prefab')
local sprite_object<const> = require('cartlib/sprite')
local text_object<const> = require('cartlib/text/text_object')
local surface_component<const> = require('cartlib/component/surface_component')
local rectangle_component<const> = require('cartlib/component/rectangle_component')
local overlay_component<const> = require('overlay_component')

local presentation<const> = {
	sprite = 'p3.sprite', text = 'p3.text', surface = 'p3.surface',
	rectangle = 'p3.rectangle', overlay = 'p3.overlay',
}
local surface<const> = {}
local rectangle<const> = {}
local overlay<const> = {}
local spatial<const> = {
	family = '2d', authority = 'affine', local_transform = { 1, 0, 0, 1, 0, 0 },
}

function presentation.register()
	prefab.define({ def_id = presentation.sprite, class = sprite_object, base = sprite_object, spatial = spatial })
	prefab.define({ def_id = presentation.text, class = text_object, base = text_object, spatial = spatial })
	prefab.define({ def_id = presentation.surface, class = surface, spatial = spatial,
		components = { surface_component.new } })
	prefab.define({ def_id = presentation.rectangle, class = rectangle, spatial = spatial,
		components = { rectangle_component.new } })
	prefab.define({ def_id = presentation.overlay, class = overlay, spatial = spatial,
		components = { overlay_component.new } })
end

return presentation

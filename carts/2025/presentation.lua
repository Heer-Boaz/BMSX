local object_2d<const> = require('cartlib/world/object_2d')
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
setmetatable(surface, { __index = object_2d })
local rectangle<const> = {}
setmetatable(rectangle, { __index = object_2d })
local overlay<const> = {}
setmetatable(overlay, { __index = object_2d })

function surface:ctor()
	self:get_component(surface_component).visible = true
end

function rectangle:ctor()
	self:get_component(rectangle_component).visible = true
end

function presentation.register()
	prefab.define({ def_id = presentation.sprite, class = sprite_object })
	prefab.define({ def_id = presentation.text, class = text_object })
	prefab.define({ def_id = presentation.surface, class = surface,
		components = { function(owner) return surface_component.new(owner, owner) end } })
	prefab.define({ def_id = presentation.rectangle, class = rectangle,
		components = { function(owner) return rectangle_component.new(owner, owner) end } })
	prefab.define({ def_id = presentation.overlay, class = overlay,
		components = { overlay_component.new } })
end

return presentation

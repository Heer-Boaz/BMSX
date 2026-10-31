local prefab<const> = require('cartlib/world/prefab')
local map_visual<const> = require('map_visual_component')
local map_widget<const> = {}

function map_widget:ctor()
	self.visual = self:get_component(map_visual)
	self.visual.visible = true
end

function map_widget.register()
	prefab.define({ def_id = 'pietious.map', class = map_widget,
		spatial = { family = '2d', authority = 'affine' },
		components = { map_visual.new }, defaults = { visible = false } })
end

return map_widget

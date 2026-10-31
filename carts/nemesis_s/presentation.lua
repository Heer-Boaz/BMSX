local object_2d<const> = require('cartlib/world/object_2d')
-- Reusable visual-only prefabs. Scenes supply images, layout and dimensions;
-- the presentation controller supplies timing. Neither prefab has an update.
local rectangle_component<const> = require('cartlib/component/rectangle_component')
local prefab<const> = require('cartlib/world/prefab')
local sprite_object<const> = require('cartlib/sprite')

local presentation<const> = {
	sprite_definition_id = 'nemesis_s.presentation.sprite',
	cover_definition_id = 'nemesis_s.presentation.cover',
}
local cover<const> = {}
setmetatable(cover, { __index = object_2d })

function cover:ctor()
	self.visual = self:get_component(rectangle_component)
	self.visual.visible = true
end

function presentation.register()
	prefab.define({
		def_id = presentation.sprite_definition_id,
		class = sprite_object,
	})
	prefab.define({
		def_id = presentation.cover_definition_id,
		class = cover,
		components = { function(owner) return rectangle_component.new(owner, owner) end },
	})
end

return presentation

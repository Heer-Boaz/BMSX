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

function cover:ctor()
	self.visual = self:get_component(rectangle_component)
end

function presentation.register()
	prefab.define({
		def_id = presentation.sprite_definition_id,
		class = sprite_object,
		spatial = { family = '2d', authority = 'affine' },
	})
	prefab.define({
		def_id = presentation.cover_definition_id,
		class = cover,
		spatial = { family = '2d', authority = 'affine' },
		components = { rectangle_component.new },
	})
end

return presentation

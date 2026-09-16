-- Reusable visual-only prefabs. Scenes supply images, layout and dimensions;
-- the presentation controller supplies timing. Neither prefab has an update.
local custom_visual_component<const> = require('cartlib/component/custom_visual_component')
local prefab<const> = require('cartlib/world/prefab')
local sprite_object<const> = require('cartlib/sprite')

local presentation<const> = {
	sprite_definition_id = 'nemesis_s.presentation.sprite',
	cover_definition_id = 'nemesis_s.presentation.cover',
}
local sprite<const> = {}
local cover<const> = {}

local draw_cover<const> = function(component, draw)
	local owner<const> = component.parent
	local x<const> = owner.x + component.offset_x
	local y<const> = owner.y + component.offset_y
	draw:rect(x, y, x + owner.sx, y + owner.sy, owner.color)
end

function cover:ctor()
	self.visual = self:get_component(custom_visual_component, 'cover')
end

function presentation.register()
	prefab.define({
		def_id = presentation.sprite_definition_id,
		class = sprite,
		base = sprite_object,
	})
	prefab.define({
		def_id = presentation.cover_definition_id,
		class = cover,
		components = {
			custom_visual_component.factory({ id_local = 'cover', draw = draw_cover }),
		},
	})
end

return presentation

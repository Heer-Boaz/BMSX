-- A sprite object is the small world-object composition that owns one primary
-- sprite component. Collision remains an explicit, independently scheduled
-- component; visual-only objects therefore never enter collision storage.

local world_object<const> = require('cartlib/world/world_object')
local sprite_component<const> = require('cartlib/component/sprite_component')

local sprite_object<const> = {}
sprite_object.__index = sprite_object
-- Sprite subclasses may replace the primary visual constructor once at class
-- definition time. Initialization still owns exactly one primary component;
-- render and animation lanes therefore consume their normal retained types
-- without a per-frame visual-mode branch.
sprite_object.primary_sprite_factory = sprite_component.new
setmetatable(sprite_object, { __index = world_object })

local base_sprite_id<const> = 'base_sprite'

function sprite_object.initialize(self)
	local sprite<const> = self.primary_sprite_factory(self, nil, base_sprite_id)
	self.sprite_component = sprite
	-- Whole-object visibility belongs to WorldObject, not this component's
	-- independently writable visibility. Project only primary visual inputs.
	if sprite.frame_sources == nil and self.imgid ~= nil then
		sprite:set_imgid(self.imgid)
	end
	if sprite.animations ~= nil and self.animation ~= nil then
		sprite:set_animation(self.animation)
	end
	if self.order ~= nil then sprite:set_order(self.order or 0) end
	if self.presentation_order ~= nil then sprite:set_presentation_order(self.presentation_order or 0) end
	if self.color ~= nil then sprite.color = self.color or 0xffffffff end
	if self.flip_h ~= nil then sprite.flip_h = self.flip_h end
	if self.flip_v ~= nil then sprite.flip_v = self.flip_v end
	local region<const> = self.region
	if region then sprite:set_region(region.x, region.y, region.width, region.height) end
	local attachment<const> = self.attachment_affine
	if attachment then
		sprite:set_attachment_affine(attachment[1], attachment[2], attachment[3], attachment[4], attachment[5], attachment[6])
	end
	local presentation<const> = self.presentation_affine
	if presentation then
		sprite:set_presentation_affine(presentation[1], presentation[2], presentation[3], presentation[4], presentation[5], presentation[6])
	end
	self:add_component(sprite)
end

return sprite_object

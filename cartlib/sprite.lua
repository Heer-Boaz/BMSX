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
-- without a per-object visual-mode branch.
sprite_object.primary_sprite_factory = sprite_component.new
setmetatable(sprite_object, { __index = world_object })

local base_sprite_id<const> = 'base_sprite'

function sprite_object.initialize(self, context)
	self.sprite_component = self.primary_sprite_factory(context, base_sprite_id)

	self:add_component(self.sprite_component)
end

return sprite_object

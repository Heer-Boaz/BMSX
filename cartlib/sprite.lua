-- A sprite object is the small world-object composition that owns one primary
-- sprite component. Collision remains an explicit, independently scheduled
-- component; visual-only objects therefore never enter collision storage.

local world_object<const> = require('cartlib/world/world_object')
local sprite_component<const> = require('cartlib/component/sprite_component')

local sprite_object<const> = {}
sprite_object.__index = sprite_object
setmetatable(sprite_object, { __index = world_object })

local base_sprite_id<const> = 'base_sprite'

function sprite_object.initialize(self)
	world_object.initialize(self)

	self.sprite_component = sprite_component.new({
		imgid = self.imgid,
		id_local = base_sprite_id,
	})

	self:add_component(self.sprite_component)
	if self.imgid ~= nil then
		self.sx = self.sprite_component.source_width
		self.sy = self.sprite_component.source_height
	end
end

-- Sets the sprite component's semantic image id and updates the object's size
-- from the resolved image owned by that component.
function sprite_object:set_imgid(id)
	if not self.sprite_component:set_imgid(id) then
		return
	end
	if id == nil then
		return
	end
	self.sx = self.sprite_component.source_width
	self.sy = self.sprite_component.source_height
end

return sprite_object

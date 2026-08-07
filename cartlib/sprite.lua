-- spriteobject built atop worldobject
--
-- DESIGN PRINCIPLES — image suffixes and collision geometry
--
-- 1. THE @cx / @cc FILENAME SUFFIX IS HOW POLYGON COLLISION IS ENABLED.
--    rombuilder strips it from the final ROM id but processes it at pack-time:
--
--      @cx  — bakes a CONVEX hull polygon (one polygon; fast, recommended default)
--      @cc  — bakes a tighter multi-piece convex fit (multiple polygons; slower)
--      none — AABB only (a rectangle from the image's sx/sy; cheapest)
--
--    Examples:
--      player.png          → AABB collision only
--      player@cx.png       → convex polygon; ROM id becomes 'player'
--      player@cc.png       → concave polygons; ROM id becomes 'player'
--
--    WRONG — no suffix, expecting polygon collision:
--      self:set_imgid('enemy')           -- AABB only, regardless of sprite shape!
--
--    RIGHT — convex hull suffix:
--      self:set_imgid('enemy')           -- image file is 'enemy@cx.png' at pack-time
--
-- 2. COLLISION IS DERIVED LAZILY FROM THE SPRITE METADATA.
--    When set_imgid(id) is called, the packed collision geometry is later
--    read directly by the linked collider2dcomponent when collision code asks
--    for the current shape.
--    No extra setup is needed in cart code — just ensure a collider2dcomponent
--    exists on the object.
--
-- 3. COLLISION LAYERS: carts program the collider's raw layer and mask words.
--      self:set_imgid('enemy')
--      self.collider.layer = collision_enemy_layer
--      self.collider.mask = collision_enemy_mask

local worldobject<const> = require('cartlib/world/worldobject')
local collider2dcomponent<const> = require('cartlib/collision/collider2dcomponent')
local spritecomponent<const> = require('cartlib/component/spritecomponent')

local spriteobject<const> = {}
spriteobject.__index = spriteobject
setmetatable(spriteobject, { __index = worldobject })

local base_sprite_id<const> = 'base_sprite'
local primary_collider_id<const> = 'primary'

function spriteobject.new(opts)
	local self<const> = setmetatable(worldobject.new(opts), spriteobject)

	self.sprite_component = spritecomponent.new({
		imgid = opts.imgid,
		id_local = base_sprite_id,
	})
	self.collider = collider2dcomponent.new({ id_local = primary_collider_id })

	self:add_component(self.sprite_component)
	self:add_component(self.collider)
	self.collider:set_sprite(self.sprite_component)
	if opts.imgid ~= nil then
		self.sx = self.sprite_component.source_width
		self.sy = self.sprite_component.source_height
	end

	return self
end

-- Sets the sprite component's semantic image id and updates the object's size
-- from the resolved image owned by that component.
function spriteobject:set_imgid(id)
	if not self.sprite_component:set_imgid(id) then
		return
	end
	if id == nil then
		return
	end
	self.sx = self.sprite_component.source_width
	self.sy = self.sprite_component.source_height
end

return spriteobject

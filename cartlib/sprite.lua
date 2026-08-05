-- sprite_object built atop world_object
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
--      self:gfx('enemy')           -- AABB only, regardless of sprite shape!
--
--    RIGHT — convex hull suffix:
--      self:gfx('enemy')           -- image file is 'enemy@cx.png' at pack-time
--
-- 2. COLLISION IS DERIVED LAZILY FROM THE SPRITE METADATA.
--    When gfx(id) is called, imgmeta.hitpolygons (baked by rombuilder) is later
--    read directly by the linked collider_2d_component when collision code asks
--    for the current shape.
--    No extra setup is needed in cart code — just ensure a collider_2d_component
--    exists on the object before gfx() is called.
--
-- 3. COLLISION LAYERS: carts program the collider's raw layer and mask words.
--      self:gfx('enemy')
--      self.collider.layer = collision_enemy_layer
--      self.collider.mask = collision_enemy_mask

local world_object<const> = require('cartlib/world/object')
local collider_2d_component<const> = require('cartlib/collision/collider_2d_component')
local sprite_component<const> = require('cartlib/render/sprite_component')
local romdir<const> = require('cartlib/romdir')

local sprite_object<const> = {}
sprite_object.__index = sprite_object
setmetatable(sprite_object, { __index = world_object })

sprite_object.base_sprite_id = 'base_sprite'
sprite_object.primary_collider_id = 'primary'

local apply_image_metadata<const> = function(self, id)
	local record<const> = romdir.image(id)
	if record == nil then
		error('Image ROM entry "' .. tostring(id) .. '" not found.')
	end
	local meta<const> = record.imgmeta
	self.sx = meta.width
	self.sy = meta.height
end

function sprite_object.new(opts)
	opts = opts or {}
	opts.type_name = 'sprite_object'
	local self<const> = setmetatable(world_object.new(opts), sprite_object)
	self.flip_h = false
	self.flip_v = false
	self.imgid = opts.imgid

	self.sprite_component = sprite_component.new({
		imgid = self.imgid,
		id_local = sprite_object.base_sprite_id,
	})
	self.collider = collider_2d_component.new({ id_local = sprite_object.primary_collider_id })

	self:add_component(self.sprite_component)
	self:add_component(self.collider)
	self.collider:set_sprite(self.sprite_component)
	if self.imgid then
		apply_image_metadata(self, self.imgid)
	end

	return self
end

-- sprite_object:gfx(id, meta?)
--   Sets this object's sprite to the image with the given ROM id.
--   id should be the base name WITHOUT the @cx/@cc suffix (rombuilder strips it).
--   meta is optional; when omitted, imgmeta is read from the mapped ROM TOC.
--   After loading, the linked collider_2d_component (if one exists) will read the
--   current imgmeta lazily when collision code asks for shape data.
--   Must be called AFTER the object is spawned and has a collider_2d_component.
function sprite_object:gfx(id, meta)
	self.imgid = id
	self.sprite_component:set_imgid(id)
	if id == nil then
		return
	end
	if meta then
		self.sx = meta.width
		self.sy = meta.height
	else
		apply_image_metadata(self, id)
	end
end

return sprite_object

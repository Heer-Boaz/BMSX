-- spriteobject built atop worldobject
--
-- DESIGN PRINCIPLES — image suffixes and collision geometry
--
-- 1. THE @cx / @cc FILENAME SUFFIX IS HOW POLYGON COLLISION IS ENABLED.
--    rombuilder strips it from the final asset name but processes it at pack-time:
--
--      @cx  — bakes a CONVEX hull polygon (one polygon; fast, recommended default)
--      @cc  — bakes a tighter multi-piece convex fit (multiple polygons; slower)
--      none — AABB only (a rectangle from the image's sx/sy; cheapest)
--
--    Examples:
--      player.png          → AABB collision only
--      player@cx.png       → convex polygon; asset loads as 'player'
--      player@cc.png       → concave polygons; asset loads as 'player'
--
--    WRONG — no suffix, expecting polygon collision:
--      self:gfx('enemy')           -- AABB only, regardless of sprite shape!
--
--    RIGHT — convex hull suffix:
--      self:gfx('enemy')           -- image file is 'enemy@cx.png' at pack-time
--
-- 2. COLLISION IS DERIVED LAZILY FROM THE SPRITE METADATA.
--    When gfx(id) is called, imgmeta.hitpolygons (baked by rombuilder) is later
--    read directly by the linked collider2dcomponent when collision code asks
--    for the current shape.
--    No extra setup is needed in cart code — just ensure a collider2dcomponent
--    exists on the object before gfx() is called.
--
-- 3. WORLD ECS AND MANUAL DRAW PATHS CAN BOTH EXIST.
--    World-managed spriteobjects are normally rendered by spriterendersystem.
--    spriteobject:draw() still matters for manual draw paths (for example
--    subsystem-owned objects or other explicit owner:draw() flows).
--
-- 4. COLLISION PROFILES: after gfx(), call apply_collision_profile().
--      self:gfx('enemy')
--      self.collider:apply_collision_profile('enemy')  -- sets layer/mask

local worldobject<const> = require('worldobject')
local components<const> = require('components')

local spriteobject<const> = {}
spriteobject.__index = spriteobject
setmetatable(spriteobject, { __index = worldobject })

spriteobject.base_sprite_id = 'base_sprite'
spriteobject.primary_collider_id = 'primary'

local apply_image_metadata<const> = function(self, id)
	local asset<const> = assets.img[id]
	if asset == nil then
		error('[spriteobject] Image asset "' .. tostring(id) .. '" not found.')
	end
	local meta<const> = asset.imgmeta
	self.sx = meta.width
	self.sy = meta.height
end

function spriteobject.new(opts)
	opts = opts or {}
	opts.type_name = 'spriteobject'
	local self<const> = setmetatable(worldobject.new(opts), spriteobject)
	self.flip_h = false
	self.flip_v = false
	self.imgid = nil

	self.sprite_component = components.spritecomponent.new({
		imgid = self.imgid,
		id_local = spriteobject.base_sprite_id,
		layer = opts.layer,
	})
	self.collider = components.collider2dcomponent.new({ id_local = spriteobject.primary_collider_id })

	self:add_component(self.sprite_component)
	self:add_component(self.collider)

	return self
end

-- spriteobject:gfx(id, meta?)
--   Sets this object's sprite to the image with the given asset id.
--   id should be the base name WITHOUT the @cx/@cc suffix (rombuilder strips it).
--   meta is optional; when omitted, imgmeta is fetched through host asset lookup.
--   After loading, the linked collider2dcomponent (if one exists) will read the
--   current imgmeta lazily when collision code asks for shape data.
--   Must be called AFTER the object is spawned and has a collider2dcomponent.
function spriteobject:gfx(id, meta)
	self.imgid = id
	self.sprite_component.imgid = id
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

function spriteobject:draw()
	if not self.visible then
		return
	end
	local sc<const> = self.sprite_component
	if sc.imgid == nil then
		return
	end
	local offset<const> = sc.offset
	local flip_flags = 0
	if sc.flip.flip_h then
		flip_flags = flip_flags | 1
	end
	if sc.flip.flip_v then
		flip_flags = flip_flags | 2
	end
	memwrite(
		vdp_stream_claim_words(sys_vdp_stream_packet_header_words + 13),
		sys_vdp_cmd_blit,
		 13,
		0,
		assets.img[sc.imgid].handle,
		self.x + offset.x,
		self.y + offset.y,
		self.z + offset.z,
		sc.layer,
		sc.scale.x,
		sc.scale.y,
		flip_flags,
		sc.colorize.r,
		sc.colorize.g,
		sc.colorize.b,
		sc.colorize.a,
		sc.parallax_weight
	)
end

return spriteobject

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
-- 2. COLLISION IS SYNCED AUTOMATICALLY BY spritecomponent.sync_collider().
--    When gfx(id) is called, imgmeta.hitpolygons (baked by rombuilder) is read
--    and copied into the linked collider2dcomponent.local_polys.
--    No extra setup is needed in cart code — just ensure a collider2dcomponent
--    exists on the object before gfx() is called.
--
-- 3. spriterendersystem RENDERS; spriteobject:draw() IS OBSOLETE.
--    Do not override draw() in subclasses. The ECS spriterendersystem calls
--    spritecomponent each frame; draw() on the object itself is never invoked
--    by the engine and exists only for backward compat.
--
-- 4. COLLISION PROFILES: after gfx(), call apply_collision_profile().
--      self:gfx('enemy')
--      self.collider:apply_collision_profile('enemy')  -- sets layer/mask

local worldobject = require('worldobject')
local components = require('components')
local romdir = require('romdir')

local spriteobject = {}
spriteobject.__index = spriteobject
setmetatable(spriteobject, { __index = worldobject })

spriteobject.base_sprite_id = 'base_sprite'
spriteobject.primary_collider_id = 'primary'

local function apply_image_metadata(self, id)
	local meta = assets.img[romdir.token(id)].imgmeta
	self.sx = meta.width
	self.sy = meta.height
end

function spriteobject.new(opts)
	opts = opts or {}
	opts.type_name = 'spriteobject'
	local self = setmetatable(worldobject.new(opts), spriteobject)
	self.flip_h = false
	self.flip_v = false
	self.imgid = 'none'

	self.sprite_component = components.spritecomponent.new({ imgid = self.imgid, id_local = spriteobject.base_sprite_id })
	self.collider = components.collider2dcomponent.new({ id_local = spriteobject.primary_collider_id })

	self:add_component(self.sprite_component)
	self:add_component(self.collider)

	return self
end

-- spriteobject:gfx(id, meta?)
--   Sets this object's sprite to the image with the given asset id.
--   id should be the base name WITHOUT the @cx/@cc suffix (rombuilder strips it).
--   meta is optional; when omitted, imgmeta is fetched from romdir automatically.
--   After loading, sync_collider() copies imgmeta.hitpolygons into the linked
--   collider2dcomponent (if one exists), activating polygon collision.
--   Must be called AFTER the object is spawned and has a collider2dcomponent.
function spriteobject:gfx(id, meta)
	self.imgid = id
	self.sprite_component.imgid = id
	if id == 'none' then
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
	local sc = self.sprite_component
	if sc.imgid == 'none' then
		return
	end
	local offset = sc.offset
	put_sprite(sc.imgid, self.x + offset.x, self.y + offset.y, self.z + offset.z, {
		scale = sc.scale,
		flip_h = sc.flip.flip_h,
		flip_v = sc.flip.flip_v,
		colorize = sc.colorize,
		parallax_weight = sc.parallax_weight,
	})
end

return spriteobject

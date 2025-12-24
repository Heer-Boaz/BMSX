-- sprite.lua
-- spriteobject built atop worldobject

local worldobject = require("worldobject")
local components = require("components")

local spriteobject = {}
spriteobject.__index = spriteobject
setmetatable(spriteobject, { __index = worldobject })

local base_sprite_id = "base_sprite"
local primary_collider_id = "primary"

local function apply_image_metadata(self, id)
	local meta = assets.img[id].imgmeta
	self.sx = meta.width
	self.sy = meta.height
end

function spriteobject.new(opts)
	local self = setmetatable(worldobject.new(opts), spriteobject)
	self.type_name = "spriteobject"
	self.flip_h = false
	self.flip_v = false
	self.imgid = "none"
	self.animations = {}
	self.current_animation = nil

	self.sprite_component = components.spritecomponent.new({ parent = self, imgid = self.imgid, id_local = base_sprite_id })
	self.collider = components.collider2dcomponent.new({ parent = self, id_local = primary_collider_id })

	self:add_component(self.sprite_component)
	self:add_component(self.collider)

	return self
end

function spriteobject:set_image(id, meta)
	self.imgid = id
	self.sprite_component.imgid = id
	if id == "none" then
		return
	end
	if meta then
		self.sx = meta.width
		self.sy = meta.height
	else
		apply_image_metadata(self, id)
	end
end

function spriteobject:play_ani(id, opts)
	self.current_animation = id
	self.timelines:play(id, opts)
end

function spriteobject:stop_ani(id)
	if self.current_animation == id then
		self.current_animation = nil
	end
	self.timelines:stop(id)
end

function spriteobject:resume_ani(id)
	self:play_ani(id)
end

function spriteobject:draw()
	if not self.visible then
		return
	end
	local sc = self.sprite_component
	if sc.imgid == "none" then
		return
	end
	local offset = sc.offset
	put_sprite(sc.imgid, self.x + offset.x, self.y + offset.y, self.z + offset.z, {
		scale = sc.scale,
		flip_h = sc.flip.flip_h,
		flip_v = sc.flip.flip_v,
		colorize = sc.colorize,
	})
end

return spriteobject

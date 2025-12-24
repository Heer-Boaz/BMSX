-- sprite.lua
-- SpriteObject built atop WorldObject

local WorldObject = require("worldobject")
local components = require("components")

local SpriteObject = {}
SpriteObject.__index = SpriteObject
setmetatable(SpriteObject, { __index = WorldObject })

local BASE_SPRITE_ID = "base_sprite"
local PRIMARY_COLLIDER_ID = "primary"

local function apply_image_metadata(self, meta)
	self.sx = meta.width
	self.sy = meta.height
end

function SpriteObject.new(opts)
	local self = setmetatable(WorldObject.new(opts), SpriteObject)
	self.type_name = "SpriteObject"
	self.flip_h = false
	self.flip_v = false
	self.imgid = "none"
	self.colorize = { r = 255, g = 255, b = 255, a = 1 }
	self.animations = {}
	self.current_animation = nil

	self.sprite_component = components.SpriteComponent.new({ parent = self, imgid = self.imgid, id_local = BASE_SPRITE_ID })
	self.collider = components.Collider2DComponent.new({ parent = self, id_local = PRIMARY_COLLIDER_ID })

	self:add_component(self.sprite_component)
	self:add_component(self.collider)

	return self
end

function SpriteObject:set_image(id, meta)
	self.imgid = id
	self.sprite_component.imgid = id
	apply_image_metadata(self, meta)
end

function SpriteObject:play_ani(id, opts)
	self.current_animation = id
	self.timelines:play(id, opts)
end

function SpriteObject:stop_ani(id)
	if self.current_animation == id then
		self.current_animation = nil
	end
	self.timelines:stop(id)
end

function SpriteObject:resume_ani(id)
	self:play_ani(id)
end

return SpriteObject

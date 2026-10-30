local gp0<const> = require('cartlib/gx/gp0')
local image<const> = require('cartlib/gx/image')
local visual_2d_component<const> = require('cartlib/component/visual_2d_component')
local shallow_copy<const> = require('cartlib/util/shallow_copy')

local sprite_component<const> = {}
sprite_component.__index = sprite_component
setmetatable(sprite_component, { __index = visual_2d_component })

function sprite_component.new(context, id_local, defaults, default_source)
	local self<const>, input<const> = visual_2d_component.new(context, id_local or 'sprite', defaults)
	setmetatable(self, sprite_component)
	local color = input.color
	if color == nil then color = defaults and defaults.color end
	self.color = color or 0xffffffff
	local flip_h = input.flip_h
	if flip_h == nil then flip_h = defaults and defaults.flip_h end
	self.flip_h = flip_h or false
	local flip_v = input.flip_v
	if flip_v == nil then flip_v = defaults and defaults.flip_v end
	self.flip_v = flip_v or false
	self.imgid = nil
	self._source = nil
	self.source_width = 0
	self.source_height = 0
	local imgid = input.imgid
	local source
	if imgid ~= nil then
		source = image.resolve(imgid)
	else
		imgid = defaults and defaults.imgid
		source = default_source
	end
	self:_set_resolved_imgid(imgid, source)
	local region<const> = input.region or (defaults and defaults.region)
	if region ~= nil then
		self:set_region(region.x, region.y, region.width, region.height)
	end
	return self, input
end

function sprite_component.factory(definition)
	local defaults<const> = shallow_copy(definition)
	local imgid<const> = defaults.imgid
	local source<const> = imgid and image.resolve(imgid)
	local default_id<const> = defaults.id_local
	return function(context, id_local)
		return sprite_component.new(context, id_local or default_id, defaults, source)
	end
end

-- Resolved images stay inside the visual owner. Animation admission resolves
-- its immutable frame set once and uses this internal binding path; ordinary
-- cart code continues to publish only imgids through set_imgid().
function sprite_component:_set_resolved_imgid(imgid, source)
	self.imgid = imgid
	if source then
		self._source = source
		self.source_width = source.width
		self.source_height = source.height
		if self.region_width ~= nil then
			self:set_draw_function(self.draw_region_visual)
		else
			self:set_draw_function(self.draw_visual)
		end
	else
		self._source = nil
		self.source_width = 0
		self.source_height = 0
		self:set_draw_function(nil)
	end
	return true
end

function sprite_component:set_imgid(imgid)
	if self.imgid == imgid then
		return false
	end
	local collider<const> = self._collider
	if collider ~= nil then collider:admit_sprite_image(imgid) end
	local source
	if imgid then
		source = image.resolve(imgid)
	end
	return self:_set_resolved_imgid(imgid, source)
end

-- A sprite region retains raw source coordinates on the visual component and
-- selects its packet datapath when the region is admitted. Ordinary sprites
-- keep the direct blit path and pay no per-draw region branch.
function sprite_component:set_region(x, y, width, height)
	self.region_x = x
	self.region_y = y
	self.region_width = width
	self.region_height = height
	if self._source ~= nil then
		self:set_draw_function(self.draw_region_visual)
	end
	return self
end

function sprite_component:clear_region()
	self.region_x = nil
	self.region_y = nil
	self.region_width = nil
	self.region_height = nil
	if self._source ~= nil then
		self:set_draw_function(self.draw_visual)
	end
	return self
end

function sprite_component:on_detach()
	if self._collider then
		self._collider:set_sprite(nil)
	end
	if self.owner.sprite_component == self then
		self.owner.sprite_component = nil
	end
end

function sprite_component:draw_visual(draw)
	local source<const> = self._source
	self:resolve_pose()
	local x<const>, y<const> = self.wox, self.woy
	local color<const> = self.color
	local translation_only<const> = self._translation_only
	if translation_only
	and not self.flip_h and not self.flip_v
	and (color & 0x00ffffff) == 0x00ffffff then
		source:blit(draw, x, y)
		return
	end
	local flip_flags<const> = (self.flip_h and 1 or 0) | (self.flip_v and 2 or 0)
	if translation_only then
		source:draw(draw, x, y, color, flip_flags, gp0.draw_mode_blend_half)
		return
	end
	source:draw_affine(
		draw,
		x, y,
		self.source_width * self.wxx, self.source_width * self.wxy,
		self.source_height * self.wyx, self.source_height * self.wyy,
		flip_flags,
		color,
		gp0.draw_mode_blend_half)
end

function sprite_component:draw_region_visual(draw)
	local source<const> = self._source
	self:resolve_pose()
	local x<const>, y<const> = self.wox, self.woy
	local source_x<const> = self.region_x
	local source_y<const> = self.region_y
	local width<const> = self.region_width
	local height<const> = self.region_height
	local color<const> = self.color
	local flip_flags<const> = (self.flip_h and 1 or 0) | (self.flip_v and 2 or 0)
	if self._translation_only then
		source:draw_source_rect(
			draw,
			source_x, source_y,
			width, height,
			x, y,
			color,
			flip_flags,
			gp0.draw_mode_blend_half)
		return
	end
	local source_x0 = source_x
	local source_x1 = source_x + width - 1
	local source_y0 = source_y
	local source_y1 = source_y + height - 1
	if self.flip_h then
		source_x0 = source_x1
		source_x1 = source_x
	end
	if self.flip_v then
		source_y0 = source_y1
		source_y1 = source_y
	end
	local ax<const>, ay<const> = width * self.wxx, width * self.wxy
	local bx<const>, by<const> = height * self.wyx, height * self.wyy
	source:draw_quad(
		draw,
		source_x0, source_y0,
		source_x1, source_y0,
		source_x0, source_y1,
		source_x1, source_y1,
		x, y,
		x + ax, y + ay,
		x + bx, y + by,
		x + ax + bx, y + ay + by,
		color,
		gp0.draw_mode_blend_half)
end

return sprite_component

local collider_2d_component<const> = require('cartlib/collision/collider_2d_component')
local tile_strip_component<const> = require('cartlib/component/tile_strip_component')
local shape_geometry<const> = require('cartlib/collision/shape_geometry')
local shallow_copy<const> = require('cartlib/util/shallow_copy')

local tile_strip_collider_2d_component<const> = {}
tile_strip_collider_2d_component.__index = tile_strip_collider_2d_component
setmetatable(tile_strip_collider_2d_component, { __index = collider_2d_component })

local admit_layout<const> = function(self, step_x, step_y, left, top, right, bottom)
	local width<const>, height<const> = right - left, bottom - top
	local collapsed<const> = (step_y == 0 and step_x >= -width and step_x <= width)
		or (step_x == 0 and step_y >= -height and step_y <= height)
	self:reserve_geometry(collapsed and 64 or 32 + self.tile_strip.maximum_tiles * 64)
	self._strip_collapsed = collapsed
end

function tile_strip_collider_2d_component:admit_strip_step(x, y)
	admit_layout(self, x, y, self.local_left, self.local_top, self.local_right, self.local_bottom)
end

function tile_strip_collider_2d_component:set_local_area(left, top, right, bottom)
	local strip<const> = self.tile_strip
	admit_layout(self, strip.step_x, strip.step_y, left, top, right, bottom)
	return collider_2d_component.set_local_area(self, left, top, right, bottom)
end

function tile_strip_collider_2d_component:resolve_shape()
	local strip<const> = self.tile_strip
	local first<const>, last<const> = strip.first_tile, strip.last_tile
	if last < first then return nil end
	self:resolve_pose()
	local source_changed<const> = strip._source_revision ~= self._strip_revision
		or self._geometry_revision ~= self._consumed_geometry_revision
	if source_changed or self._geometry_basis_revision ~= self._basis_revision then
		shape_geometry.write_strip(self._geometry_address, first, last, strip.step_x, strip.step_y,
			self.local_left, self.local_top, self.local_right, self.local_bottom,
			self.wxx, self.wxy, self.wyx, self.wyy, self._strip_collapsed)
		self._strip_revision = strip._source_revision
		self._geometry_basis_revision = self._basis_revision
		self._consumed_geometry_revision = self._geometry_revision
	end
	return self._geometry_address
end

function tile_strip_collider_2d_component.factory(definition)
	local defaults<const> = shallow_copy(definition)
	return function(context, id_local)
		local self<const>, input<const> = collider_2d_component.construct(context, id_local, defaults)
		setmetatable(self, tile_strip_collider_2d_component)
		local source_id<const> = input.tile_strip_id_local or defaults.tile_strip_id_local or 'tile_strip'
		local strip<const> = context.owner:get_component(tile_strip_component, source_id)
		if strip._collider ~= nil then error('tile-strip geometry already belongs to another collider binding') end
		self.tile_strip = strip
		local area<const> = input.local_area or defaults.local_area
		if area ~= nil then self:set_local_area(area.left, area.top, area.right, area.bottom)
		else self:set_local_area(0, 0, strip.tile_width, strip.tile_height) end
		strip._collider = self
		return self
	end
end

function tile_strip_collider_2d_component:unbind()
	self.tile_strip._collider = nil
	collider_2d_component.unbind(self)
end

return tile_strip_collider_2d_component

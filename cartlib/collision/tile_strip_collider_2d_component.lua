local collider_2d_component<const> = require('cartlib/collision/collider_2d_component')
local tile_strip_component<const> = require('cartlib/component/tile_strip_component')
local shape_geometry<const> = require('cartlib/collision/shape_geometry')
local shallow_copy<const> = require('cartlib/util/shallow_copy')

local tile_strip_collider_2d_component<const> = {}
tile_strip_collider_2d_component.__index = tile_strip_collider_2d_component
setmetatable(tile_strip_collider_2d_component, { __index = collider_2d_component })

local is_contiguous<const> = function(self, step_x, step_y)
	local width<const>, height<const> = self.local_right - self.local_left, self.local_bottom - self.local_top
	return (step_y == 0 and step_x >= -width and step_x <= width)
		or (step_x == 0 and step_y >= -height and step_y <= height)
end

local resolve_strip<const> = function(self)
	local strip<const> = self.tile_strip
	local first<const>, last<const> = strip.first_tile, strip.last_tile
	local step_x<const>, step_y<const> = strip.step_x, strip.step_y
	local source_changed<const> = first ~= self._strip_first or last ~= self._strip_last
		or step_x ~= self._strip_step_x or step_y ~= self._strip_step_y
		or self._geometry_revision ~= self._consumed_geometry_revision
	if source_changed then
		local count<const> = last - first + 1
		if count < 1 or count > strip.maximum_tiles then error('tile-strip collider range is outside its admitted source bound') end
		local collapsed<const> = is_contiguous(self, step_x, step_y)
		local required<const> = collapsed and 64 or 32 + strip.maximum_tiles * 64
		self:reserve_geometry(required)
		self._strip_collapsed = collapsed
	end
	if source_changed or self._geometry_basis_revision ~= self._basis_revision then
		shape_geometry.write_strip(self._geometry_address, first, last, step_x, step_y,
			self.local_left, self.local_top, self.local_right, self.local_bottom,
			self.wxx, self.wxy, self.wyx, self.wyy, self._strip_collapsed)
		self._strip_first, self._strip_last = first, last
		self._strip_step_x, self._strip_step_y = step_x, step_y
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
		self.tile_strip = strip
		local area<const> = input.local_area or defaults.local_area
		if area ~= nil then self:set_local_area(area.left, area.top, area.right, area.bottom)
		else self:set_local_area(0, 0, strip.tile_width, strip.tile_height) end
		local collapsed<const> = is_contiguous(self, strip.step_x, strip.step_y)
		self:reserve_geometry(collapsed and 64 or 32 + strip.maximum_tiles * 64)
		self._resolve_geometry = resolve_strip
		return self
	end
end

return tile_strip_collider_2d_component

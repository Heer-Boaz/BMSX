local image<const> = require('cartlib/gx/image')
local visual_2d_component<const> = require('cartlib/component/visual_2d_component')
local affine_batch<const> = require('cartlib/gx/affine_batch')
local shallow_copy<const> = require('cartlib/util/shallow_copy')

local tile_strip_component<const> = {}
tile_strip_component.__index = tile_strip_component
setmetatable(tile_strip_component, { __index = visual_2d_component })

-- Source edits admit their complete candidate before publication. Collider
-- queries consume the retained source revision, never repeat that admission.
function tile_strip_component:set_range(first, last)
	if first == self.first_tile and last == self.last_tile then return self end
	if last - first + 1 > self.maximum_tiles then error('tile-strip range exceeds its admitted source bound') end
	self.first_tile, self.last_tile = first, last
	self._source_revision = self._source_revision + 1
	return self
end

function tile_strip_component:set_step(x, y)
	if x == self.step_x and y == self.step_y then return self end
	local collider<const> = self._collider
	if collider ~= nil then collider:admit_strip_step(x, y) end
	self.step_x, self.step_y = x, y
	self._source_revision = self._source_revision + 1
	return self
end

function tile_strip_component:draw_visual(draw)
	local first<const> = self.first_tile
	local last<const> = self.last_tile
	if last < first then return end
	self:resolve_pose()
	local source<const> = self._source
	local step_x<const>, step_y<const> = self.step_x, self.step_y
	if self._translation_only then
		local x, y = self.wox + first*step_x, self.woy + first*step_y
		for _ = first, last do
			source:blit(draw, x, y)
			x, y = x + step_x, y + step_y
		end
	else
		affine_batch.repeated_image(draw, source, first, last, step_x, step_y,
			self.wxx, self.wxy, self.wyx, self.wyy, self.wox, self.woy, 0xffffffff)
	end
end

-- A tile strip is one straight, inclusive range in tile-index space. The
-- visual owns both endpoints; gameplay changes the range without duplicating
-- derived world coordinates or rebuilding draw commands.
function tile_strip_component.factory(definition)
	local defaults<const> = shallow_copy(definition)
	local source<const> = image.resolve(defaults.imgid)
	local id_local<const> = defaults.id_local or 'tile_strip'
	return function(owner, configuration)
		local self<const>, input<const> = visual_2d_component.new(owner, configuration, id_local, defaults)
		setmetatable(self, tile_strip_component)
		local selected_source<const> = input.imgid and image.resolve(input.imgid) or source
		self._source = selected_source
		self.tile_width = selected_source.width
		self.tile_height = selected_source.height
		self.maximum_tiles = input.maximum_tiles or defaults.maximum_tiles
		self.step_x = input.step_x or defaults.step_x
		self.step_y = input.step_y or defaults.step_y
		local first<const> = input.first_tile or defaults.first_tile
		self.first_tile = first
		self.last_tile = first - 1
		self._source_revision = 0
		self:set_draw_function(tile_strip_component.draw_visual)
		return self
	end
end

local protected<const> = shallow_copy(visual_2d_component.timeline_channels.protected)
protected.first_tile, protected.last_tile = true, true
protected.step_x, protected.step_y = true, true
protected.maximum_tiles, protected._source_revision = true, true
protected.tile_width, protected.tile_height, protected._source, protected._collider = true, true, true, true
tile_strip_component.timeline_channels = {
	protected = protected,
	properties = visual_2d_component.timeline_channels.properties,
	groups = visual_2d_component.timeline_channels.groups,
}

return tile_strip_component

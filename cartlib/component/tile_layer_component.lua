local image<const> = require('cartlib/gx/image')
local command_list<const> = require('cartlib/gx/command_list')
local visual_component<const> = require('cartlib/component/visual_component')

local tile_layer_component<const> = {}
tile_layer_component.__index = tile_layer_component
setmetatable(tile_layer_component, { __index = visual_component })

function tile_layer_component.new(opts)
	local self<const> = setmetatable(visual_component.new(opts), tile_layer_component)
	self._sources = {}
	-- A layer resolves each semantic image id once; cells retain the resolved
	-- source directly and rendering never performs an asset lookup.
	self._sources_by_imgid = {}
	self.tile_count = 0
	self.columns = opts.columns or 1
	self.tile_size = opts.tile_size or 0
	self._first_visible_column = 1
	self._last_visible_column = self.columns
	local imgids<const> = opts.imgids
	if imgids then
		local tile_count<const> = opts.tile_count or #imgids
		for index = 1, tile_count do
			self:set_tile(index, imgids[index])
		end
		self:resize(tile_count, self.columns)
	end
	return self
end

function tile_layer_component:set_tile(index, imgid)
	if imgid then
		local sources_by_imgid<const> = self._sources_by_imgid
		local source = sources_by_imgid[imgid]
		if source == nil then
			source = image.resolve(imgid)
			sources_by_imgid[imgid] = source
		end
		self._sources[index] = source
	else
		self._sources[index] = nil
	end
end

function tile_layer_component:resize(tile_count, columns)
	local sources<const> = self._sources
	for index = tile_count + 1, self.tile_count do
		sources[index] = nil
	end
	self.tile_count = tile_count
	self.columns = columns
	self._first_visible_column = 1
	self._last_visible_column = columns
end

function tile_layer_component:set_visible_columns(first_column, column_count)
	local last_column = first_column + column_count - 1
	if last_column > self.columns then
		last_column = self.columns
	end
	self._first_visible_column = first_column
	self._last_visible_column = last_column
end

function tile_layer_component:fill(imgid, tile_count, columns)
	local source<const> = image.resolve(imgid)
	local sources<const> = self._sources
	for index = 1, tile_count do
		sources[index] = source
	end
	self:resize(tile_count, columns)
end

function tile_layer_component:set_indexed_tiles(indices, index_count, imgid)
	local source<const> = image.resolve(imgid)
	local sources<const> = self._sources
	for index = 1, index_count do
		local tile_index<const> = indices[index]
		sources[tile_index] = source
	end
end

function tile_layer_component:draw(draw)
	local parent<const> = self.parent
	local origin_x<const> = parent.x + self.offset_x + self.draw_offset_x
	local origin_y<const> = parent.y + self.offset_y + self.draw_offset_y
	command_list.tile_layer(
		draw,
		self._sources,
		self.tile_count,
		self.columns,
		self._first_visible_column,
		self._last_visible_column,
		self.tile_size,
		origin_x,
		origin_y)
end

return tile_layer_component

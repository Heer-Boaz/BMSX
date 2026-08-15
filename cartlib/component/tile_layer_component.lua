local image<const> = require('cartlib/gx/image')
local command_list<const> = require('cartlib/gx/command_list')
local gp0<const> = require('cartlib/gx/gp0')
local visual_component<const> = require('cartlib/component/visual_component')

local tile_layer_component<const> = {}
tile_layer_component.__index = tile_layer_component
setmetatable(tile_layer_component, { __index = visual_component })

local resolve_source<const> = function(self, imgid)
	local sources_by_imgid<const> = self._sources_by_imgid
	local source = sources_by_imgid[imgid]
	if source == nil then
		source = image.resolve(imgid)
		sources_by_imgid[imgid] = source
	end
	return source
end

local rebuild_visible_tiles<const> = function(self, origin_x, origin_y)
	local visible_tile_indices<const> = self._visible_tile_indices
	local visible_slots_by_tile_index<const> = self._visible_slots_by_tile_index
	local visible_sources<const> = self._visible_sources
	local visible_x_offsets<const> = self._visible_x_offsets
	local visible_y_offsets<const> = self._visible_y_offsets
	local visible_position_words<const> = self._visible_position_words
	local previous_count<const> = self._visible_tile_count
	for slot = 1, previous_count do
		visible_slots_by_tile_index[visible_tile_indices[slot]] = nil
	end

	local sources<const> = self._sources
	local tile_count<const> = self.tile_count
	local columns<const> = self.columns
	local first_column<const> = self._first_visible_column
	local last_column<const> = self._last_visible_column
	local tile_size<const> = self._tile_size
	local row_start = first_column
	local y_offset = 0
	local visible_count = 0
	while row_start <= tile_count do
		local row_end = row_start + last_column - first_column
		if row_end > tile_count then
			row_end = tile_count
		end
		local x_offset = 0
		for tile_index = row_start, row_end do
			local source<const> = sources[tile_index]
			if source ~= nil then
				visible_count = visible_count + 1
				visible_tile_indices[visible_count] = tile_index
				visible_slots_by_tile_index[tile_index] = visible_count
				visible_sources[visible_count] = source
				visible_x_offsets[visible_count] = x_offset
				visible_y_offsets[visible_count] = y_offset
				visible_position_words[visible_count] = gp0.pair16(origin_x + x_offset, origin_y + y_offset)
			end
			x_offset = x_offset + tile_size
		end
		row_start = row_start + columns
		y_offset = y_offset + tile_size
	end
	for slot = visible_count + 1, previous_count do
		visible_tile_indices[slot] = nil
		visible_sources[slot] = nil
		visible_x_offsets[slot] = nil
		visible_y_offsets[slot] = nil
		visible_position_words[slot] = nil
	end
	self._visible_tile_count = visible_count
	self._visible_tiles_dirty = false
	self._position_origin_x = origin_x
	self._position_origin_y = origin_y
	self._pending_position_origin_x = nil
	self._pending_position_origin_y = nil
end

local rebuild_visible_positions<const> = function(self, origin_x, origin_y)
	local position_words<const> = self._visible_position_words
	local x_offsets<const> = self._visible_x_offsets
	local y_offsets<const> = self._visible_y_offsets
	for source_index = 1, self._visible_tile_count do
		position_words[source_index] = gp0.pair16(
			origin_x + x_offsets[source_index],
			origin_y + y_offsets[source_index])
	end
	self._position_origin_x = origin_x
	self._position_origin_y = origin_y
	self._pending_position_origin_x = nil
	self._pending_position_origin_y = nil
end

function tile_layer_component.new(opts)
	local self<const> = setmetatable(visual_component.new(opts), tile_layer_component)
	self._sources = {}
	-- A layer resolves each semantic image id once; cells retain the resolved
	-- source directly and rendering never performs an asset lookup.
	self._sources_by_imgid = {}
	-- Visible packets are rebuilt only when the grid or view changes. Rendering
	-- then walks a flat row-major list without testing empty/off-screen cells.
	self._visible_tile_indices = {}
	self._visible_slots_by_tile_index = {}
	self._visible_sources = {}
	self._visible_x_offsets = {}
	self._visible_y_offsets = {}
	self._visible_position_words = {}
	self._visible_tile_count = 0
	self._visible_tiles_dirty = true
	self._position_origin_x = nil
	self._position_origin_y = nil
	self._pending_position_origin_x = nil
	self._pending_position_origin_y = nil
	self.tile_count = 0
	self.columns = opts.columns or 1
	self._tile_size = opts.tile_size or 0
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
	local sources<const> = self._sources
	local previous<const> = sources[index]
	local source
	if imgid then
		source = resolve_source(self, imgid)
	end
	if previous == source then
		return
	end
	sources[index] = source
	if self._visible_tiles_dirty then
		return
	end
	if previous ~= nil and source ~= nil then
		local visible_slot<const> = self._visible_slots_by_tile_index[index]
		if visible_slot ~= nil then
			self._visible_sources[visible_slot] = source
		end
		return
	end
	self._visible_tiles_dirty = true
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
	self._visible_tiles_dirty = true
end

function tile_layer_component:set_visible_columns(first_column, column_count)
	local last_column = first_column + column_count - 1
	if last_column > self.columns then
		last_column = self.columns
	end
	self._first_visible_column = first_column
	self._last_visible_column = last_column
	self._visible_tiles_dirty = true
end

function tile_layer_component:set_tile_size(tile_size)
	self._tile_size = tile_size
	self._visible_tiles_dirty = true
end

function tile_layer_component:fill(imgid, tile_count, columns)
	local source<const> = resolve_source(self, imgid)
	local sources<const> = self._sources
	for index = 1, tile_count do
		sources[index] = source
	end
	self:resize(tile_count, columns)
end

function tile_layer_component:set_indexed_tiles(indices, index_count, imgid)
	local source<const> = resolve_source(self, imgid)
	local sources<const> = self._sources
	if self._visible_tiles_dirty then
		for index = 1, index_count do
			sources[indices[index]] = source
		end
		return
	end
	local visible_slots_by_tile_index<const> = self._visible_slots_by_tile_index
	local visible_sources<const> = self._visible_sources
	for index = 1, index_count do
		local tile_index<const> = indices[index]
		sources[tile_index] = source
		local visible_slot<const> = visible_slots_by_tile_index[tile_index]
		if visible_slot ~= nil then
			visible_sources[visible_slot] = source
		end
	end
end

function tile_layer_component:draw(draw)
	local parent<const> = self.parent
	local origin_x<const> = parent.x + self.offset_x + self.draw_offset_x
	local origin_y<const> = parent.y + self.offset_y + self.draw_offset_y
	if self._visible_tiles_dirty then
		rebuild_visible_tiles(self, origin_x, origin_y)
	elseif origin_x ~= self._position_origin_x or origin_y ~= self._position_origin_y then
		-- Moving layers use the direct translated writer. Promote the new
		-- position only after it remains unchanged for a frame, so continuous
		-- movement never rewrites a cache that cannot be reused.
		if origin_x == self._pending_position_origin_x and origin_y == self._pending_position_origin_y then
			rebuild_visible_positions(self, origin_x, origin_y)
		else
			self._pending_position_origin_x = origin_x
			self._pending_position_origin_y = origin_y
			command_list.translated_tile_layer(
				draw,
				self._visible_sources,
				self._visible_x_offsets,
				self._visible_y_offsets,
				self._visible_tile_count,
				origin_x,
				origin_y)
			return
		end
	end
	command_list.tile_layer(
		draw,
		self._visible_sources,
		self._visible_position_words,
		self._visible_tile_count)
end

return tile_layer_component

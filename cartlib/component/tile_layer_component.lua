local image<const> = require('cartlib/gx/image')
local command_list<const> = require('cartlib/gx/command_list')
local gp0<const> = require('cartlib/gx/gp0')
local tile_layer_row<const> = require('cartlib/component/tile_layer_row')
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

local configure_rows<const> = function(self, previous_tile_count)
	local slots_by_tile_index<const> = self._slots_by_tile_index
	for tile_index = 1, previous_tile_count do
		slots_by_tile_index[tile_index] = nil
	end
	local row_count<const> = (self.tile_count + self.columns - 1) // self.columns
	local rows<const> = self._rows
	local previous_row_count<const> = self._row_count
	local dirty_rows<const> = self._dirty_rows
	for dirty_index = 1, self._dirty_row_count do
		dirty_rows[dirty_index] = nil
	end
	for row_index = 1, row_count do
		local row = rows[row_index]
		if row == nil then
			row = tile_layer_row.new()
			rows[row_index] = row
		end
		tile_layer_row.configure(row, row_index)
		dirty_rows[row_index] = row
	end
	for row_index = row_count + 1, previous_row_count do
		tile_layer_row.configure(rows[row_index], row_index)
	end
	self._row_count = row_count
	self._dirty_row_count = row_count
	self._selected_view_revision = 0
	self._coordinate_domain_columns = gp0.signed_coordinate_extent // self._tile_size
end

function tile_layer_component.new(opts)
	local self<const> = setmetatable(visual_component.new(opts), tile_layer_component)
	self._sources = {}
	-- Semantic image ids resolve once. Ordered row views retain the source
	-- records themselves, so texture admission may publish live VRAM placement
	-- independently of IMGDEC or DMA completion.
	self._sources_by_imgid = {}
	self._slots_by_tile_index = {}
	self._rows = {}
	self._row_count = 0
	self._dirty_rows = {}
	self._dirty_row_count = 0
	self._coordinate_domain_columns = 0
	self._view_revision = 1
	self._selected_view_revision = 0
	self.tile_count = 0
	self.columns = opts.columns or 1
	self._tile_size = opts.tile_size or 0
	self._first_visible_column = 1
	self._last_visible_column = self.columns
	local imgids<const> = opts.imgids
	if imgids then
		local tile_count<const> = opts.tile_count or #imgids
		self:resize(tile_count, self.columns)
		for index = 1, tile_count do
			self:set_tile(index, imgids[index])
		end
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
	local row<const> = self._rows[((index - 1) // self.columns) + 1]
	if row.dirty then
		return
	end
	if previous ~= nil and source ~= nil then
		row.sources[self._slots_by_tile_index[index]] = source
		return
	end
	row.dirty = true
	local dirty_row_count<const> = self._dirty_row_count + 1
	self._dirty_row_count = dirty_row_count
	self._dirty_rows[dirty_row_count] = row
end

-- resize admits the grid representation. Configure tile size first, then
-- resize before writing individual cells with set_tile.
function tile_layer_component:resize(tile_count, columns)
	local previous_tile_count<const> = self.tile_count
	local sources<const> = self._sources
	for index = tile_count + 1, previous_tile_count do
		sources[index] = nil
	end
	self.tile_count = tile_count
	self.columns = columns
	self._first_visible_column = 1
	self._last_visible_column = columns
	self._view_revision = self._view_revision + 1
	configure_rows(self, previous_tile_count)
end

function tile_layer_component:set_visible_columns(first_column, column_count)
	local last_column = first_column + column_count - 1
	if last_column > self.columns then
		last_column = self.columns
	end
	if self._first_visible_column == first_column and self._last_visible_column == last_column then
		return
	end
	self._first_visible_column = first_column
	self._last_visible_column = last_column
	self._view_revision = self._view_revision + 1
end

function tile_layer_component:set_tile_size(tile_size)
	if self._tile_size == tile_size then
		return
	end
	self._tile_size = tile_size
	if self.tile_count ~= 0 then
		configure_rows(self, self.tile_count)
	end
end

function tile_layer_component:fill(imgid, tile_count, columns)
	self:resize(tile_count, columns)
	local source<const> = resolve_source(self, imgid)
	local sources<const> = self._sources
	for index = 1, tile_count do
		sources[index] = source
	end
end

-- Animated tile families replace already-populated cells. This intentionally
-- avoids structural mutation checks and preserves each row's dense ordering.
function tile_layer_component:replace_indexed_tiles(indices, index_count, imgid)
	local source<const> = resolve_source(self, imgid)
	local sources<const> = self._sources
	local rows<const> = self._rows
	local slots_by_tile_index<const> = self._slots_by_tile_index
	local columns<const> = self.columns
	for index = 1, index_count do
		local tile_index<const> = indices[index]
		sources[tile_index] = source
		local row<const> = rows[((tile_index - 1) // columns) + 1]
		if not row.dirty then
			row.sources[slots_by_tile_index[tile_index]] = source
		end
	end
end

function tile_layer_component:draw(draw)
	local rows<const> = self._rows
	local view_revision<const> = self._view_revision
	local first_visible_column<const> = self._first_visible_column
	local last_visible_column<const> = self._last_visible_column
	local dirty_row_count<const> = self._dirty_row_count
	if dirty_row_count ~= 0 then
		local dirty_rows<const> = self._dirty_rows
		for dirty_index = 1, dirty_row_count do
			local row<const> = dirty_rows[dirty_index]
			dirty_rows[dirty_index] = nil
			tile_layer_row.rebuild(
				row,
				self._sources,
				self._slots_by_tile_index,
				self.tile_count,
				self.columns,
				self._tile_size,
				self._coordinate_domain_columns
			)
		end
		self._dirty_row_count = 0
		self._selected_view_revision = 0
	end
	if self._selected_view_revision ~= view_revision then
		for row_index = 1, self._row_count do
			tile_layer_row.select_visible(
				rows[row_index],
				first_visible_column,
				last_visible_column
			)
		end
		self._selected_view_revision = view_revision
	end
	local parent<const> = self.parent
	command_list.tile_layer(
		draw,
		rows,
		self._row_count,
		first_visible_column,
		last_visible_column,
		self._coordinate_domain_columns,
		self._tile_size,
		parent.x + self.offset_x + self.draw_offset_x,
		parent.y + self.offset_y + self.draw_offset_y
	)
end

return tile_layer_component

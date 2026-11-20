local atlas<const> = require('cartlib/gx/atlas')
local gp0<const> = require('cartlib/gx/gp0')

local tile_layer_row<const> = {}

function tile_layer_row.new()
	return {
		row_index = 0,
		columns = {},
		coordinate_domains = {},
		sources = {},
		position_words = {},
		uv_words = {},
		size_words = {},
		draw_modes = {},
		draw_mode_counts = {},
		cell_size_word = 0,
		foreign_size_count = 0,
		mirror_stride = 0,
		source_count = 0,
		first_visible_source = 1,
		last_visible_source = 0,
		dirty = true,
	}
end

-- Maintain the GP0 projection when a source changes, not on every draw.
-- Mirrored rows count each logical cell once, even across the ring boundary.
function tile_layer_row.set_source(row, slot, source)
	local size_words<const> = row.size_words
	local uv_words<const> = row.uv_words
	local draw_modes<const> = row.draw_modes
	local previous_mode<const> = draw_modes[slot]
	local previous_size<const> = size_words[slot]
	local draw_mode, size_word, uv_word
	if source ~= nil then
		draw_mode, size_word, uv_word = source._blit_draw_mode, source._size_word, source._blit_uv_word
	end
	if previous_mode ~= draw_mode then
		local counts<const> = row.draw_mode_counts
		if previous_mode ~= nil then
			local remaining<const> = counts[previous_mode] - 1
			if remaining == 0 then counts[previous_mode] = nil
			else counts[previous_mode] = remaining end
		end
		if draw_mode ~= nil then
			counts[draw_mode] = (counts[draw_mode] or 0) + 1
		end
	end
	if previous_size ~= size_word then
		local cell_size<const> = row.cell_size_word
		local was_foreign<const> = previous_size ~= nil and previous_size ~= cell_size
		local is_foreign<const> = size_word ~= nil and size_word ~= cell_size
		if is_foreign ~= was_foreign then
			row.foreign_size_count = row.foreign_size_count + (is_foreign and 1 or -1)
		end
	end
	local sources<const> = row.sources
	sources[slot], draw_modes[slot], size_words[slot], uv_words[slot] = source, draw_mode, size_word, uv_word
	local stride<const> = row.mirror_stride
	if stride ~= 0 then
		local copy<const> = slot + stride
		sources[copy], draw_modes[copy], size_words[copy], uv_words[copy] = source, draw_mode, size_word, uv_word
	end
end

function tile_layer_row.configure(row, row_index, cell_size_word, mirror_stride)
	local columns<const> = row.columns
	local coordinate_domains<const> = row.coordinate_domains
	local position_words<const> = row.position_words
	local stride<const> = row.mirror_stride
	local first = 1
	if stride ~= 0 then first = row.first_visible_source end
	for slot = first, first + row.source_count - 1 do
		local primary = slot
		if stride ~= 0 and slot > stride then primary = slot - stride end
		columns[primary], coordinate_domains[primary], position_words[primary] = nil, nil, nil
		tile_layer_row.set_source(row, primary, nil)
		if stride ~= 0 then
			local copy<const> = primary + stride
			columns[copy], coordinate_domains[copy], position_words[copy] = nil, nil, nil
		end
	end
	row.row_index = row_index
	row.cell_size_word = cell_size_word
	row.mirror_stride = mirror_stride
	row.source_count = 0
	row.first_visible_source = 1
	row.last_visible_source = 0
	row.dirty = true
end

function tile_layer_row.refresh_packets(rows, row_count)
	local revision<const> = atlas.placement_revision
	if rows.placement_revision == revision then return end
	for row_index = 1, row_count do
		local row<const> = rows[row_index]
		local sources<const> = row.sources
		local stride<const> = row.mirror_stride
		local first = 1
		if stride ~= 0 then first = row.first_visible_source end
		for slot = first, first + row.source_count - 1 do
			local primary = slot
			if stride ~= 0 and slot > stride then primary = slot - stride end
			tile_layer_row.set_source(row, primary, sources[primary])
		end
	end
	rows.placement_revision = revision
end

-- The row owns the ordered dense rendering view for its map cells. Topology
-- mutations rebuild only this row; texture-family replacements update its
-- retained source slot directly.
function tile_layer_row.rebuild(
	row,
	grid_sources,
	slots_by_tile_index,
	tile_count,
	grid_columns,
	tile_size,
	coordinate_domain_columns
)
	local columns<const> = row.columns
	local coordinate_domains<const> = row.coordinate_domains
	local position_words<const> = row.position_words
	local previous_count<const> = row.source_count
	local row_start<const> = ((row.row_index - 1) * grid_columns) + 1
	local row_end = row_start + grid_columns - 1
	if row_end > tile_count then
		row_end = tile_count
	end
	local y_offset<const> = (row.row_index - 1) * tile_size
	local source_count = 0
	for tile_index = row_start, row_end do
		slots_by_tile_index[tile_index] = nil
		local source<const> = grid_sources[tile_index]
		if source ~= nil then
			source_count = source_count + 1
			local column<const> = tile_index - row_start + 1
			columns[source_count] = column
			coordinate_domains[source_count] = ((column - 1) // coordinate_domain_columns) + 1
			tile_layer_row.set_source(row, source_count, source)
			position_words[source_count] = gp0.pair16(
				((column - 1) % coordinate_domain_columns) * tile_size,
				y_offset
			)
			slots_by_tile_index[tile_index] = source_count
		end
	end
	for slot = source_count + 1, previous_count do
		columns[slot] = nil
		coordinate_domains[slot] = nil
		tile_layer_row.set_source(row, slot, nil)
		position_words[slot] = nil
	end
	row.source_count = source_count
	-- Compaction remaps slot numbers; the previous visibility fingers no longer
	-- designate cells in this ordered view.
	row.first_visible_source = 1
	row.last_visible_source = 0
	row.dirty = false
end

-- The visible bounds are retained fingers into the ordered source columns.
-- Scrolling therefore advances only across cells that entered or left the
-- view; direct jumps still converge on the same lower and upper bounds.
function tile_layer_row.select_visible(row, first_column, last_column)
	local columns<const> = row.columns
	local source_count<const> = row.source_count
	local first_source = row.first_visible_source
	while first_source > 1 and columns[first_source - 1] >= first_column do
		first_source = first_source - 1
	end
	while first_source <= source_count and columns[first_source] < first_column do
		first_source = first_source + 1
	end
	local last_source = row.last_visible_source
	while last_source > 0 and columns[last_source] > last_column do
		last_source = last_source - 1
	end
	while last_source < source_count and columns[last_source + 1] <= last_column do
		last_source = last_source + 1
	end
	row.first_visible_source = first_source
	row.last_visible_source = last_source
end

return tile_layer_row

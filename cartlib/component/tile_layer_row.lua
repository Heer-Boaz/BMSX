local gp0<const> = require('cartlib/gx/gp0')

local tile_layer_row<const> = {}

function tile_layer_row.new()
	return {
		row_index = 0,
		columns = {},
		coordinate_domains = {},
		sources = {},
		position_words = {},
		source_count = 0,
		first_visible_source = 1,
		last_visible_source = 0,
		dirty = true,
	}
end

function tile_layer_row.configure(row, row_index)
	local columns<const> = row.columns
	local coordinate_domains<const> = row.coordinate_domains
	local sources<const> = row.sources
	local position_words<const> = row.position_words
	for slot = 1, row.source_count do
		columns[slot] = nil
		coordinate_domains[slot] = nil
		sources[slot] = nil
		position_words[slot] = nil
	end
	row.row_index = row_index
	row.source_count = 0
	row.first_visible_source = 1
	row.last_visible_source = 0
	row.dirty = true
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
	local sources<const> = row.sources
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
			sources[source_count] = source
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
		sources[slot] = nil
		position_words[slot] = nil
	end
	row.source_count = source_count
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

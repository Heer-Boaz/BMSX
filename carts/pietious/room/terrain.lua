-- The cart packer owns immutable terrain layout. Here the palette projects
-- semantic art onto the atlas's current placement without touching any room tape.
local image<const> = require('cartlib/gx/image')
local atlas<const> = require('cartlib/gx/atlas')
local commands<const> = require('cartlib/gx/command_list')
local body_capacity<const> = require('room/terrain_layout').body_words
local bin<const> = require('cartlib/bin')
local assets<const> = require('bmsx/assets')
require('constants')

bss modes: word[256]
bss uvs: word[256]
bss room_body: word[body_capacity]
local art_sources
local projected_revision
local projected_rows
local body_words
local body_mode

local terrain<const> = {
	tape = assets.bin_pietious_terrain_tape_addr,
}

-- A stair span has a tile column, an inclusive first row and an exclusive end.
-- The player locks against its foot coordinate, one tile above the first row.
function terrain.stair_bounds(span)
	return room_tile_origin_x + (span & 0xff) * room_tile_size,
		room_tile_origin_y + (((span >> 8) & 0xff) - 1) * room_tile_size - player_height,
		room_tile_origin_y + (span >> 16) * room_tile_size - player_height
end

function terrain.bind_art()
	local names<const> = bin.decode(assets.data_pietious_terrain_art_addr, 'pietious terrain art')
	for ordinal = 1, #names do
		names[ordinal] = image.resolve(names[ordinal])
	end
	art_sources = names
	projected_revision = -1
end

function terrain.draw(draw, rows, row_count, origin_x, origin_y)
	local revision<const> = atlas.placement_revision
	if projected_revision ~= revision then
		local mode_words<const>: *word = modes
		local uv_words<const>: *word = uvs
		for ordinal = 1, #art_sources do
			local source<const> = art_sources[ordinal]
			mode_words[ordinal] = source._blit_draw_mode
			uv_words[ordinal] = source._blit_uv_word
		end
		projected_revision = revision
		projected_rows = nil
	end
	if projected_rows ~= rows then
		body_words, body_mode = commands.prepare_fixed_tile_tape(room_body, terrain.tape,
			rows, row_count, room_tile_size, modes, uvs)
		projected_rows = rows
	end
	commands.append_fixed_tile_tape(draw, room_body, body_words, body_mode, origin_x, origin_y)
end

return terrain

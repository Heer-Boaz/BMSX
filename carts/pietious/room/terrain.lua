-- The cart packer owns immutable terrain layout. Here the palette projects
-- semantic art onto the atlas's current placement without touching any room tape.
local image<const> = require('cartlib/gx/image')
local atlas<const> = require('cartlib/gx/atlas')
local bin<const> = require('cartlib/bin')
local assets<const> = require('bmsx/assets')

local tile_chars<const> = {
	wall = string.byte('#'),
	breakable_wall = string.byte('$'),
	stair_left = string.byte('-'),
	stair_left_alt = string.byte('_'),
	stair_right = string.byte('='),
	stair_right_alt = string.byte('+'),
	rock_ul = 0xba,
	rock_ur = 0xbb,
	rock_dl = 0xbc,
	rock_dr = 0xbd,
	pillar_l1 = string.byte('p'),
	pillar_r1 = string.byte('i'),
	pillar_mid = string.byte('l'),
	pillar_l3 = string.byte('a'),
	pillar_r3 = string.byte('r'),
	empty = string.byte('.'),
}
local solid_tiles<const> = {
	[tile_chars.wall] = true,
	[tile_chars.breakable_wall] = true,
	[tile_chars.rock_ul] = true,
	[tile_chars.rock_ur] = true,
	[tile_chars.rock_dl] = true,
	[tile_chars.rock_dr] = true,
}
local stair_left_tiles<const> = {
	[tile_chars.stair_left] = true,
	[tile_chars.stair_left_alt] = true,
}
local stair_right_tiles<const> = {
	[tile_chars.stair_right] = true,
	[tile_chars.stair_right_alt] = true,
}
bss modes: word[256]
bss uvs: word[256]
local art_sources
local projected_revision

local terrain<const> = {
	tile_chars = tile_chars,
	solid_tiles = solid_tiles,
	stair_left_tiles = stair_left_tiles,
	stair_right_tiles = stair_right_tiles,
	tape = assets.bin_pietious_terrain_tape_addr,
	modes = modes,
	uvs = uvs,
}

function terrain.bind_art()
	local names<const> = bin.decode(assets.data_pietious_terrain_art_addr, 'pietious terrain art')
	for ordinal = 1, #names do
		names[ordinal] = image.resolve(names[ordinal])
	end
	art_sources = names
	projected_revision = -1
end

function terrain.project_art()
	local revision<const> = atlas.placement_revision
	if projected_revision == revision then return end
	local mode_words<const>: *word = modes
	local uv_words<const>: *word = uvs
	for ordinal = 1, #art_sources do
		local source<const> = art_sources[ordinal]
		mode_words[ordinal] = source._blit_draw_mode
		uv_words[ordinal] = source._blit_uv_word
	end
	projected_revision = revision
end

return terrain

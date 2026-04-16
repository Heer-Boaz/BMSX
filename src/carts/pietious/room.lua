local constants<const> = require('constants')
local castle_map<const> = require('castle_map')
local timeline<const> = require('timeline')

local room<const> = {}
local water_surface_timeline_id<const> = 'r.ws'
local empty_tile_handle<const> = 0xffffffff
local tile_run_arg_words<const> = 11
local tile_run_payload_word_offset<const> = sys_vdp_stream_packet_header_words + tile_run_arg_words
local water_surface_frame_imgids<const> = {
	'water_surface_msx',
}
local water_surface_timeline_frame_defs<const> = {
	{ value = 1, hold = 1 },
}
for i = 1, 63 do
	local suffix<const> = string.format('%02d', i)
	water_surface_frame_imgids[i + 1] = 'water_surface_msx_' .. suffix
	water_surface_timeline_frame_defs[i + 1] = { value = i + 1, hold = 1 }
end
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
local breakable_wall_kinds<const> = {
	breakablewall = true,
	disappearingwall = true,
}
local rock_tile_width<const> = constants.rock.width / constants.room.tile_size
local rock_tile_height<const> = constants.rock.height / constants.room.tile_size
local rock_logic_tiles<const> = {
	{ tile_chars.rock_ul, tile_chars.rock_ur },
	{ tile_chars.rock_dl, tile_chars.rock_dr },
}
local world_dissolve_prefix_by_tile_id<const> = {
	backworld_ul = 'backworld_ul_dissolve_',
	backworld_ul_dark = 'backworld_ul_dissolve_',
	backworld_ur = 'backworld_ur_dissolve_',
	backworld_ur_dark = 'backworld_ur_dissolve_',
	backworld_dl = 'backworld_dl_dissolve_',
	backworld_dl_dark = 'backworld_dl_dissolve_',
	backworld_dr = 'backworld_dr_dissolve_',
	backworld_dr_dark = 'backworld_dr_dissolve_',
}

local background_themes<const> = {
	castleblue = {
		mode = 'checker2',
		front = 'castle_front_blue_1',
		light_l = 'castle_tile_blue_l',
		light_r = 'castle_tile_blue_r',
		dark_l = 'castle_tile_blue_l_dark',
		dark_r = 'castle_tile_blue_r_dark',
	},
	castlegarden = {
		mode = 'grid4',
		front = 'castle_front_blue_1',
		tiles = {
			{ 'castle_tile_garden_1_1', 'castle_tile_garden_2_1', 'castle_tile_garden_3_1', 'castle_tile_garden_4_1' },
			{ 'castle_tile_garden_1_2', 'castle_tile_garden_2_2', 'castle_tile_garden_3_2', 'castle_tile_garden_4_2' },
			{ 'castle_tile_garden_1_3', 'castle_tile_garden_2_3', 'castle_tile_garden_3_3', 'castle_tile_garden_4_3' },
			{ 'castle_tile_garden_1_4', 'castle_tile_garden_2_4', 'castle_tile_garden_3_4', 'castle_tile_garden_4_4' },
		},
		dark_tiles = {
			'castle_tile_garden_dark_1',
			'castle_tile_garden_dark_2',
			'castle_tile_garden_dark_3',
			'castle_tile_garden_dark_4',
		},
	},
	castlegold = {
		mode = 'checker2',
		front = 'castle_front_gold_1',
		light_l = 'castle_tile_gold_l',
		light_r = 'castle_tile_gold_r',
		dark_l = 'castle_tile_gold_l_dark',
		dark_r = 'castle_tile_gold_r_dark',
	},
	castlered = {
		mode = 'grid4',
		front = 'castle_front_blue_1',
		tiles = {
			{ 'castle_tile_red_1_1', 'castle_tile_red_2_1', 'castle_tile_red_3_1', 'castle_tile_red_4_1' },
			{ 'castle_tile_red_1_2', 'castle_tile_red_2_2', 'castle_tile_red_3_2', 'castle_tile_red_4_2' },
			{ 'castle_tile_red_1_3', 'castle_tile_red_2_3', 'castle_tile_red_3_3', 'castle_tile_red_4_3' },
			{ 'castle_tile_red_1_4', 'castle_tile_red_2_4', 'castle_tile_red_3_4', 'castle_tile_red_4_4' },
		},
		dark_tiles = {
			'castle_tile_red_dark_1',
			'castle_tile_red_dark_2',
			'castle_tile_red_dark_3',
			'castle_tile_red_dark_4',
		},
	},
	castlestone = {
		mode = 'grid4',
		front = 'castle_front_blue_1',
		tiles = {
			{ 'castle_tile_stone_1_1', 'castle_tile_stone_2_1', 'castle_tile_stone_3_1', 'castle_tile_stone_4_1' },
			{ 'castle_tile_stone_1_2', 'castle_tile_stone_2_2', 'castle_tile_stone_3_2', 'castle_tile_stone_4_2' },
			{ 'castle_tile_stone_1_3', 'castle_tile_stone_2_3', 'castle_tile_stone_3_3', 'castle_tile_stone_4_3' },
			{ 'castle_tile_stone_1_4', 'castle_tile_stone_2_4', 'castle_tile_stone_3_4', 'castle_tile_stone_4_4' },
		},
		dark_tiles = {
			'castle_tile_stone_dark_1',
			'castle_tile_stone_dark_2',
			'castle_tile_stone_dark_3',
			'castle_tile_stone_dark_4',
		},
	},
	world = {
		mode = 'world4',
		front = 'frontworld_l',
		ul = 'backworld_ul',
		ur = 'backworld_ur',
		dl = 'backworld_dl',
		dr = 'backworld_dr',
		ul_dark = 'backworld_ul_dark',
		ur_dark = 'backworld_ur_dark',
		dl_dark = 'backworld_dl_dark',
		dr_dark = 'backworld_dr_dark',
	},
}

local room_hidden_mode_events<const> = {
	'transition',
	'halo',
	'shrine',
	'item',
	'lithograph',
	'title',
	'title_wait',
	'story',
	'ending',
	'victory_dance',
	'death',
}

local room_visible_mode_events<const> = {
	'room',
	'seal_dissolution',
	'daemon_appearance',
	'player.shrine_overlay_exit',
	'player.world_emerge',
}

local pillar_themes<const> = {
	castleblue = {
		l1 = 'castle_pillar_blue_l1',
		r1 = 'castle_pillar_blue_r1',
		l2 = 'castle_pillar_blue_l2',
		r2 = 'castle_pillar_blue_r2',
		l3 = 'castle_pillar_blue_l3',
		r3 = 'castle_pillar_blue_r3',
	},
	castlegarden = {
		l1 = 'castle_pillar_garden_l1',
		r1 = 'castle_pillar_garden_r1',
		l2 = 'castle_pillar_garden_l2',
		r2 = 'castle_pillar_garden_r2',
		l3 = 'castle_pillar_garden_l3',
		r3 = 'castle_pillar_garden_r3',
	},
	castlegold = {
		l1 = 'castle_pillar_red_l1',
		r1 = 'castle_pillar_red_r1',
		l2 = 'castle_pillar_red_l2',
		r2 = 'castle_pillar_red_r2',
		l3 = 'castle_pillar_red_l3',
		r3 = 'castle_pillar_red_r3',
	},
	castlered = {
		l1 = 'castle_pillar_red_l1',
		r1 = 'castle_pillar_red_r1',
		l2 = 'castle_pillar_red_l2',
		r2 = 'castle_pillar_red_r2',
		l3 = 'castle_pillar_red_l3',
		r3 = 'castle_pillar_red_r3',
	},
	castlestone = {
		l1 = 'castle_pillar_stone_l1',
		r1 = 'castle_pillar_stone_r1',
		l2 = 'castle_pillar_stone_l2',
		r2 = 'castle_pillar_stone_r2',
		l3 = 'castle_pillar_stone_l3',
		r3 = 'castle_pillar_stone_r3',
	},
	world = {
		l1 = 'backworld_pillar_l1',
		r1 = 'backworld_pillar_r1',
		l2 = 'backworld_pillar_l2',
		r2 = 'backworld_pillar_r2',
		l3 = 'backworld_pillar_l3',
		r3 = 'backworld_pillar_r3',
	},
}

local build_screen_rows<const> = function(map_rows, draaideuren, tile_size, origin_x, origin_y)
	local screen_rows<const> = {}
	for y = 1, #map_rows do
		screen_rows[y] = map_rows[y]
	end

	for i = 1, #draaideuren do
		local draaideur<const> = draaideuren[i]
		local tx<const> = ((draaideur.x - origin_x) // tile_size) + 1
		local ty<const> = ((draaideur.y - origin_y) // tile_size) + 1
		for row = ty, ty + 2 do
			local line<const> = screen_rows[row]
			screen_rows[row] = line:sub(1, tx - 1) .. '.' .. line:sub(tx + 1)
		end
	end

	return screen_rows
end

local set_row_byte<const> = function(row, tx, byte)
	return row:sub(1, tx - 1) .. string.char(byte) .. row:sub(tx + 1)
end

local create_tile_id<const> = function(ch, x, y, map_rows, room_subtype)
	local background<const> = background_themes[room_subtype]
	local pillars<const> = pillar_themes[room_subtype]

	if ch == tile_chars.wall then
		return background.front
	end
	if ch == tile_chars.breakable_wall then
		if background.front_dissolve ~= nil then
			return background.front_dissolve
		end
		return background.front
	end
	if stair_left_tiles[ch] then
		return 'castle_stairs_l'
	end
	if stair_right_tiles[ch] then
		return 'castle_stairs_r'
	end
	if ch == tile_chars.pillar_l1 then
		return pillars.l1
	end
	if ch == tile_chars.pillar_r1 then
		return pillars.r1
	end
	if ch == tile_chars.pillar_mid then
		if y > 1 and y < #map_rows then
			local ch_up<const> = string.byte(map_rows[y - 1], x)
			local ch_down<const> = string.byte(map_rows[y + 1], x)
			if ch_up == tile_chars.pillar_l1 and ch_down == tile_chars.pillar_l3 then
				return pillars.l2
			end
			if ch_up == tile_chars.pillar_r1 and ch_down == tile_chars.pillar_r3 then
				return pillars.r2
			end
		end
	end
	if ch == tile_chars.pillar_l3 then
		return pillars.l3
	end
	if ch == tile_chars.pillar_r3 then
		return pillars.r3
	end

	if background.mode == 'grid4' then
		local wall_up<const> = y > 1 and solid_tiles[string.byte(map_rows[y - 1], x)]
		if wall_up then
			local dark_index<const> = ((x - 1) % 4) + 1
			return background.dark_tiles[dark_index]
		end

		local tx<const> = ((x - 1) % 4) + 1
		local ty<const> = ((y - 1) % 4) + 1
		return background.tiles[ty][tx]
	end

	if background.mode == 'world4' then
		local dark<const> = y > 1 and solid_tiles[string.byte(map_rows[y - 1], x)]
		local left_column<const> = ((x - 1) % 2) == 0
		local row_mod<const> = (y - 1) % 4
		if row_mod == 0 then
			if left_column then
				return dark and background.ul_dark or background.ul
			end
			return dark and background.ur_dark or background.ur
		end
		if row_mod == 1 then
			if left_column then
				return dark and background.dl_dark or background.dl
			end
			return dark and background.dr_dark or background.dr
		end
		if row_mod == 2 then
			if left_column then
				return dark and background.ur_dark or background.ur
			end
			return dark and background.ul_dark or background.ul
		end
		if left_column then
			return dark and background.dr_dark or background.dr
		end
		return dark and background.dl_dark or background.dl
	end

	local is_left_column<const> = ((x - 1) % 2) == 0
	local is_top_row<const> = ((y - 1) % 2) == 0
	if is_top_row then
		local dark<const> = y > 1 and solid_tiles[string.byte(map_rows[y - 1], x)]
		if is_left_column then
			if dark then
				return background.dark_l
			end
			return background.light_l
		end
		if dark then
			return background.dark_r
		end
		return background.light_r
	end

	local dark<const> = solid_tiles[string.byte(map_rows[y - 1], x)]
	if is_left_column then
		if dark then
			return background.dark_r
		end
		return background.light_r
	end
	if dark then
		return background.dark_l
	end
	return background.light_l
end

local build_solids<const> = function(map_rows, tile_size, origin_x, origin_y)
	local solids<const> = {}
	local rows<const> = #map_rows
	local cols<const> = #map_rows[1]
	for y = 1, rows do
		local row<const> = map_rows[y]
		local run_start = 0
		for x = 1, cols + 1 do
			local is_solid<const> = x <= cols and solid_tiles[string.byte(row, x)]
			if is_solid and run_start == 0 then
				run_start = x
			elseif (not is_solid) and run_start ~= 0 then
				local run_width_tiles<const> = x - run_start
				solids[#solids + 1] = {
					x = origin_x + ((run_start - 1) * tile_size),
					y = origin_y + ((y - 1) * tile_size),
					w = run_width_tiles * tile_size,
					h = tile_size,
				}
				run_start = 0
			end
		end
	end
	return solids
end

local build_logic_rows<const> = function(room_state)
	local logic_rows<const> = {}
	for y = 1, #room_state.map_rows do
		logic_rows[y] = room_state.map_rows[y]
	end

	local destroyed_rock_ids<const> = room_state.destroyed_rock_ids
	for i = 1, #room_state.rocks do
		local rock<const> = room_state.rocks[i]
		if not destroyed_rock_ids[rock.id] then
			local tx0<const> = ((rock.x - room_state.tile_origin_x) // room_state.tile_size) + 1
			local ty0<const> = ((rock.y - room_state.tile_origin_y) // room_state.tile_size) + 1
			for dy = 1, rock_tile_height do
				local ty<const> = ty0 + dy - 1
				local row = logic_rows[ty]
				for dx = 1, rock_tile_width do
					row = set_row_byte(row, tx0 + dx - 1, rock_logic_tiles[dy][dx])
				end
				logic_rows[ty] = row
			end
		end
	end

	return logic_rows
end

local build_stairs<const> = function(map_rows, tile_size, origin_x, origin_y, player_height)
	local stairs<const> = {}
	local row_count<const> = #map_rows
	local column_count<const> = #map_rows[1]

	for tx = 1, column_count - 1 do
		local ty = 1
		while ty <= row_count do
			local row<const> = map_rows[ty]
			local left<const> = string.byte(row, tx)
			local right<const> = string.byte(row, tx + 1)
			if stair_left_tiles[left] and stair_right_tiles[right] then
				local min_row<const> = ty
				local max_row
				max_row = ty
				ty = ty + 1
				while ty <= row_count do
					local next_row<const> = map_rows[ty]
					local next_left<const> = string.byte(next_row, tx)
					local next_right<const> = string.byte(next_row, tx + 1)
					if not (stair_left_tiles[next_left] and stair_right_tiles[next_right]) then
						break
					end
					max_row = ty
					ty = ty + 1
				end

				local x<const> = origin_x + ((tx - 1) * tile_size)
				local anchor_y<const> = origin_y + ((min_row - 1) * tile_size)
				local top_y<const> = origin_y + ((min_row - 2) * tile_size) - player_height
				local bottom_y<const> = origin_y + (max_row * tile_size) - player_height
				stairs[#stairs + 1] = {
					x = x,
					anchor_y = anchor_y,
					top_y = top_y,
					bottom_y = bottom_y,
					min_row = min_row,
					max_row = max_row,
				}
			else
				ty = ty + 1
			end
		end
	end

	return stairs
end

local water_kind_at_tile<const> = function(room_state, tx, ty)
	local water<const> = room_state.water
	if water == nil then
		return constants.water.none
	end
	if ty < water.surface_row or ty > room_state.tile_rows then
		return constants.water.none
	end
	if tx < 1 or tx > room_state.tile_columns then
		return constants.water.none
	end
	if solid_tiles[string.byte(room_state.logic_rows[ty], tx)] then
		return constants.water.none
	end
	if ty == water.surface_row then
		return constants.water.surface
	end
	return constants.water.body
end

local player_water_kind_at_tile<const> = function(room_state, tx, ty)
	local water<const> = room_state.water
	if water == nil then
		return constants.water.none
	end
	if ty < water.surface_row or ty > room_state.tile_rows then
		return constants.water.none
	end
	if tx < 1 or tx > room_state.tile_columns then
		return constants.water.none
	end
	if solid_tiles[string.byte(room_state.logic_rows[ty], tx)] then
		return constants.water.none
	end
	if ty == water.surface_row then
		return constants.water.surface
	end
	return constants.water.body
end

local rebuild_room_logic<const> = function(room_state)
	local logic_rows<const> = build_logic_rows(room_state)
	room_state.logic_rows = logic_rows
	room_state.solids = build_solids(logic_rows, constants.room.tile_size, constants.room.tile_origin_x, constants.room.tile_origin_y)
	room_state.stairs = build_stairs(logic_rows, constants.room.tile_size, constants.room.tile_origin_x, constants.room.tile_origin_y, constants.player.height)
end

local refresh_room_geometry<const> = function(room_state)
	rebuild_room_logic(room_state)
	room_state:rebuild_room_tiles()
end

--[[
Room tile-run caching
=====================

This room renderer does NOT own a private "reserved" RAM region for its tile
payloads. The persistent state lives in normal Lua tables on the room object:

	- self.room_tile_handles
	- self.water_tile_handles
	- self.water_surface_tile_indices

Those tables are the real cache. They survive across frames, room visibility
changes, water animation frames, and room-geometry rebuilds until we explicitly
rebuild them.

The VDP packet memory is different:

	- every game tick, the cart resets vdp_stream_cursor back to sys_vdp_stream_base
	- draw code then claims packet space again in the same tick order
	- the stream is therefore a transient submission buffer, not a stable object
	  store owned by this room

However, resetting the cursor does NOT zero the underlying RAM. That gives us a
useful optimization:

	1. claim the same amount of stream space every game tick
	2. remember the previously claimed packet_base
	3. if the new claim returns the same packet_base and our cached tile data is
	   still valid, do not rewrite the packet payload
	4. if the base moved, or the tile data changed, rewrite the packet

So the trick is:

	- persistent tile state in Lua
	- opportunistic reuse of the same VDP stream slot
	- explicit dirty tracking whenever room/water data changes

This is why we keep:

	- *_packet_base       -> last claimed stream address
	- *_packet_dirty      -> full payload/header must be rewritten
	- water_surface_dirty -> only the animated water-surface slice must be patched

This also explains why hide_room_tiles() invalidates the remembered packet base:

	- once the room stops submitting those packets, other draw code is free to
	  claim that part of the stream
	- so when the room becomes visible again, we must assume nothing about the old
	  address and force a fresh write if needed

The important consequence is that we no longer pay the expensive per-frame work
that the old code did:

	- no per-frame create_tile_id(...) over the whole room
	- no per-frame assets.img[...] handle resolution over the whole room
	- no per-frame rebuild of full room/water tile arrays
	- no per-frame rewrite of the entire tile-run payload when nothing moved

The only always-on work left in the hot path is:

	- claim the stream slot
	- compare packet_base
	- submit nothing if the old packet contents are still valid

For water animation we go even smaller:

	- rebuild_room_tiles() precalculates exactly which tile indices are water
	  surface tiles
	- sync_water_surface_frame() only updates those cached handles in Lua
	- render_water() then patches only those payload words when the frame changed

This is not a general engine feature or a RAM allocator. It is a cart-level
optimization that exploits the current VDP stream behavior in a controlled way.
If the engine later gets a true persistent tile-run API, that would be the
cleaner long-term abstraction. For now, this keeps the current design fast
without inventing new infrastructure.
]]
local write_tile_run_header<const> = function(base, tile_count, cols, rows, tile_size, origin_x, origin_y)
	memwrite(
		base,
		sys_vdp_cmd_tile_run,
		tile_run_arg_words,
		tile_count,
		tile_count,
		cols,
		rows,
		tile_size,
		tile_size,
		origin_x,
		origin_y,
		0,
		0,
		0,
		sys_vdp_layer_world
	)
end

local write_tile_run_payload<const> = function(payload_dst, handles, tile_count)
	for i = 1, tile_count do
		mem[payload_dst + ((i - 1) * sys_vdp_arg_stride)] = handles[i]
	end
end

local patch_tile_run_payload<const> = function(payload_dst, handles, indices, count)
	for i = 1, count do
		local tile_index<const> = indices[i]
		mem[payload_dst + ((tile_index - 1) * sys_vdp_arg_stride)] = handles[tile_index]
	end
end

local apply_room_template<const> = function(room_state, template)
	local map_rows<const> = build_screen_rows(
		template.map_rows,
		template.draaideuren,
		constants.room.tile_size,
		constants.room.tile_origin_x,
		constants.room.tile_origin_y
	)

	room_state.room_number = template.room_number
	room_state.world_number = template.world_number
	room_state.room_subtype = template.room_subtype
	room_state.custom = template.custom
	room_state.room_dissolve_step = 0
	room_state.seal_dissolve_step = 0
	room_state.world_width = constants.room.width
	room_state.world_height = constants.room.height
	room_state.world_top = constants.room.hud_height
	room_state.spawn = template.spawn
	room_state.tile_size = constants.room.tile_size
	room_state.tile_origin_x = constants.room.tile_origin_x
	room_state.tile_origin_y = constants.room.tile_origin_y
	room_state.tile_rows = #map_rows
	room_state.tile_columns = #map_rows[1]
	room_state.map_rows = map_rows
	room_state.water = template.water
	room_state.enemies = template.enemies
	room_state.rocks = template.rocks
	room_state.items = template.items
	room_state.lithographs = template.lithographs
	room_state.shrines = template.shrines
	room_state.seal = template.seal
	room_state.world_entrances = template.world_entrances
	room_state.draaideuren = template.draaideuren
	room_state.room_links = template.room_links
	room_state.edge_gates = template.edge_gates
	rebuild_room_logic(room_state)
end

local room_object<const> = {}
room_object.__index = room_object

function room_object:load_room(room_number)
	local target_room_number<const> = room_number or castle_map.start_room_number
	apply_room_template(self, castle_map.room_templates[target_room_number])
	self:rebuild_room_tiles()
end

function room_object:patch_rows(rows)
	local changed
	for i = 1, #rows do
		local patch<const> = rows[i]
		local row_index<const> = patch.index
		local row_value<const> = patch.value
		if self.map_rows[row_index] ~= row_value then
			self.map_rows[row_index] = row_value
			changed = true
		end
	end
	if changed then
		refresh_room_geometry(self)
	end
	return changed
end

function room_object:apply_progression_command(command)
	if command.room_number ~= nil and command.room_number ~= oget('c').current_room_number then
		return false
	end
	if command.op == 'room.patch_rows' then
		return self:patch_rows(command.rows)
	end
	error("Unsupported room progression command op '" .. tostring(command.op) .. "'.")
end

function room_object:world_to_tile(world_x, world_y)
	local tx<const> = ((world_x - self.tile_origin_x) // self.tile_size) + 1
	local ty<const> = ((world_y - self.tile_origin_y) // self.tile_size) + 1
	return tx, ty
end

function room_object:tile_to_world(tx, ty)
	local world_x<const> = self.tile_origin_x + ((tx - 1) * self.tile_size)
	local world_y<const> = self.tile_origin_y + ((ty - 1) * self.tile_size)
	return world_x, world_y
end

function room_object:snap_world_to_tile(world_x, world_y)
	local tx<const>, ty<const> = self:world_to_tile(world_x, world_y)
	return self:tile_to_world(tx, ty)
end

function room_object:base_collision_flags_at_tile(tx, ty)
	if ty < 1 or ty > self.tile_rows then
		return constants.collision_flags.none
	end
	if tx < 1 or tx > self.tile_columns then
		return constants.collision_flags.none
	end
	local collision = 0
	if solid_tiles[string.byte(self.logic_rows[ty], tx)] then
		collision = collision | constants.collision_flags.wall
	end
	if self:is_active_draaideur_at_tile(tx, ty) then
		collision = collision | constants.collision_flags.wall
	end
	if self:is_active_breakable_wall_at_tile(tx, ty) then
		collision = collision | constants.collision_flags.wall
	end
	return collision
end

function room_object:mark_rock_destroyed(rock_id)
	self.destroyed_rock_ids[rock_id] = true
	rebuild_room_logic(self)
	self:rebuild_room_tiles()
end

function room_object:water_kind_at_world(world_x, world_y)
	local tx<const>, ty<const> = self:world_to_tile(world_x, world_y)
	return water_kind_at_tile(self, tx, ty)
end

function room_object:player_water_kind_at_world(world_x, world_y)
	local tx<const>, ty<const> = self:world_to_tile(world_x, world_y)
	return player_water_kind_at_tile(self, tx, ty)
end

function room_object:collision_flags_at_tile(tx, ty, include_elevator)
	local collision = self:base_collision_flags_at_tile(tx, ty)
	local use_elevator = include_elevator
	if use_elevator == nil then
		use_elevator = true
	end
	if use_elevator and self:is_active_elevator_at_tile(tx, ty) then
		collision = collision | constants.collision_flags.elevator
	end
	return collision
end

function room_object:overlaps_active_elevator(x, y, w, h)
	local elevator_count<const> = oget('c').elevator_count
	for i = 1, elevator_count do
		local platform<const> = oget('e.p' .. tostring(i))
		if platform.current_room_number == self.room_number
			and rect_overlaps(x, y, w, h, platform.x, platform.y, constants.room.tile_size4, constants.room.tile_size2)
		then
			return true
		end
	end
	return false
end

function room_object:is_active_elevator_at_tile(tx, ty)
	local world_x<const>, world_y<const> = self:tile_to_world(tx, ty)
	return self:overlaps_active_elevator(world_x, world_y, self.tile_size, self.tile_size)
end

function room_object:overlaps_active_breakable_wall(x, y, w, h)
	local enemy_defs<const> = self.enemies
	for i = 1, #enemy_defs do
		local enemy_def<const> = enemy_defs[i]
		if breakable_wall_kinds[enemy_def.kind] then
			local wall<const> = oget(enemy_def.id)
			if wall ~= nil and wall.active and wall.space_id == 'main' then
				local wall_width<const> = enemy_def.width_tiles * self.tile_size
				local wall_height<const> = enemy_def.height_tiles * self.tile_size
				if rect_overlaps(x, y, w, h, enemy_def.x, enemy_def.y, wall_width, wall_height) then
					return true
				end
			end
		end
	end
	return false
end

function room_object:overlaps_active_draaideur(x, y, w, h)
	local tx0, ty0 = self:world_to_tile(x, y)
	local tx1, ty1 = self:world_to_tile(x + w - 1, y + h - 1)
	if tx1 < tx0 then
		tx0, tx1 = tx1, tx0
	end
	if ty1 < ty0 then
		ty0, ty1 = ty1, ty0
	end

	for ty = ty0, ty1 do
		for tx = tx0, tx1 do
			if self:is_active_draaideur_at_tile(tx, ty) then
				return true
			end
		end
	end
	return false
end

function room_object:is_active_draaideur_at_tile(tx, ty)
	if ty < 1 or ty > self.tile_rows then
		return false
	end
	if tx < 1 or tx > self.tile_columns then
		return false
	end

	local draaideuren<const> = self.draaideuren
	for i = 1, #draaideuren do
		local door_def<const> = draaideuren[i]
		local door_tx<const> = ((door_def.x - self.tile_origin_x) // self.tile_size) + 1
		local door_ty<const> = ((door_def.y - self.tile_origin_y) // self.tile_size) + 1
		if tx == door_tx and ty >= door_ty and ty <= door_ty + 2 then
			local draaideur<const> = oget(door_def.id)
			if draaideur ~= nil and draaideur.state >= 0 then
				return true
			end
		end
	end
	return false
end

function room_object:is_active_breakable_wall_at_tile(tx, ty)
	local world_x<const>, world_y<const> = self:tile_to_world(tx, ty)
	return self:overlaps_active_breakable_wall(world_x, world_y, self.tile_size, self.tile_size)
end

function room_object:has_collision_flags_at_tile(tx, ty, mask)
	return (self:collision_flags_at_tile(tx, ty) & mask) ~= 0
end

function room_object:collision_flags_at_world(world_x, world_y, include_elevator)
	local tx<const>, ty<const> = self:world_to_tile(world_x, world_y)
	return self:collision_flags_at_tile(tx, ty, include_elevator)
end

function room_object:has_collision_flags_at_world(world_x, world_y, mask, include_elevator)
	return (self:collision_flags_at_world(world_x, world_y, include_elevator) & mask) ~= 0
end

function room_object:has_collision_flags_in_rect(x, y, w, h, mask, include_elevator)
	local tx0, ty0 = self:world_to_tile(x, y)
	local tx1, ty1 = self:world_to_tile(x + w - 1, y + h - 1)
	if tx1 < tx0 then
		tx0, tx1 = tx1, tx0
	end
	if ty1 < ty0 then
		ty0, ty1 = ty1, ty0
	end

	for ty = ty0, ty1 do
		for tx = tx0, tx1 do
			if (self:collision_flags_at_tile(tx, ty, include_elevator) & mask) ~= 0 then
				return true
			end
		end
	end

	return false
end

function room_object:overlaps_solid_rect(x, y, w, h)
	local solids<const> = self.solids
	for i = 1, #solids do
		local solid<const> = solids[i]
		if rect_overlaps(x, y, w, h, solid.x, solid.y, solid.w, solid.h) then
			return true
		end
	end
	if self:overlaps_active_elevator(x, y, w, h) then
		return true
	end
	if self:overlaps_active_draaideur(x, y, w, h) then
		return true
	end
	return self:overlaps_active_breakable_wall(x, y, w, h)
end

function room_object:find_near_lithograph(player)
	local lithograph_defs<const> = self.lithographs
	local player_left<const> = player.x
	local player_top<const> = player.y
	local player_right<const> = player.x + player.width
	local player_bottom<const> = player.y + player.height

	for i = 1, #lithograph_defs do
		local lithograph<const> = oget(lithograph_defs[i].id)
		local area_left<const> = lithograph.x + constants.lithograph.hit_left_px
		local area_top<const> = lithograph.y + constants.lithograph.hit_top_px
		local area_right<const> = lithograph.x + constants.lithograph.hit_right_px
		local area_bottom<const> = lithograph.y + constants.lithograph.hit_bottom_px
		if player_right >= area_left and player_left <= area_right and player_bottom >= area_top and player_top <= area_bottom then
			return lithograph
		end
	end

	return nil
end

function room_object:switch_room(direction)
	local from_room_number<const> = oget('c').current_room_number
	local target_room_number<const> = self.room_links[direction]

	if target_room_number < 0 then
		return {
			from_room_number = from_room_number,
			to_room_number = target_room_number,
			direction = direction,
			outside = true,
		}
	end

	apply_room_template(self, castle_map.room_templates[target_room_number])
	self:rebuild_room_tiles()
	return {
		from_room_number = from_room_number,
		to_room_number = target_room_number,
		direction = direction,
	}
end

function room_object:bind_visual()
	local rc<const> = self:get_component('customvisualcomponent')
	rc.producer = function(_ctx)
		self:render_room()
	end
end

function room_object:bind()
	for i = 1, #room_hidden_mode_events do
		local event_name<const> = room_hidden_mode_events[i]
		self.events:on({
			event = event_name,
			emitter = 'd',
			subscriber = self,
			handler = function()
				self:hide_room_tiles()
			end,
		})
	end
	for i = 1, #room_visible_mode_events do
		local event_name<const> = room_visible_mode_events[i]
		self.events:on({
			event = event_name,
			emitter = 'd',
			subscriber = self,
			handler = function()
				self:show_room_tiles()
			end,
		})
	end
end

function room_object:ctor()
	self.destroyed_rock_ids = {}
	self.logic_rows = {}
	self.room_tile_handles = {}
	self.room_tile_handle_count = 0
	self.room_tile_count = 0
	self.room_tile_packet_words = 0
	self.room_tile_packet_base = nil
	self.room_tile_packet_dirty = true
	self.water_tile_handles = {}
	self.water_tile_handle_count = 0
	self.water_tile_count = 0
	self.water_rows = 0
	self.water_tile_packet_words = 0
	self.water_tile_packet_base = nil
	self.water_tile_packet_dirty = true
	self.water_surface_tile_indices = {}
	self.water_surface_tile_count = 0
	self.water_surface_dirty = false
	self.last_water_surface_frame = 1
	self.water_surface_handles = {}
	for i = 1, #water_surface_frame_imgids do
		self.water_surface_handles[i] = assets.img[water_surface_frame_imgids[i]].handle
	end
	self.water_body_handle = assets.img.water_body_msx.handle
	self.tiles_visible = false
	self:bind_visual()
	self:bind()
end

function room_object:hide_room_tiles()
	self.tiles_visible = false
	-- The stream cursor resets every frame, but other draws may reuse this slot
	-- while the room is hidden. Forget the old base so the next visible submit
	-- always treats the packet as needing a fresh write at its new claim site.
	self.room_tile_packet_base = nil
	self.water_tile_packet_base = nil
end

function room_object:show_room_tiles()
	self.tiles_visible = true
end

function room_object:rebuild_room_tiles()
	-- Build the persistent Lua-side handle caches once for the current room
	-- geometry/state. This is the expensive path and should only run when room
	-- data actually changes: room load, row patch, rock destruction, dissolve
	-- phase change, etc.
	local images<const> = assets.img
	local prev_room_tile_handle_count<const> = self.room_tile_handle_count
	local tile_columns<const> = self.tile_columns
	local tile_rows<const> = self.tile_rows
	local tile_count<const> = tile_columns * tile_rows
	local dissolve_step<const> = self.room_dissolve_step
	local room_tile_handles<const> = self.room_tile_handles

	for y = 1, tile_rows do
		local row_base<const> = ((y - 1) * tile_columns)
		local map_row<const> = self.map_rows[y]
		for x = 1, tile_columns do
			local tile_index<const> = row_base + x
			local tile_id = create_tile_id(string.byte(map_row, x), x, y, self.map_rows, self.room_subtype)
			if dissolve_step > 0 then
				local dissolve_index<const> = dissolve_step - 1
				if self.room_subtype == 'world' and string.byte(map_row, x) == tile_chars.breakable_wall then
					if dissolve_index >= 6 then
						room_tile_handles[tile_index] = empty_tile_handle
						goto continue
					end
					local wall_phase<const> = ((x + (y * 3)) % 6) + 1
					if dissolve_index >= wall_phase then
						room_tile_handles[tile_index] = empty_tile_handle
						goto continue
					end
				end
				local dissolve_prefix<const> = world_dissolve_prefix_by_tile_id[tile_id]
				if dissolve_prefix ~= nil then
					if dissolve_index >= 6 then
						room_tile_handles[tile_index] = empty_tile_handle
						goto continue
					end
					tile_id = dissolve_prefix .. tostring(dissolve_index)
				end
			end
			room_tile_handles[tile_index] = images[tile_id].handle
			::continue::
		end
	end
	for i = tile_count + 1, prev_room_tile_handle_count do
		room_tile_handles[i] = nil
	end
	self.room_tile_handle_count = tile_count
	self.room_tile_count = tile_count
	self.room_tile_packet_words = tile_run_payload_word_offset + tile_count
	self.room_tile_packet_dirty = true

	if self.water == nil then
		self.water_tile_count = 0
		self.water_rows = 0
		self.water_tile_packet_words = 0
		self.water_tile_handle_count = 0
		self.water_surface_tile_count = 0
		self.water_tile_packet_dirty = false
		self.water_surface_dirty = false
		self.water_tile_packet_base = nil
		self.last_water_surface_frame = 1
		return
	end
	local prev_water_tile_handle_count<const> = self.water_tile_handle_count
	local prev_water_surface_tile_count<const> = self.water_surface_tile_count
	local water_surface_handle<const> = self.water_surface_handles[1]
	local water_rows<const> = self.tile_rows - self.water.surface_row + 1
	local water_tile_count<const> = self.tile_columns * water_rows
	local water_tile_handles<const> = self.water_tile_handles
	local water_surface_tile_indices<const> = self.water_surface_tile_indices
	local water_surface_tile_count = 0

	for y = self.water.surface_row, self.tile_rows do
		local row_base<const> = ((y - self.water.surface_row) * self.tile_columns)
		for x = 1, self.tile_columns do
			local tile_index<const> = row_base + x
			local kind<const> = water_kind_at_tile(self, x, y)
			if kind == constants.water.none then
				water_tile_handles[tile_index] = empty_tile_handle
			elseif kind == constants.water.surface then
				water_tile_handles[tile_index] = water_surface_handle
				water_surface_tile_count = water_surface_tile_count + 1
				water_surface_tile_indices[water_surface_tile_count] = tile_index
			else
				water_tile_handles[tile_index] = self.water_body_handle
			end
		end
	end
	for i = water_tile_count + 1, prev_water_tile_handle_count do
		water_tile_handles[i] = nil
	end
	for i = water_surface_tile_count + 1, prev_water_surface_tile_count do
		water_surface_tile_indices[i] = nil
	end
	self.water_tile_handle_count = water_tile_count
	self.water_tile_count = water_tile_count
	self.water_rows = water_rows
	self.water_tile_packet_words = tile_run_payload_word_offset + water_tile_count
	self.water_surface_tile_count = water_surface_tile_count
	self.water_tile_packet_dirty = true
	self.water_surface_dirty = false
	self.last_water_surface_frame = 1
end

function room_object:sync_water_surface_frame(water_surface_frame)
	if self.water == nil or self.last_water_surface_frame == water_surface_frame then
		return
	end
	-- Only the surface strip animates. Update the cached handles in Lua, then let
	-- render_water() patch exactly those payload words if the packet slot stayed
	-- stable this frame.
	local water_surface_handle<const> = self.water_surface_handles[water_surface_frame]
	local water_tile_handles<const> = self.water_tile_handles
	local water_surface_tile_indices<const> = self.water_surface_tile_indices
	for i = 1, self.water_surface_tile_count do
		local tile_index<const> = water_surface_tile_indices[i]
		water_tile_handles[tile_index] = water_surface_handle
	end
	self.last_water_surface_frame = water_surface_frame
	self.water_surface_dirty = true
end

function room_object:render_tiles()
	local tile_count<const> = self.room_tile_count
	if tile_count == 0 then
		return
	end
	local packet_base<const> = vdp_stream_claim_words(self.room_tile_packet_words)
	if self.room_tile_packet_base ~= packet_base then
		-- Same cached tile data, different stream slot. The payload must be copied
		-- into the new packet location because the remembered RAM address changed.
		self.room_tile_packet_base = packet_base
		self.room_tile_packet_dirty = true
	end
	if not self.room_tile_packet_dirty then
		-- Fast path: same claim site, same cached content, so the old packet bytes
		-- in stream RAM are still valid and we do not touch them again.
		return
	end
	write_tile_run_header(packet_base, tile_count, self.tile_columns, self.tile_rows, self.tile_size, self.tile_origin_x, self.tile_origin_y)
	write_tile_run_payload(packet_base + (tile_run_payload_word_offset * sys_vdp_arg_stride), self.room_tile_handles, tile_count)
	self.room_tile_packet_dirty = false
end

function room_object:render_water()
	local tile_count<const> = self.water_tile_count
	if tile_count == 0 then
		return
	end
	local packet_base<const> = vdp_stream_claim_words(self.water_tile_packet_words)
	local payload_dst<const> = packet_base + (tile_run_payload_word_offset * sys_vdp_arg_stride)
	if self.water_tile_packet_base ~= packet_base then
		-- Same idea as the room tile layer: if the claim moves, the cached packet
		-- contents are no longer at the correct address, so force a full rewrite.
		self.water_tile_packet_base = packet_base
		self.water_tile_packet_dirty = true
	end
	if self.water_tile_packet_dirty then
		write_tile_run_header(
			packet_base,
			tile_count,
			self.tile_columns,
			self.water_rows,
			self.tile_size,
			self.tile_origin_x,
			self.tile_origin_y + ((self.water.surface_row - 1) * self.tile_size)
		)
		write_tile_run_payload(payload_dst, self.water_tile_handles, tile_count)
		self.water_tile_packet_dirty = false
		self.water_surface_dirty = false
		return
	end
	if not self.water_surface_dirty then
		-- Fast path: full water packet is already valid at this address and the
		-- animated surface frame did not change.
		return
	end
	-- Micro-update path: only rewrite the payload words for the surface strip.
	patch_tile_run_payload(payload_dst, self.water_tile_handles, self.water_surface_tile_indices, self.water_surface_tile_count)
	self.water_surface_dirty = false
end

function room_object:render_room()
	if self.tiles_visible then
		if self.water ~= nil then
			self:sync_water_surface_frame(self:get_timeline(water_surface_timeline_id):value())
		end
		self:render_tiles()
		self:render_water()
	end
	if not self:has_tag('r.seal_fx') then
		return
	end
	local director<const> = oget('d')
	if not director:has_tag('d.seal.flash') then
		return
	end
	memwrite(vdp_stream_claim_words(sys_vdp_stream_packet_header_words + 10), sys_vdp_cmd_fill_rect, 10, 0, 0, constants.room.tile_origin_y, display_width(), display_height(), 342, sys_vdp_layer_world, 1, 1, 1, 0.5)
end

local room_runtime_state_name<const> = function(room_state)
	local world_number<const> = room_state.world_number or 0
	if world_number ~= 0 then
		local castle<const> = oget('c')
		if castle:has_tag('c.daemon.fight') then
			return 'daemon_fight'
		end
		if castle:has_tag('c.seal.active') then
			return 'seal'
		end
		if castle:has_tag('c.seal.sequence') then
			return 'seal'
		end
		return 'world'
	end
	return 'castle'
end

local define_room_fsm<const> = function()
	define_fsm('room', {
		initial = 'mode_state',
		on = {
			['room.switched'] = {
				emitter = 'pietolon',
				go = function(self)
					self:set_space('main')
				end,
			},
		},
		states = {
			mode_state = {
				initial = 'room',
				on = {
					['room'] = '/mode_state/room',
					['transition'] = '/mode_state/transition',
					['halo'] = '/mode_state/halo',
					['shrine'] = '/mode_state/shrine',
					['item'] = '/mode_state/item',
					['lithograph'] = '/mode_state/lithograph',
					['title'] = '/mode_state/title',
					['story'] = '/mode_state/story',
					['ending'] = '/mode_state/ending',
					['victory_dance'] = '/mode_state/victory_dance',
					['death'] = '/mode_state/death',
					['seal_dissolution'] = '/mode_state/seal_dissolution',
					['daemon_appearance'] = '/mode_state/daemon_appearance',
				},
				states = {
					room = {
						entering_state = function(self)
							self.events:emit('room_state.sync')
						end,
					},
					transition = {},
					halo = {},
					shrine = {},
					item = {},
					lithograph = {},
					title = {},
					story = {},
					ending = {},
					victory_dance = {},
					death = {},
					seal_dissolution = {},
					daemon_appearance = {},
				},
			},
			room_state = {
				is_concurrent = true,
				initial = 'unknown',
				on = {
					['room_state.sync'] = function(self)
						return '/room_state/' .. room_runtime_state_name(self)
					end,
					['room_state.changed'] = function(self)
						return '/room_state/' .. room_runtime_state_name(self)
					end,
				},
				states = {
					unknown = {},
					castle = {},
					world = {},
					seal = {},
					daemon_fight = {},
				},
			},
			fx_state = {
				is_concurrent = true,
				initial = 'active',
				on = {
					['seal_dissolution'] = '/fx_state/seal_fx',
					['daemon_appearance'] = '/fx_state/daemon_fx',
					['room'] = '/fx_state/active',
					['transition'] = '/fx_state/active',
					['halo'] = '/fx_state/active',
					['shrine'] = '/fx_state/active',
					['item'] = '/fx_state/active',
					['lithograph'] = '/fx_state/active',
					['title'] = '/fx_state/active',
					['story'] = '/fx_state/active',
					['ending'] = '/fx_state/active',
					['victory_dance'] = '/fx_state/active',
					['death'] = '/fx_state/active',
				},
				states = {
					active = {},
					seal_fx = {
						tags = { 'r.seal_fx' },
					},
					daemon_fx = {},
				},
			},
			water_state = {
				is_concurrent = true,
				initial = 'active',
				states = {
					active = {
						timelines = {
							[water_surface_timeline_id] = {
								def = {
									-- MoG `TBD06..TBD57`: surface char `0xB6` rotates on a 64-tick cycle.
									frames = timeline.build_frame_sequence(water_surface_timeline_frame_defs),
									playback_mode = 'loop',
								},
								autoplay = true,
							},
						},
					},
				},
			},
		},
	})
end

local register_room_definition<const> = function()
	define_prefab({
		def_id = 'room',
		class = room_object,
		fsms = { 'room' },
		components = { 'customvisualcomponent' },
		defaults = {
		},
	})
end

room.define_room_fsm = define_room_fsm
room.register_room_definition = register_room_definition

return room

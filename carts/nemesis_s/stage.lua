local clamp<const> = require('cartlib/util/clamp')
local rol8<const> = require('cartlib/util/rol8')
local velocity<const> = require('cartlib/velocity')
local fsm_component<const> = require('cartlib/fsm/fsm_component')
local fsm_library<const> = require('cartlib/fsm/library')
local image<const> = require('cartlib/gx/image')
local prefab<const> = require('cartlib/world/prefab')
local custom_visual_component<const> = require('cartlib/component/custom_visual_component')
local tile_layer_component<const> = require('cartlib/component/tile_layer_component')
local timeline_component<const> = require('cartlib/timeline/timeline_component')
local world<const> = require('cartlib/world/world')
local stage_scroll_follower_component<const> = require('stage_scroll_follower_component')
require('constants')
local bin<const> = require('cartlib/bin')
local assets<const> = require('bmsx/assets')
local string_byte<const> = string.byte
local string_char<const> = string.char

local stage<const> = {}
stage.__index = stage

local resume_scrolling_event<const> = 'stage.resume_scrolling'

-- The YAML map stays author-facing ASCII; decoding consumes byte tokens directly.
local stage_char_space<const> = 32 -- space
local stage_char_collision<const> = 33 -- !
local stage_char_house<const> = 35 -- #
local stage_char_ground_variant<const> = 37 -- %
local stage_char_moon<const> = 39 -- '
local stage_char_house_left<const> = 40 -- (
local stage_char_house_right<const> = 41 -- )
local stage_char_house_center<const> = 43 -- +
local stage_char_ground<const> = 45 -- -
local stage_char_house_left_slope<const> = 47 -- /
local stage_char_tree_1<const> = 49 -- 1
local stage_char_tree_2<const> = 50 -- 2
local stage_char_tree_3<const> = 51 -- 3
local stage_char_tree_4<const> = 52 -- 4
local stage_char_tree_5<const> = 53 -- 5
local stage_char_tree_6<const> = 54 -- 6
local stage_char_tree_7<const> = 55 -- 7
local stage_char_ground_alt<const> = 61 -- =
local stage_char_roof<const> = 64 -- @
local stage_char_kerk<const> = 75 -- K
local stage_char_mijter_red<const> = 77 -- M
local stage_char_sneeuwpop<const> = 78 -- N
local stage_char_sint_pop_down<const> = 80 -- P
local stage_char_rook_generator<const> = 82 -- R
local stage_char_schoorsteen_foe<const> = 83 -- S
local stage_char_zak_foe<const> = 90 -- Z
local stage_char_house_right_slope<const> = 92 -- \
local stage_char_house_peak<const> = 94 -- ^
local stage_char_ground_vertical<const> = 95 -- _
local stage_char_door<const> = 100 -- d
local stage_char_mijter_blue<const> = 109 -- m
local stage_char_lantaarn<const> = 111 -- o
local stage_char_sint_pop_up<const> = 112 -- p
local stage_char_chimney<const> = 115 -- s
local stage_char_tree<const> = 116 -- t
local stage_char_window<const> = 119 -- w
local stage_char_lantaarn_post<const> = 124 -- |
local house_roof_base_chars<const> = {
	[stage_char_roof] = true,
	[stage_char_house_left_slope] = true,
	[stage_char_house_right_slope] = true,
	[stage_char_house_peak] = true,
}
local snow_surface_chars<const> = {
	[stage_char_ground_alt] = true,
	[stage_char_ground] = true,
}
local empty_stage_chars<const> = {
	[stage_char_sint_pop_up] = true,
	[stage_char_sint_pop_down] = true,
	[stage_char_mijter_blue] = true,
	[stage_char_mijter_red] = true,
}
local chimney_chars<const> = {
	[stage_char_chimney] = true,
	[stage_char_schoorsteen_foe] = true,
	[stage_char_rook_generator] = true,
}
local transparent_overlay_chars<const> = {
	[stage_char_kerk] = true,
	[stage_char_moon] = true,
}
local sint_pop_group_by_symbol<const> = {
	[stage_char_sint_pop_up] = sint_pop_group_up,
	[stage_char_sint_pop_down] = sint_pop_group_down,
}
local mijter_foe_type_by_symbol<const> = {
	[stage_char_mijter_blue] = mijter_foe_type_blue,
	[stage_char_mijter_red] = mijter_foe_type_red,
}
local stage_scroll_follower_view

local non_collision_tile_keys<const> = {
	none = true,
	lantaarn1 = true,
	lantaarn2 = true,
	lantaarn3 = true,
	house_1 = true,
	house_4 = true,
	house_5 = true,
	house_6 = true,
	snow = true,
	snowtree1 = true,
	snowtree3 = true,
	snowtree20 = true,
}

local tile_imgid_by_key<const> = {
	collision = assets_house_tile_1,
	house_1 = assets_house_tile_1,
	house_2 = assets_house_tile_2,
	house_3 = assets_house_tile_3,
	house_4 = assets_house_tile_4,
	house_5 = assets_house_tile_5,
	house_6 = assets_house_tile_6,
	house_7 = assets_house_tile_7,
	house_8 = assets_house_tile_8,
	house_9 = assets_house_tile_9,
	house_10 = assets_house_tile_10,
	house_11 = assets_house_tile_11,
	house_12 = assets_house_tile_12,
	house_13 = assets_house_tile_13,
	house_door = assets_house_tile_door,
	house_window = assets_house_tile_window,
	house_window2 = assets_house_tile_window2,
	lantaarn1 = assets_lantaarn_tile_1,
	lantaarn2 = assets_lantaarn_tile_2,
	lantaarn3 = assets_lantaarn_tile_3,
	ground = assets_ground,
	ground2 = assets_ground2,
	ground_v = assets_ground_v,
	ground2_v = assets_ground2_v,
	ground3 = assets_ground3,
	ground4 = assets_ground4,
	ground_start = assets_ground_start,
	ground_end = assets_ground_end,
	ground_start_v = assets_ground_start_v,
	ground_end_v = assets_ground_end_v,
	snow = assets_snow,
	schoorsteen1 = assets_schoorsteen1,
	schoorsteen2 = assets_schoorsteen2,
	schoorsteen3 = assets_schoorsteen3,
	snowtree1 = assets_snowtree1,
	snowtree2 = assets_snowtree2,
	snowtree3 = assets_snowtree3,
	snowtree4 = assets_snowtree4,
	snowtree5 = assets_snowtree5,
	snowtree6 = assets_snowtree6,
	snowtree7 = assets_snowtree7,
	snowtree8 = assets_snowtree8,
	snowtree9 = assets_snowtree9,
	snowtree10 = assets_snowtree10,
	snowtree11 = assets_snowtree11,
	snowtree12 = assets_snowtree12,
	snowtree13 = assets_snowtree13,
	snowtree14 = assets_snowtree14,
	snowtree15 = assets_snowtree15,
	snowtree16 = assets_snowtree16,
	snowtree17 = assets_snowtree17,
	snowtree18 = assets_snowtree18,
	snowtree19 = assets_snowtree19,
	snowtree20 = assets_snowtree20,
	snowtree21 = assets_snowtree21,
}
local star_sources<const> = {
	yellow = image.resolve(assets_star_yellow),
	blue = image.resolve(assets_star_blue),
}
local star_blink_tracks<const> = telemetry_enabled and {
	{
		kind = 'event',
		keys = {
			{ frame = 0, event = 'star_blink_toggle', direction = 'forward' },
			{ frame = 1, event = 'star_blink_toggle', direction = 'forward' },
			{ frame = 2, event = 'star_blink_toggle', direction = 'forward' },
			{ frame = 3, event = 'star_blink_toggle', direction = 'forward' },
		},
	},
}

local new_rows<const> = function(width, height, default_value)
	local out<const> = {}
	for y = 1, height do
		local row<const> = {}
		for x = 1, width do
			row[x] = default_value
		end
		out[y] = row
	end
	return out
end

local reset_star_positions<const> = function(target, source)
	for i = 1, #source do
		local src<const> = source[i]
		local star = target[i]
		if star == nil then
			star = {}
			target[i] = star
		end
		star.x = src.x
		star.y = src.y
	end
	for i = #source + 1, #target do
		target[i] = nil
	end
end

local decode_stage_tile<const> = function(above_row, row, below_row, x, y, width, ch)
	local above = stage_char_space
	if above_row ~= nil then
		above = string_byte(above_row, x)
	end
	local below = stage_char_space
	if below_row ~= nil then
		below = string_byte(below_row, x)
	end
	local left = stage_char_space
	local left_down = stage_char_space
	if x > 1 then
		left = string_byte(row, x - 1)
		if below_row ~= nil then
			left_down = string_byte(below_row, x - 1)
		end
	end
	local right = stage_char_space
	local right_down = stage_char_space
	if x < width then
		right = string_byte(row, x + 1)
		if below_row ~= nil then
			right_down = string_byte(below_row, x + 1)
		end
	end

	if ch == stage_char_collision then
		return 'collision'
	end
	if ch == stage_char_house then
		if house_roof_base_chars[above] then
			return 'house_13'
		end
		return 'house_8'
	end
	if ch == stage_char_roof then
		return 'house_12'
	end
	if ch == stage_char_door then
		return 'house_door'
	end
	if ch == stage_char_window then
		if right == stage_char_roof then
			return 'house_window2'
		end
		return 'house_window'
	end
	if ch == stage_char_house_left_slope then
		if below == stage_char_house_left_slope then
			return 'house_1'
		end
		return 'house_5'
	end
	if ch == stage_char_house_right_slope then
		if below == stage_char_house_right_slope then
			return 'house_4'
		end
		return 'house_6'
	end
	if ch == stage_char_house_peak then
		return 'house_2'
	end
	if ch == stage_char_house_center then
		return 'house_3'
	end
	if ch == stage_char_house_left then
		if house_roof_base_chars[above] then
			return 'house_7'
		end
		return 'house_10'
	end
	if ch == stage_char_house_right then
		if house_roof_base_chars[above] then
			return 'house_9'
		end
		return 'house_11'
	end
	if ch == stage_char_lantaarn_post then
		if snow_surface_chars[below] then
			return 'lantaarn3'
		end
		return 'lantaarn2'
	end
	if ch == stage_char_lantaarn then
		return 'lantaarn1'
	end
	if empty_stage_chars[ch] then
		return nil
	end
	if ch == stage_char_ground then
		if left ~= stage_char_space and right ~= stage_char_space then
			return 'ground'
		end
		if left == stage_char_space then
			return 'ground_start'
		end
		return 'ground_end'
	end
	if ch == stage_char_ground_alt then
		if left ~= stage_char_space and right ~= stage_char_space then
			return 'ground2'
		end
		if left == stage_char_space then
			return 'ground_start'
		end
		return 'ground_end'
	end
	if ch == stage_char_ground_vertical then
		local parity_even<const> = ((x - 1) % 2) == 0
		if left == stage_char_space then
			return 'ground_start_v'
		end
		if right == stage_char_space then
			return 'ground_end_v'
		end
		if parity_even then
			return 'ground_v'
		end
		return 'ground2_v'
	end
	if ch == stage_char_ground_variant then
		local parity_even<const> = ((x - 1) % 2) == 0
		if parity_even then
			return 'ground3'
		end
		return 'ground4'
	end
	if chimney_chars[ch] then
		if above == stage_char_space then
			return 'schoorsteen1'
		end
		if left == stage_char_space or right == stage_char_space then
			return 'schoorsteen3'
		end
		return 'schoorsteen2'
	end
	if ch == stage_char_space
	or ch == stage_char_zak_foe
	or ch == stage_char_sneeuwpop then
		if snow_surface_chars[below]
		and left_down ~= stage_char_space
		and right_down ~= stage_char_space then
			return 'snow'
		end
		return nil
	end
	if ch == stage_char_tree then
		if right == stage_char_tree_1 then
			return 'snowtree1'
		end
		if right == stage_char_tree_2 then
			return 'snowtree4'
		end
		if right == stage_char_tree_3 then
			return 'snowtree7'
		end
		if right == stage_char_tree_4 then
			return 'snowtree10'
		end
		if right == stage_char_tree_5 then
			return 'snowtree13'
		end
		if right == stage_char_tree_6 then
			return 'snowtree16'
		end
		if right == stage_char_tree_7 then
			return 'snowtree19'
		end
		if left == stage_char_tree_1 then
			return 'snowtree3'
		end
		if left == stage_char_tree_2 then
			return 'snowtree6'
		end
		if left == stage_char_tree_3 then
			return 'snowtree9'
		end
		if left == stage_char_tree_4 then
			return 'snowtree12'
		end
		if left == stage_char_tree_5 then
			return 'snowtree15'
		end
		if left == stage_char_tree_6 then
			return 'snowtree18'
		end
		if left == stage_char_tree_7 then
			return 'snowtree21'
		end
		return nil
	end
	if ch == stage_char_tree_1 then
		if left == stage_char_tree then
			return 'snowtree2'
		end
		return nil
	end
	if ch == stage_char_tree_2 then
		if left == stage_char_tree then
			return 'snowtree5'
		end
		return nil
	end
	if ch == stage_char_tree_3 then
		if left == stage_char_tree then
			return 'snowtree8'
		end
		return nil
	end
	if ch == stage_char_tree_4 then
		if left == stage_char_tree then
			return 'snowtree11'
		end
		return nil
	end
	if ch == stage_char_tree_5 then
		if left == stage_char_tree then
			return 'snowtree14'
		end
		return nil
	end
	if ch == stage_char_tree_6 then
		if left == stage_char_tree then
			return 'snowtree17'
		end
		return nil
	end
	if ch == stage_char_tree_7 then
		if left == stage_char_tree then
			return 'snowtree20'
		end
		return nil
	end
	if transparent_overlay_chars[ch] then
		return nil
	end
	error('nemesis_s unsupported stage symbol "' .. string_char(ch) .. '" at x=' .. tostring(x) .. ', y=' .. tostring(y))
end

local resolve_tile_material<const> = function(tile_key)
	if tile_key == nil then
		return nil, 0
	end

	local imgid<const> = tile_imgid_by_key[tile_key]
	if non_collision_tile_keys[tile_key] then
		return imgid, 0
	end
	return imgid, 1
end

function stage:apply_stage_config(stage_data)
	self.tile_size = stage_data.tile_size
	self.tile_columns = stage_data.tile_columns
	self.music_cues = stage_data.music_cues
	self.restart_points = stage_data.restart_points
	self.scroll_stop_columns = stage_data.scroll_stop_columns
	self.scroll_stop_count = #stage_data.scroll_stop_columns
	self.star_visual:set_offset_z(stage_data.draw_z)
	self.stage_tiles:set_offset_z(stage_data.draw_z)
end

function stage:advance_music_cues(column)
	local music_cues<const> = self.music_cues
	local cue_index = self.music_cue_index
	local cue = music_cues[cue_index]
	while cue ~= nil and cue.column <= column do
		self.events:emit(cue.event)
		cue_index = cue_index + 1
		cue = music_cues[cue_index]
	end
	self.music_cue_index = cue_index
end

function stage:advance_actor_spawns(column)
	local spawns<const> = self.actor_spawns
	local spawn_count<const> = self.actor_spawn_count
	local index = self.actor_spawn_index
	while index <= spawn_count and spawns[index].column <= column do
		local spawn<const> = spawns[index]
		world:spawn(spawn.definition_id, spawn.options)
		index = index + 1
	end
	self.actor_spawn_index = index
end

function stage:build_tape()
	local stage_data<const> = bin.decode(assets.data_nemesis_s_stage_addr, stage_asset_id)
	self:apply_stage_config(stage_data)
	local map_rows<const> = stage_data.map_rows

	local width<const> = #map_rows[1]
	local height<const> = #map_rows

	self.tile_rows = height
	self.tape_length_tiles = width
	local stage_tiles<const> = self.stage_tiles
	stage_tiles:set_tile_size(self.tile_size)
	stage_tiles:resize(width * height, width)
	self.solid_tape = new_rows(width, height, 0)

	for stage_y = 1, height do
		local map_row<const> = map_rows[stage_y]
		local above_row
		if stage_y > 1 then
			above_row = map_rows[stage_y - 1]
		end
		local below_row
		if stage_y < height then
			below_row = map_rows[stage_y + 1]
		end
		for stage_x = 1, width do
			local symbol<const> = string_byte(map_row, stage_x)
			local tile_key<const> = decode_stage_tile(
				above_row, map_row, below_row, stage_x, stage_y, width, symbol)
			local imgid<const> , solid<const> = resolve_tile_material(tile_key)
			stage_tiles:set_tile(((stage_y - 1) * width) + stage_x, imgid)
			self.solid_tape[stage_y][stage_x] = solid
		end
	end

	local actor_spawns<const> = {}
	for stage_x = 1, width do
		for stage_y = 1, height do
			local symbol<const> = string_byte(map_rows[stage_y], stage_x)
			local sint_pop_group<const> = sint_pop_group_by_symbol[symbol]
			if sint_pop_group ~= nil then
				local column<const> = stage_x - 1
				local spawn_y<const> = (stage_y - 1) * self.tile_size
				local formation<const> = { remaining = sint_pop_group_size }
				for group_index = 0, sint_pop_group_size - 1 do
					actor_spawns[#actor_spawns + 1] = {
						column = column,
						definition_id = ids_sint_pop_def,
						options = {
							stage = self,
							formation = formation,
							group_type = sint_pop_group,
							pos = {
								x = playfield_width + (group_index * sint_pop_width),
								y = spawn_y,
							},
						},
					}
				end
			else
				local mijter_foe_type<const> = mijter_foe_type_by_symbol[symbol]
				if mijter_foe_type ~= nil then
					actor_spawns[#actor_spawns + 1] = {
						column = stage_x - 1,
						definition_id = ids_mijter_foe_def,
						options = {
							stage = self,
							mijter_type = mijter_foe_type,
							pos = {
								x = playfield_width,
								y = (stage_y - 2) * self.tile_size,
							},
						},
					}
				elseif symbol == stage_char_schoorsteen_foe then
					actor_spawns[#actor_spawns + 1] = {
						column = stage_x - 2,
						definition_id = ids_schoorsteen_foe_def,
						options = {
							stage = self,
							pos = {
								x = playfield_width - 3 - self.tile_size,
								y = (stage_y - 2) * self.tile_size,
							},
						},
					}
				elseif symbol == stage_char_rook_generator then
					actor_spawns[#actor_spawns + 1] = {
						column = stage_x - 1,
						definition_id = ids_rook_generator_def,
						options = {
							stage = self,
							pos = {
								x = playfield_width - (self.tile_size * 2),
								y = (stage_y - 2) * self.tile_size,
							},
						},
					}
				elseif symbol == stage_char_zak_foe then
					actor_spawns[#actor_spawns + 1] = {
						column = stage_x - 1,
						definition_id = ids_zak_foe_def,
						options = {
							stage = self,
							direction = zak_foe_direction_left,
							pos = {
								x = playfield_width - self.tile_size,
								y = (stage_y - 2) * self.tile_size,
							},
						},
					}
				elseif symbol == stage_char_sneeuwpop then
					actor_spawns[#actor_spawns + 1] = {
						column = stage_x - 1,
						definition_id = ids_sneeuwpop_def,
						options = {
							stage = self,
							pos = {
								x = playfield_width - self.tile_size,
								y = (stage_y - 7) * self.tile_size,
							},
						},
					}
				elseif symbol == stage_char_kerk then
					local kerk_y<const> = stage_y * self.tile_size - kerk_height
					actor_spawns[#actor_spawns + 1] = {
						column = stage_x - 1,
						definition_id = ids_bel_def,
						options = {
							stage = self,
							pos = {
								x = playfield_width + 7 - self.tile_size,
								y = kerk_y + 80,
							},
						},
					}
					actor_spawns[#actor_spawns + 1] = {
						column = stage_x - 1,
						definition_id = ids_kerk_def,
						options = {
							stage = self,
							pos = {
								x = playfield_width - self.tile_size,
								y = kerk_y,
							},
						},
					}
				elseif symbol == stage_char_moon then
					actor_spawns[#actor_spawns + 1] = {
						column = stage_x - 1,
						definition_id = ids_moon_def,
						options = {
							stage = self,
							pos = {
								x = moon_spawn_x,
								y = moon_spawn_y,
							},
						},
					}
				end
			end
		end
	end
	self.actor_spawns = actor_spawns
	self.actor_spawn_count = #actor_spawns
end

function stage:apply_star_scroll(stars, step)
	for i = 1, #stars do
		local star<const> = stars[i]
		star.x = star.x - step
		if star.x < 0 then
			star.x = playfield_width
		end
	end
end

function stage:reset_runtime()
	if self.stage_tiles.tile_count == 0 then
		self:build_tape()
	end
	local start_column<const> = self.start_column
	self.left_tile = start_column + 1
	self.stage_tiles:set_visible_columns(self.left_tile, self.tile_columns + 2)
	self.tape_head = self.left_tile + self.tile_columns - 1
	local current_column<const> = self.tape_head - 1
	local music_cues<const> = self.music_cues
	local current_music_cue_index = 1
	for cue_index = 2, #music_cues do
		if music_cues[cue_index].column > current_column then
			break
		end
		current_music_cue_index = cue_index
	end
	self.start_music_cue = music_cues[current_music_cue_index]
	self.music_cue_index = current_music_cue_index + 1
	local scroll_stop_index = 1
	local scroll_stop_columns<const> = self.scroll_stop_columns
	while scroll_stop_index <= self.scroll_stop_count
	and scroll_stop_columns[scroll_stop_index] <= current_column do
		scroll_stop_index = scroll_stop_index + 1
	end
	self.scroll_stop_index = scroll_stop_index
	local actor_spawn_index = 1
	local actor_spawns<const> = self.actor_spawns
	local actor_spawn_count<const> = self.actor_spawn_count
	while actor_spawn_index <= actor_spawn_count
	and actor_spawns[actor_spawn_index].column <= current_column do
		actor_spawn_index = actor_spawn_index + 1
	end
	self.actor_spawn_index = actor_spawn_index
	self.tile_steps = start_column
	self.total_scroll_px = start_column * self.tile_size
	self.scroll_gate = 0x01
	self.scrolling = true
	reset_star_positions(self.yellow_stars, stars_yellow)
	reset_star_positions(self.blue_stars, stars_blue)
	self.yellow_blink = false
	self.blue_blink = false
	self.blink_turn = 'yellow'
end

function stage:begin_play()
	local cue<const> = self.start_music_cue
	if self.restarting then
		self.events:emit(cue.restart_event)
	else
		self.events:emit(cue.event)
	end
	self:update_runtime()
	return '/running/scrolling'
end

function stage:restart_column()
	local tape_head<const> = self.tape_head - 1
	local restart_points<const> = self.restart_points
	local start_column = restart_points[1].start_column
	for point_index = 2, #restart_points do
		local point<const> = restart_points[point_index]
		if tape_head < point.trigger_column then
			break
		end
		start_column = point.start_column
	end
	return start_column
end

function stage:advance_tape()
	local max_left_tile<const> = self.tape_length_tiles - self.tile_columns + 1
	if self.left_tile >= max_left_tile then
		self.scrolling = false
		return
	end

	self.left_tile = self.left_tile + 1
	self.stage_tiles:set_visible_columns(self.left_tile, self.tile_columns + 2)
	self.tape_head = self.left_tile + self.tile_columns - 1
	local column<const> = self.tape_head - 1
	self:advance_music_cues(column)
	local followers<const> = stage_scroll_follower_view.components
	for follower_index = 1, #followers do
		local follower<const> = followers[follower_index]
		follower.parent.x = follower.parent.x - self.tile_size
	end
	self:advance_actor_spawns(column)
	self.tile_steps = self.tile_steps + 1
	self.total_scroll_px = self.tile_steps * self.tile_size

	if telemetry_enabled then
		self.events:emit('stage_scroll_tile', {
			left = self.left_tile,
			head = self.tape_head,
		})
	end

	local scroll_stop_index<const> = self.scroll_stop_index
	if scroll_stop_index <= self.scroll_stop_count
	and column >= self.scroll_stop_columns[scroll_stop_index] then
		self.scroll_stop_index = scroll_stop_index + 1
		self.scrolling = false
	elseif self.left_tile >= max_left_tile then
		self.scrolling = false
	end
	if not self.scrolling and telemetry_enabled then
		self.events:emit('stage_scroll_stop', {
			left = self.left_tile,
			head = self.tape_head,
		})
	end
end

function stage:update_runtime()
	if not self.scrolling then
		return '/running/stopped'
	end

	local scroll_gate<const> = rol8(self.scroll_gate)
	self.scroll_gate = scroll_gate
	if (scroll_gate & 1) ~= 0 then
		self:advance_tape()
	end

	if not self.scrolling then
		return '/running/stopped'
	end

	local star_scroll_step<const> = self.star_scroll_step
	self:apply_star_scroll(self.yellow_stars, star_scroll_step)
	self:apply_star_scroll(self.blue_stars, star_scroll_step)
end

function stage:resume_scrolling()
	self.scrolling = true
	self.events:emit(resume_scrolling_event)
end

function stage:draw_star_particles(draw, stars, source, hidden)
	if hidden then
		return
	end
	for i = 1, #stars do
		local star<const> = stars[i]
		source:blit(draw, star.x, star.y)
	end
end

local draw_stars<const> = function(component, draw)
	local owner<const> = component.parent
	owner:draw_star_particles(draw, owner.yellow_stars, star_sources.yellow, owner.yellow_blink)
	owner:draw_star_particles(draw, owner.blue_stars, star_sources.blue, owner.blue_blink)
end
local new_star_visual<const> = custom_visual_component.factory({ draw = draw_stars })

function stage:is_solid_pixel(screen_x, screen_y)
	local map_x = ((screen_x + self.total_scroll_px) // self.tile_size) + 1
	local map_y = (screen_y // self.tile_size) + 1

	map_x = clamp(map_x, 1, self.tape_length_tiles)
	map_y = clamp(map_y, 1, self.tile_rows)

	return self.solid_tape[map_y][map_x] ~= 0
end

-- Returns the zero-based offset of the first solid tile in a horizontal run,
-- or tile_count when the complete run is clear. Beam and sprite-width collision
-- paths consume the retained stage row directly instead of sampling pixels.
function stage:first_solid_tile_offset(screen_x, screen_y, tile_count)
	local map_x<const> = ((screen_x + self.total_scroll_px) // self.tile_size) + 1
	local row<const> = self.solid_tape[(screen_y // self.tile_size) + 1]
	local last_offset = tile_count - 1
	local screen_last_offset<const> = self.tile_columns - (screen_x // self.tile_size) - 1
	if last_offset > screen_last_offset then
		last_offset = screen_last_offset
	end
	for tile_offset = 0, last_offset do
		if row[map_x + tile_offset] ~= 0 then
			return tile_offset
		end
	end
	return tile_count
end

-- Returns the zero-based offset of the first solid tile in a vertical run,
-- or the number of in-bounds tiles when the run reaches the playfield edge.
-- Stage-relative beams retain this result once because their map column stays
-- fixed while both the stage and beam consume the same tile scroll.
function stage:first_solid_vertical_tile_offset(screen_x, screen_y, tile_count, direction)
	local map_x<const> = ((screen_x + self.total_scroll_px) // self.tile_size) + 1
	local map_y<const> = (screen_y // self.tile_size) + 1
	local last_offset = tile_count - 1
	if direction < 0 then
		if last_offset >= map_y then
			last_offset = map_y - 1
		end
	else
		local bottom_offset<const> = self.tile_rows - map_y
		if last_offset > bottom_offset then
			last_offset = bottom_offset
		end
	end
	local solid_tape<const> = self.solid_tape
	for tile_offset = 0, last_offset do
		if solid_tape[map_y + tile_offset * direction][map_x] ~= 0 then
			return tile_offset
		end
	end
	return last_offset + 1
end

function stage:ctor()
	self.solid_tape = {}
	self.yellow_stars = {}
	self.blue_stars = {}
	self.star_scroll_step = velocity.pixels_per_second_to_pixels_per_tick(
		stage_star_scroll_speed_px_per_second
	)
	self.star_visual = self:get_component(custom_visual_component)
	self.stage_tiles = self:get_component(tile_layer_component)
end

local define_stage_fsm<const> = function()
	fsm_library.register(ids_stage_fsm, {
		initial = 'boot',
		on = {
			[resume_scrolling_event] = '/running/scrolling',
		},
		states = {
			boot = {
				entering_state = function(self)
					self:reset_runtime()
					return '/running'
				end,
			},
			running = {
				initial = 'begin_play',
				timelines = {
					[ids_stage_star_blink_timeline] = {
						def = {
							frames = {
								{ blink_turn = 'yellow', yellow_blink = false, blue_blink = false },
								{ blink_turn = 'yellow', yellow_blink = true, blue_blink = false },
								{ blink_turn = 'blue', yellow_blink = false, blue_blink = false },
								{ blink_turn = 'blue', yellow_blink = false, blue_blink = true },
							},
							frame_duration = stage_star_blink_frame_ms,
							playback_mode = 'loop',
							apply = true,
							tracks = star_blink_tracks,
						},
						autoplay = true,
						stop_on_exit = true,
						play_options = {
							rewind = true,
							snap_to_start = true,
						},
					},
				},
				states = {
					begin_play = {
						update = stage.begin_play,
					},
					scrolling = {
						update = stage.update_runtime,
					},
					stopped = {},
				},
			},
		},
	})
end

local register_stage_definition<const> = function()
	stage_scroll_follower_view = world:active_component_view(stage_scroll_follower_component)
	prefab.define({
		def_id = ids_stage_def,
		class = stage,
		components = {
			new_star_visual,
			tile_layer_component.new,
			timeline_component.new,
			fsm_component.factory({ ids_stage_fsm }),
		},
		defaults = {
			restarting = false,
		},
	})
end

return {
	define_stage_fsm = define_stage_fsm,
	register_stage_definition = register_stage_definition,
	stage_def_id = ids_stage_def,
	stage_instance_id = ids_stage_instance,
	stage_fsm_id = ids_stage_fsm,
}

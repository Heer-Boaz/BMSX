local clamp<const> = require('cartlib/util/clamp')
local clock<const> = require('cartlib/clock')
local fsm_component<const> = require('cartlib/fsm/fsm_component')
local fsm_library<const> = require('cartlib/fsm/library')
local image<const> = require('cartlib/gx/image')
local prefab<const> = require('cartlib/world/prefab')
local custom_visual_component<const> = require('cartlib/component/custom_visual_component')
local tile_layer_component<const> = require('cartlib/component/tile_layer_component')
local timeline_component<const> = require('cartlib/timeline/timeline_component')
local world<const> = require('cartlib/world/world')
require('constants')
local bin<const> = require('cartlib/bin')
local assets<const> = require('bmsx/assets')

local stage<const> = {}
stage.__index = stage

local frame_duration_ms<const> = clock.frame_milliseconds()

local house_roof_base_chars<const> = { ['@'] = true, ['/'] = true, ['\\'] = true, ['^'] = true }
local snow_surface_chars<const> = { ['='] = true, ['-'] = true }
local empty_stage_chars<const> = { p = true, ['P'] = true, m = true, ['M'] = true }
local chimney_chars<const> = { s = true, ['S'] = true, ['R'] = true }
local transparent_overlay_chars<const> = { ['K'] = true, ["'"] = true }
local sint_pop_group_by_symbol<const> = {
	p = sint_pop_group_up,
	['P'] = sint_pop_group_down,
}
local mijter_foe_type_by_symbol<const> = {
	m = mijter_foe_type_blue,
	['M'] = mijter_foe_type_red,
}

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

local char_at<const> = function(map_rows, x, y)
	if y < 1 or y > #map_rows then
		return ' '
	end
	local row<const> = map_rows[y]
	if x < 1 or x > string.len(row) then
		return ' '
	end
	return string.sub(row, x, x)
end

local should_snow_from_neighbors<const> = function(below, left_down, right_down)
	return snow_surface_chars[below] and left_down ~= ' ' and right_down ~= ' '
end

local decode_stage_tile<const> = function(map_rows, x, y, ch)
	local above<const> = char_at(map_rows, x, y - 1)
	local below<const> = char_at(map_rows, x, y + 1)
	local left<const> = char_at(map_rows, x - 1, y)
	local right<const> = char_at(map_rows, x + 1, y)
	local left_down<const> = char_at(map_rows, x - 1, y + 1)
	local right_down<const> = char_at(map_rows, x + 1, y + 1)

	if ch == '!' then
		return 'collision'
	end
	if ch == '#' then
		if house_roof_base_chars[above] then
			return 'house_13'
		end
		return 'house_8'
	end
	if ch == '@' then
		return 'house_12'
	end
	if ch == 'd' then
		return 'house_door'
	end
	if ch == 'w' then
		if right == '@' then
			return 'house_window2'
		end
		return 'house_window'
	end
	if ch == '/' then
		if below == '/' then
			return 'house_1'
		end
		return 'house_5'
	end
	if ch == '\\' then
		if below == '\\' then
			return 'house_4'
		end
		return 'house_6'
	end
	if ch == '^' then
		return 'house_2'
	end
	if ch == '+' then
		return 'house_3'
	end
	if ch == '(' then
		if house_roof_base_chars[above] then
			return 'house_7'
		end
		return 'house_10'
	end
	if ch == ')' then
		if house_roof_base_chars[above] then
			return 'house_9'
		end
		return 'house_11'
	end
	if ch == '|' then
		if snow_surface_chars[below] then
			return 'lantaarn3'
		end
		return 'lantaarn2'
	end
	if ch == 'o' then
		return 'lantaarn1'
	end
	if empty_stage_chars[ch] then
		return nil
	end
	if ch == '-' then
		if left ~= ' ' and right ~= ' ' then
			return 'ground'
		end
		if left == ' ' then
			return 'ground_start'
		end
		return 'ground_end'
	end
	if ch == '=' then
		if left ~= ' ' and right ~= ' ' then
			return 'ground2'
		end
		if left == ' ' then
			return 'ground_start'
		end
		return 'ground_end'
	end
	if ch == '_' then
		local parity_even<const> = ((x - 1) % 2) == 0
		if left == ' ' then
			return 'ground_start_v'
		end
		if right == ' ' then
			return 'ground_end_v'
		end
		if parity_even then
			return 'ground_v'
		end
		return 'ground2_v'
	end
	if ch == '%' then
		local parity_even<const> = ((x - 1) % 2) == 0
		if parity_even then
			return 'ground3'
		end
		return 'ground4'
	end
	if chimney_chars[ch] then
		if above == ' ' then
			return 'schoorsteen1'
		end
		if left == ' ' or right == ' ' then
			return 'schoorsteen3'
		end
		return 'schoorsteen2'
	end
	if ch == ' ' then
		if should_snow_from_neighbors(below, left_down, right_down) then
			return 'snow'
		end
		return nil
	end
	if ch == 'Z' then
		if should_snow_from_neighbors(below, left_down, right_down) then
			return 'snow'
		end
		return nil
	end
	if ch == 'N' then
		if should_snow_from_neighbors(below, left_down, right_down) then
			return 'snow'
		end
		return nil
	end
	if ch == 't' then
		if right == '1' then
			return 'snowtree1'
		end
		if right == '2' then
			return 'snowtree4'
		end
		if right == '3' then
			return 'snowtree7'
		end
		if right == '4' then
			return 'snowtree10'
		end
		if right == '5' then
			return 'snowtree13'
		end
		if right == '6' then
			return 'snowtree16'
		end
		if right == '7' then
			return 'snowtree19'
		end
		if left == '1' then
			return 'snowtree3'
		end
		if left == '2' then
			return 'snowtree6'
		end
		if left == '3' then
			return 'snowtree9'
		end
		if left == '4' then
			return 'snowtree12'
		end
		if left == '5' then
			return 'snowtree15'
		end
		if left == '6' then
			return 'snowtree18'
		end
		if left == '7' then
			return 'snowtree21'
		end
		return nil
	end
	if ch == '1' then
		if left == 't' then
			return 'snowtree2'
		end
		return nil
	end
	if ch == '2' then
		if left == 't' then
			return 'snowtree5'
		end
		return nil
	end
	if ch == '3' then
		if left == 't' then
			return 'snowtree8'
		end
		return nil
	end
	if ch == '4' then
		if left == 't' then
			return 'snowtree11'
		end
		return nil
	end
	if ch == '5' then
		if left == 't' then
			return 'snowtree14'
		end
		return nil
	end
	if ch == '6' then
		if left == 't' then
			return 'snowtree17'
		end
		return nil
	end
	if ch == '7' then
		if left == 't' then
			return 'snowtree20'
		end
		return nil
	end
	if transparent_overlay_chars[ch] then
		return nil
	end
	error('nemesis_s unsupported stage symbol "' .. ch .. '" at x=' .. tostring(x) .. ', y=' .. tostring(y))
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

	local width<const> = string.len(map_rows[1])
	local height<const> = #map_rows

	self.tile_rows = height
	self.tape_length_tiles = width
	local stage_tiles<const> = self.stage_tiles
	stage_tiles:set_tile_size(self.tile_size)
	stage_tiles:resize(width * height, width)
	self.solid_tape = new_rows(width, height, 0)

	for stage_y = 1, height do
		local map_row<const> = map_rows[stage_y]
		for stage_x = 1, width do
			local symbol<const> = string.sub(map_row, stage_x, stage_x)
			local tile_key<const> = decode_stage_tile(map_rows, stage_x, stage_y, symbol)
			local imgid<const> , solid<const> = resolve_tile_material(tile_key)
			stage_tiles:set_tile(((stage_y - 1) * width) + stage_x, imgid)
			self.solid_tape[stage_y][stage_x] = solid
		end
	end

	local actor_spawns<const> = {}
	for stage_x = 1, width do
		for stage_y = 1, height do
			local symbol<const> = string.sub(map_rows[stage_y], stage_x, stage_x)
			local sint_pop_group<const> = sint_pop_group_by_symbol[symbol]
			if sint_pop_group ~= nil then
				local column<const> = stage_x - 1
				local spawn_y<const> = (stage_y - 1) * self.tile_size
				for group_index = 0, sint_pop_group_size - 1 do
					actor_spawns[#actor_spawns + 1] = {
						column = column,
						definition_id = ids_sint_pop_def,
						options = {
							group_id = column,
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
							mijter_type = mijter_foe_type,
							pos = {
								x = playfield_width,
								y = (stage_y - 2) * self.tile_size,
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
	self.left_tile = 1
	self.stage_tiles:set_visible_columns(1, self.tile_columns + 2)
	self.tape_head = self.tile_columns
	self.music_cue_index = 1
	self.scroll_stop_index = 1
	local actor_spawn_index = 1
	local actor_spawns<const> = self.actor_spawns
	local actor_spawn_count<const> = self.actor_spawn_count
	local current_column<const> = self.tape_head - 1
	while actor_spawn_index <= actor_spawn_count
	and actor_spawns[actor_spawn_index].column <= current_column do
		actor_spawn_index = actor_spawn_index + 1
	end
	self.actor_spawn_index = actor_spawn_index
	self.tile_steps = 0
	self.total_scroll_px = 0
	self.star_scroll_px = 0
	self.scroll_elapsed_ms = 0
	self.scrolling = true
	reset_star_positions(self.yellow_stars, stars_yellow)
	reset_star_positions(self.blue_stars, stars_blue)
	self.yellow_blink = false
	self.blue_blink = false
	self.blink_turn = 'yellow'
end

function stage:begin_play()
	self:advance_music_cues(self.tape_head - 1)
	self:update_runtime()
	return '/running/scrolling'
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

	local elapsed_ms<const> = self.scroll_elapsed_ms + frame_duration_ms
	if elapsed_ms >= stage_scroll_interval_ms then
		self.scroll_elapsed_ms = elapsed_ms - stage_scroll_interval_ms
		self:advance_tape()
	else
		self.scroll_elapsed_ms = elapsed_ms
	end

	if not self.scrolling then
		return '/running/stopped'
	end

	self.star_scroll_px = self.star_scroll_px + stage_star_scroll_speed
	self:apply_star_scroll(self.yellow_stars, stage_star_scroll_speed)
	self:apply_star_scroll(self.blue_stars, stage_star_scroll_speed)
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

function stage:is_solid_pixel(screen_x, screen_y)
	local map_x = ((screen_x + self.total_scroll_px) // self.tile_size) + 1
	local map_y = (screen_y // self.tile_size) + 1

	map_x = clamp(map_x, 1, self.tape_length_tiles)
	map_y = clamp(map_y, 1, self.tile_rows)

	return self.solid_tape[map_y][map_x] ~= 0
end

function stage:ctor()
	self.solid_tape = {}
	self.yellow_stars = {}
	self.blue_stars = {}
	self.star_visual = self:get_component(custom_visual_component)
	self.star_visual:set_draw_function(draw_stars)
	self.stage_tiles = self:get_component(tile_layer_component)
end

local define_stage_fsm<const> = function()
	fsm_library.register(ids_stage_fsm, {
		initial = 'boot',
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
								{ blink_turn = 'yellow', yellow_blink = true, blue_blink = false },
								{ blink_turn = 'blue', yellow_blink = false, blue_blink = false },
								{ blink_turn = 'blue', yellow_blink = false, blue_blink = true },
								{ blink_turn = 'yellow', yellow_blink = false, blue_blink = false },
							},
							frame_duration = stage_star_blink_frame_duration,
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
	prefab.define({
		def_id = ids_stage_def,
		class = stage,
		components = {
			custom_visual_component.new,
			tile_layer_component.new,
			timeline_component.new,
			fsm_component.factory({ ids_stage_fsm }),
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

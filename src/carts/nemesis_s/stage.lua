local constants<const> = require('constants')

local stage_subsystem<const> = {}
stage_subsystem.__index = stage_subsystem

local house_roof_base_chars<const> = { ['@'] = true, ['/'] = true, ['\\'] = true, ['^'] = true }
local snow_surface_chars<const> = { ['='] = true, ['-'] = true }
local empty_stage_chars<const> = { p = true, ['P'] = true, m = true, ['M'] = true }
local chimney_chars<const> = { s = true, ['S'] = true, ['R'] = true }
local transparent_overlay_chars<const> = { ['K'] = true, ["'"] = true }

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

local tile_asset_by_key<const> = {
	collision = constants.assets.house_tile_1,
	house_1 = constants.assets.house_tile_1,
	house_2 = constants.assets.house_tile_2,
	house_3 = constants.assets.house_tile_3,
	house_4 = constants.assets.house_tile_4,
	house_5 = constants.assets.house_tile_5,
	house_6 = constants.assets.house_tile_6,
	house_7 = constants.assets.house_tile_7,
	house_8 = constants.assets.house_tile_8,
	house_9 = constants.assets.house_tile_9,
	house_10 = constants.assets.house_tile_10,
	house_11 = constants.assets.house_tile_11,
	house_12 = constants.assets.house_tile_12,
	house_13 = constants.assets.house_tile_13,
	house_door = constants.assets.house_tile_door,
	house_window = constants.assets.house_tile_window,
	house_window2 = constants.assets.house_tile_window2,
	lantaarn1 = constants.assets.lantaarn_tile_1,
	lantaarn2 = constants.assets.lantaarn_tile_2,
	lantaarn3 = constants.assets.lantaarn_tile_3,
	ground = constants.assets.ground,
	ground2 = constants.assets.ground2,
	ground_v = constants.assets.ground_v,
	ground2_v = constants.assets.ground2_v,
	ground3 = constants.assets.ground3,
	ground4 = constants.assets.ground4,
	ground_start = constants.assets.ground_start,
	ground_end = constants.assets.ground_end,
	ground_start_v = constants.assets.ground_start_v,
	ground_end_v = constants.assets.ground_end_v,
	snow = constants.assets.snow,
	schoorsteen1 = constants.assets.schoorsteen1,
	schoorsteen2 = constants.assets.schoorsteen2,
	schoorsteen3 = constants.assets.schoorsteen3,
	snowtree1 = constants.assets.snowtree1,
	snowtree2 = constants.assets.snowtree2,
	snowtree3 = constants.assets.snowtree3,
	snowtree4 = constants.assets.snowtree4,
	snowtree5 = constants.assets.snowtree5,
	snowtree6 = constants.assets.snowtree6,
	snowtree7 = constants.assets.snowtree7,
	snowtree8 = constants.assets.snowtree8,
	snowtree9 = constants.assets.snowtree9,
	snowtree10 = constants.assets.snowtree10,
	snowtree11 = constants.assets.snowtree11,
	snowtree12 = constants.assets.snowtree12,
	snowtree13 = constants.assets.snowtree13,
	snowtree14 = constants.assets.snowtree14,
	snowtree15 = constants.assets.snowtree15,
	snowtree16 = constants.assets.snowtree16,
	snowtree17 = constants.assets.snowtree17,
	snowtree18 = constants.assets.snowtree18,
	snowtree19 = constants.assets.snowtree19,
	snowtree20 = constants.assets.snowtree20,
	snowtree21 = constants.assets.snowtree21,
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

local decode_stage_tile<const> = function(map_rows, x, y)
	local ch<const> = char_at(map_rows, x, y)
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

	local tile_id<const> = tile_asset_by_key[tile_key]
	if non_collision_tile_keys[tile_key] then
		return tile_id, 0
	end
	return tile_id, 1
end

function stage_subsystem:apply_stage_config(stage_data)
	self.tile_size = stage_data.tile_size
	self.tile_columns = stage_data.tile_columns
	self.draw_z = stage_data.draw_z
	self.scroll_mode_pause = stage_data.scroll_mode_pause
	self.scroll_mode_forced = stage_data.scroll_mode_forced
	self.scroll_mode_gated = stage_data.scroll_mode_gated
	self.scroll_mode_default = stage_data.scroll_mode_default
	self.scroll_rotator_initial = stage_data.scroll_rotator_initial
end

function stage_subsystem:build_tape()
	local stage_data<const> = assets.data[constants.stage.asset_id]
	self:apply_stage_config(stage_data)
	local map_rows<const> = stage_data.map_rows

	local width<const> = string.len(map_rows[1])
	local height<const> = #map_rows

	self.tile_rows = height
	self.tape_length_tiles = width
	self.stop_tape_head = stage_data.stop_tape_head
	self.tile_tape = new_rows(width, height, nil)
	self.solid_tape = new_rows(width, height, 0)

	for stage_y = 1, height do
		local row<const> = map_rows[stage_y]
		for stage_x = 1, width do
			local tile_key<const> = decode_stage_tile(map_rows, stage_x, stage_y)
			local tile_id<const> , solid<const> = resolve_tile_material(tile_key)
			self.tile_tape[stage_y][stage_x] = tile_id
			self.solid_tape[stage_y][stage_x] = solid
		end
	end
end

function stage_subsystem:apply_star_scroll(stars, step)
	for i = 1, #stars do
		local star<const> = stars[i]
		star.x = star.x - step
		if star.x < 0 then
			star.x = constants.machine.game_width
		end
	end
end

function stage_subsystem:reset_runtime()
	if #self.tile_tape == 0 then
		self:build_tape()
	end
	self.left_tile = 1
	self.tape_head = self.tile_columns
	self.tile_steps = 0
	self.total_scroll_px = 0
	self.total_smooth_scroll_px = 0
	self.scrolling = true
	self.scroll_mode = self.scroll_mode_default
	self.scroll_rotator = self.scroll_rotator_initial
	self.scroll_gate_bit = 0
	self.scroll_advanced = false
	self.frame = 0
	reset_star_positions(self.yellow_stars, constants.stars.yellow)
	reset_star_positions(self.blue_stars, constants.stars.blue)
	self.yellow_blink = false
	self.blue_blink = false
	self.blink_turn = 'yellow'
end

function stage_subsystem:update_runtime()
	local smooth_scroll_px = 0

	if self.scrolling then
		local max_left_tile<const> = self.tape_length_tiles - self.tile_columns + 1
		local should_advance = false

		self.scroll_advanced = false
		self.scroll_gate_bit = 0

		if self.scroll_mode == self.scroll_mode_forced then
			should_advance = true
			smooth_scroll_px = self.tile_size
		elseif self.scroll_mode == self.scroll_mode_gated then
			self.scroll_rotator = rol8(self.scroll_rotator)
			self.scroll_gate_bit = self.scroll_rotator % 2
			should_advance = self.scroll_gate_bit == 1
			smooth_scroll_px = self.tile_size / 8
		end

		if should_advance then
			if self.tape_head >= self.stop_tape_head or self.left_tile >= max_left_tile then
				self.scrolling = false
				smooth_scroll_px = 0
				self.events:emit('stage_scroll_stop', {
					left = self.left_tile,
					head = self.tape_head,
				})
			else
				self.left_tile = self.left_tile + 1
				self.tape_head = self.left_tile + self.tile_columns - 1
				self.tile_steps = self.tile_steps + 1
				self.scroll_advanced = true
				self.events:emit('stage_scroll_tile', {
					left = self.left_tile,
					head = self.tape_head,
				})
			end
		end

		self.events:emit('stage_scroll_gate', {
			mode = self.scroll_mode,
			rot = self.scroll_rotator,
			bit = self.scroll_gate_bit,
			adv = self.scroll_advanced,
			left = self.left_tile,
			head = self.tape_head,
		})
	end

	self.total_scroll_px = self.tile_steps * self.tile_size
	self.total_smooth_scroll_px = self.total_smooth_scroll_px + smooth_scroll_px
	if smooth_scroll_px ~= 0 then
		self:apply_star_scroll(self.yellow_stars, smooth_scroll_px)
		self:apply_star_scroll(self.blue_stars, smooth_scroll_px)
	end
	self.frame = self.frame + 1
end

function stage_subsystem:draw_star_particles(stars, imgid, hidden)
	if hidden then
		return
	end
	for i = 1, #stars do
		local star<const> = stars[i]
		vdp_blit_img_rgba(imgid, star.x, star.y, constants.stage.star_particle_z, sys_vdp_layer_world, 1, 1, 0, 1, 1, 1, 1, 0)
	end
end

function stage_subsystem:draw()
	self:draw_star_particles(self.yellow_stars, constants.assets.star_yellow, self.yellow_blink)
	self:draw_star_particles(self.blue_stars, constants.assets.star_blue, self.blue_blink)

	local draw_columns<const> = self.tile_columns + 1
	local tile_size<const> = self.tile_size
	local z<const> = self.draw_z

	for screen_column = 0, draw_columns do
		local stage_column<const> = self.left_tile + screen_column
		if stage_column > self.tape_length_tiles then
			break
		end

		local draw_x<const> = screen_column * tile_size
		for stage_row = 1, self.tile_rows do
			local tile_id<const> = self.tile_tape[stage_row][stage_column]
			if tile_id ~= nil then
				vdp_blit_img_rgba(tile_id, draw_x, (stage_row - 1) * tile_size, z, sys_vdp_layer_world, 1, 1, 0, 1, 1, 1, 1, 0)
			end
		end
	end
end

function stage_subsystem:is_solid_pixel(screen_x, screen_y)
	local map_x = ((screen_x + self.total_scroll_px) // self.tile_size) + 1
	local map_y = (screen_y // self.tile_size) + 1

	map_x = clamp_int(map_x, 1, self.tape_length_tiles)
	map_y = clamp_int(map_y, 1, self.tile_rows)

	return self.solid_tape[map_y][map_x] ~= 0
end

function stage_subsystem:ctor()
	self.tile_tape = {}
	self.solid_tape = {}
	self.yellow_stars = {}
	self.blue_stars = {}
end

local define_stage_fsm<const> = function()
	define_fsm(constants.ids.stage_fsm, {
		initial = 'boot',
		states = {
			boot = {
				entering_state = function(self)
					self:reset_runtime()
					return '/running'
				end,
				},
				running = {
					update = function(self)
						self:update_runtime()
					end,
					timelines = {
						[constants.ids.stage_star_blink_timeline] = {
						def = {
							frames = {
								{ blink_turn = 'yellow', yellow_blink = true, blue_blink = false },
								{ blink_turn = 'blue', yellow_blink = false, blue_blink = false },
								{ blink_turn = 'blue', yellow_blink = false, blue_blink = true },
								{ blink_turn = 'yellow', yellow_blink = false, blue_blink = false },
							},
							ticks_per_frame = constants.stage.star_blink_gate_frames,
							playback_mode = 'loop',
						},
						autoplay = true,
						stop_on_exit = true,
						play_options = {
							rewind = true,
							snap_to_start = true,
						},
						on_frame = function(self, _state, event)
							self.events:emit('star_blink_toggle', {
								turn = event.frame_value.blink_turn,
								yellow_blink = event.frame_value.yellow_blink,
								blue_blink = event.frame_value.blue_blink,
							})
						end,
					},
				},
				},
			},
		})
end

local register_stage_subsystem_definition<const> = function()
	define_subsystem({
		def_id = constants.ids.stage_def,
		class = stage_subsystem,
		fsms = { constants.ids.stage_fsm },
		defaults = {
			update_priority = -10,
			animation_priority = -10,
			presentation_priority = -10,
		},
	})
end

return {
	define_stage_fsm = define_stage_fsm,
	register_stage_subsystem_definition = register_stage_subsystem_definition,
	stage_def_id = constants.ids.stage_def,
	stage_instance_id = constants.ids.stage_instance,
	stage_fsm_id = constants.ids.stage_fsm,
}

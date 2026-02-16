local constants = require('constants.lua')
local romdir = require('romdir')

local stage = {}
local stage_object = {}
stage_object.__index = stage_object

local stage_fsm_id = constants.ids.stage_fsm

local state = {
	tile_tape = {},
	solid_tape = {},
	tile_size = 0,
	tile_columns = 0,
	draw_z = 0,
	scroll_mode_pause = 0,
	scroll_mode_forced = 0,
	scroll_mode_gated = 0,
	scroll_mode_default = 0,
	scroll_rotator_initial = 0,
	left_tile = 1,
	tape_head = 0,
	tile_rows = 0,
	tape_length_tiles = 0,
	stop_tape_head = 0,
	tile_steps = 0,
	total_scroll_px = 0,
	total_smooth_scroll_px = 0,
	scrolling = true,
	scroll_mode = 0,
	scroll_rotator = 0,
	scroll_gate_bit = 0,
	scroll_advanced = false,
	frame = 0,
	yellow_stars = {},
	blue_stars = {},
	yellow_blink = false,
	blue_blink = false,
	blink_turn = 'yellow',
	event_sink = nil,
}

local non_collision_tile_keys = {
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

local loaded_stage_data = nil

local tile_asset_by_key = {
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

local function new_rows(width, height, default_value)
	local out = {}
	for y = 1, height do
		local row = {}
		for x = 1, width do
			row[x] = default_value
		end
		out[y] = row
	end
	return out
end

local function reset_star_positions(target, source)
	for i = 1, #source do
		local src = source[i]
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

local function emit_event(name, extra)
	local sink = state.event_sink
	if sink == nil then
		return
	end
	sink(name, extra)
end

local function apply_star_scroll(stars, step)
	local width = constants.machine.game_width
	for i = 1, #stars do
		local star = stars[i]
		star.x = star.x - step
		if star.x < 0 then
			star.x = width
		end
	end
end

local function apply_blink_state(turn, yellow_blink, blue_blink)
	state.blink_turn = turn
	state.yellow_blink = yellow_blink
	state.blue_blink = blue_blink
	emit_event(
		'star_blink_toggle',
		string.format(
			'turn=%s|yellow_blink=%d|blue_blink=%d',
			state.blink_turn,
			bool01(state.yellow_blink),
			bool01(state.blue_blink)
		)
	)
end

local function draw_star_particles(stars, imgid, hidden)
	if hidden then
		return
	end
	for i = 1, #stars do
		local star = stars[i]
		put_sprite(imgid, star.x, star.y, constants.stage.star_particle_z)
	end
end

local function load_stage_data()
	local token = romdir.token(constants.stage.asset_id)
	local data = assets.data[token]
	if data == nil then
		error("nemesis_s stage missing data asset '" .. constants.stage.asset_id .. "'")
	end
	return data
end

local function get_stage_data()
	if loaded_stage_data == nil then
		loaded_stage_data = load_stage_data()
	end
	return loaded_stage_data
end

local function apply_stage_config(stage_data)
	state.tile_size = stage_data.tile_size
	state.tile_columns = stage_data.tile_columns
	state.draw_z = stage_data.draw_z
	state.scroll_mode_pause = stage_data.scroll_mode_pause
	state.scroll_mode_forced = stage_data.scroll_mode_forced
	state.scroll_mode_gated = stage_data.scroll_mode_gated
	state.scroll_mode_default = stage_data.scroll_mode_default
	state.scroll_rotator_initial = stage_data.scroll_rotator_initial
end

local function char_at(map_rows, x, y)
	if y < 1 or y > #map_rows then
		return ' '
	end
	local row = map_rows[y]
	if x < 1 or x > string.len(row) then
		return ' '
	end
	return string.sub(row, x, x)
end

local function is_house_roof_base(ch)
	return ch == '@' or ch == '/' or ch == '\\' or ch == '^'
end

local function should_snow_from_neighbors(below, left_down, right_down)
	return (below == '=' or below == '-') and left_down ~= ' ' and right_down ~= ' '
end

local function decode_stage_tile(map_rows, x, y)
	local ch = char_at(map_rows, x, y)
	local above = char_at(map_rows, x, y - 1)
	local below = char_at(map_rows, x, y + 1)
	local left = char_at(map_rows, x - 1, y)
	local right = char_at(map_rows, x + 1, y)
	local left_down = char_at(map_rows, x - 1, y + 1)
	local right_down = char_at(map_rows, x + 1, y + 1)

	if ch == '!' then
		return 'collision'
	end
	if ch == '#' then
		if is_house_roof_base(above) then
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
		if is_house_roof_base(above) then
			return 'house_7'
		end
		return 'house_10'
	end
	if ch == ')' then
		if is_house_roof_base(above) then
			return 'house_9'
		end
		return 'house_11'
	end
	if ch == '|' then
		if below == '-' or below == '=' then
			return 'lantaarn3'
		end
		return 'lantaarn2'
	end
	if ch == 'o' then
		return 'lantaarn1'
	end
	if ch == 'p' or ch == 'P' or ch == 'm' or ch == 'M' then
		return 'none'
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
		local parity_even = ((x - 1) % 2) == 0
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
		local parity_even = ((x - 1) % 2) == 0
		if parity_even then
			return 'ground3'
		end
		return 'ground4'
	end
	if ch == 's' or ch == 'S' or ch == 'R' then
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
		return 'none'
	end
	if ch == 'Z' then
		if should_snow_from_neighbors(below, left_down, right_down) then
			return 'snow'
		end
		return 'none'
	end
	if ch == 'N' then
		if should_snow_from_neighbors(below, left_down, right_down) then
			return 'snow'
		end
		return 'none'
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
		return 'none'
	end
	if ch == '1' then
		if left == 't' then
			return 'snowtree2'
		end
		return 'none'
	end
	if ch == '2' then
		if left == 't' then
			return 'snowtree5'
		end
		return 'none'
	end
	if ch == '3' then
		if left == 't' then
			return 'snowtree8'
		end
		return 'none'
	end
	if ch == '4' then
		if left == 't' then
			return 'snowtree11'
		end
		return 'none'
	end
	if ch == '5' then
		if left == 't' then
			return 'snowtree14'
		end
		return 'none'
	end
	if ch == '6' then
		if left == 't' then
			return 'snowtree17'
		end
		return 'none'
	end
	if ch == '7' then
		if left == 't' then
			return 'snowtree20'
		end
		return 'none'
	end
	if ch == 'K' or ch == "'" then
		return 'none'
	end
	error('nemesis_s unsupported stage symbol "' .. ch .. '" at x=' .. tostring(x) .. ', y=' .. tostring(y))
end

local function resolve_tile_material(tile_key)
	if tile_key == 'none' then
		return nil, 0
	end

	local tile_id = tile_asset_by_key[tile_key]
	if tile_id == nil then
		error("nemesis_s unsupported stage tile key '" .. tile_key .. "'")
	end

	if non_collision_tile_keys[tile_key] then
		return tile_id, 0
	end
	return tile_id, 1
end

local function build_tape()
	local stage_data = get_stage_data()
	apply_stage_config(stage_data)
	local map_rows = stage_data.map_rows
	if #map_rows == 0 then
		error('nemesis_s stage data has no map_rows')
	end

	local width = string.len(map_rows[1])
	local height = #map_rows

	if stage_data.tile_rows ~= height then
		error(
			'nemesis_s stage tile_rows mismatch: manifest='
				.. tostring(stage_data.tile_rows)
				.. ', actual='
				.. tostring(height)
		)
	end
	if stage_data.tape_length_tiles ~= width then
		error(
			'nemesis_s stage tape_length_tiles mismatch: manifest='
				.. tostring(stage_data.tape_length_tiles)
				.. ', actual='
				.. tostring(width)
		)
	end

	state.tile_rows = height
	state.tape_length_tiles = width
	state.stop_tape_head = stage_data.stop_tape_head
	state.tile_tape = new_rows(width, height, nil)
	state.solid_tape = new_rows(width, height, 0)

	for stage_y = 1, height do
		local row = map_rows[stage_y]
		if string.len(row) ~= width then
			error(
				'nemesis_s stage row width mismatch at y='
					.. tostring(stage_y)
					.. ': expected='
					.. tostring(width)
					.. ', actual='
					.. tostring(string.len(row))
			)
		end
		for stage_x = 1, width do
			local tile_key = decode_stage_tile(map_rows, stage_x, stage_y)
			local tile_id, solid = resolve_tile_material(tile_key)
			state.tile_tape[stage_y][stage_x] = tile_id
			state.solid_tape[stage_y][stage_x] = solid
		end
	end
end

function stage.reset_runtime()
	if #state.tile_tape == 0 then
		build_tape()
	end
	state.left_tile = 1
	state.tape_head = state.tile_columns
	state.tile_steps = 0
	state.total_scroll_px = 0
	state.total_smooth_scroll_px = 0
	state.scrolling = true
	state.scroll_mode = state.scroll_mode_default
	state.scroll_rotator = state.scroll_rotator_initial
	state.scroll_gate_bit = 0
	state.scroll_advanced = false
	state.frame = 0
	reset_star_positions(state.yellow_stars, constants.stars.yellow)
	reset_star_positions(state.blue_stars, constants.stars.blue)
	state.yellow_blink = false
	state.blue_blink = false
	state.blink_turn = 'yellow'
end

function stage.tick(on_event)
	local delta_scroll_px = 0
	local smooth_scroll_px = 0
	local max_left_tile = state.tape_length_tiles - state.tile_columns + 1
	local should_advance = false

	state.scroll_advanced = false
	state.scroll_gate_bit = 0

	if state.scrolling then
		if state.scroll_mode == state.scroll_mode_forced then
			should_advance = true
			smooth_scroll_px = state.tile_size
		elseif state.scroll_mode == state.scroll_mode_gated then
			state.scroll_rotator = rol8(state.scroll_rotator)
			state.scroll_gate_bit = state.scroll_rotator % 2
			should_advance = state.scroll_gate_bit == 1
			smooth_scroll_px = state.tile_size / 8
		end

		if should_advance then
			if state.tape_head >= state.stop_tape_head or state.left_tile >= max_left_tile then
				state.scrolling = false
				smooth_scroll_px = 0
				if on_event ~= nil then
					on_event('stage_scroll_stop', string.format('left=%d|head=%d', state.left_tile, state.tape_head))
				end
			else
				state.left_tile = state.left_tile + 1
				state.tape_head = state.left_tile + state.tile_columns - 1
				state.tile_steps = state.tile_steps + 1
				delta_scroll_px = state.tile_size
				state.scroll_advanced = true
				if on_event ~= nil then
					on_event('stage_scroll_tile', string.format('left=%d|head=%d', state.left_tile, state.tape_head))
				end
			end
		end

		if on_event ~= nil then
			on_event(
				'stage_scroll_gate',
				string.format(
					'mode=%d|rot=%d|bit=%d|adv=%d|left=%d|head=%d',
					state.scroll_mode,
					state.scroll_rotator,
					state.scroll_gate_bit,
					state.scroll_advanced and 1 or 0,
					state.left_tile,
					state.tape_head
				)
			)
		end
	end

	state.total_scroll_px = state.tile_steps * state.tile_size
	state.total_smooth_scroll_px = state.total_smooth_scroll_px + smooth_scroll_px
	if smooth_scroll_px ~= 0 then
		apply_star_scroll(state.yellow_stars, smooth_scroll_px)
		apply_star_scroll(state.blue_stars, smooth_scroll_px)
	end
	state.frame = state.frame + 1
	return delta_scroll_px, smooth_scroll_px
end

function stage.draw()
	draw_star_particles(state.yellow_stars, constants.assets.star_yellow, state.yellow_blink)
	draw_star_particles(state.blue_stars, constants.assets.star_blue, state.blue_blink)

	local draw_columns = state.tile_columns + 1
	local tile_size = state.tile_size
	local start_tile = state.left_tile
	local z = state.draw_z

	for screen_column = 0, draw_columns do
		local stage_column = start_tile + screen_column
		if stage_column > state.tape_length_tiles then
			break
		end

		local draw_x = screen_column * tile_size
		for stage_row = 1, state.tile_rows do
			local tile_id = state.tile_tape[stage_row][stage_column]
			if tile_id ~= nil then
				put_sprite(tile_id, draw_x, (stage_row - 1) * tile_size, z)
			end
		end
	end
end

function stage.is_solid_pixel(screen_x, screen_y)
	local tile_size = state.tile_size
	local map_x = math.floor((screen_x + state.total_scroll_px) / tile_size) + 1
	local map_y = math.floor(screen_y / tile_size) + 1

	map_x = clamp_int(map_x, 1, state.tape_length_tiles)
	map_y = clamp_int(map_y, 1, state.tile_rows)

	return state.solid_tape[map_y][map_x] ~= 0
end

function stage.get_state()
	return state
end

function stage.set_event_sink(on_event)
	state.event_sink = on_event
end

function stage_object:define_star_blink_timeline()
	local timeline_id = constants.ids.stage_star_blink_timeline
	self:define_timeline(timeline.new({
		id = timeline_id,
		frames = {
			{ turn = 'yellow', yellow_blink = true, blue_blink = false },
			{ turn = 'blue', yellow_blink = false, blue_blink = false },
			{ turn = 'blue', yellow_blink = false, blue_blink = true },
			{ turn = 'yellow', yellow_blink = false, blue_blink = false },
		},
		ticks_per_frame = constants.stage.star_blink_gate_frames,
		playback_mode = 'loop',
		apply = function(_target, frame_value)
			apply_blink_state(frame_value.turn, frame_value.yellow_blink, frame_value.blue_blink)
		end,
	}))
	self:play_timeline(timeline_id, { rewind = true, snap_to_start = true })
end

function stage_object:reset_runtime()
	stage.reset_runtime()
end

function stage_object:tick()
	stage.tick(emit_event)
end

function stage_object:ctor()
	local rc = self:get_component('customvisualcomponent')
	rc.producer = function(_ctx)
		stage.draw()
	end
end

local function define_stage_fsm()
	define_fsm(stage_fsm_id, {
		initial = 'boot',
		states = {
			boot = {
				entering_state = function(self)
					self:reset_runtime()
					self:define_star_blink_timeline()
					return '/running'
				end,
			},
			running = {},
		},
	})
end

local function register_stage_definition()
	define_prefab({
		def_id = constants.ids.stage_def,
		class = stage_object,
		fsms = { stage_fsm_id },
		components = { 'customvisualcomponent' },
		defaults = {},
	})
end

return {
	reset_runtime = stage.reset_runtime,
	tick = stage.tick,
	draw = stage.draw,
	is_solid_pixel = stage.is_solid_pixel,
	get_state = stage.get_state,
	set_event_sink = stage.set_event_sink,
	define_stage_fsm = define_stage_fsm,
	register_stage_definition = register_stage_definition,
	stage_def_id = constants.ids.stage_def,
	stage_instance_id = constants.ids.stage_instance,
	stage_fsm_id = stage_fsm_id,
}

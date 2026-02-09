local constants = require('constants.lua')

local stage = {}

local state = {
	tile_tape = {},
	solid_tape = {},
	left_tile = 1,
	tape_head = constants.stage.tile_columns,
	tile_steps = 0,
	total_scroll_px = 0,
	scrolling = true,
	scroll_mode = constants.stage.scroll_mode_default,
	scroll_rotator = constants.stage.scroll_rotator_initial,
	scroll_gate_bit = 0,
	scroll_advanced = false,
}

local function clamp_int(value, min_value, max_value)
	local clamped = value
	if clamped < min_value then
		clamped = min_value
	end
	if clamped > max_value then
		clamped = max_value
	end
	return clamped
end

local function rol8(value)
	local rotated = value + value
	if rotated >= 256 then
		rotated = rotated - 255
	end
	return rotated
end

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

local function profile_for_column(stage_x)
	local rows = constants.stage.tile_rows

	local ceiling = 2 + math.floor((math.sin(stage_x / 23) + 1) * 1.5)
	local floor = (rows - 2) - math.floor((math.sin((stage_x + 110) / 27) + 1) * 1.5)

	if stage_x >= 96 and stage_x < 188 then
		floor = floor - 1
	end
	if stage_x >= 188 and stage_x < 264 then
		ceiling = ceiling + 1
	end
	if stage_x >= 264 and stage_x < 380 then
		ceiling = ceiling + 1
		floor = floor - 1
	end
	if stage_x >= 380 and stage_x < 440 then
		ceiling = ceiling + 2
		floor = floor - 2
	end
	if stage_x >= 448 and stage_x <= constants.stage.stop_tape_head then
		ceiling = 1
		floor = rows - 2
	end

	local minimum_gap = 8
	if floor - ceiling < minimum_gap then
		local center = math.floor((ceiling + floor) * 0.5)
		ceiling = center - math.floor(minimum_gap * 0.5)
		floor = ceiling + minimum_gap
	end

	ceiling = clamp_int(ceiling, 1, rows - 10)
	floor = clamp_int(floor, ceiling + minimum_gap, rows - 1)

	return ceiling, floor
end

local function set_tile(stage_x, stage_y, tile_id, solid)
	state.tile_tape[stage_y][stage_x] = tile_id
	state.solid_tape[stage_y][stage_x] = solid
end

local function build_tape()
	local width = constants.stage.tape_length_tiles
	local height = constants.stage.tile_rows

	state.tile_tape = new_rows(width, height, nil)
	state.solid_tape = new_rows(width, height, 0)

	for stage_x = 1, width do
		local ceiling, floor = profile_for_column(stage_x)

		for stage_y = 1, ceiling do
			local tile_id = constants.assets.ground_v
			if stage_y == ceiling then
				tile_id = constants.assets.ground_end_v
			elseif ((stage_x + stage_y) % 2) == 0 then
				tile_id = constants.assets.ground2_v
			end
			set_tile(stage_x, stage_y, tile_id, 1)
		end

		for stage_y = floor, height do
			local tile_id = constants.assets.ground
			local solid = 1
			if stage_y == floor then
				if (stage_x % 3) == 0 then
					tile_id = constants.assets.snow
					solid = 0
				else
					tile_id = constants.assets.ground_start
				end
			elseif stage_y == height then
				if (stage_x % 2) == 0 then
					tile_id = constants.assets.ground3
				else
					tile_id = constants.assets.ground4
				end
			elseif (stage_x % 2) == 0 then
				tile_id = constants.assets.ground2
			end
			set_tile(stage_x, stage_y, tile_id, solid)
		end

		if stage_x > 84 and stage_x < 428 and (stage_x % 52) == 0 then
			local top = floor - 5
			for stage_y = top, floor - 1 do
				local tile_id = constants.assets.ground_end
				if stage_y == top then
					tile_id = constants.assets.ground_start
				end
				set_tile(stage_x, stage_y, tile_id, 1)
			end
		end

		if stage_x > 126 and stage_x < 392 and (stage_x % 64) == 32 then
			local bottom = ceiling + 5
			for stage_y = ceiling + 1, bottom do
				local tile_id = constants.assets.ground_end_v
				if stage_y < bottom and ((stage_y + stage_x) % 2) == 0 then
					tile_id = constants.assets.ground2_v
				end
				set_tile(stage_x, stage_y, tile_id, 1)
			end
		end
	end
end

function stage.reset_runtime()
	if #state.tile_tape == 0 then
		build_tape()
	end
	state.left_tile = 1
	state.tape_head = constants.stage.tile_columns
	state.tile_steps = 0
	state.total_scroll_px = 0
	state.scrolling = true
	state.scroll_mode = constants.stage.scroll_mode_default
	state.scroll_rotator = constants.stage.scroll_rotator_initial
	state.scroll_gate_bit = 0
	state.scroll_advanced = false
end

function stage.tick(on_event)
	local delta_scroll_px = 0
	local max_left_tile = constants.stage.tape_length_tiles - constants.stage.tile_columns + 1
	local should_advance = false

	state.scroll_advanced = false
	state.scroll_gate_bit = 0

	if state.scrolling then
		if state.scroll_mode == constants.stage.scroll_mode_forced then
			should_advance = true
		elseif state.scroll_mode == constants.stage.scroll_mode_gated then
			state.scroll_rotator = rol8(state.scroll_rotator)
			state.scroll_gate_bit = state.scroll_rotator % 2
			should_advance = state.scroll_gate_bit == 1
		end

		if should_advance then
			if state.tape_head >= constants.stage.stop_tape_head or state.left_tile >= max_left_tile then
				state.scrolling = false
				if on_event ~= nil then
					on_event('stage_scroll_stop', string.format('left=%d|head=%d', state.left_tile, state.tape_head))
				end
			else
				state.left_tile = state.left_tile + 1
				state.tape_head = state.left_tile + constants.stage.tile_columns - 1
				state.tile_steps = state.tile_steps + 1
				delta_scroll_px = constants.stage.tile_size
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

	state.total_scroll_px = state.tile_steps * constants.stage.tile_size
	return delta_scroll_px
end

function stage.draw()
	local draw_columns = constants.stage.tile_columns + 1
	local tile_size = constants.stage.tile_size
	local start_tile = state.left_tile
	local z = constants.stage.draw_z

	for screen_column = 0, draw_columns do
		local stage_column = start_tile + screen_column
		if stage_column > constants.stage.tape_length_tiles then
			break
		end

		local draw_x = screen_column * tile_size
		for stage_row = 1, constants.stage.tile_rows do
			local tile_id = state.tile_tape[stage_row][stage_column]
			if tile_id ~= nil then
				put_sprite(tile_id, draw_x, (stage_row - 1) * tile_size, z)
			end
		end
	end
end

function stage.is_solid_pixel(screen_x, screen_y)
	local tile_size = constants.stage.tile_size
	local map_x = math.floor((screen_x + state.total_scroll_px) / tile_size) + 1
	local map_y = math.floor(screen_y / tile_size) + 1

	map_x = clamp_int(map_x, 1, constants.stage.tape_length_tiles)
	map_y = clamp_int(map_y, 1, constants.stage.tile_rows)

	return state.solid_tape[map_y][map_x] ~= 0
end

function stage.get_state()
	return state
end

return stage

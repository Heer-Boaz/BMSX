local constants = require('constants.lua')
local romdir = require('romdir')

local stage = {}

local state = {
	tile_tape = {},
	solid_tape = {},
	left_tile = 1,
	tape_head = constants.stage.tile_columns,
	tile_rows = 0,
	tape_length_tiles = 0,
	stop_tape_head = 0,
	tile_steps = 0,
	total_scroll_px = 0,
	scrolling = true,
	scroll_mode = constants.stage.scroll_mode_default,
	scroll_rotator = constants.stage.scroll_rotator_initial,
	scroll_gate_bit = 0,
	scroll_advanced = false,
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
		if left == ' ' then
			return 'ground_start_v'
		end
		if right == ' ' then
			return 'ground_end_v'
		end
		if (x % 2) == 0 then
			return 'ground_v'
		end
		return 'ground2_v'
	end
	if ch == '%' then
		if (x % 2) == 0 then
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

local function resolve_tile_material(tile_key, stage_x, stage_y)
	if tile_key == 'none' then
		return nil, 0
	end
	if tile_key == 'ground' then
		return constants.assets.ground, 1
	end
	if tile_key == 'ground2' then
		return constants.assets.ground2, 1
	end
	if tile_key == 'ground_v' then
		return constants.assets.ground_v, 1
	end
	if tile_key == 'ground2_v' then
		return constants.assets.ground2_v, 1
	end
	if tile_key == 'ground3' then
		return constants.assets.ground3, 1
	end
	if tile_key == 'ground4' then
		return constants.assets.ground4, 1
	end
	if tile_key == 'ground_start' then
		return constants.assets.ground_start, 1
	end
	if tile_key == 'ground_end' then
		return constants.assets.ground_end, 1
	end
	if tile_key == 'ground_start_v' then
		return constants.assets.ground_start_v, 1
	end
	if tile_key == 'ground_end_v' then
		return constants.assets.ground_end_v, 1
	end
	if tile_key == 'snow' then
		return constants.assets.snow, 0
	end
	if non_collision_tile_keys[tile_key] then
		return nil, 0
	end
	if ((stage_x + stage_y) % 2) == 0 then
		return constants.assets.ground3, 1
	end
	return constants.assets.ground4, 1
end

local function build_tape()
	local stage_data = get_stage_data()
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
			local tile_id, solid = resolve_tile_material(tile_key, stage_x, stage_y)
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
	local max_left_tile = state.tape_length_tiles - constants.stage.tile_columns + 1
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
			if state.tape_head >= state.stop_tape_head or state.left_tile >= max_left_tile then
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
	local tile_size = constants.stage.tile_size
	local map_x = math.floor((screen_x + state.total_scroll_px) / tile_size) + 1
	local map_y = math.floor(screen_y / tile_size) + 1

	map_x = clamp_int(map_x, 1, state.tape_length_tiles)
	map_y = clamp_int(map_y, 1, state.tile_rows)

	return state.solid_tape[map_y][map_x] ~= 0
end

function stage.get_state()
	return state
end

return stage

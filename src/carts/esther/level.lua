-- @bmsx-analyse disable
local constants = require('constants')

local level = {}

local resolve_level_context_state32<const> = function(context_key)
	local key = context_key or constants.dkc.default_level_context
	local value = constants.dkc.level_state32_by_context[key]
	if value == nil then
		error(string.format("Unknown DKC level context '%s'", tostring(key)))
	end
	return key, value
end

local eor_16<const> = function(a, b)
	return (a ~ b) & 0xFFFF
end

local find_top_solid_y<const> = function(solids, sample_x)
	local top = nil
	for i = 1, #solids do
		local solid = solids[i]
		if sample_x >= solid.x and sample_x < (solid.x + solid.w) then
			if top == nil or solid.y < top then
				top = solid.y
			end
		end
	end
	return top
end

local build_dummy_asm_collision<const> = function(level_data)
	local columns = ((level_data.world_width + 31) // 32) + 1
	local rows = 16
	local d3_words = {}

	for i = 1, columns * rows do
		d3_words[i] = 0x0000
	end

	local player_height = constants.player.height
	for col = 0, columns - 1 do
		local sample_x = (col << 5) + 16
		local top_solid_y = find_top_solid_y(level_data.solids, sample_x)
		if top_solid_y ~= nil then
			local probe_y = top_solid_y - player_height
			if probe_y < 0 then
				probe_y = 0
			elseif probe_y > 0x01FF then
				probe_y = 0x01FF
			end
			local y_base = probe_y & 0x01E0
			local y_component = (eor_16(y_base, 0x01E0) >> 4) & 0xFFFF
			local d3_offset = ((col << 5) + y_component) & 0xFFFF
			local d3_index = (d3_offset >> 1) + 1
			d3_words[d3_index] = 0x0001
		end
	end

	level_data.dkc1_asm_collision = {
		dispatch_label = 'code_81800d',
		d3_words = d3_words,
		d7_bytes = { 0x00, 0x00, 0x02, 0x02 },
		db = 0x0002,
	}
end

function level.create_level(context_key)
	local world_width = constants.world.width
	local world_height = constants.world.height
	local ground_y = 192
	local selected_context_key, selected_state32 = resolve_level_context_state32(context_key)

	local level_data = {
		world_width = world_width,
		world_height = world_height,
		dkc1_level_context = selected_context_key,
		dkc1_state32 = selected_state32,
		spawn = { x = constants.player.start_x, y = constants.player.start_y },
		goal = { x = world_width - 236, y = 120, w = 78, h = 72 },
		barrels = {
			{
				id = 1,
				spawn_x = 1060,
				spawn_y = 174,
				x = 1060,
				y = 174,
				w = constants.barrel.width,
				h = constants.barrel.height,
				pos_subx = 1060 * constants.dkc.subpixels_per_px,
				pos_suby = 174 * constants.dkc.subpixels_per_px,
				x_speed_subpx = 0,
				y_speed_subpx = 0,
				grounded = true,
				state = 'idle',
				throw_lock_frames = 0,
				trace_frames_left = 0,
				spawn_frame = 960,
				dkc1_slot = 0x001C,
				dkc1_sprite_id = 0x0040,
				dkc1_sprite_id_base = 0x0040,
				dkc1_ramtable11a1lo = 0x0027,
				dkc1_ramtable11a1lo_base = 0x0027,
				dkc1_ramtable109dlo = 0x0000,
				dkc1_ramtable109dlo_base = 0x0000,
				dkc1_ramtable1595lo = 0x0000,
				dkc1_ramtable15c9lo = 0x0000,
				dkc1_ramtable0f25lo = 0x0000,
				dkc1_yxppccctlo = 0x0000,
				dkc1_collision_role = 'carryable',
				dkc1_collision_role_base = 'carryable',
				dkc1_hitbox = { 0x0000, -constants.barrel.height, constants.barrel.width, constants.barrel.height },
			},
		},
		stomp_targets = {
			{
				id = 1,
				spawn_x = 280,
				spawn_y = 166,
				x = 280,
				y = 166,
				w = 22,
				h = 26,
				x_speed_subpx = 0,
				y_speed_subpx = 0,
				grounded = true,
				state = 'active',
				spawn_frame = 0,
				dkc1_slot = 0x001A,
				dkc1_sprite_id = 0x0006,
				dkc1_sprite_id_base = 0x0006,
				dkc1_ramtable11a1lo = 0x0027,
				dkc1_ramtable11a1lo_base = 0x0027,
				dkc1_ramtable109dlo = 0x0001,
				dkc1_ramtable109dlo_base = 0x0001,
				dkc1_ramtable1595lo = 0x0000,
				dkc1_ramtable15c9lo = 0x0000,
				dkc1_ramtable0f25lo = 0x0000,
				dkc1_yxppccctlo = 0x0000,
				dkc1_collision_role = 'enemy',
				dkc1_collision_role_base = 'enemy',
				dkc1_hitbox = { 0x0000, -26, 22, 26 },
			},
			{
				id = 2,
				spawn_x = 420,
				spawn_y = 162,
				x = 420,
				y = 162,
				w = 24,
				h = 30,
				x_speed_subpx = 0,
				y_speed_subpx = 0,
				grounded = true,
				state = 'active',
				spawn_frame = 0,
				dkc1_slot = 0x0018,
				dkc1_sprite_id = 0x002F,
				dkc1_sprite_id_base = 0x002F,
				dkc1_ramtable11a1lo = 0x0027,
				dkc1_ramtable11a1lo_base = 0x0027,
				dkc1_ramtable109dlo = 0x0001,
				dkc1_ramtable109dlo_base = 0x0001,
				dkc1_ramtable1595lo = 0x0000,
				dkc1_ramtable15c9lo = 0x0000,
				dkc1_ramtable0f25lo = 0x0000,
				dkc1_yxppccctlo = 0x0000,
				dkc1_collision_role = 'enemy',
				dkc1_collision_role_base = 'enemy',
				dkc1_hitbox = { 0x0000, -30, 24, 30 },
			},
			{
				id = 3,
				spawn_x = 560,
				spawn_y = 160,
				x = 560,
				y = 160,
				w = 28,
				h = 32,
				x_speed_subpx = 0,
				y_speed_subpx = 0,
				grounded = true,
				state = 'active',
				spawn_frame = 0,
				dkc1_slot = 0x0016,
				dkc1_sprite_id = 0x0046,
				dkc1_sprite_id_base = 0x0046,
				dkc1_ramtable11a1lo = 0x0027,
				dkc1_ramtable11a1lo_base = 0x0027,
				dkc1_ramtable109dlo = 0x0001,
				dkc1_ramtable109dlo_base = 0x0001,
				dkc1_ramtable1595lo = 0x0000,
				dkc1_ramtable15c9lo = 0x0000,
				dkc1_ramtable0f25lo = 0x0000,
				dkc1_yxppccctlo = 0x0000,
				dkc1_collision_role = 'enemy',
				dkc1_collision_role_base = 'enemy',
				dkc1_hitbox = { 0x0000, -32, 28, 32 },
			},
			{
				id = 4,
				spawn_x = 700,
				spawn_y = 176,
				x = 700,
				y = 176,
				w = 16,
				h = 16,
				x_speed_subpx = 0,
				y_speed_subpx = 0,
				grounded = true,
				state = 'active',
				spawn_frame = 0,
				dkc1_slot = 0x0014,
				dkc1_sprite_id = 0x0050,
				dkc1_sprite_id_base = 0x0050,
				dkc1_ramtable11a1lo = 0x0027,
				dkc1_ramtable11a1lo_base = 0x0027,
				dkc1_ramtable109dlo = 0x0000,
				dkc1_ramtable109dlo_base = 0x0000,
				dkc1_ramtable1595lo = 0x0000,
				dkc1_ramtable15c9lo = 0x0000,
				dkc1_ramtable0f25lo = 0x0000,
				dkc1_yxppccctlo = 0x0000,
				dkc1_collision_role = 'projectile',
				dkc1_collision_role_base = 'projectile',
				dkc1_hitbox = { 0x0000, -16, 16, 16 },
			},
			{
				id = 5,
				spawn_x = 960,
				spawn_y = 176,
				x = 960,
				y = 176,
				w = 20,
				h = 28,
				x_speed_subpx = 0,
				y_speed_subpx = 0,
				grounded = true,
				state = 'active',
				spawn_frame = 0,
				dkc1_slot = 0x0012,
				dkc1_sprite_id = 0x0033,
				dkc1_sprite_id_base = 0x0033,
				dkc1_ramtable11a1lo = 0x0027,
				dkc1_ramtable11a1lo_base = 0x0027,
				dkc1_ramtable109dlo = 0x0000,
				dkc1_ramtable109dlo_base = 0x0000,
				dkc1_ramtable1595lo = 0x0000,
				dkc1_ramtable15c9lo = 0x0000,
				dkc1_ramtable0f25lo = 0x0000,
				dkc1_yxppccctlo = 0x0000,
				dkc1_collision_role = 'enemy',
				dkc1_collision_role_base = 'enemy',
				dkc1_hitbox = { 0x0000, -28, 20, 28 },
			},
			{
				id = 6,
				spawn_x = 980,
				spawn_y = 176,
				x = 980,
				y = 176,
				w = 14,
				h = 16,
				x_speed_subpx = 0,
				y_speed_subpx = 0,
				grounded = true,
				state = 'active',
				spawn_frame = 0,
				dkc1_slot = 0x0010,
				dkc1_sprite_id = 0x0051,
				dkc1_sprite_id_base = 0x0051,
				dkc1_ramtable11a1lo = 0x0027,
				dkc1_ramtable11a1lo_base = 0x0027,
				dkc1_ramtable109dlo = 0x0000,
				dkc1_ramtable109dlo_base = 0x0000,
				dkc1_ramtable1595lo = 0x0000,
				dkc1_ramtable15c9lo = 0x0000,
				dkc1_ramtable0f25lo = 0x0000,
				dkc1_yxppccctlo = 0x0000,
				dkc1_collision_role = 'projectile',
				dkc1_collision_role_base = 'projectile',
				dkc1_hitbox = { 0x0000, -16, 14, 16 },
			},
		},
			solids = {
				-- Flat opening run-in area.
				{ x = 0, y = ground_y, w = 640, h = world_height - ground_y, dkc1_collision9c = 0x0032 },
				-- Small dip for fall-state transition checks.
				{ x = 640, y = ground_y + 24, w = 100, h = world_height - ground_y - 24, dkc1_collision9c = 0x0032 },
				-- Resume baseline and continue flat run.
				{ x = 740, y = ground_y, w = 760, h = world_height - ground_y, dkc1_collision9c = 0x0032 },
				-- Later raised test pad (not blocking first wall area).
				{ x = 1500, y = ground_y - 32, w = 140, h = world_height - (ground_y - 32), dkc1_collision9c = 0x0032 },
				-- Back to baseline after the state-test section.
				{ x = 1640, y = ground_y, w = world_width - 1640, h = world_height - ground_y, dkc1_collision9c = 0x0032 },
			},
		decor_far = {
			{ x = -160, y = 118, w = 420, h = 122 },
			{ x = 320, y = 122, w = 370, h = 118 },
			{ x = 760, y = 116, w = 430, h = 124 },
			{ x = 1290, y = 120, w = 390, h = 120 },
			{ x = 1760, y = 114, w = 450, h = 126 },
			{ x = 2310, y = 120, w = 400, h = 120 },
			{ x = 2790, y = 116, w = 430, h = 124 },
			{ x = 3320, y = 120, w = 410, h = 120 },
			{ x = 3810, y = 114, w = 420, h = 126 },
		},
		decor_mid = {
			{ x = -40, y = 152, w = 220, h = 88 },
			{ x = 250, y = 158, w = 190, h = 82 },
			{ x = 520, y = 150, w = 220, h = 90 },
			{ x = 820, y = 156, w = 210, h = 84 },
			{ x = 1110, y = 148, w = 230, h = 92 },
			{ x = 1420, y = 156, w = 200, h = 84 },
			{ x = 1690, y = 150, w = 230, h = 90 },
			{ x = 2000, y = 156, w = 210, h = 84 },
			{ x = 2290, y = 148, w = 230, h = 92 },
			{ x = 2600, y = 156, w = 200, h = 84 },
			{ x = 2880, y = 150, w = 230, h = 90 },
			{ x = 3190, y = 156, w = 210, h = 84 },
			{ x = 3480, y = 148, w = 230, h = 92 },
			{ x = 3790, y = 156, w = 200, h = 84 },
		},
		trunks = {
			{ x = 180, y = 90, w = 30, h = 102 },
			{ x = 700, y = 84, w = 28, h = 108 },
			{ x = 1280, y = 86, w = 32, h = 106 },
			{ x = 1750, y = 82, w = 28, h = 110 },
			{ x = 2310, y = 88, w = 32, h = 104 },
			{ x = 2890, y = 84, w = 30, h = 108 },
			{ x = 3450, y = 88, w = 32, h = 104 },
		},
	}

	build_dummy_asm_collision(level_data)
	return level_data
end

return level

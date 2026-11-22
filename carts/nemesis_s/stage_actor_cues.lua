require('constants')

local actors<const> = {}

-- Read the cooked encounter array directly from stage ROM. Only an admitted
-- encounter produces live options, positions or formation state.
struct stage_actor_cue
	column: word
	row: u16
	role: u16
end

local formation_by_role<const> = {
	[112] = sint_pop_group_up, -- p
	[80] = sint_pop_group_down, -- P
}
local mijter_by_role<const> = {
	[109] = mijter_foe_type_blue, -- m
	[77] = mijter_foe_type_red, -- M
}
local turret_by_role<const> = {
	[66] = 'blue_floor', [67] = 'red_floor', [98] = 'blue_ceiling', [99] = 'red_ceiling',
}

local admit<const> = function(stage, column, row, role)
	local size<const> = stage.tile_size
	local scene<const> = stage.scene
	local ground_y<const> = (row - 1) * size
	local group_type<const> = formation_by_role[role]
	if group_type ~= nil then
		local formation<const> = { remaining = sint_pop_group_size }
		for group_index = 0, sint_pop_group_size - 1 do
			scene:spawn(ids_sint_pop_def, {
				position = { x = playfield_width + group_index * sint_pop_width, y = ground_y },
				stage = stage, formation = formation, group_type = group_type,
			})
		end
		return
	end

	local definition_id
	local x = playfield_width - size
	local y = ground_y
	local mijter_type<const> = mijter_by_role[role]
	if mijter_type ~= nil then
		scene:spawn(ids_mijter_foe_def, {
			position = { x = playfield_width, y = ground_y - size },
			stage = stage, mijter_type = mijter_type,
		})
		return
	end
	local turret<const> = turret_by_role[role]
	if turret ~= nil then
		scene:spawn(ids_havengeschut_def, {
			position = { x = x, y = y },
			stage = stage, variant = turret, spawn_column = column,
		})
		return
	end
	if role == 90 then -- Z: sack
		scene:spawn(ids_zak_foe_def, {
			position = { x = x, y = ground_y - size },
			stage = stage, direction = zak_foe_direction_left,
		})
		return
	end

	if role == 83 then -- S: chimney
		definition_id = ids_schoorsteen_foe_def
		x, y = playfield_width - schoorsteen_foe_width // 2, ground_y - schoorsteen_foe_height
	elseif role == 68 then -- D: quay cannon
		definition_id = ids_kadekanon_def
		x = playfield_width - 12
	elseif role == 82 then -- R: smoke generator
		definition_id = ids_rook_generator_def
		x, y = x - rook_generator_width // 2, ground_y - rook_generator_height
	elseif role == 78 then -- N: snowman
		definition_id = ids_sneeuwpop_def
		y = ground_y - 6 * size
	elseif role == 87 then -- W: mill
		definition_id = 'nemesis_s.enemy.molen'
	elseif role == 75 then -- K: church and its bell
		definition_id = ids_kerk_def
		y = ground_y + size - kerk_height
		scene:spawn(ids_bel_def, { position = { x = x + 7, y = y + 80 }, stage = stage })
	elseif role == 39 then -- ': moon
		definition_id = ids_moon_def
		x, y = moon_spawn_x, moon_spawn_y
	end
	scene:spawn(definition_id, { position = { x = x, y = y }, stage = stage })
end

function actors.seek(stage, column)
	local index = 0
	local count<const> = stage.actor_cue_count
	local cue: *stage_actor_cue = stage.actor_cues
	while index < count and cue->column <= column do
		index = index + 1
		cue = cue + sizeof(stage_actor_cue)
	end
	stage.actor_cue_index = index
end

function actors.advance(stage, column)
	local index = stage.actor_cue_index
	local count<const> = stage.actor_cue_count
	if index == count then return end
	local cue: *stage_actor_cue = stage.actor_cues + index * sizeof(stage_actor_cue)
	local admission = cue->column
	if admission > column then return end
	repeat
		admit(stage, admission, cue->row, cue->role)
		index = index + 1
		if index == count then break end
		cue = cue + sizeof(stage_actor_cue)
		admission = cue->column
	until admission > column
	stage.actor_cue_index = index
end

return actors

local object_2d<const> = require('cartlib/world/object_2d')
local clamp<const> = require('cartlib/util/clamp')
local rol8<const> = require('cartlib/util/rol8')
local fsm_component<const> = require('cartlib/fsm/fsm_component')
local fsm_library<const> = require('cartlib/fsm/library')
local prefab<const> = require('cartlib/world/prefab')
local stage_tiles_component<const> = require('stage_tiles_component')
local world<const> = require('cartlib/world/world')
local stage_scroll_follower_component<const> = require('stage_scroll_follower_component')
require('constants')
local bin<const> = require('cartlib/bin')
local assets<const> = require('bmsx/assets')
local string_byte<const> = string.byte
local string_char<const> = string.char
local stage_tilemap_v2<const> = require('stage_tilemap_v2')
local grachtwater<const> = require('grachtwater')
local havenanimatie<const> = require('havenanimatie')

local stage<const> = {}
stage.__index = stage
setmetatable(stage, { __index = object_2d })

local resume_scrolling_event<const> = 'stage.resume_scrolling'

-- The YAML map stays author-facing ASCII; decoding emits the retained tile
-- layer and collision representations directly.
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
local stage_char_molen<const> = 87 -- W
local stage_char_kadekanon<const> = 68 -- D
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
local turret_by_symbol<const> = {
    [66]='blue_floor',[67]='red_floor',[98]='blue_ceiling',[99]='red_ceiling',
}
local transparent_overlay_chars<const> = {
	[stage_char_kerk] = true,
	[stage_char_molen] = true,
	[stage_char_kadekanon] = true,
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
		return assets_house_tile_1, 1
	end
	if ch == stage_char_house then
		if house_roof_base_chars[above] then
			return assets_house_tile_13, 1
		end
		return assets_house_tile_8, 1
	end
	if ch == stage_char_roof then
		return assets_house_tile_12, 1
	end
	if ch == stage_char_door then
		return assets_house_tile_door, 1
	end
	if ch == stage_char_window then
		if right == stage_char_roof then
			return assets_house_tile_window2, 1
		end
		return assets_house_tile_window, 1
	end
	if ch == stage_char_house_left_slope then
		if below == stage_char_house_left_slope then
			return assets_house_tile_1, 0
		end
		return assets_house_tile_5, 0
	end
	if ch == stage_char_house_right_slope then
		if below == stage_char_house_right_slope then
			return assets_house_tile_4, 0
		end
		return assets_house_tile_6, 0
	end
	if ch == stage_char_house_peak then
		return assets_house_tile_2, 1
	end
	if ch == stage_char_house_center then
		return assets_house_tile_3, 1
	end
	if ch == stage_char_house_left then
		if house_roof_base_chars[above] then
			return assets_house_tile_7, 1
		end
		return assets_house_tile_10, 1
	end
	if ch == stage_char_house_right then
		if house_roof_base_chars[above] then
			return assets_house_tile_9, 1
		end
		return assets_house_tile_11, 1
	end
	if ch == stage_char_lantaarn_post then
		if snow_surface_chars[below] then
			return assets_lantaarn_tile_3, 0
		end
		return assets_lantaarn_tile_2, 0
	end
	if ch == stage_char_lantaarn then
		return assets_lantaarn_tile_1, 0
	end
	if empty_stage_chars[ch] then
		return nil, 0
	end
	if ch == stage_char_ground then
		if left ~= stage_char_space and right ~= stage_char_space then
			return assets_ground, 1
		end
		if left == stage_char_space then
			return assets_ground_start, 1
		end
		return assets_ground_end, 1
	end
	if ch == stage_char_ground_alt then
		if left ~= stage_char_space and right ~= stage_char_space then
			return assets_ground2, 1
		end
		if left == stage_char_space then
			return assets_ground_start, 1
		end
		return assets_ground_end, 1
	end
	if ch == stage_char_ground_vertical then
		local parity_even<const> = ((x - 1) % 2) == 0
		if left == stage_char_space then
			return assets_ground_start_v, 1
		end
		if right == stage_char_space then
			return assets_ground_end_v, 1
		end
		if parity_even then
			return assets_ground_v, 1
		end
		return assets_ground2_v, 1
	end
	if ch == stage_char_ground_variant then
		local parity_even<const> = ((x - 1) % 2) == 0
		if parity_even then
			return assets_ground3, 1
		end
		return assets_ground4, 1
	end
	if chimney_chars[ch] then
		if above == stage_char_space then
			return assets_schoorsteen1, 1
		end
		if left == stage_char_space or right == stage_char_space then
			return assets_schoorsteen3, 1
		end
		return assets_schoorsteen2, 1
	end
	if ch == stage_char_space
	or ch == stage_char_zak_foe
	or ch == stage_char_sneeuwpop then
		if snow_surface_chars[below]
		and left_down ~= stage_char_space
		and right_down ~= stage_char_space then
			return assets_snow, 0
		end
		return nil, 0
	end
	if ch == stage_char_tree then
		if right == stage_char_tree_1 then
			return assets_snowtree1, 0
		end
		if right == stage_char_tree_2 then
			return assets_snowtree4, 1
		end
		if right == stage_char_tree_3 then
			return assets_snowtree7, 1
		end
		if right == stage_char_tree_4 then
			return assets_snowtree10, 1
		end
		if right == stage_char_tree_5 then
			return assets_snowtree13, 1
		end
		if right == stage_char_tree_6 then
			return assets_snowtree16, 1
		end
		if right == stage_char_tree_7 then
			return assets_snowtree19, 1
		end
		if left == stage_char_tree_1 then
			return assets_snowtree3, 0
		end
		if left == stage_char_tree_2 then
			return assets_snowtree6, 1
		end
		if left == stage_char_tree_3 then
			return assets_snowtree9, 1
		end
		if left == stage_char_tree_4 then
			return assets_snowtree12, 1
		end
		if left == stage_char_tree_5 then
			return assets_snowtree15, 1
		end
		if left == stage_char_tree_6 then
			return assets_snowtree18, 1
		end
		if left == stage_char_tree_7 then
			return assets_snowtree21, 1
		end
		return nil, 0
	end
	if ch == stage_char_tree_1 then
		if left == stage_char_tree then
			return assets_snowtree2, 1
		end
		return nil, 0
	end
	if ch == stage_char_tree_2 then
		if left == stage_char_tree then
			return assets_snowtree5, 1
		end
		return nil, 0
	end
	if ch == stage_char_tree_3 then
		if left == stage_char_tree then
			return assets_snowtree8, 1
		end
		return nil, 0
	end
	if ch == stage_char_tree_4 then
		if left == stage_char_tree then
			return assets_snowtree11, 1
		end
		return nil, 0
	end
	if ch == stage_char_tree_5 then
		if left == stage_char_tree then
			return assets_snowtree14, 1
		end
		return nil, 0
	end
	if ch == stage_char_tree_6 then
		if left == stage_char_tree then
			return assets_snowtree17, 1
		end
		return nil, 0
	end
	if ch == stage_char_tree_7 then
		if left == stage_char_tree then
			return assets_snowtree20, 0
		end
		return nil, 0
	end
	if transparent_overlay_chars[ch] or turret_by_symbol[ch] then
		return nil, 0
	end
	error('nemesis_s unsupported stage symbol "' .. string_char(ch) .. '" at x=' .. tostring(x) .. ', y=' .. tostring(y))
end

function stage:apply_stage_config(stage_data)
	self.tile_size = stage_data.tile_size
	self.tile_columns = stage_data.tile_columns
	self.music_cues = stage_data.music_cues
	self.restart_points = stage_data.restart_points
	self.scroll_stop_columns = stage_data.scroll_stop_columns
	self.scroll_stop_count = #stage_data.scroll_stop_columns
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
		self.scene:spawn(spawn.definition_id, spawn.options)
		index = index + 1
	end
	self.actor_spawn_index = index
end

function stage:build_tape()
	local stage_data<const> = bin.decode(assets.data_nemesis_s_stage_addr, stage_asset_id)
	local map_rows<const>, numeric_rows<const>, numeric_assets<const> = stage_tilemap_v2.resolve(stage_data)
	self:apply_stage_config(stage_data)
    -- Blank spawn markers keep their spawn role while exposing the native stars.
    local numeric_art=numeric_assets
    if stage_data.sky_actor_ids then
        numeric_art={}
        for id,name in ipairs(numeric_assets) do numeric_art[id]=name end
        for _,id in ipairs(stage_data.sky_actor_ids) do numeric_art[id]=nil end
    end

	local width<const> = #map_rows[1]
	local height<const> = #map_rows

	self.tile_rows = height
	self.tape_length_tiles = width
	local stage_tiles<const> = self.stage_tiles
	stage_tiles:configure(width, height, self.tile_size)
	-- The native role decoder supplies one collision bit per tile. Keep those
	-- bits in row words so longer stages do not retain a Lua value per cell.
	self.solid_tape = new_rows((width + 31) // 32, height, 0)

	for stage_y = 1, height do
		local map_row<const> = map_rows[stage_y]
		local solid_row<const> = self.solid_tape[stage_y]
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
			local native_imgid<const>, solid<const> = decode_stage_tile(
				above_row, map_row, below_row, stage_x, stage_y, width, symbol)
			local imgid = native_imgid
			if numeric_rows ~= nil then
				local id<const> = numeric_rows[stage_y][stage_x]
				imgid = numeric_art[id]
			end
			if imgid then stage_tiles:admit_tile(stage_x, stage_y, imgid) end
			if solid ~= 0 then
				local bit<const> = stage_x - 1
				local word<const> = (bit // 32) + 1
				solid_row[word] = solid_row[word] | (1 << (bit & 31))
			end
		end
	end

    if stage_data.harbor_animation then
        self.harbor=havenanimatie.new(stage_data.harbor_animation,stage_tiles,self.solid_tape)
    end

	if stage_data.water_animation then
        self.water=grachtwater.new(stage_data.water_animation,numeric_rows,numeric_assets,stage_tiles)
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
							position = { x = playfield_width + (group_index * sint_pop_width), y = spawn_y },
							stage = self,
							formation = formation,
							group_type = sint_pop_group,
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
							position = { x = playfield_width, y = (stage_y - 2) * self.tile_size },
							stage = self,
							mijter_type = mijter_foe_type,
						},
					}
                elseif turret_by_symbol[symbol] then
                    actor_spawns[#actor_spawns+1]={
                        column=stage_x-1,definition_id=ids_havengeschut_def,
                        options={
                            position={x=playfield_width-self.tile_size,y=(stage_y-1)*self.tile_size},
                            stage=self,variant=turret_by_symbol[symbol],spawn_column=stage_x-1,
                        },
                    }
				elseif symbol == stage_char_schoorsteen_foe then
					actor_spawns[#actor_spawns + 1] = {
						column = stage_x - 2,
						definition_id = ids_schoorsteen_foe_def,
						options = {
							position = { x = playfield_width - self.tile_size, y = (stage_y - 4) * self.tile_size },
							stage = self,
						},
					}
				elseif symbol == stage_char_kadekanon then
                    actor_spawns[#actor_spawns + 1] = {
                        column = stage_x - 1,
                        definition_id = ids_kadekanon_def,
                        options = {
                            position = { x = playfield_width - 12, y = (stage_y - 1) * self.tile_size },
                            stage = self,
                        },
                    }
				elseif symbol == stage_char_rook_generator then
					actor_spawns[#actor_spawns + 1] = {
						column = stage_x - 1,
						definition_id = ids_rook_generator_def,
						options = {
							position = { x = playfield_width - (self.tile_size * 2), y = (stage_y - 4) * self.tile_size },
							stage = self,
						},
					}
				elseif symbol == stage_char_zak_foe then
					actor_spawns[#actor_spawns + 1] = {
						column = stage_x - 1,
						definition_id = ids_zak_foe_def,
						options = {
							position = { x = playfield_width - self.tile_size, y = (stage_y - 2) * self.tile_size },
							stage = self,
							direction = zak_foe_direction_left,
						},
					}
				elseif symbol == stage_char_sneeuwpop then
					actor_spawns[#actor_spawns + 1] = {
						column = stage_x - 1,
						definition_id = ids_sneeuwpop_def,
						options = {
							position = { x = playfield_width - self.tile_size, y = (stage_y - 7) * self.tile_size },
							stage = self,
						},
					}
				elseif symbol == stage_char_molen then
					actor_spawns[#actor_spawns + 1] = {
						column = stage_x - 1,
						definition_id = 'nemesis_s.enemy.molen',
						options = {
							position = { x = playfield_width - self.tile_size, y = (stage_y - 1) * self.tile_size },
							stage = self,
						},
					}
				elseif symbol == stage_char_kerk then
					local kerk_y<const> = stage_y * self.tile_size - kerk_height
					actor_spawns[#actor_spawns + 1] = {
						column = stage_x - 1,
						definition_id = ids_bel_def,
						options = {
							position = { x = playfield_width + 7 - self.tile_size, y = kerk_y + 80 },
							stage = self,
						},
					}
					actor_spawns[#actor_spawns + 1] = {
						column = stage_x - 1,
						definition_id = ids_kerk_def,
						options = {
							position = { x = playfield_width - self.tile_size, y = kerk_y },
							stage = self,
						},
					}
				elseif symbol == stage_char_moon then
					actor_spawns[#actor_spawns + 1] = {
						column = stage_x - 1,
						definition_id = ids_moon_def,
						options = {
							position = { x = moon_spawn_x, y = moon_spawn_y },
							stage = self,
						},
					}
				end
			end
		end
	end
	self.actor_spawns = actor_spawns
	self.actor_spawn_count = #actor_spawns
end

function stage:reset_runtime()
	if self.starfield then self.starfield.mill_arena=false end
	if self.stage_tiles.tile_count == 0 then
		self:build_tape()
	end
	local start_column<const> = self.start_column
	self.left_tile = start_column + 1
	self.stage_tiles:set_visible_columns(self.left_tile, self.tile_columns + 2)
	if self.water then self.water:reset(self.left_tile,self.tile_columns+2) end
    if self.harbor then self.harbor:reset(self.left_tile-1) end
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
	if self.water then self.water:show(self.left_tile,self.tile_columns+2) end
    if self.harbor then self.harbor:show(self.left_tile-1) end
	self.tape_head = self.left_tile + self.tile_columns - 1
	local column<const> = self.tape_head - 1
	self:advance_music_cues(column)
	local followers<const> = stage_scroll_follower_view.components
	for follower_index = 1, #followers do
		local follower<const> = followers[follower_index]
		local owner<const> = follower.owner
		local x<const>, y<const> = owner:get_global_position()
		owner:set_global_position(x - self.tile_size, y)
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

function stage:update_scenery()
    if self.water then self.water:tick(self.left_tile,self.tile_columns+2) end
    if self.harbor then self.harbor:tick() end
end

function stage:update_runtime()
    self:update_scenery()
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

	self.starfield:scroll()
end

-- A destructible target can be cleared before its camera stop enters the screen.
function stage:release_scroll_stop(column)
	local index<const> = self.scroll_stop_index
	if self.scroll_stop_columns[index] == column then
		self.scroll_stop_index = index+1
	elseif not self.scrolling and self.scroll_stop_columns[index-1] == column then
		self:resume_scrolling()
	end
end

function stage:resume_scrolling()
	self.scrolling = true
	self.events:emit(resume_scrolling_event)
end

function stage:is_solid_pixel(screen_x, screen_y)
	local pose_x<const>, pose_y<const> = self:get_global_position()
	local map_x = ((screen_x - pose_x + self.total_scroll_px) // self.tile_size) + 1
	local map_y = ((screen_y - pose_y) // self.tile_size) + 1

	map_x = clamp(map_x, 1, self.tape_length_tiles)
	map_y = clamp(map_y, 1, self.tile_rows)

	local bit<const> = map_x - 1
	return (self.solid_tape[map_y][(bit // 32) + 1] & (1 << (bit & 31))) ~= 0
end

-- Returns the zero-based offset of the first solid tile in a horizontal run,
-- or tile_count when the complete run is clear. Beam and sprite-width collision
-- paths consume the retained stage row directly instead of sampling pixels.
function stage:first_solid_tile_offset(screen_x, screen_y, tile_count)
	local pose_x<const>, pose_y<const> = self:get_global_position()
	local map_x<const> = ((screen_x - pose_x + self.total_scroll_px) // self.tile_size) + 1
	local map_y<const> = ((screen_y - pose_y) // self.tile_size) + 1
	if map_y < 1 or map_y > self.tile_rows then return tile_count end
	local row<const> = self.solid_tape[map_y]
	local last_offset = tile_count - 1
	local screen_last_offset<const> = self.tile_columns - (screen_x // self.tile_size) - 1
	if last_offset > screen_last_offset then
		last_offset = screen_last_offset
	end
	last_offset = math.min(last_offset, self.tape_length_tiles - map_x)
	for tile_offset = math.max(0, 1 - map_x), last_offset do
		local bit<const> = map_x + tile_offset - 1
		if (row[(bit // 32) + 1] & (1 << (bit & 31))) ~= 0 then
			return tile_offset
		end
	end
	return tile_count
end

-- Projectile probes retain their normal terrain stopping rule. A hit also
-- reaches the animated load that owns that cell, so its art and solid bits
-- are removed together instead of leaving an invisible obstruction.
local cargo_hit_feedback<const> = function(self,cargo,screen_x,screen_y)
    self.scene:spawn(cargo.health>0 and ids_small_explosion_def or ids_large_explosion_def,{
        position={x=screen_x-self.tile_size,y=screen_y-self.tile_size},stage=self,
    })
    self.events:emit(cargo.health>0 and 'enemy.structure.hit' or 'enemy.structure.destroyed')
end

function stage:receive_projectile_impact(projectile, screen_x, screen_y, tile_offset)
    if not self.harbor then return end
    local pose_x<const>,pose_y<const> = self:get_global_position()
    local hit_x<const> = screen_x+tile_offset*self.tile_size
    local map_x<const> = ((hit_x-pose_x+self.total_scroll_px)//self.tile_size)+1
    local map_y<const> = ((screen_y-pose_y)//self.tile_size)+1
    local cargo<const> = self.harbor:hit_tile(map_x,map_y,projectile)
    if not cargo then return end
    cargo_hit_feedback(self,cargo,hit_x,screen_y)
    return true
end

function stage:receive_projectile_blast(projectile,width,height)
    if not self.harbor then return end
    local pose_x<const>,pose_y<const> = self:get_global_position()
    local left<const> = projectile.x-pose_x+self.total_scroll_px
    local top<const> = projectile.y-pose_y
    for y=(top//self.tile_size)+1,((top+height-1)//self.tile_size)+1 do
        for x=(left//self.tile_size)+1,((left+width-1)//self.tile_size)+1 do
            local cargo<const> = self.harbor:hit_tile(x,y,projectile)
            if cargo then
                cargo_hit_feedback(self,cargo,(x-1)*self.tile_size-self.total_scroll_px+pose_x,
                    (y-1)*self.tile_size+pose_y)
            end
        end
    end
end

-- Returns the zero-based offset of the first solid tile in a vertical run,
-- or the number of in-bounds tiles when the run reaches the playfield edge.
-- Stage-relative beams retain this result once because their map column stays
-- fixed while both the stage and beam consume the same tile scroll.
function stage:first_solid_vertical_tile_offset(screen_x, screen_y, tile_count, direction)
	local pose_x<const>, pose_y<const> = self:get_global_position()
	local map_x<const> = ((screen_x - pose_x + self.total_scroll_px) // self.tile_size) + 1
	local map_y<const> = ((screen_y - pose_y) // self.tile_size) + 1
	if map_x < 1 or map_x > self.tape_length_tiles then return tile_count end
	local last_offset = tile_count - 1
	local first_offset
	if direction < 0 then
		first_offset = math.max(0, map_y - self.tile_rows)
		if last_offset >= map_y then
			last_offset = map_y - 1
		end
	else
		first_offset = math.max(0, 1 - map_y)
		local bottom_offset<const> = self.tile_rows - map_y
		if last_offset > bottom_offset then
			last_offset = bottom_offset
		end
	end
	local solid_tape<const> = self.solid_tape
	local word<const> = ((map_x - 1) // 32) + 1
	local mask<const> = 1 << ((map_x - 1) & 31)
	for tile_offset = first_offset, last_offset do
		if (solid_tape[map_y + tile_offset * direction][word] & mask) ~= 0 then
			return tile_offset
		end
	end
	return math.max(0, last_offset + 1)
end

function stage:ctor()
	self.solid_tape = {}
	self.stage_tiles = self:get_component(stage_tiles_component)
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
				states = {
					begin_play = {
						update = stage.begin_play,
					},
					scrolling = {
						update = stage.update_runtime,
					},
					stopped = {update=stage.update_scenery},
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
			stage_tiles_component.new,
			fsm_component.factory({ ids_stage_fsm }),
		},
		defaults = {
			order = 16,
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

local object_2d<const> = require('cartlib/world/object_2d')
local fsm_library<const> = require('cartlib/fsm/library')
local fsm_component<const> = require('cartlib/fsm/fsm_component')
local prefab<const> = require('cartlib/world/prefab')
local rect_overlaps<const> = require('cartlib/util/rect_overlaps')
require('constants')
local timeline<const> = require('cartlib/timeline/timeline')
local tile_layer_component<const> = require('cartlib/component/tile_layer_component')
local timeline_component<const> = require('cartlib/timeline/timeline_component')
local visual_2d_component<const> = require('cartlib/component/visual_2d_component')
local commands<const> = require('cartlib/gx/command_list')
local terrain<const> = require('room/terrain')

local room<const> = {}
local water_surface_timeline_id<const> = 'r.ws'
local water_surface_frame_imgids<const> = {
	'water_surface_msx',
}
local water_body_imgid<const> = 'water_body_msx'
local water_surface_timeline_frame_defs<const> = {
	{ value = 1, hold = 1 },
}
for i = 1, 63 do
	local suffix<const> = string.format('%02d', i)
	water_surface_frame_imgids[i + 1] = 'water_surface_msx_' .. suffix
	water_surface_timeline_frame_defs[i + 1] = { value = i + 1, hold = 1 }
end
local tile_chars<const> = terrain.tile_chars
local solid_tiles<const> = terrain.solid_tiles
local stair_left_tiles<const> = terrain.stair_left_tiles
local stair_right_tiles<const> = terrain.stair_right_tiles
local rock_tile_width<const> = rock_width / room_tile_size
local rock_tile_height<const> = rock_height / room_tile_size
local rock_logic_tiles<const> = {
	{ tile_chars.rock_ul, tile_chars.rock_ur },
	{ tile_chars.rock_dl, tile_chars.rock_dr },
}
local room_hidden_mode_events<const> = {
	'transition',
	'halo',
	'shrine',
	'item',
	'lithograph',
	'title',
	'intro',
	'story',
	'epilogue',
	'end_demo',
	'death',
}

local room_visible_mode_events<const> = {
	'room',
	'seal_dissolution',
	'daemon_appearance',
	'victory_dance',
	'player.shrine_overlay_exit',
	'player.world_emerge',
}
local room_tile_visibility_on<const> = {}
for i = 1, #room_hidden_mode_events do
	room_tile_visibility_on[room_hidden_mode_events[i]] = {
		emitter = 'd',
		go = '/tile_visibility/hidden',
	}
end
for i = 1, #room_visible_mode_events do
	room_tile_visibility_on[room_visible_mode_events[i]] = {
		emitter = 'd',
		go = '/tile_visibility/visible',
	}
end

local set_row_byte<const> = function(row, tx, byte)
	return row:sub(1, tx - 1) .. string.char(byte) .. row:sub(tx + 1)
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

	local destroyed_rock_ids<const> = room_state.progress.destroyed_rocks
	for i = 1, #room_state.rocks do
		local rock<const> = room_state.rocks[i]
		if not destroyed_rock_ids[rock.member_id] then
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
		return water_none
	end
	if ty < water.surface_row or ty > room_state.tile_rows then
		return water_none
	end
	if tx < 1 or tx > room_state.tile_columns then
		return water_none
	end
	if solid_tiles[string.byte(room_state.logic_rows[ty], tx)] then
		return water_none
	end
	if ty == water.surface_row then
		return water_surface
	end
	return water_body
end

local player_water_kind_at_tile<const> = function(room_state, tx, ty)
	local water<const> = room_state.water
	if water == nil then
		return water_none
	end
	if ty < water.surface_row or ty > room_state.tile_rows then
		return water_none
	end
	if tx < 1 or tx > room_state.tile_columns then
		return water_none
	end
	-- Player depth follows the water plane. At rest the foot coordinate belongs
	-- to the submerged support tile, while the body above it remains in water.
	if ty == water.surface_row then
		return water_surface
	end
	return water_body
end

local rebuild_room_logic<const> = function(room_state)
	local logic_rows<const> = build_logic_rows(room_state)
	room_state.logic_rows = logic_rows
	room_state.solids = build_solids(logic_rows, room_tile_size, room_tile_origin_x, room_tile_origin_y)
	room_state.stairs = build_stairs(logic_rows, room_tile_size, room_tile_origin_x, room_tile_origin_y, player_height)
end

local refresh_room_geometry<const> = function(room_state)
	rebuild_room_logic(room_state)
	room_state:rebuild_room_tiles()
end

local apply_room_template<const> = function(room_state, template)
	local geometry<const> = template.terrain
	local base<const> = geometry.base
	local map_rows<const> = base.rows

	room_state.room_number = template.room_number
	room_state.world_number = template.world_number
	room_state.room_subtype = template.room_subtype
	room_state.room_dissolve_step = 0
	room_state.seal_dissolve_step = 0
	room_state.world_width = room_width
	room_state.world_height = room_height
	room_state.world_top = room_hud_height
	room_state.spawn = template.spawn
	room_state.tile_size = room_tile_size
	room_state.tile_origin_x = room_tile_origin_x
	room_state.tile_origin_y = room_tile_origin_y
	room_state.tile_rows = #map_rows
	room_state.tile_columns = #map_rows[1]
	room_state.map_rows = map_rows
	room_state.terrain = base
	room_state.water = template.water
	room_state.scene_id = template.scene_id
	room_state.enemies = template.enemies
	room_state.condition_dependencies = template.condition_dependencies
	room_state.wall_enemies = template.wall_enemies
	room_state.rocks = template.rocks
	room_state.inventory_rocks = template.inventory_rocks
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
setmetatable(room_object, { __index = object_2d })

function room_object:select_terrain(variant)
	if variant == self.terrain then return false end
	self.terrain = variant
	self.map_rows = variant.rows
	refresh_room_geometry(self)
	return true
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
		return collision_flags_none
	end
	if tx < 1 or tx > self.tile_columns then
		return collision_flags_none
	end
	local collision = 0
	if solid_tiles[string.byte(self.logic_rows[ty], tx)] then
		collision = collision | collision_flags_wall
	end
	if self:is_active_draaideur_at_tile(tx, ty) then
		collision = collision | collision_flags_wall
	end
	if self:is_active_breakable_wall_at_tile(tx, ty) then
		collision = collision | collision_flags_wall
	end
	return collision
end

function room_object:mark_rock_destroyed(rock_id)
	self.progress.destroyed_rocks[rock_id] = true
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
		collision = collision | collision_flags_elevator
	end
	return collision
end

function room_object:overlaps_active_elevator(x, y, w, h)
	local elevators<const> = self.castle.elevators
	for i = 1, #elevators do
		local platform<const> = elevators[i]
		local pose_x<const>, pose_y<const> = platform:get_global_position()
		if platform.current_room_number == self.room_number
			and rect_overlaps(x, y, w, h, pose_x, pose_y, room_tile_size4, room_tile_size2)
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
	local walls<const> = self.wall_instances
	for i = 1, #walls do
		local wall<const> = walls[i]
		local pose_x<const>, pose_y<const> = wall:get_global_position()
		if rect_overlaps(x, y, w, h, pose_x, pose_y, wall.width_tiles * room_tile_size, wall.height_tiles * room_tile_size) then
			return true
		end
	end
	return false
end

function room_object:overlaps_active_draaideur(x, y, w, h)
	local draaideuren<const> = self.draaideur_instances
	local tile_size<const> = self.tile_size
	local door_height<const> = tile_size * 3
	for i = 1, #draaideuren do
		local draaideur<const> = draaideuren[i]
		local pose_x<const>, pose_y<const> = draaideur:get_global_position()
		if draaideur.collision_enabled
		and rect_overlaps(x, y, w, h, pose_x, pose_y, tile_size, door_height)
		then
			return true
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

	local draaideuren<const> = self.draaideur_instances
	for i = 1, #draaideuren do
		local draaideur<const> = draaideuren[i]
		if tx == draaideur.tile_x
		and ty >= draaideur.tile_y
		and ty <= draaideur.tile_y + 2
		and draaideur.collision_enabled
		then
			return true
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
	local lithographs<const> = self.lithograph_instances
	local player_x<const>, player_y<const> = player:get_global_position()
	local player_left<const> = player_x
	local player_top<const> = player_y
	local player_right<const> = player_x + player.width
	local player_bottom<const> = player_y + player.height

	for i = 1, #lithographs do
		local lithograph<const> = lithographs[i]
		local pose_x<const>, pose_y<const> = lithograph:get_global_position()
		local area_left<const> = pose_x + lithograph_hit_left_px
		local area_top<const> = pose_y + lithograph_hit_top_px
		local area_right<const> = pose_x + lithograph_hit_right_px
		local area_bottom<const> = pose_y + lithograph_hit_bottom_px
		if player_right >= area_left and player_left <= area_right and player_bottom >= area_top and player_top <= area_bottom then
			return lithograph
		end
	end

	return nil
end

function room_object:switch_room(direction)
	local from_room_number<const> = self.castle.current_room_number
	local target_room_number<const> = self.room_links[direction]

	if target_room_number < 0 then
		return {
			from_room_number = from_room_number,
			to_room_number = target_room_number,
			direction = direction,
			outside = true,
		}
	end

	return {
		from_room_number = from_room_number,
		to_room_number = target_room_number,
		direction = direction,
	}
end

local room_layer_profile<const> = {
	attachment_affine = { 1, 0, 0, 1, room_tile_origin_x, room_tile_origin_y }, visible = false,
}
local water_layer_profile<const> = {
	columns = 1, tile_size = room_tile_size,
	attachment_affine = { 1, 0, 0, 1, room_tile_origin_x, room_tile_origin_y }, visible = false, order = 1,
}

local draw_room_tape<const> = function(layer, draw)
	layer:resolve_pose()
	terrain.project_art()
	commands.fixed_tile_tape(draw, terrain.tape, layer.tape_rows, layer.owner.tile_rows,
		room_tile_size, terrain.modes, terrain.uvs, layer.wox, layer.woy)
end

function room_object:ctor()
	self.wall_instances = {}
	self.draaideur_instances = {}
	self.lithograph_instances = {}
	self.shrine_instances = {}
	self.world_entrance_instances = {}
	self.logic_rows = {}
	self.room_tile_count = 0
	self.water_tile_count = 0
	self.water_rows = 0
	self.water_surface_tile_indices = {}
	self.water_surface_tile_count = 0
	self.last_water_surface_frame = 1
	self.room_tile_layer = visual_2d_component.new(self, room_layer_profile, 'room')
	self.room_tile_layer:set_draw_function(draw_room_tape)
	self:add_component(self.room_tile_layer)
	self.water_tile_layer = tile_layer_component.new(self, water_layer_profile, 'water')
	self:add_component(self.water_tile_layer)
	self.tiles_visible = false
	apply_room_template(self, self.template)
	self:rebuild_room_tiles()
end

function room_object:hide_room_tiles()
	self.tiles_visible = false
	self.room_tile_layer.visible = false
	self.water_tile_layer.visible = false
end

function room_object:show_room_tiles()
	self.tiles_visible = true
	self.room_tile_layer.visible = self.room_tile_count ~= 0
	self.water_tile_layer.visible = self.water_tile_count ~= 0
end

function room_object:rebuild_room_tiles()
	local tile_columns<const> = self.tile_columns
	local tile_rows<const> = self.tile_rows
	local tile_count<const> = tile_columns * tile_rows
	local dissolve_step<const> = self.room_dissolve_step
	print('pietious.room.tiles.begin', os.clock(), self.room_number, tile_count, dissolve_step)
	local layout<const> = self.terrain
	local row_directory<const> = dissolve_step == 0 and layout.tape or layout.dissolve[dissolve_step]
	self.room_tile_layer.tape_rows = terrain.tape + row_directory
	self.room_tile_count = tile_count

	if self.water == nil then
		self.water_tile_count = 0
		self.water_rows = 0
		self.water_surface_tile_count = 0
		self.last_water_surface_frame = 1
		self.water_tile_layer:resize(0, self.tile_columns)
		self.water_tile_layer.visible = false
		print('pietious.room.tiles.end', os.clock(), self.room_number, tile_count, 0)
		return
	end
	local prev_water_surface_tile_count<const> = self.water_surface_tile_count
	local water_surface_imgid<const> = water_surface_frame_imgids[1]
	local water_rows<const> = self.tile_rows - self.water.surface_row + 1
	local water_tile_count<const> = self.tile_columns * water_rows
	local water_tile_layer<const> = self.water_tile_layer
	local water_surface_tile_indices<const> = self.water_surface_tile_indices
	local water_surface_tile_count = 0
	water_tile_layer:resize(water_tile_count, self.tile_columns)

	for y = self.water.surface_row, self.tile_rows do
		local row_base<const> = ((y - self.water.surface_row) * self.tile_columns)
		for x = 1, self.tile_columns do
			local tile_index<const> = row_base + x
			local kind<const> = water_kind_at_tile(self, x, y)
			if kind == water_none then
				water_tile_layer:set_tile(tile_index, nil)
			elseif kind == water_surface then
				water_tile_layer:set_tile(tile_index, water_surface_imgid)
				water_surface_tile_count = water_surface_tile_count + 1
				water_surface_tile_indices[water_surface_tile_count] = tile_index
			else
				water_tile_layer:set_tile(tile_index, water_body_imgid)
			end
		end
	end
	for i = water_surface_tile_count + 1, prev_water_surface_tile_count do
		water_surface_tile_indices[i] = nil
	end
	self.water_tile_count = water_tile_count
	self.water_rows = water_rows
	self.water_surface_tile_count = water_surface_tile_count
	self.last_water_surface_frame = 1
	water_tile_layer:set_attachment_origin(self.tile_origin_x, self.tile_origin_y + ((self.water.surface_row - 1) * self.tile_size))
	if self.tiles_visible then
		self.water_tile_layer.visible = true
	end
	print('pietious.room.tiles.end', os.clock(), self.room_number, tile_count, water_tile_count)
end

function room_object:sync_water_surface_frame(water_surface_frame)
	if self.water == nil or self.last_water_surface_frame == water_surface_frame then
		return
	end
	local water_surface_imgid<const> = water_surface_frame_imgids[water_surface_frame]
	local water_tile_layer<const> = self.water_tile_layer
	local water_surface_tile_indices<const> = self.water_surface_tile_indices
	water_tile_layer:replace_indexed_tiles(water_surface_tile_indices, self.water_surface_tile_count, water_surface_imgid)
	self.last_water_surface_frame = water_surface_frame
end

local define_room_fsm<const> = function()
	fsm_library.register('room', {
		initial = 'tile_visibility',
		on = {
			['room.switched'] = {
				emitter = 'pietolon',
				go = function(self)
					self:set_space('main')
				end,
			},
		},
		states = {
			water_state = {
				is_concurrent = true,
				initial = 'active',
				states = {
					active = {
						timelines = {
							[water_surface_timeline_id] = {
								def = {
									phase = 'presentation',
									-- MoG `TBD06..TBD57`: surface char `0xB6` rotates on a 64-tick cycle.
									frames = timeline.build_frame_sequence(water_surface_timeline_frame_defs),
									playback_mode = 'loop',
									apply = room_object.sync_water_surface_frame,
								},
								autoplay = true,
							},
						},
					},
				},
			},
			tile_visibility = {
				-- A room is presentable as soon as it is constructed, including
				-- while paused. Modal flow events explicitly hide/reveal it.
				initial = 'visible',
				on = room_tile_visibility_on,
				states = {
					hidden = {
						entering_state = room_object.hide_room_tiles,
					},
					visible = {
						entering_state = room_object.show_room_tiles,
					},
				},
			},
		},
	})
end

local register_room_definition<const> = function()
	prefab.define({
		def_id = 'room',
		class = room_object,
		components = {
			timeline_component.new,
			fsm_component.factory({ 'room' }),
		},
		defaults = {
		},
	})
end

room.define_room_fsm = define_room_fsm
room.register_room_definition = register_room_definition

return room

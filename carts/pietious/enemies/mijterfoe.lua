local prefab<const> = require('cartlib/world/prefab')
require('constants')
local bt_result<const> = require('cartlib/behaviour_tree/result')
local bt_running<const> = bt_result.running
local bt_success<const> = bt_result.success
local behaviour_tree_library<const> = require('cartlib/behaviour_tree/library')
local bt_component<const> = require('cartlib/behaviour_tree/bt_component')
local fixed_point_velocity_component<const> = require('cartlib/physics/fixed_point_velocity_component')
local enemy_base<const> = require('enemies/enemy_base')

local mijterfoe<const> = {}
mijterfoe.__index = mijterfoe

-- The original Bat's sixteen signed Q8.8 flight vectors, decoded from the
-- tables at 0x7e49 and 0x7e69 and multiplied by the enemy's speed factor 2.
local velocity_x_by_direction<const> = {
	512, 442, 362, 256, 0, -256, -362, -442,
	-512, -442, -362, -256, 0, 256, 362, 442,
}
local velocity_y_by_direction<const> = {
	0, -256, -362, -442, -512, -442, -362, -256,
	0, 256, 362, 442, 512, 442, 362, 256,
}
local visual_index_by_direction<const> = {
	1, 2, 2, 3, 3, 4, 4, 5,
	5, 6, 6, 7, 7, 8, 8, 1,
}
local direction_visuals<const> = {
	{ imgid = 'meijter_r', flip_h = false, flip_v = false },
	{ imgid = 'meijter_dr', flip_h = false, flip_v = true },
	{ imgid = 'meijter_up', flip_h = false, flip_v = false },
	{ imgid = 'meijter_dr', flip_h = true, flip_v = true },
	{ imgid = 'meijter_r', flip_h = true, flip_v = false },
	{ imgid = 'meijter_dr', flip_h = true, flip_v = false },
	{ imgid = 'meijter_up', flip_h = false, flip_v = true },
	{ imgid = 'meijter_dr', flip_h = false, flip_v = false },
}

local set_direction_sprite<const> = function(self, direction_index)
	self.direction_index = direction_index
	local visual<const> = direction_visuals[visual_index_by_direction[direction_index + 1]]
	self:set_imgid(visual.imgid)
	local sprite<const> = self.sprite_component
	sprite.flip_h = visual.flip_h
	sprite.flip_v = visual.flip_v
end

local advance_flight_direction<const> = function(self, node_memory)
	local motion<const> = self.motion
	local direction_index = self.direction_index
	local reflected = false
	local velocity_y<const> = motion.velocity_y
	if velocity_y >= 0 then
		if self.y >= enemy_mijter_max_y then
			motion.velocity_y = -velocity_y
			direction_index = (-direction_index) & 0x0f
			reflected = true
		end
	elseif self.y < enemy_mijter_min_y then
		motion.velocity_y = -velocity_y
		direction_index = (-direction_index) & 0x0f
		reflected = true
	end

	local velocity_x<const> = motion.velocity_x
	if velocity_x >= 0 then
		if self.x >= enemy_mijter_max_x then
			motion.velocity_x = -velocity_x
			direction_index = (8 - direction_index) & 0x0f
			reflected = true
		end
	elseif self.x < enemy_mijter_min_x then
		motion.velocity_x = -velocity_x
		direction_index = (8 - direction_index) & 0x0f
		reflected = true
	end

	local direction_ticks
	if reflected then
		direction_ticks = enemy_mijter_direction_min_steps
		set_direction_sprite(self, direction_index)
	else
		direction_ticks = node_memory.direction_ticks
	end
	direction_ticks = direction_ticks - 1
	if direction_ticks == 0 then
		direction_ticks = math.random(
			enemy_mijter_direction_min_steps,
			enemy_mijter_direction_max_steps
		)
		direction_index = math.random(16) - 1
		motion.velocity_x = velocity_x_by_direction[direction_index + 1]
		motion.velocity_y = velocity_y_by_direction[direction_index + 1]
		set_direction_sprite(self, direction_index)
	end
	node_memory.direction_ticks = direction_ticks
end

function mijterfoe:ctor()
	self.motion = self:get_component(fixed_point_velocity_component)
	set_direction_sprite(self, 12)
end

function mijterfoe.initialize_direction_cycle(_self, execution)
	execution.blackboard:set(
		'direction_ticks',
		math.random(enemy_mijter_direction_min_steps, enemy_mijter_direction_max_steps)
	)
	return bt_success
end

function mijterfoe.execute_seek_ceiling(self, node_memory, execution)
	node_memory.direction_ticks = execution.blackboard:get('direction_ticks')
	return mijterfoe.tick_seek_ceiling(self, node_memory)
end

function mijterfoe.tick_seek_ceiling(self, node_memory)
	local rm<const> = self.room
	local x<const> = self.x
	local y<const> = self.y
	local tile_x<const>, tile_y<const> = rm:world_to_tile(x, y)
	local _<const>, ceiling_tile_y<const> = rm:world_to_tile(x, y - 1)
	if rm:has_collision_flags_at_tile(tile_x, ceiling_tile_y, collision_flags_solid_mask)
	and rm:has_collision_flags_at_tile(tile_x + 1, ceiling_tile_y, collision_flags_solid_mask)
	and not rm:has_collision_flags_at_tile(tile_x, tile_y, collision_flags_solid_mask)
	and not rm:has_collision_flags_at_tile(tile_x + 1, tile_y, collision_flags_solid_mask)
	and not rm:has_collision_flags_at_tile(tile_x, tile_y + 1, collision_flags_solid_mask)
	and not rm:has_collision_flags_at_tile(tile_x + 1, tile_y + 1, collision_flags_solid_mask)
	then
		local motion<const> = self.motion
		motion.velocity_x = 0
		motion.velocity_y = 0
		set_direction_sprite(self, 12)
		return bt_success
	end
	advance_flight_direction(self, node_memory)
	return bt_running
end

function mijterfoe.begin_takeoff(self)
	local motion<const> = self.motion
	motion.velocity_x = 0
	motion.velocity_y = 256
	set_direction_sprite(self, 12)
	return bt_success
end

function mijterfoe.execute_free_flight(_self, node_memory)
	node_memory.flight_ticks = math.random(
		enemy_mijter_flight_min_steps,
		enemy_mijter_flight_max_steps
	)
	node_memory.direction_ticks = math.random(
		enemy_mijter_direction_min_steps,
		enemy_mijter_direction_max_steps
	)
	return bt_running
end

function mijterfoe.tick_free_flight(self, node_memory, execution)
	local flight_ticks<const> = node_memory.flight_ticks - 1
	if flight_ticks == 0 then
		execution.blackboard:set('direction_ticks', node_memory.direction_ticks)
		return bt_success
	end
	node_memory.flight_ticks = flight_ticks
	advance_flight_direction(self, node_memory)
	return bt_running
end

function mijterfoe.choose_drop_type(_self)
	if math.random(100) <= enemy_mijter_drop_health_chance_pct then
		return 'life'
	end
	if math.random(100) <= enemy_mijter_drop_ammo_chance_pct then
		return 'ammo'
	end
	return nil
end

function mijterfoe.register()
	local tree_id<const> = 'enemy_mijterfoe'
	behaviour_tree_library.register(tree_id, {
		blackboard = {
			{
				key = 'direction_ticks',
				initial_value = 0,
			},
		},
		root = {
			type = 'sequence',
			children = {
				{
					type = 'task',
					execute = mijterfoe.initialize_direction_cycle,
				},
				{
					type = 'loop',
					child = {
						type = 'sequence',
						children = {
							{
								type = 'task',
								node_memory = true,
								execute = mijterfoe.execute_seek_ceiling,
								tick = mijterfoe.tick_seek_ceiling,
							},
							{
								type = 'wait',
								duration_ticks = enemy_mijter_hang_steps,
							},
							{
								type = 'task',
								execute = mijterfoe.begin_takeoff,
							},
							{
								type = 'wait',
								duration_ticks = enemy_mijter_takeoff_steps,
							},
							{
								type = 'task',
								node_memory = true,
								execute = mijterfoe.execute_free_flight,
								tick = mijterfoe.tick_free_flight,
							},
							{
								type = 'wait',
								duration_ticks = 1,
							},
						},
					},
				},
			},
		},
	})
	prefab.define({
		def_id = 'enemy.mijterfoe',
		class = mijterfoe,
		base = enemy_base,
		components = {
			enemy_base.new_collider,
			fixed_point_velocity_component.new,
			bt_component.factory(tree_id),
		},
		defaults = {
			damage = 2,
			max_health = 1,
			health = 1,
			dangerous = true,
			enemy_kind = 'mijterfoe',
		},
	})
end

return mijterfoe

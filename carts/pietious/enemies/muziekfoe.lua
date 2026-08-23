local prefab<const> = require('cartlib/world/prefab')
local world<const> = require('cartlib/world/world')
local div_toward_zero<const> = require('cartlib/util/div_toward_zero')
local velocity<const> = require('cartlib/velocity')
require('constants')
local bt_result<const> = require('cartlib/behaviour_tree/result')
local bt_running<const> = bt_result.running
local bt_success<const> = bt_result.success
local behaviour_tree_library<const> = require('cartlib/behaviour_tree/library')
local bt_component<const> = require('cartlib/behaviour_tree/bt_component')
local kinematic_movement_component<const> = require('cartlib/physics/kinematic_movement_component')
local enemy_base<const> = require('enemies/enemy_base')
local abs<const> = math.abs

local muziekfoe<const> = {}
muziekfoe.__index = muziekfoe

local get_delta_from_source_to_target_scaled<const> = function(source_x, source_y, target_x, target_y, speed_scale)
	local dx<const> = target_x - source_x
	local dy<const> = target_y - source_y
	if dx == 0 then
		return 0, dy > 0 and speed_scale or -speed_scale
	end
	if dy == 0 then
		return dx > 0 and speed_scale or -speed_scale, 0
	end
	local abs_dx<const> = abs(dx)
	local abs_dy<const> = abs(dy)
	if abs_dx > abs_dy then
		return dx > 0 and speed_scale or -speed_scale, div_toward_zero(dy * speed_scale, abs_dx)
	end
	return div_toward_zero(dx * speed_scale, abs_dy), dy > 0 and speed_scale or -speed_scale
end

-- disable-next-line single_line_method_pattern -- constructor owns the local enemy sprite id at the class boundary.
function muziekfoe:ctor()
	self.movement = self:get_component(kinematic_movement_component)
	self.movement:set_collision_world(self.room)
	self:set_imgid('muziekfoe')
end

function muziekfoe.execute_move(self, node_memory)
	node_memory.move_accum = 0
	return muziekfoe.tick_move(self, node_memory)
end

function muziekfoe.tick_move(self, node_memory)
	local dir_modifier<const> = self.direction == 'left' and -1 or 1
	local move_x<const>, move_accum<const> = velocity.consume_axis_accum(
		node_memory.move_accum,
		enemy_muziek_horizontal_speed_num,
		enemy_muziek_horizontal_speed_den
	)
	node_memory.move_accum = move_accum
	if self.movement:move_x(move_x * dir_modifier) ~= 0 then
		self.direction = self.direction == 'left' and 'right' or 'left'
	end
	return bt_running
end

function muziekfoe.spawn_note(self)
	local player<const> = self.player
	local source_x<const> = self.x + 12
	local source_y<const> = self.y + 8
	local target_x<const> = player.x
	local target_y<const> = player.y + player.height
	local delta_scale<const> = 8
	local delta_x<const>, delta_y<const> = get_delta_from_source_to_target_scaled(
		source_x,
		source_y,
		target_x,
		target_y,
		delta_scale
	)
	local delta_divisor<const> = math.random(1, 2)
	world:spawn('enemy.nootfoe', {
		castle = self.castle,
		room = self.room,
		player = player,
		direction = delta_x < 0 and 'left' or 'right',
		speed_x_num = delta_x,
		speed_y_num = delta_y,
		speed_den = delta_scale * delta_divisor,
		speed_accum_x = 0,
		speed_accum_y = 0,
		pos = {
			x = self.x + 12,
			y = self.y,
			z = 140,
		},
	})
	return bt_success
end

function muziekfoe.choose_drop_type(_self)
	if math.random(100) <= enemy_muziek_drop_health_chance_pct then
		return 'life'
	end
	if math.random(100) <= enemy_muziek_drop_ammo_chance_pct then
		return 'ammo'
	end
	return nil
end

local tasks<const> = {
	move = {
		node_memory = true,
		execute = muziekfoe.execute_move,
		tick = muziekfoe.tick_move,
	},
	spawn_note = {
		execute = muziekfoe.spawn_note,
	},
}

function muziekfoe.register()
	local tree_id<const> = 'enemy_muziekfoe'
	behaviour_tree_library.register(tree_id, {
		root = {
			type = 'parallel_all',
			children = {
				{
					type = 'task',
					task = tasks.move,
				},
				{
					type = 'sequence',
					children = {
						{
							type = 'wait',
							duration_ticks = enemy_muziek_spawn_noot_steps - 1,
						},
						{
							type = 'loop',
							child = {
								type = 'sequence',
								children = {
									{
										type = 'task',
										task = tasks.spawn_note,
									},
									{
										type = 'wait',
										duration_ticks = enemy_muziek_spawn_noot_steps - 1,
									},
								},
							},
						},
					},
				},
			},
		},
	})
	prefab.define({
		def_id = 'enemy.muziekfoe',
		class = muziekfoe,
		base = enemy_base,
		components = {
			enemy_base.new_collider,
			kinematic_movement_component.factory({
				local_left = 0,
				local_top = 0,
				local_right = 24,
				local_bottom = 16,
				world_left = 0,
				world_top = room_hud_height,
				world_right = room_width,
				world_bottom = room_height,
				collision_mask = collision_flags_solid_mask,
				include_elevators = true,
			}),
			bt_component.factory(tree_id),
		},
		defaults = {
			damage = 4,
			max_health = 3,
			health = 3,
			dangerous = true,
			speed_x_num = 0,
			speed_y_num = 0,
			speed_den = 1,
			speed_accum_x = 0,
			speed_accum_y = 0,
			direction = 'right',
			enemy_kind = 'muziekfoe',
		},
	})
end

return muziekfoe

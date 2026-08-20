local prefab<const> = require('cartlib/world/prefab')
require('constants')
local bt_result<const> = require('cartlib/behaviour_tree/result')
local bt_running<const> = bt_result.running
local bt_success<const> = bt_result.success
local behaviour_tree_library<const> = require('cartlib/behaviour_tree/library')
local bt_component<const> = require('cartlib/behaviour_tree/bt_component')
local kinematic_movement_component<const> = require('cartlib/physics/kinematic_movement_component')
local enemy_base<const> = require('enemies/enemy_base')

local zakfoe<const> = {}
zakfoe.__index = zakfoe

function zakfoe:ctor()
	self.movement = self:get_component(kinematic_movement_component)
	self.movement:set_collision_world(self.room)
	self:set_imgid('zakfoe_stand')
	self.sprite_component.flip_h = self.direction == 'left'
end

function zakfoe.execute_jump(self, node_memory)
	node_memory.vertical_speed = enemy_zak_vertical_speed_start
	node_memory.ground_y = self.y
	node_memory.remaining_ticks = enemy_zak_jump_steps
	self:set_imgid('zakfoe_jump')
	self.sprite_component.flip_h = self.direction == 'left'
	return bt_running
end

function zakfoe.tick_jump(self, node_memory)
	local direction_mod<const> = self.direction == 'right' and 1 or -1
	self.y = self.y + node_memory.vertical_speed
	node_memory.vertical_speed = node_memory.vertical_speed + enemy_zak_vertical_speed_step

	local movement<const> = self.movement
	if movement:move_x(enemy_zak_horizontal_speed_px * direction_mod) ~= 0
	or not movement:has_support_ahead(direction_mod, room_tile_half, room_tile_size) then
		self.direction = direction_mod < 0 and 'right' or 'left'
		self.sprite_component.flip_h = self.direction == 'left'
	end

	local remaining_ticks<const> = node_memory.remaining_ticks - 1
	if remaining_ticks > 0 then
		node_memory.remaining_ticks = remaining_ticks
		return bt_running
	end
	self.y = node_memory.ground_y
	self:set_imgid('zakfoe_recover')
	self.sprite_component.flip_h = self.direction == 'left'
	return bt_success
end

function zakfoe.finish_recovery(self)
	self:set_imgid('zakfoe_stand')
	self.sprite_component.flip_h = self.direction == 'left'
	return bt_success
end

function zakfoe.choose_drop_type(self)
	if self.drop_health_chance_pct > 0
	and math.random(100) <= self.drop_health_chance_pct then
		return 'life'
	end
	if self.drop_ammo_chance_pct > 0
	and math.random(100) <= self.drop_ammo_chance_pct then
		return 'ammo'
	end
	return nil
end

function zakfoe.register()
	local tree_id<const> = 'enemy_zakfoe'
	behaviour_tree_library.register(tree_id, {
		root = {
			type = 'sequence',
			children = {
				{
					type = 'wait',
					duration_ticks = enemy_zak_prepare_jump_steps - 1,
				},
				{
					type = 'task',
					node_memory = true,
					execute = zakfoe.execute_jump,
					tick = zakfoe.tick_jump,
				},
				{
					type = 'wait',
					duration_ticks = enemy_zak_recovery_steps,
				},
				{
					type = 'task',
					execute = zakfoe.finish_recovery,
				},
			},
		},
	})
	prefab.define({
		def_id = 'enemy.zakfoe',
		class = zakfoe,
		base = enemy_base,
		components = {
			enemy_base.new_collider,
			kinematic_movement_component.factory({
				local_left = 2,
				local_top = 2,
				local_right = 14,
				local_bottom = 14,
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
			damage = 2,
			max_health = 2,
			health = 2,
			dangerous = true,
			speed_x_num = 0,
			speed_y_num = 0,
			speed_den = 1,
			speed_accum_x = 0,
			speed_accum_y = 0,
			drop_health_chance_pct = enemy_zak_drop_health_chance_pct,
			drop_ammo_chance_pct = enemy_zak_drop_ammo_chance_pct,
			direction = 'right',
			enemy_kind = 'zakfoe',
		},
	})
end

return zakfoe

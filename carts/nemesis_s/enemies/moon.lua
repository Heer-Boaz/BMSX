local behaviour_tree_component<const> = require('cartlib/behaviour_tree/bt_component')
local behaviour_tree_result<const> = require('cartlib/behaviour_tree/result')
local collider_2d_component<const> = require('cartlib/collision/collider_2d_component')
local sprite_animation_component<const> = require('cartlib/component/sprite_animation_component')
local fsm_component<const> = require('cartlib/fsm/fsm_component')
local fsm_library<const> = require('cartlib/fsm/library')
local prefab<const> = require('cartlib/world/prefab')
local timeline_component<const> = require('cartlib/timeline/timeline_component')
local world<const> = require('cartlib/world/world')
local assets<const> = require('bmsx/assets')
local enemy<const> = require('enemies/enemy')
require('constants')

local moon<const> = {}
moon.__index = moon
moon.tree_id = 'nemesis_s.enemy.moon'

local defeated_event<const> = 'enemy.moon.defeated'
local wait_for_explosion_timeline_id<const> = 'nemesis_s.enemy.moon.wait_for_explosion'
local wait_for_end_demo_timeline_id<const> = 'nemesis_s.enemy.moon.wait_for_end_demo'
local bt_running<const> = behaviour_tree_result.running
local bt_success<const> = behaviour_tree_result.success
local players_view
local roodjes_view

local new_core_collider<const> = collider_2d_component.factory({
	id_local = moon_core_collider_id,
	layer = collision_enemy_layer,
	mask = collision_enemy_mask,
})
local new_armor_collider<const> = collider_2d_component.factory({
	id_local = moon_armor_collider_id,
	layer = collision_enemy_layer,
	mask = collision_enemy_mask,
})
local new_flash_left<const> = sprite_animation_component.factory({
	id_local = moon_flash_left_id,
	frames = {
		assets_schoorsteen_flash_1,
		assets_schoorsteen_flash_2,
	},
	loop = true,
	offset_z = 1,
	enabled = false,
})
local new_flash_right<const> = sprite_animation_component.factory({
	id_local = moon_flash_right_id,
	frames = {
		assets_schoorsteen_flash_1,
		assets_schoorsteen_flash_2,
	},
	loop = true,
	offset_z = 1,
	enabled = false,
})

local rotation_poses<const> = {
	{
		imgid = assets_moon_up,
		armor = assets.collision_shape_moon_up_armor_addr,
		core = assets.collision_shape_moon_up_core_addr,
		flip_h = false,
		flip_v = false,
	},
	{
		imgid = assets_moon_up_right,
		armor = assets.collision_shape_moon_up_right_armor_addr,
		core = assets.collision_shape_moon_up_right_core_addr,
		flip_h = false,
		flip_v = false,
	},
	{
		imgid = assets_moon_right,
		armor = assets.collision_shape_moon_right_armor_addr,
		core = assets.collision_shape_moon_right_core_addr,
		flip_h = false,
		flip_v = false,
	},
	{
		imgid = assets_moon_down_right,
		armor = assets.collision_shape_moon_down_right_armor_addr,
		core = assets.collision_shape_moon_down_right_core_addr,
		flip_h = false,
		flip_v = false,
	},
	{
		imgid = assets_moon_up,
		armor = assets.collision_shape_moon_down_armor_addr,
		core = assets.collision_shape_moon_down_core_addr,
		flip_h = true,
		flip_v = true,
	},
	{
		imgid = assets_moon_up_right,
		armor = assets.collision_shape_moon_down_left_armor_addr,
		core = assets.collision_shape_moon_down_left_core_addr,
		flip_h = true,
		flip_v = true,
	},
	{
		imgid = assets_moon_right,
		armor = assets.collision_shape_moon_left_armor_addr,
		core = assets.collision_shape_moon_left_core_addr,
		flip_h = true,
		flip_v = true,
	},
	{
		imgid = assets_moon_down_right,
		armor = assets.collision_shape_moon_up_left_armor_addr,
		core = assets.collision_shape_moon_up_left_core_addr,
		flip_h = true,
		flip_v = true,
	},
}

function moon:apply_rotation()
	local pose<const> = rotation_poses[self.rotation]
	local sprite<const> = self.sprite_component
	self:set_imgid(pose.imgid)
	sprite.flip_h = pose.flip_h
	sprite.flip_v = pose.flip_v
	local armor<const> = self.armor_collider
	armor:set_shape_asset(pose.armor)
	local core<const> = self.core_collider
	core:set_shape_asset(pose.core)
end

function moon:rotate_clockwise()
	local rotation<const> = self.rotation + 1
	self.rotation = rotation > moon_rotation_up_left and moon_rotation_up or rotation
	self:apply_rotation()
end

function moon:rotate_counterclockwise()
	local rotation<const> = self.rotation - 1
	self.rotation = rotation < moon_rotation_up and moon_rotation_up_left or rotation
	self:apply_rotation()
end

function moon:ctor()
	self.behaviour = self:get_component(behaviour_tree_component)
	self.core_collider = self:get_component(collider_2d_component, moon_core_collider_id)
	self.armor_collider = self:get_component(collider_2d_component, moon_armor_collider_id)
	self.flash_left = self:get_component(sprite_animation_component, moon_flash_left_id)
	self.flash_right = self:get_component(sprite_animation_component, moon_flash_right_id)
	self:apply_rotation()
end

function moon:onspawn()
	self.health = moon_health * #players_view.objects
	self.vulnerable = false
end

function moon:tick_entering()
	self.x = self.x - self.stage.tile_size
	if self.x <= moon_enter_target_x then
		self.vulnerable = true
		return bt_success
	end
	return bt_running
end

function moon:tick_fly_left()
	self:rotate_counterclockwise()
	self.x = self.x - self.stage.tile_size
	if self.x <= 0 then
		return bt_success
	end
	return bt_running
end

function moon:tick_fly_up()
	self:rotate_counterclockwise()
	self.y = self.y - self.stage.tile_size
	if self.y <= 0 then
		self.vertical_direction = moon_vertical_direction_down
		return bt_success
	end
	return bt_running
end

function moon:tick_fly_down()
	self:rotate_counterclockwise()
	self.y = self.y + self.stage.tile_size
	if self.y >= playfield_height - moon_height then
		self.vertical_direction = moon_vertical_direction_up
		return bt_success
	end
	return bt_running
end

function moon:spawn_mini_moon()
	local players<const> = players_view.objects
	local target<const> = players[math.random(1, #players)]
	local red<const> = math.random(1, 100) <= mini_moon_red_chance_percent
		and #roodjes_view.objects < mini_moon_red_pickup_limit
	world:spawn(ids_mini_moon_def, {
		stage = self.stage,
		target = target,
		red = red,
		pos = {
			x = self.x + moon_width // 2,
			y = self.y + moon_height // 2,
		},
	})
end

function moon:tick_small_ray_pass()
	self.x = self.x + self.stage.tile_size
	if self.x >= playfield_width - moon_width then
		return bt_success
	end
	return bt_running
end

function moon:tick_rotate_to_small_ray_direction()
	local target_rotation<const> = self.vertical_direction == moon_vertical_direction_down
		and moon_rotation_up or moon_rotation_down
	if self.rotation == target_rotation then
		return bt_success
	end
	self:rotate_counterclockwise()
	return bt_running
end

function moon:activate_small_ray_flashes()
	local offset_y<const> = self.rotation == moon_rotation_up and 50 or 0
	local flash_left<const> = self.flash_left
	flash_left.offset_x = 2
	flash_left.offset_y = offset_y
	flash_left:activate()
	local flash_right<const> = self.flash_right
	flash_right.offset_x = 44
	flash_right.offset_y = offset_y
	flash_right:activate()
end

function moon:deactivate_flashes()
	self.flash_left:deactivate()
	self.flash_right:deactivate()
end

function moon:fire_small_ray_volley()
	local points_down<const> = self.rotation == moon_rotation_up
	local direction<const> = points_down and moon_vertical_direction_down or moon_vertical_direction_up
	local offset_y<const> = points_down and 56 or 8
	world:spawn(ids_moon_small_ray_def, {
		direction = direction,
		pos = { x = self.x + 2, y = self.y + offset_y },
	})
	world:spawn(ids_moon_small_ray_def, {
		direction = direction,
		pos = { x = self.x + 44, y = self.y + offset_y },
	})
	self.events:emit('enemy.moon.small_ray_fired')
	return bt_success
end

function moon:tick_rotate_to_right()
	if self.rotation == moon_rotation_right then
		return bt_success
	end
	self:rotate_clockwise()
	return bt_running
end

function moon:tick_vertical_playfield()
	self.y = self.y + self.vertical_direction * self.stage.tile_size
	if self.vertical_direction == moon_vertical_direction_up then
		if self.y <= 0 then
			self.vertical_direction = moon_vertical_direction_down
		end
	elseif self.y >= playfield_height - moon_height then
		self.vertical_direction = moon_vertical_direction_up
	end
end

function moon:begin_death_ray()
	world:spawn(ids_moon_death_ray_def, {
		originator = self,
		pos = {
			x = self.x + moon_death_ray_offset_x,
			y = self.y + moon_death_ray_offset_y,
		},
	})
	self.events:emit('enemy.moon.death_ray_fired')
	return bt_success
end

-- The Stage-7 Abaddon controller chooses a direction toward the primary
-- player only at the start of each movement segment. Its movement accumulator
-- and remaining movement count belong to that active Task instance.
local death_ray_movement_task<const> = {
	node_memory = true,
}

function death_ray_movement_task.execute(self, node_memory)
	local player<const> = players_view.objects[1]
	if self.y < 0 or self.y + moon_death_ray_move_target_offset_y < player.y then
		self.vertical_direction = moon_vertical_direction_down
	else
		self.vertical_direction = moon_vertical_direction_up
	end
	node_memory.movement_accumulator = moon_death_ray_move_accumulator_initial
	node_memory.remaining_moves = math.random(
		moon_death_ray_move_count_min,
		moon_death_ray_move_count_max
	)
	return bt_running
end

function death_ray_movement_task.tick(self, node_memory)
	local movement_accumulator<const> = node_memory.movement_accumulator
		+ moon_death_ray_move_accumulator_step
	if movement_accumulator < 0x100 then
		node_memory.movement_accumulator = movement_accumulator
		return bt_running
	end
	node_memory.movement_accumulator = movement_accumulator - 0x100

	local remaining_moves<const> = node_memory.remaining_moves
	if remaining_moves == 0 then
		return bt_success
	end
	node_memory.remaining_moves = remaining_moves - 1

	local direction<const> = self.vertical_direction
	local y<const> = self.y + direction * self.stage.tile_size
	self.y = y
	if direction == moon_vertical_direction_down then
		if y >= moon_death_ray_move_bottom_y then
			self.vertical_direction = moon_vertical_direction_up
		end
	elseif y <= moon_death_ray_move_top_y then
		self.vertical_direction = moon_vertical_direction_down
	end
	return bt_running
end

moon.tasks = {
	enter = {
		tick = moon.tick_entering,
	},
	fly_left = {
		tick = moon.tick_fly_left,
	},
	fly_up = {
		tick = moon.tick_fly_up,
	},
	fly_down = {
		tick = moon.tick_fly_down,
	},
	small_ray_pass = {
		tick = moon.tick_small_ray_pass,
	},
	rotate_to_small_ray_direction = {
		tick = moon.tick_rotate_to_small_ray_direction,
	},
	fire_small_ray_volley = {
		execute = moon.fire_small_ray_volley,
	},
	rotate_to_right = {
		tick = moon.tick_rotate_to_right,
	},
	begin_death_ray = {
		execute = moon.begin_death_ray,
	},
	death_ray_movement = death_ray_movement_task,
}

moon.services = {
	spawn_mini_moon = {
		on_tick = moon.spawn_mini_moon,
	},
	small_ray_flashes = {
		on_become_relevant = moon.activate_small_ray_flashes,
		on_cease_relevant = moon.deactivate_flashes,
	},
	vertical_playfield_movement = {
		on_tick = moon.tick_vertical_playfield,
	},
}

function moon:receive_player_projectile(projectile, collider_local_id, hit_point)
	if collider_local_id ~= moon_core_collider_id or not self.vulnerable then
		self.events:emit('enemy.moon.armored_hit')
		return true
	end
	enemy.receive_player_projectile(self, projectile)
	if self.health > 0 then
		self.events:emit('enemy.moon.hit')
		world:spawn(ids_small_explosion_def, {
			stage = self.stage,
			pos = { x = hit_point.x, y = hit_point.y },
		})
	end
	return true
end

function moon:on_destroyed()
	self.vulnerable = false
	self.events:emit(defeated_event)
end

function moon:begin_dying()
	self.behaviour:stop()
	self.vulnerable = false
end

function moon:explode()
	self.visible = false
	self.core_collider:set_enabled(false)
	self.armor_collider:set_enabled(false)
	self.events:emit('enemy.moon.explosion')
	world:spawn(ids_large_explosion_def, {
		stage = self.stage,
		pos = {
			x = self.x + moon_width // 3,
			y = self.y + moon_height // 3,
		},
	})
	return '/dying/wait_for_end_demo'
end

local define_fsm<const> = function()
	fsm_library.register(ids_moon_fsm, {
		initial = 'active',
		on = {
			[defeated_event] = '/dying/wait_for_explosion',
		},
		states = {
			active = {},
			dying = {
				initial = 'wait_for_explosion',
				entering_state = moon.begin_dying,
				states = {
					wait_for_explosion = {
						timelines = {
							[wait_for_explosion_timeline_id] = {
								def = {
									duration_frames = moon_wait_for_explosion_ticks,
								},
								on_finished = moon.explode,
							},
						},
					},
					wait_for_end_demo = {
						timelines = {
							[wait_for_end_demo_timeline_id] = {
								def = {
									duration_frames = moon_wait_for_end_demo_ticks,
								},
								on_finished = function(self)
									self.stage.events:emit('stage.completed')
								end,
							},
						},
					},
				},
			},
		},
	})
end

local register_definition<const> = function()
	players_view = world:active_definition_view(ids_player_def)
	roodjes_view = world:active_definition_view(ids_roodje_def)
	prefab.define({
		def_id = ids_moon_def,
		class = moon,
		base = enemy,
		components = {
			new_core_collider,
			new_armor_collider,
			new_flash_left,
			new_flash_right,
			behaviour_tree_component.factory(moon.tree_id),
			timeline_component.new,
			fsm_component.factory({ ids_moon_fsm }),
		},
		defaults = {
			imgid = assets_moon_down_right,
			max_health = moon_health,
			rotation = moon_rotation_down_right,
			vertical_direction = moon_vertical_direction_down,
			small_fry = false,
			z = moon_draw_z,
		},
	})
end

function moon.register()
	define_fsm()
	register_definition()
end

return moon

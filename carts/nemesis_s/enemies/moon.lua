local actioneffects<const> = require('cartlib/actioneffects')
local actioneffect_component<const> = require('cartlib/actioneffects/actioneffect_component')
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

local enter_step_effect_id<const> = 'nemesis_s.enemy.moon.enter_step'
local mini_moon_effect_id<const> = 'nemesis_s.enemy.moon.mini_moon'
local small_ray_move_effect_id<const> = 'nemesis_s.enemy.moon.small_ray_move'
local small_ray_volley_effect_id<const> = 'nemesis_s.enemy.moon.small_ray_volley'
local slow_playfield_move_effect_id<const> = 'nemesis_s.enemy.moon.slow_playfield_move'
local entered_event<const> = 'enemy.moon.entered'
local death_ray_requested_event<const> = 'enemy.moon.death_ray.requested'
local defeated_event<const> = 'enemy.moon.defeated'
local small_ray_flash_timeline_id<const> = 'nemesis_s.enemy.moon.small_ray_flash'
local death_ray_cycle_timeline_id<const> = 'nemesis_s.enemy.moon.death_ray_cycle'
local death_ray_move_pause_timeline_id<const> = 'nemesis_s.enemy.moon.death_ray_move_pause'
local wait_for_attack_timeline_id<const> = 'nemesis_s.enemy.moon.wait_for_attack'
local wait_for_explosion_timeline_id<const> = 'nemesis_s.enemy.moon.wait_for_explosion'
local wait_for_end_demo_timeline_id<const> = 'nemesis_s.enemy.moon.wait_for_end_demo'
local players_view
local roodjes_view

local new_core_collider<const> = collider_2d_component.factory({
	id_local = moon_core_collider_id,
	layer = collision_enemy_layer,
	mask = collision_player_projectile_layer,
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

function moon:step_entering()
	self.x = self.x - moon_enter_step_x
	if self.x <= moon_enter_target_x then
		self.vulnerable = true
		return entered_event
	end
end

function moon:update_fly_left()
	self:rotate_counterclockwise()
	self.x = self.x - moon_fly_step
	if self.x <= 0 then
		if math.random(1, 2) == 1 then
			return '/combat/fly_attack/up'
		end
		return '/combat/fly_attack/down'
	end
end

function moon:update_fly_up()
	self:rotate_counterclockwise()
	self.y = self.y - moon_fly_step
	if self.y <= 0 then
		self.vertical_direction = moon_vertical_direction_down
		return '/combat/small_rays_down/rotating'
	end
end

function moon:update_fly_down()
	self:rotate_counterclockwise()
	self.y = self.y + moon_fly_step
	if self.y >= playfield_height - moon_height then
		self.vertical_direction = moon_vertical_direction_up
		return '/combat/small_rays_up/rotating'
	end
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

function moon:step_small_rays()
	self.x = self.x + moon_small_ray_move_step_x
	if self.x >= playfield_width - moon_width then
		return death_ray_requested_event
	end
end

function moon:update_rotate_to_up()
	if self.rotation == moon_rotation_up then
		return '../flashing'
	end
	self:rotate_counterclockwise()
end

function moon:update_rotate_to_down()
	if self.rotation == moon_rotation_down then
		return '../flashing'
	end
	self:rotate_counterclockwise()
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
end

function moon:begin_small_ray_volley()
	self:fire_small_ray_volley()
	return '../firing'
end

function moon:update_rotate_to_right()
	if self.rotation == moon_rotation_right then
		return '../attack'
	end
	self:rotate_clockwise()
end

function moon:step_vertical_playfield()
	self.y = self.y + self.vertical_direction * moon_slow_vertical_step
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
end

-- The Stage-7 Abaddon controller chooses a direction toward the primary
-- player only at the start of each movement segment. Its byte accumulator and
-- pre-decremented step counter are retained directly so the translated Moon
-- keeps the source boss's discrete, readable movement rhythm.
function moon:begin_death_ray_movement()
	local player<const> = players_view.objects[1]
	if self.y < 0 or self.y + moon_death_ray_move_target_offset_y < player.y then
		self.vertical_direction = moon_vertical_direction_down
	else
		self.vertical_direction = moon_vertical_direction_up
	end
	self.death_ray_move_phase = moon_death_ray_move_phase_initial
	self.death_ray_move_counter = math.random(
		moon_death_ray_move_counter_min,
		moon_death_ray_move_counter_max
	)
end

function moon:update_death_ray_movement()
	local phase<const> = self.death_ray_move_phase + moon_death_ray_move_phase_step
	if phase < 0x100 then
		self.death_ray_move_phase = phase
		return
	end
	self.death_ray_move_phase = phase - 0x100

	local counter<const> = self.death_ray_move_counter - 1
	self.death_ray_move_counter = counter
	if counter == 0 then
		return '../waiting'
	end

	local direction<const> = self.vertical_direction
	local y<const> = self.y + direction * moon_death_ray_move_step
	self.y = y
	if direction == moon_vertical_direction_down then
		if y >= moon_death_ray_move_bottom_y then
			self.vertical_direction = moon_vertical_direction_up
		end
	elseif y <= moon_death_ray_move_top_y then
		self.vertical_direction = moon_vertical_direction_down
	end
end

function moon:choose_next_attack()
	if math.random(1, 100) <= moon_fly_attack_chance_percent then
		return '/combat/fly_attack/left'
	end
	return '/combat/death_ray/rotating'
end

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
	self.vulnerable = false
	self.core_collider:set_enabled(false)
	self.armor_collider:set_enabled(false)
	self:deactivate_flashes()
end

function moon:explode()
	self.visible = false
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
		initial = 'entering',
		on = {
			[entered_event] = '/combat/fly_attack/left',
			[death_ray_requested_event] = '/combat/death_ray/rotating',
			[defeated_event] = '/dying/wait_for_explosion',
		},
		timelines = {
			[small_ray_flash_timeline_id] = {
				def = {
					continuous = true,
					duration_ms = moon_small_ray_flash_ms,
					playback_mode = 'once',
				},
				autoplay = false,
			},
		},
		states = {
			entering = {
				actioneffects = { enter_step_effect_id },
			},
			combat = {
				initial = 'fly_attack',
				states = {
					fly_attack = {
						initial = 'left',
						actioneffects = { mini_moon_effect_id },
						states = {
							left = {
								update = moon.update_fly_left,
							},
							up = {
								update = moon.update_fly_up,
							},
							down = {
								update = moon.update_fly_down,
							},
						},
					},
					small_rays_up = {
						initial = 'rotating',
						actioneffects = {
							mini_moon_effect_id,
							small_ray_move_effect_id,
						},
						exiting_state = moon.deactivate_flashes,
						states = {
							rotating = {
								update = moon.update_rotate_to_down,
							},
							flashing = {
								entering_state = moon.activate_small_ray_flashes,
								timelines = {
									[small_ray_flash_timeline_id] = {
										autoplay = true,
										stop_on_exit = true,
										on_finished = moon.begin_small_ray_volley,
									},
								},
							},
							firing = {
								actioneffects = { small_ray_volley_effect_id },
							},
						},
					},
					small_rays_down = {
						initial = 'rotating',
						actioneffects = {
							mini_moon_effect_id,
							small_ray_move_effect_id,
						},
						exiting_state = moon.deactivate_flashes,
						states = {
							rotating = {
								update = moon.update_rotate_to_up,
							},
							flashing = {
								entering_state = moon.activate_small_ray_flashes,
								timelines = {
									[small_ray_flash_timeline_id] = {
										autoplay = true,
										stop_on_exit = true,
										on_finished = moon.begin_small_ray_volley,
									},
								},
							},
							firing = {
								actioneffects = { small_ray_volley_effect_id },
							},
						},
					},
					death_ray = {
						initial = 'rotating',
						states = {
							rotating = {
								update = moon.update_rotate_to_right,
							},
							attack = {
								initial = 'firing',
								states = {
									firing = {
										entering_state = moon.begin_death_ray,
										timelines = {
											[death_ray_cycle_timeline_id] = {
												def = {
													duration_frames = moon_death_ray_cycle_updates,
													playback_mode = 'once',
												},
												on_finished = '/combat/wait_for_new_attack',
											},
										},
									},
									movement = {
										is_concurrent = true,
										initial = 'moving',
										states = {
											moving = {
												entering_state = moon.begin_death_ray_movement,
												update = moon.update_death_ray_movement,
											},
											waiting = {
												timelines = {
													[death_ray_move_pause_timeline_id] = {
														def = {
															duration_frames = moon_death_ray_move_pause_updates,
															playback_mode = 'once',
														},
														on_finished = '../moving',
													},
												},
											},
										},
									},
								},
							},
						},
					},
					wait_for_new_attack = {
						actioneffects = { slow_playfield_move_effect_id },
						timelines = {
							[wait_for_attack_timeline_id] = {
								def = {
									continuous = true,
									duration_ms = moon_wait_for_attack_ms,
									playback_mode = 'once',
								},
								on_finished = moon.choose_next_attack,
							},
						},
					},
				},
			},
			dying = {
				initial = 'wait_for_explosion',
				entering_state = moon.begin_dying,
				states = {
					wait_for_explosion = {
						timelines = {
							[wait_for_explosion_timeline_id] = {
								def = {
									continuous = true,
									duration_ms = moon_wait_for_explosion_ms,
									playback_mode = 'once',
								},
								on_finished = moon.explode,
							},
						},
					},
					wait_for_end_demo = {
						timelines = {
							[wait_for_end_demo_timeline_id] = {
								def = {
									continuous = true,
									duration_ms = moon_wait_for_end_demo_ms,
									playback_mode = 'once',
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
			actioneffect_component.factory({
				enter_step_effect_id,
				mini_moon_effect_id,
				small_ray_move_effect_id,
				small_ray_volley_effect_id,
				slow_playfield_move_effect_id,
			}),
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
	actioneffects.register_effect(enter_step_effect_id, {
		period_ms = moon_enter_step_ms,
		handler = moon.step_entering,
	})
	actioneffects.register_effect(mini_moon_effect_id, {
		period_ms = moon_mini_spawn_ms,
		handler = moon.spawn_mini_moon,
	})
	actioneffects.register_effect(small_ray_move_effect_id, {
		period_ms = moon_small_ray_move_ms,
		handler = moon.step_small_rays,
	})
	actioneffects.register_effect(small_ray_volley_effect_id, {
		period_ms = moon_small_ray_volley_ms,
		handler = moon.fire_small_ray_volley,
	})
	actioneffects.register_effect(slow_playfield_move_effect_id, {
		period_ms = moon_slow_vertical_step_ms,
		handler = moon.step_vertical_playfield,
	})
	define_fsm()
	register_definition()
end

return moon

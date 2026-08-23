local behaviour_tree_component<const> = require('cartlib/behaviour_tree/bt_component')
local behaviour_tree_result<const> = require('cartlib/behaviour_tree/result')
local collider_2d_component<const> = require('cartlib/collision/collider_2d_component')
local custom_visual_component<const> = require('cartlib/component/custom_visual_component')
local fsm_component<const> = require('cartlib/fsm/fsm_component')
local fsm_library<const> = require('cartlib/fsm/library')
local gp0<const> = require('cartlib/gx/gp0')
local image<const> = require('cartlib/gx/image')
local prefab<const> = require('cartlib/world/prefab')
local timeline<const> = require('cartlib/timeline/timeline')
local timeline_clock_source<const> = require('cartlib/timeline/clock_source')
local timeline_component<const> = require('cartlib/timeline/timeline_component')
local world<const> = require('cartlib/world/world')
local world_object<const> = require('cartlib/world/world_object')
local assets<const> = require('bmsx/assets')
local combat_damage<const> = require('combat/damage')
local enemy_base<const> = require('enemies/enemy_base')
local world_item<const> = require('world/item').world_item
require('constants')

local world1_daemon<const> = {}
world1_daemon.__index = world1_daemon

local world1_daemon_key<const> = {}
world1_daemon_key.__index = world1_daemon_key

world1_daemon.tree_id = 'enemy_world1_daemon'
world1_daemon.timeline_id = {
	prepare_spawn = 'world1_daemon.prepare_spawn',
	unprepare_spawn = 'world1_daemon.unprepare_spawn',
	prepare_pounce = 'world1_daemon.prepare_pounce',
	unprepare_pounce = 'world1_daemon.unprepare_pounce',
	death = 'world1_daemon.death',
}

local timeline_id<const> = world1_daemon.timeline_id
local bt_running<const> = behaviour_tree_result.running
local bt_success<const> = behaviour_tree_result.success
local death_image_count<const> = 8
local death_images<const> = {}
local keep_current_pose<const> = false
local poses<const> = {
	walk_1 = {
		imgid = 'world1_daemon_walk_1',
		shape_asset = assets.collision_shape_world1_daemon_walk_1_body_addr,
	},
	walk_2 = {
		imgid = 'world1_daemon_walk_2',
		shape_asset = assets.collision_shape_world1_daemon_walk_2_body_addr,
	},
	spawn_prepare_1 = {
		imgid = 'world1_daemon_spawn_prepare_1',
		shape_asset = assets.collision_shape_world1_daemon_spawn_prepare_1_body_addr,
	},
	spawn_prepare_2 = {
		imgid = 'world1_daemon_spawn_prepare_2',
		shape_asset = assets.collision_shape_world1_daemon_spawn_prepare_2_body_addr,
	},
	pounce_prepare_1 = {
		imgid = 'world1_daemon_pounce_prepare_1',
		shape_asset = assets.collision_shape_world1_daemon_pounce_prepare_1_body_addr,
	},
	pounce_prepare_2 = {
		imgid = 'world1_daemon_pounce_prepare_2',
		shape_asset = assets.collision_shape_world1_daemon_pounce_prepare_2_body_addr,
	},
	pounce = {
		imgid = 'world1_daemon_pounce',
		shape_asset = assets.collision_shape_world1_daemon_pounce_body_addr,
	},
}

local prepare_spawn_frames<const> = {
	keep_current_pose,
	poses.spawn_prepare_1,
	poses.spawn_prepare_2,
}
local unprepare_spawn_frames<const> = {
	keep_current_pose,
	poses.spawn_prepare_1,
	poses.walk_2,
}
local prepare_pounce_frames<const> = {
	keep_current_pose,
	poses.pounce_prepare_1,
	poses.pounce_prepare_2,
}
local unprepare_pounce_frames<const> = {
	keep_current_pose,
	poses.walk_2,
}

local death_stage_keys<const> = {}
local death_frame = 0
for stage = 1, death_image_count * 2 do
	death_stage_keys[stage] = { frame = death_frame, value = stage }
	death_frame = death_frame + (
		(stage & 1) == 1
		and boss_world1_death_odd_stage_frames
		or boss_world1_death_even_stage_frames
	)
end
local death_hidden_frame<const> = death_frame
local new_collider<const> = collider_2d_component.factory({
	layer = collision_enemy_layer,
	mask = collision_enemy_mask,
	enabled = false,
})

local draw_death_parity<const> = function(draw, boss, tile, parity)
	local origin_x<const> = boss.x
	local origin_y<const> = boss.y
	local flip_h<const> = boss.direction == 'left'
	for row = 0, 3 do
		for column = (row + parity) & 1, 9, 2 do
			local x<const> = origin_x + (column * room_tile_size)
			local y<const> = origin_y + (row * room_tile_size)
			if flip_h then
				tile:draw(draw, x, y, 0xffffffff, 1, gp0.draw_mode_blend_half)
			else
				tile:blit(draw, x, y)
			end
		end
	end
end

local draw_death_overlay<const> = function(component, draw)
	local boss<const> = component.parent
	local stage<const> = boss.death_stage
	if stage <= death_image_count then
		draw_death_parity(draw, boss, death_images[stage], 0)
		return
	end
	draw_death_parity(draw, boss, death_images[death_image_count], 0)
	draw_death_parity(draw, boss, death_images[stage - death_image_count], 1)
end

local dispose_references<const> = function(objects)
	for index = 1, #objects do
		local obj<const> = objects[index]
		if obj.active then
			obj:mark_for_disposal()
		end
		objects[index] = nil
	end
end

-- disable-next-line single_line_method_pattern -- the boss key overrides the item collection policy by remaining visible until the victory sequence releases it.
function world1_daemon_key:on_collected()
	self.collider:set_enabled(false)
end

function world1_daemon:ctor()
	self.behaviour = self:get_component(behaviour_tree_component)
	self.collider = self:get_component(collider_2d_component)
	self.death_visual = self:get_component(custom_visual_component)
	self.death_visual:set_offset_z(111)
	self.spawn_projectiles = {}
	self.potatoes = {}
	self.zaks = {}
	self.key = nil
	self.death_stage = 1
	self.walk_frame = 1
	self.current_pose = nil
	self.visible = false
	self:set_pose(poses.walk_1)
end

function world1_daemon:clear_encounter_objects()
	dispose_references(self.spawn_projectiles)
	dispose_references(self.potatoes)
	dispose_references(self.zaks)
	self:clear_key()
end

function world1_daemon:clear_key()
	local key<const> = self.key
	if key ~= nil and key.active then
		key:mark_for_disposal()
	end
	self.key = nil
end

function world1_daemon:reset_encounter()
	local behaviour<const> = self.behaviour
	behaviour:stop()
	self.collider:set_enabled(false)
	self.death_visual:set_draw_function(nil)
	self:clear_encounter_objects()
	self.health = self.max_health
	self.dangerous = false
	self.visible = false
	self.death_stage = 1
	behaviour.blackboard:reset()
	self:set_pose(poses.walk_1)
	self.sprite_component.offset_y = 0
end

function world1_daemon:activate_encounter()
	self:choose_entrance()
	self.dangerous = true
	self.visible = true
	self.collider:set_enabled(true)
	self.behaviour:start()
end

function world1_daemon:execute_walk()
	self.walk_frame = self.current_pose == poses.walk_2 and 2 or 1
	self.visible = true
	self.sprite_component.offset_y = 0
	return bt_running
end

function world1_daemon:set_pose(pose)
	if pose ~= keep_current_pose and pose ~= self.current_pose then
		self.current_pose = pose
		self:set_imgid(pose.imgid)
		local flip_h<const> = self.direction == 'left'
		local collider<const> = self.collider
		collider:set_shape_asset(pose.shape_asset)
		collider:set_shape_flip(flip_h, false)
	end
end

function world1_daemon:advance_walk_frame()
	if self.walk_frame == 1 then
		self.walk_frame = 2
		self:set_pose(poses.walk_2)
	else
		self.walk_frame = 1
		self:set_pose(poses.walk_1)
	end
end

function world1_daemon:tick_walk_into_room()
	self:advance_walk_frame()
	if self.direction == 'right' then
		local x<const> = self.x + room_tile_size
		if x >= boss_world1_entry_left_x then
			self.x = boss_world1_entry_left_x
			return bt_success
		end
		self.x = x
		return bt_running
	end
	local x<const> = self.x - room_tile_size
	if x <= boss_world1_entry_right_x then
		self.x = boss_world1_entry_right_x
		return bt_success
	end
	self.x = x
	return bt_running
end

function world1_daemon:tick_walk_forward_out_of_room()
	self:advance_walk_frame()
	local step<const> = self.direction == 'right' and room_tile_size or -room_tile_size
	local x<const> = self.x + step
	if x > room_width or x < -(10 * room_tile_size) then
		self.x = -1000
		self.y = -1000
		self.visible = false
		return bt_success
	end
	self.x = x
	return bt_running
end

function world1_daemon:tick_walk_backward_out_of_room()
	self:advance_walk_frame()
	local step<const> = self.direction == 'right' and room_tile_size or -room_tile_size
	local x<const> = self.x - step
	if x > room_width or x < -(10 * room_tile_size) then
		self.x = -1000
		self.y = -1000
		self.visible = false
		return bt_success
	end
	self.x = x
	return bt_running
end

function world1_daemon:execute_pounce()
	self:set_pose(poses.pounce)
	self.sprite_component.offset_y = room_tile_size
	return bt_running
end

function world1_daemon:tick_pounce()
	if self.direction == 'right' then
		local x<const> = self.x + boss_world1_pounce_step_px
		if x < boss_world1_pounce_left_x then
			self.x = x
			return bt_running
		end
		self.x = boss_world1_pounce_left_x
	else
		local x<const> = self.x - boss_world1_pounce_step_px
		if x > boss_world1_pounce_right_x then
			self.x = x
			return bt_running
		end
		self.x = boss_world1_pounce_right_x
	end
	self:set_pose(poses.walk_1)
	self.sprite_component.offset_y = 0
	self.events:emit('daemon.landed')
	return bt_success
end

function world1_daemon:choose_entrance()
	local lane
	if math.random(1, 2) == 1 then
		local player<const> = self.player
		if player.x <= boss_world1_player_side_split_x then
			self.direction = 'right'
			self.x = boss_world1_start_left_x
		else
			self.direction = 'left'
			self.x = boss_world1_start_right_x
		end
		if player.y <= boss_world1_lane_y[2] then
			lane = 1
		elseif player.y <= boss_world1_lane_y[3] then
			lane = 2
		else
			lane = 3
		end
	else
		if math.random(1, 2) == 1 then
			self.direction = 'left'
			self.x = boss_world1_start_right_x
		else
			self.direction = 'right'
			self.x = boss_world1_start_left_x
		end
		lane = math.random(1, 3)
	end
	self.y = boss_world1_lane_y[lane]
	local flip_h<const> = self.direction == 'left'
	self.sprite_component.flip_h = flip_h
	self.collider:set_shape_flip(flip_h, false)
	return bt_success
end

function world1_daemon:spawn_potato(x, y)
	for index = 1, boss_world1_max_potatoes do
		local existing<const> = self.potatoes[index]
		if existing == nil or not existing.active then
			local speed_x<const> = self.direction == 'right' and 4 or -4
			self.potatoes[index] = world:spawn('enemy.marspeinenaardappel', {
				space_id = self.space_id,
				castle = self.castle,
				room = self.room,
				player = self.player,
				pos = { x = x, y = y, z = draw_z_enemy + 1 },
				speed_x_num = speed_x,
				speed_y_num = 4,
				drop_health_chance_pct = 0,
				drop_ammo_chance_pct = 0,
				direction = self.direction,
			})
			return
		end
	end
end

function world1_daemon:spawn_attack_burst(burst_count)
	local projectiles<const> = self.spawn_projectiles
	local write_index = 1
	for read_index = 1, #projectiles do
		local projectile<const> = projectiles[read_index]
		if projectile.active then
			projectiles[write_index] = projectile
			write_index = write_index + 1
		end
	end
	for index = write_index, #projectiles do
		projectiles[index] = nil
	end

	local x = self.x
	if self.direction == 'right' then
		x = x + (8 * room_tile_size)
	end
	local y<const> = self.y
	for _ = 1, boss_world1_spawn_projectiles_per_burst do
		local speed_x = math.random(10, 19) * 2
		if self.direction == 'left' then
			speed_x = -speed_x
		end
		local projectile<const> = world:spawn('enemy.daemon_spawn', {
			space_id = self.space_id,
			castle = self.castle,
			room = self.room,
			player = self.player,
			pos = { x = x, y = y, z = draw_z_enemy + 1 },
			speed_x_num = speed_x,
			speed_y_num = math.random(-12, 11) * 4,
			direction = self.direction,
		})
		projectiles[#projectiles + 1] = projectile
	end

	if (burst_count % 3) == 0 then
		self:spawn_potato(x, y)
	end
	self.events:emit('daemon.spawn_burst')
end

function world1_daemon:spawn_zak()
	for index = 1, boss_world1_max_zaks do
		local existing<const> = self.zaks[index]
		if existing == nil or not existing.active then
			local direction
			local x
			if math.random(1, 2) == 1 then
				direction = 'left'
				x = room_width - (2 * room_tile_size)
			else
				direction = 'right'
				x = 0
			end
			self.zaks[index] = world:spawn('enemy.zakfoe', {
				space_id = self.space_id,
				castle = self.castle,
				room = self.room,
				player = self.player,
				pos = {
					x = x,
					y = boss_world1_zak_lane_y[math.random(1, 3)],
					z = draw_z_enemy,
				},
				direction = direction,
				drop_health_chance_pct = boss_world1_zak_drop_health_chance_pct,
				drop_ammo_chance_pct = boss_world1_zak_drop_ammo_chance_pct,
			})
			return
		end
	end
end

local spawn_attack_service<const> = {
	node_memory = true,
}

function spawn_attack_service.on_become_relevant(_target, node_memory)
	node_memory.burst_count = 0
end

function spawn_attack_service.on_tick(target, node_memory)
	local burst_count<const> = node_memory.burst_count
	target:spawn_attack_burst(burst_count)
	node_memory.burst_count = burst_count + 1
end

world1_daemon.tasks = {
	walk_into_room = {
		execute = world1_daemon.execute_walk,
		tick = world1_daemon.tick_walk_into_room,
	},
	walk_forward_out_of_room = {
		execute = world1_daemon.execute_walk,
		tick = world1_daemon.tick_walk_forward_out_of_room,
	},
	walk_backward_out_of_room = {
		execute = world1_daemon.execute_walk,
		tick = world1_daemon.tick_walk_backward_out_of_room,
	},
	pounce = {
		execute = world1_daemon.execute_pounce,
		tick = world1_daemon.tick_pounce,
	},
	choose_entrance = {
		execute = world1_daemon.choose_entrance,
	},
}

world1_daemon.services = {
	spawn_attack = spawn_attack_service,
	spawn_zak = {
		on_tick = world1_daemon.spawn_zak,
	},
}

function world1_daemon:apply_damage(request)
	local previous_health<const> = self.health
	local health<const> = previous_health - 1
	self.health = health
	if previous_health > 30 and health <= 30 then
		self.events:emit('daemon.health_half')
	elseif previous_health > 15 and health <= 15 then
		self.events:emit('daemon.health_quarter')
	end
	if health <= 0 then
		self.health = 0
		self.dangerous = false
		return combat_damage.build_applied_result(request, 1, true, 'destroyed')
	end
	return combat_damage.build_applied_result(request, 1, false, 'damaged')
end

function world1_daemon:process_damage_result(result)
	if result.destroyed then
		self.events:emit('daemon.defeated')
	end
end

function world1_daemon:begin_death()
	self.behaviour:stop()
	self.collider:set_enabled(false)
	self:clear_encounter_objects()
	self:set_pose(poses.walk_1)
	self.sprite_component.offset_y = 0
	self.death_visual:set_draw_function(draw_death_overlay)
end

function world1_daemon:spawn_key()
	self.death_visual:set_draw_function(nil)
	self.key = world:spawn('world1_daemon_key', {
		id = 'world1_daemon_key',
		space_id = self.space_id,
		room = self.room,
		player = self.player,
		pos = { x = boss_world1_key_x, y = boss_world1_key_y, z = draw_z_enemy },
		item_id = 'world1_daemon_key',
		item_type = 'keyworld1',
		rs_room_number = self.room.room_number,
	})
	self.key:add_tag('rs')
	self.events:emit('daemon.death_complete')
end

function world1_daemon:ondespawn()
	self:clear_encounter_objects()
	world_object.ondespawn(self)
end

local define_world1_daemon_fsm<const> = function()
	fsm_library.register('world1_daemon', {
		timelines = {
			[timeline_id.prepare_spawn] = {
				def = {
					frames = prepare_spawn_frames,
					frame_duration = boss_world1_pose_frame_ms,
					playback_mode = 'once',
					apply = world1_daemon.set_pose,
				},
				autoplay = false,
			},
			[timeline_id.unprepare_spawn] = {
				def = {
					frames = unprepare_spawn_frames,
					frame_duration = boss_world1_pose_frame_ms,
					playback_mode = 'once',
					apply = world1_daemon.set_pose,
				},
				autoplay = false,
			},
			[timeline_id.prepare_pounce] = {
				def = {
					frames = prepare_pounce_frames,
					frame_duration = boss_world1_pose_frame_ms,
					playback_mode = 'once',
					apply = world1_daemon.set_pose,
				},
				autoplay = false,
			},
			[timeline_id.unprepare_pounce] = {
				def = {
					frames = unprepare_pounce_frames,
					frame_duration = boss_world1_pose_frame_ms,
					playback_mode = 'once',
					apply = world1_daemon.set_pose,
				},
				autoplay = false,
			},
			[timeline_id.death] = {
				def = {
					frames = timeline.range(death_hidden_frame + boss_world1_death_hidden_frames),
					playback_mode = 'once',
					clock_source = timeline_clock_source.frame,
					tracks = {
						{
							kind = 'value',
							interpolation = 'step',
							path = { 'death_stage' },
							keys = death_stage_keys,
						},
						{
							kind = 'value',
							interpolation = 'step',
							path = { 'visible' },
							keys = {
								{ frame = 0, value = true },
								{ frame = death_hidden_frame, value = false },
							},
						},
					},
				},
				autoplay = false,
			},
		},
		initial = 'waiting',
		on = {
			['daemon_appearance'] = {
				emitter = 'd',
				go = '/waiting',
			},
			['daemon_appearance_done'] = {
				emitter = 'd',
				go = '/active',
			},
			['victory_dance_visual_done'] = {
				emitter = 'pietolon',
				go = world1_daemon.clear_key,
			},
			['daemon.defeated'] = '/dying',
		},
		states = {
			waiting = {
				entering_state = world1_daemon.reset_encounter,
			},
			active = {
				entering_state = world1_daemon.activate_encounter,
			},
			dying = {
				entering_state = world1_daemon.begin_death,
				timelines = {
					[timeline_id.death] = {
						autoplay = true,
						stop_on_exit = true,
						play_options = {
							rewind = true,
							snap_to_start = true,
						},
						on_finished = '/key',
					},
				},
			},
			key = {
				entering_state = world1_daemon.spawn_key,
			},
		},
	})
end

local register_world1_daemon_definition<const> = function()
	for index = 1, death_image_count do
		death_images[index] = image.resolve('world1_daemon_death_' .. tostring(index))
	end
	prefab.define({
		def_id = 'world1_daemon_key',
		class = world1_daemon_key,
		base = world_item,
		components = {
			collider_2d_component.new_for_sprite,
			fsm_component.factory({ 'world_item' }),
		},
	})
	prefab.define({
		def_id = 'enemy.daemon',
		class = world1_daemon,
		base = enemy_base,
		components = {
			new_collider,
			behaviour_tree_component.factory(world1_daemon.tree_id),
			custom_visual_component.new,
			timeline_component.new,
			fsm_component.factory({ 'world1_daemon' }),
		},
		defaults = {
			damage = boss_world1_contact_damage,
			max_health = boss_world1_max_health,
			health = boss_world1_max_health,
			dangerous = false,
			direction = 'right',
			enemy_kind = 'world1_daemon',
		},
	})
end

return {
	world1_daemon = world1_daemon,
	define_world1_daemon_fsm = define_world1_daemon_fsm,
	register_world1_daemon_definition = register_world1_daemon_definition,
}

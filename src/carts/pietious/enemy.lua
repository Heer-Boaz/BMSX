local constants = require('constants.lua')
local components = require('components')
local eventemitter = require('eventemitter')
local behaviourtree = require('behaviourtree')
local enemy_explosion_module = require('enemy_explosion.lua')
local mijterfoe_module = require('enemies/mijterfoe.lua')
local zakfoe_module = require('enemies/zakfoe.lua')
local crossfoe_module = require('enemies/crossfoe.lua')
local boekfoe_module = require('enemies/boekfoe.lua')
local paperfoe_module = require('enemies/paperfoe.lua')
local muziekfoe_module = require('enemies/muziekfoe.lua')
local nootfoe_module = require('enemies/nootfoe.lua')
local stafffoe_module = require('enemies/stafffoe.lua')
local staffspawn_module = require('enemies/staffspawn.lua')
local cloud_module = require('enemies/cloud.lua')
local vlokspawner_module = require('enemies/vlokspawner.lua')
local vlokfoe_module = require('enemies/vlokfoe.lua')
local marspeinenaardappel_module = require('enemies/marspeinenaardappel.lua')

local enemy = {}
enemy.__index = enemy

local enemy_fsm_id = constants.ids.enemy_fsm
local enemy_bt_id = constants.ids.enemy_bt

local state_waiting = enemy_fsm_id .. ':/waiting'
local state_flying = enemy_fsm_id .. ':/flying'
local PLAYER_ID = constants.ids.player_instance
local PLAYER_SWORD_TAG = 'pietious.player.group.sword'

local body_sprite_component_id = 'body'
local body_collider_component_id = 'body'

local boekfoe_timeline_id = constants.ids.enemy_def .. '.timeline.boekfoe'
local cloud_timeline_id = constants.ids.enemy_def .. '.timeline.cloud'

local boekfoe_timeline_frames = {
	'boekfoe_closed',
	'boekfoe_open',
}

local cloud_timeline_frames = {
	'cloud_1',
	'cloud_2',
}

local noot_colors = {
	{ r = 1, g = 1, b = 1, a = 1 },
	{ r = 1, g = 0, b = 0, a = 1 },
	{ r = 0, g = 1, b = 1, a = 1 },
	{ r = 0, g = 1, b = 0, a = 1 },
	{ r = 1, g = 0.75, b = 0.8, a = 1 },
	{ r = 1, g = 1, b = 0, a = 1 },
	{ r = 0.93, g = 0.51, b = 0.93, a = 1 },
}

local enemy_kind_modules = {
	mijterfoe = mijterfoe_module,
	zakfoe = zakfoe_module,
	crossfoe = crossfoe_module,
	boekfoe = boekfoe_module,
	paperfoe = paperfoe_module,
	muziekfoe = muziekfoe_module,
	nootfoe = nootfoe_module,
	stafffoe = stafffoe_module,
	staffspawn = staffspawn_module,
	cloud = cloud_module,
	vlokspawner = vlokspawner_module,
	vlokfoe = vlokfoe_module,
	marspeinenaardappel = marspeinenaardappel_module,
}

local function get_kind_module(kind)
	local kind_module = enemy_kind_modules[kind]
	if kind_module == nil then
		error('pietious enemy has no kind module: ' .. tostring(kind))
	end
	return kind_module
end

local death_effect_sequence = 0
local spawned_enemy_sequence = 0

local function random_between(min_value, max_value)
	return math.random(min_value, max_value)
end

local function random_percent_hit(chance_pct)
	return math.random(100) <= chance_pct
end

local function get_delta_from_source_to_target_scaled(source_x, source_y, target_x, target_y, speed_scale)
	local dx = target_x - source_x
	local dy = target_y - source_y
	if dx == 0 then
		return 0, dy > 0 and speed_scale or -speed_scale
	end
	if dy == 0 then
		return dx > 0 and speed_scale or -speed_scale, 0
	end
	local abs_dx = math.abs(dx)
	local abs_dy = math.abs(dy)
	if abs_dx > abs_dy then
		return dx > 0 and speed_scale or -speed_scale, div_toward_zero(dy * speed_scale, abs_dx)
	end
	return div_toward_zero(dx * speed_scale, abs_dy), dy > 0 and speed_scale or -speed_scale
end

local function build_spawned_enemy_id(kind)
	spawned_enemy_sequence = spawned_enemy_sequence + 1
	return string.format('enemy_spawn_%s_%06d', kind, spawned_enemy_sequence)
end

local function consume_axis_accum(accum, speed_num, speed_den)
	accum = accum + speed_num
	local delta = 0
	while accum >= speed_den do
		delta = delta + 1
		accum = accum - speed_den
	end
	while accum <= -speed_den do
		delta = delta - 1
		accum = accum + speed_den
	end
	return delta, accum
end

local function speed_components_from_angle(speed_num, angle_degrees)
	local radians = math.rad(angle_degrees)
	local speed_x_num = round_to_nearest(math.cos(radians) * speed_num)
	local speed_y_num = round_to_nearest(math.sin(radians) * speed_num)
	return speed_x_num, speed_y_num
end

function enemy:is_collision_tile(world_x, world_y)
	local room = self.room
	local tx = math.floor((world_x - room.tile_origin_x) / room.tile_size) + 1
	local ty = math.floor((world_y - room.tile_origin_y) / room.tile_size) + 1
	if tx < 1 or tx > room.tile_columns then
		return true
	end
	if ty < 1 or ty > room.tile_rows then
		return true
	end
	return room.collision_map[ty][tx] ~= 0
end

function enemy:create_components()
	local body_collider = components.collider2dcomponent.new({
		parent = self,
		id_local = body_collider_component_id,
		generateoverlapevents = true,
		spaceevents = 'current',
	})
	body_collider:apply_collision_profile('enemy')
	self:add_component(body_collider)

	local body_sprite = components.spritecomponent.new({
		parent = self,
		id_local = body_sprite_component_id,
		imgid = 'meijter_up',
		offset = { x = 0, y = 0, z = 110 },
		collider_local_id = body_collider_component_id,
	})
	self:add_component(body_sprite)

	self.body_collider = body_collider
	self.body_sprite = body_sprite
end

function enemy:ensure_animation_timelines()
	self:define_timeline(new_timeline({
		id = boekfoe_timeline_id,
		frames = boekfoe_timeline_frames,
		ticks_per_frame = 1,
		playback_mode = 'loop',
	}))
	self:define_timeline(new_timeline({
		id = cloud_timeline_id,
		frames = cloud_timeline_frames,
		ticks_per_frame = constants.enemy.cloud_anim_switch_steps,
		playback_mode = 'loop',
	}))
end

function enemy:set_velocity(speed_x_num, speed_y_num, speed_den)
	self.speed_x_num = speed_x_num
	self.speed_y_num = speed_y_num
	self.speed_den = speed_den
	self.speed_accum_x = 0
	self.speed_accum_y = 0
end

function enemy:move_with_velocity()
	local dx, next_accum_x = consume_axis_accum(self.speed_accum_x, self.speed_x_num, self.speed_den)
	local dy, next_accum_y = consume_axis_accum(self.speed_accum_y, self.speed_y_num, self.speed_den)
	self.speed_accum_x = next_accum_x
	self.speed_accum_y = next_accum_y
	self.x = self.x + dx
	self.y = self.y + dy
end

function enemy:set_body_hit_area(left, top, right, bottom)
	self.body_collider:set_local_area({
		left = left,
		top = top,
		right = right,
		bottom = bottom,
	})
end

function enemy:bind_overlap_events()
	self.events:on({
		event_name = 'overlap.stay',
		subscriber = self,
		handler = function(event)
			self:on_overlap_stay(event)
		end,
	})

	eventemitter.eventemitter.instance:on({
		event = constants.events.room_switched,
		subscriber = self,
		handler = function(event)
			if self.despawn_on_room_switch and event.from == self.room_id then
				self:mark_for_disposal()
			end
		end,
	})
end

function enemy:update_mijter_visual()
	return enemy_kind_modules.mijterfoe.update_visual(self, state_waiting)
end

function enemy:update_zakfoe_visual()
	return enemy_kind_modules.zakfoe.update_visual(self)
end

function enemy:update_crossfoe_visual()
	return enemy_kind_modules.crossfoe.update_visual(self)
end

function enemy:update_boekfoe_visual()
	return enemy_kind_modules.boekfoe.update_visual(self, boekfoe_timeline_id)
end

function enemy:update_paperfoe_visual()
	return enemy_kind_modules.paperfoe.update_visual(self)
end

function enemy:update_muziekfoe_visual()
	return enemy_kind_modules.muziekfoe.update_visual(self)
end

function enemy:update_nootfoe_visual()
	return enemy_kind_modules.nootfoe.update_visual(self)
end

function enemy:update_stafffoe_visual()
	return enemy_kind_modules.stafffoe.update_visual(self)
end

function enemy:update_staffspawn_visual()
	return enemy_kind_modules.staffspawn.update_visual(self)
end

function enemy:update_cloud_visual()
	return enemy_kind_modules.cloud.update_visual(self, cloud_timeline_id)
end

function enemy:update_vlokfoe_visual()
	return enemy_kind_modules.vlokfoe.update_visual(self)
end

function enemy:update_marspeinenaardappel_visual()
	return enemy_kind_modules.marspeinenaardappel.update_visual(self)
end

local visual_methods_by_kind = {
	mijterfoe = 'update_mijter_visual',
	zakfoe = 'update_zakfoe_visual',
	crossfoe = 'update_crossfoe_visual',
	boekfoe = 'update_boekfoe_visual',
	paperfoe = 'update_paperfoe_visual',
	muziekfoe = 'update_muziekfoe_visual',
	nootfoe = 'update_nootfoe_visual',
	stafffoe = 'update_stafffoe_visual',
	staffspawn = 'update_staffspawn_visual',
	cloud = 'update_cloud_visual',
	vlokfoe = 'update_vlokfoe_visual',
	marspeinenaardappel = 'update_marspeinenaardappel_visual',
}

function enemy:update_visual_components()
	local body_sprite = self.body_sprite
	local body_collider = self.body_collider

	if self.kind == 'vlokspawner' then
		body_sprite.enabled = false
		body_collider.enabled = false
		return
	end

	body_sprite.enabled = true
	body_collider.enabled = true

	local visual_method = visual_methods_by_kind[self.kind]
	if visual_method == nil then
		error('pietious enemy has no visual method: ' .. tostring(self.kind))
	end

	local imgid, flip_h, flip_v, color = self[visual_method](self)
	if color == nil then
		color = noot_colors[1]
	end

	body_sprite.imgid = imgid
	body_sprite.flip.flip_h = flip_h
	body_sprite.flip.flip_v = flip_v
	body_sprite.colorize.r = color.r
	body_sprite.colorize.g = color.g
	body_sprite.colorize.b = color.b
	body_sprite.colorize.a = color.a
end

function enemy:spawn_child_enemy(kind, x, y, options)
	local id = build_spawned_enemy_id(kind)
	local child = spawn_object(constants.ids.enemy_def, {
		id = id,
		space_id = self.space_id,
		pos = { x = x, y = y, z = 140 },
	})
	child:configure_from_room_def({
		id = id,
		kind = kind,
		x = x,
		y = y,
		direction = options.direction,
		speedx = options.speedx,
		speedy = options.speedy,
		speedden = options.speedden,
		health = options.health,
		damage = options.damage,
		dangerous = options.dangerous,
		spawned = true,
	}, self.room)
	return child
end

function enemy:projectile_is_out_of_bounds()
	local bound_right = self.projectile_bound_right
	if bound_right <= 0 then
		bound_right = self.width
	end
	local bound_bottom = self.projectile_bound_bottom
	if bound_bottom <= 0 then
		bound_bottom = self.height
	end

	if self.x + bound_right < self.room_left then
		return true
	end
	if self.x > self.room_right then
		return true
	end
	if self.y + bound_bottom < self.room_top then
		return true
	end
	if self.y > self.room_bottom then
		return true
	end
	return false
end

function enemy:bt_tick_mijter_waiting(blackboard)
	return enemy_kind_modules.mijterfoe.bt_tick_waiting(self, blackboard, random_between, state_flying)
end

function enemy:bt_tick_mijter_flying(blackboard)
	return enemy_kind_modules.mijterfoe.bt_tick_flying(self, blackboard, random_between)
end

function enemy:bt_tick_zakfoe(blackboard)
	return enemy_kind_modules.zakfoe.bt_tick(self, blackboard)
end

function enemy:bt_tick_crossfoe_waiting(blackboard)
	return enemy_kind_modules.crossfoe.bt_tick_waiting(self, blackboard, state_flying)
end

function enemy:bt_tick_crossfoe_flying(blackboard)
	return enemy_kind_modules.crossfoe.bt_tick_flying(self, blackboard, state_waiting)
end

function enemy:bt_tick_boekfoe(blackboard)
	return enemy_kind_modules.boekfoe.bt_tick(self, blackboard, random_between)
end

function enemy:bt_tick_paperfoe(_blackboard)
	return enemy_kind_modules.paperfoe.bt_tick(self, _blackboard)
end

function enemy:bt_tick_muziekfoe(blackboard)
	return enemy_kind_modules.muziekfoe.bt_tick(self, blackboard, get_delta_from_source_to_target_scaled, random_between)
end

function enemy:bt_tick_nootfoe(_blackboard)
	return enemy_kind_modules.nootfoe.bt_tick(self, _blackboard)
end

function enemy:bt_tick_stafffoe(blackboard)
	return enemy_kind_modules.stafffoe.bt_tick(self, blackboard, random_between, speed_components_from_angle)
end

function enemy:bt_tick_staffspawn(_blackboard)
	return enemy_kind_modules.staffspawn.bt_tick(self, _blackboard)
end

function enemy:bt_tick_cloud(blackboard)
	return enemy_kind_modules.cloud.bt_tick(self, blackboard)
end

function enemy:bt_tick_vlokspawner(blackboard)
	return enemy_kind_modules.vlokspawner.bt_tick(self, blackboard, random_between)
end

function enemy:bt_tick_vlokfoe(_blackboard)
	return enemy_kind_modules.vlokfoe.bt_tick(self, _blackboard)
end

function enemy:bt_tick_marspeinenaardappel(_blackboard)
	return enemy_kind_modules.marspeinenaardappel.bt_tick(self, _blackboard)
end

function enemy:configure_from_room_def(def, room)
	self.enemy_id = def.id
	self.room_id = room.room_id
	self.room = room
	self.space_id = room.space_id
	self.kind = def.kind
	self.trigger = def.trigger or ''
	self.conditions = def.conditions or {}
	self.spawned = def.spawned == true
	self.spawn_x = def.x
	self.spawn_y = def.y
	self.x = def.x
	self.y = def.y
	self.width = def.w or 16
	self.height = def.h or 16
	self.damage = def.damage or constants.damage.enemy_contact_damage
	self.max_health = def.health or constants.enemy.default_health
	self.health = self.max_health
	self.last_sword_hit_id = -1
	self.last_pepernoot_hit_id = -1
	self.dangerous = def.dangerous ~= false
	self.can_be_hit = true
	self.direction = def.direction or 'right'
	self.horizontal_dir_mod = 0
	self.vertical_dir_mod = 0
	self.room_left = 0
	self.room_right = room.world_width
	self.room_top = room.world_top
	self.room_bottom = room.world_height
	self.current_vertical_speed = 0
	self.zak_state = 'prepare'
	self.zak_ground_y = self.spawn_y
	self.cross_state = 'waiting'
	self.cross_spin_direction = 'down'
	self.mijter_entry_lock_ticks = constants.enemy.mijter_room_entry_lock_steps
	self.boek_state = 'closed'
	self.staff_state = 'default'
	self.staff_spawn_count = 0
	local speed_den = def.speedden or 1
	if speed_den <= 0 then
		error('pietious enemy speedden must be > 0')
	end
	self:set_velocity(def.speedx or 0, def.speedy or 0, speed_den)
	self.despawn_on_room_switch = false
	self.projectile_bound_right = 0
	self.projectile_bound_bottom = 0
	self.noot_color = noot_colors[1]
	self:set_body_hit_area(2, 2, 14, 14)
	local kind_module = get_kind_module(self.kind)
	kind_module.configure(self, def, {
		noot_colors = noot_colors,
		random_between = random_between,
	})

	if self.btreecontexts[enemy_bt_id] then
		self:reset_tree(enemy_bt_id)
	end

	self:stop_timeline(cloud_timeline_id)
	if kind_module.on_configured ~= nil then
		kind_module.on_configured(self, {
			cloud_timeline_id = cloud_timeline_id,
		})
	end

	self.state_variant = 'waiting'
	self.body_collider.enabled = true
	self.visible = true
	self.sc:transition_to(state_waiting)
	self:update_visual_components()
end

function enemy:choose_drop_type()
	local kind_module = get_kind_module(self.kind)
	return kind_module.choose_drop_type(self, random_percent_hit)
end

function enemy:spawn_death_effect()
	death_effect_sequence = death_effect_sequence + 1
	local effect_id = string.format('pietious.enemy_explosion.%s.%d', self.enemy_id, death_effect_sequence)
	spawn_object(enemy_explosion_module.enemy_explosion_def_id, {
		id = effect_id,
		space_id = self.space_id,
		room_id = self.room_id,
		loot_type = self:choose_drop_type(),
		pos = { x = self.x, y = self.y, z = 114 },
	})
end

function enemy:take_sword_hit(sword_id)
	if not self.can_be_hit then
		return false
	end
	if sword_id <= 0 then
		return false
	end
	if self.last_sword_hit_id == sword_id then
		return false
	end
	self.last_sword_hit_id = sword_id
	self.health = self.health - 1
	if self.health <= 0 then
		self.health = 0
		self.dangerous = false
		self:spawn_death_effect()
		eventemitter.eventemitter.instance:emit(constants.events.enemy_defeated, self.id, {
			room_id = self.room_id,
			enemy_id = self.enemy_id,
			kind = self.kind,
			trigger = self.trigger,
		})
		self:mark_for_disposal()
	end
	return true
end

function enemy:take_pepernoot_hit(pepernoot_id)
	if not self.can_be_hit then
		return false
	end
	if pepernoot_id <= 0 then
		return false
	end
	if self.last_pepernoot_hit_id == pepernoot_id then
		return false
	end
	self.last_pepernoot_hit_id = pepernoot_id
	self.health = self.health - 1
	if self.health <= 0 then
		self.health = 0
		self.dangerous = false
		self:spawn_death_effect()
		eventemitter.eventemitter.instance:emit(constants.events.enemy_defeated, self.id, {
			room_id = self.room_id,
			enemy_id = self.enemy_id,
			kind = self.kind,
			trigger = self.trigger,
		})
		self:mark_for_disposal()
	end
	return true
end

function enemy:on_overlap_stay(event)
	if event.other_id ~= PLAYER_ID then
		return
	end
	local player = object(PLAYER_ID)
	local other_collider = player:get_component_by_id(event.other_collider_id)
	if other_collider == nil then
		error('pietious enemy missing collider on overlap event')
	end
	if other_collider.id_local == constants.ids.player_sword_collider_local then
		if player:has_tag(PLAYER_SWORD_TAG) then
			self:take_sword_hit(player.sword_id)
		end
		return
	end
	if other_collider.id_local == constants.ids.player_body_collider_local and self.dangerous then
		player:take_hit(self.damage, self.x + math.floor(self.width / 2), self.y + math.floor(self.height / 2), self.kind)
	end
end

function enemy:tick()
	self:update_visual_components()
end

local function define_enemy_fsm()
	define_fsm(enemy_fsm_id, {
		initial = 'boot',
		states = {
			boot = {
				entering_state = function(self)
					self.state_name = 'boot'
					self.state_variant = 'boot'
					self:create_components()
					self:ensure_animation_timelines()
					self:bind_overlap_events()
					return '/waiting'
				end,
			},
			waiting = {
				entering_state = function(self)
					self.state_name = 'waiting'
					self.state_variant = 'waiting'
					self:update_visual_components()
				end,
			},
			flying = {
				entering_state = function(self)
					self.state_name = 'flying'
					self.state_variant = 'flying'
					self:update_visual_components()
				end,
			},
		},
	})
end

local function bt_kind_action(kind, method)
	return {
		type = 'sequence',
		children = {
			{
				type = 'condition',
				condition = function(target)
					return target.kind == kind
				end,
			},
			{
				type = 'action',
				action = function(target, blackboard)
					return target[method](target, blackboard)
				end,
			},
		},
	}
end

local function define_enemy_behaviour_tree()
	behaviourtree.register_definition(enemy_bt_id, {
		root = {
			type = 'selector',
			children = {
				{
					type = 'sequence',
					children = {
						{
							type = 'condition',
							condition = function(target)
								return target.kind == 'mijterfoe'
							end,
						},
						{
							type = 'selector',
							children = {
								{
									type = 'sequence',
									children = {
										{
											type = 'condition',
											condition = function(target)
												return target.sc:matches_state_path(state_waiting)
											end,
										},
										{
											type = 'action',
											action = function(target, blackboard)
												return target:bt_tick_mijter_waiting(blackboard)
											end,
										},
									},
								},
								{
									type = 'sequence',
									children = {
										{
											type = 'condition',
											condition = function(target)
												return target.sc:matches_state_path(state_flying)
											end,
										},
										{
											type = 'action',
											action = function(target, blackboard)
												return target:bt_tick_mijter_flying(blackboard)
											end,
										},
									},
								},
							},
						},
					},
				},
				bt_kind_action('zakfoe', 'bt_tick_zakfoe'),
				{
					type = 'sequence',
					children = {
						{
							type = 'condition',
							condition = function(target)
								return target.kind == 'crossfoe'
							end,
						},
						{
							type = 'selector',
							children = {
								{
									type = 'sequence',
									children = {
										{
											type = 'condition',
											condition = function(target)
												return target.sc:matches_state_path(state_waiting)
											end,
										},
										{
											type = 'action',
											action = function(target, blackboard)
												return target:bt_tick_crossfoe_waiting(blackboard)
											end,
										},
									},
								},
								{
									type = 'sequence',
									children = {
										{
											type = 'condition',
											condition = function(target)
												return target.sc:matches_state_path(state_flying)
											end,
										},
										{
											type = 'action',
											action = function(target, blackboard)
												return target:bt_tick_crossfoe_flying(blackboard)
											end,
										},
									},
								},
							},
						},
					},
				},
				bt_kind_action('boekfoe', 'bt_tick_boekfoe'),
				bt_kind_action('paperfoe', 'bt_tick_paperfoe'),
				bt_kind_action('muziekfoe', 'bt_tick_muziekfoe'),
				bt_kind_action('nootfoe', 'bt_tick_nootfoe'),
				bt_kind_action('stafffoe', 'bt_tick_stafffoe'),
				bt_kind_action('staffspawn', 'bt_tick_staffspawn'),
				bt_kind_action('cloud', 'bt_tick_cloud'),
				bt_kind_action('vlokspawner', 'bt_tick_vlokspawner'),
				bt_kind_action('vlokfoe', 'bt_tick_vlokfoe'),
				bt_kind_action('marspeinenaardappel', 'bt_tick_marspeinenaardappel'),
			},
		},
	})
end

local function register_enemy_definition()
	define_world_object({
		def_id = constants.ids.enemy_def,
		class = enemy,
		fsms = { enemy_fsm_id },
		bts = { enemy_bt_id },
		defaults = {
			space_id = constants.spaces.castle,
			enemy_id = '',
			room_id = '',
			room = nil,
			kind = 'mijterfoe',
			trigger = '',
			conditions = {},
			spawned = false,
			width = 16,
			height = 16,
			damage = constants.damage.enemy_contact_damage,
			max_health = constants.enemy.default_health,
			health = constants.enemy.default_health,
			last_sword_hit_id = -1,
			last_pepernoot_hit_id = -1,
			dangerous = true,
			can_be_hit = true,
			horizontal_dir_mod = 0,
			vertical_dir_mod = 0,
			room_left = 0,
			room_right = constants.room.width,
			room_top = constants.room.hud_height,
			room_bottom = constants.room.height,
			spawn_x = 0,
			spawn_y = 0,
			current_vertical_speed = 0,
			zak_state = 'prepare',
			zak_ground_y = 0,
			cross_state = 'waiting',
			cross_spin_direction = 'down',
			mijter_entry_lock_ticks = constants.enemy.mijter_room_entry_lock_steps,
			boek_state = 'closed',
			staff_state = 'default',
			staff_spawn_count = 0,
			speed_x_num = 0,
			speed_y_num = 0,
			speed_den = 1,
			speed_accum_x = 0,
			speed_accum_y = 0,
			despawn_on_room_switch = false,
			projectile_bound_right = 0,
			projectile_bound_bottom = 0,
			noot_color = { r = 1, g = 1, b = 1, a = 1 },
			state_name = 'boot',
			state_variant = 'boot',
		},
	})
end

return {
	enemy = enemy,
	define_enemy_fsm = define_enemy_fsm,
	define_enemy_behaviour_tree = define_enemy_behaviour_tree,
	register_enemy_definition = register_enemy_definition,
	enemy_def_id = constants.ids.enemy_def,
	enemy_fsm_id = enemy_fsm_id,
	enemy_bt_id = enemy_bt_id,
}

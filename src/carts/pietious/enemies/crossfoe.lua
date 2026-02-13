local constants = require('constants')
local behaviourtree = require('behaviourtree')
local eventemitter = require('eventemitter')
local enemy_explosion_module = require('enemy_explosion')

local crossfoe = {}
crossfoe.__index = crossfoe

local function apply_spin_visual(self)
	local imgid
	local flip_h
	local flip_v
	if self.cross_spin_direction == 'left' then
		imgid = 'crossfoe_turned'
		flip_h = false
		flip_v = false
	elseif self.cross_spin_direction == 'right' then
		imgid = 'crossfoe_turned'
		flip_h = true
		flip_v = false
	elseif self.cross_spin_direction == 'up' then
		imgid = 'crossfoe'
		flip_h = false
		flip_v = true
	else
		imgid = 'crossfoe'
		flip_h = false
		flip_v = false
	end
	self:set_image(imgid)
	self.sprite_component.flip.flip_h = flip_h
	self.sprite_component.flip.flip_v = flip_v
end

function crossfoe.configure(self, def)
	self.cross_state = 'waiting'
	self.cross_spin_direction = 'down'
	apply_spin_visual(self)
end

function crossfoe.bt_tick_waiting(self, blackboard)
	local player = object(constants.ids.player_instance)
	local node = blackboard.nodedata
	apply_spin_visual(self)
	local wait_ticks = node.cross_wait_ticks
	if wait_ticks == nil then
		wait_ticks = constants.enemy.cross_wait_before_fly_steps
	end
	wait_ticks = wait_ticks - 1
	if wait_ticks > 0 then
		node.cross_wait_ticks = wait_ticks
		return behaviourtree.running
	end

	node.cross_wait_ticks = constants.enemy.cross_wait_before_fly_steps
	node.cross_turn_ticks = constants.enemy.cross_turn_steps
	if player.x < self.x then
		self.cross_state = 'flying_left'
	else
		self.cross_state = 'flying_right'
	end
	self.cross_spin_direction = 'left'
	apply_spin_visual(self)
	self:dispatch_state_event('takeoff')
	return behaviourtree.running
end

function crossfoe.bt_tick_flying(self, blackboard)
	local player = object(constants.ids.player_instance)
	local node = blackboard.nodedata
	apply_spin_visual(self)
	local direction_mod = self.cross_state == 'flying_left' and -1 or 1
	local next_x = self.x + (constants.enemy.cross_horizontal_speed_px * direction_mod)
	local next_left = next_x
	local next_right = next_x + self.sx

	if (self.cross_state == 'flying_left' and self.x < (player.x - player.width))
		or (self.cross_state == 'flying_right' and self.x > (player.x + (player.width * 2)))
		or next_left < 0
		or next_right > service(constants.ids.castle_service_instance).current_room.world_width
	then
		self.cross_state = 'waiting'
		self.cross_spin_direction = 'down'
		self.x = self.x - (constants.enemy.cross_horizontal_speed_px * direction_mod)
		node.cross_wait_ticks = constants.enemy.cross_wait_before_fly_steps
		node.cross_turn_ticks = constants.enemy.cross_turn_steps
		self:dispatch_state_event('land')
		return behaviourtree.running
	end

	self.x = self.x + (constants.enemy.cross_horizontal_speed_px * direction_mod)

	local turn_ticks = node.cross_turn_ticks
	if turn_ticks == nil then
		turn_ticks = constants.enemy.cross_turn_steps
	end
	turn_ticks = turn_ticks - 1
	if turn_ticks > 0 then
		node.cross_turn_ticks = turn_ticks
		return behaviourtree.running
	end

	turn_ticks = constants.enemy.cross_turn_steps
	if self.cross_spin_direction == 'down' then
		self.cross_spin_direction = 'left'
		self.x = self.x - 4
	elseif self.cross_spin_direction == 'left' then
		self.cross_spin_direction = 'up'
		self.x = self.x + 4
	elseif self.cross_spin_direction == 'up' then
		self.cross_spin_direction = 'right'
		self.x = self.x - 4
	else
		self.cross_spin_direction = 'down'
		self.x = self.x + 4
	end
	apply_spin_visual(self)
	node.cross_turn_ticks = turn_ticks
	return behaviourtree.running
end

function crossfoe.register_behaviour_tree(bt_id)
	behaviourtree.register_definition(bt_id, {
		root = {
			type = 'selector',
			children = {
				{
					type = 'sequence',
					children = {
						{
							type = 'condition',
							condition = function(target)
								return target:has_tag('e.w')
							end,
						},
						{
							type = 'action',
							action = function(target, blackboard)
								return crossfoe.bt_tick_waiting(target, blackboard)
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
								return target:has_tag('e.f')
							end,
						},
						{
							type = 'action',
							action = function(target, blackboard)
								return crossfoe.bt_tick_flying(target, blackboard)
							end,
						},
					},
				},
			},
		},
	})
end

function crossfoe.choose_drop_type(_self)
	if math.random(100) <= constants.enemy.cross_drop_health_chance_pct then
		return 'life'
	end
	if math.random(100) <= constants.enemy.cross_drop_ammo_chance_pct then
		return 'ammo'
	end
	return 'none'
end




local enemy_death_effect_sequence = 0

local function enemy_consume_axis_accum(accum, speed_num, speed_den)
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


function crossfoe:configure_from_room_def(def, room)
		self.space_id = room.space_id
		self.trigger = def.trigger or ''
	self.conditions = def.conditions or {}
		self.damage = constants.damage.enemy_contact_damage
	self.max_health = constants.enemy.default_health
	self.health = self.max_health
	self.last_weapon_kind = ''
	self.last_weapon_hit_id = -1
	self.dangerous = def.dangerous ~= false
	self.direction = def.direction or 'right'
	self.despawn_on_room_switch = false

	self:set_velocity(def.speedx or 0, def.speedy or 0, def.speedden or 1)

	crossfoe.configure(self, def)
	self:dispatch_state_event('reset_to_waiting')
	self.collider.generateoverlapevents = true
	self.collider.spaceevents = 'current'
	self.collider:apply_collision_profile('enemy')
	self.collider:set_shape_offset(0, 0)
	self.sprite_component.offset.z = 110
end

function crossfoe:bind_overlap_events()
	self.events:on({
		event_name = 'overlap',
		subscriber = self,
		handler = function(event)
			self:on_overlap(event)
		end,
	})

	eventemitter.eventemitter.instance:on({
		event = constants.events.room_switched,
		subscriber = self,
		handler = function(event)
			if self.despawn_on_room_switch then
				self:mark_for_disposal()
			end
		end,
	})
end
function crossfoe:projectile_is_out_of_bounds()
	local bound_right = self.projectile_bound_right
	if bound_right <= 0 then
		bound_right = self.sx
	end
	local bound_bottom = self.projectile_bound_bottom
	if bound_bottom <= 0 then
		bound_bottom = self.sy
	end

	if self.x + bound_right < 0 then
		return true
	end
	if self.x > service(constants.ids.castle_service_instance).current_room.world_width then
		return true
	end
	if self.y + bound_bottom < service(constants.ids.castle_service_instance).current_room.world_top then
		return true
	end
	if self.y > service(constants.ids.castle_service_instance).current_room.world_height then
		return true
	end
	return false
end

function crossfoe:set_velocity(speed_x_num, speed_y_num, speed_den)
	self.speed_x_num = speed_x_num
	self.speed_y_num = speed_y_num
	self.speed_den = speed_den
	self.speed_accum_x = 0
	self.speed_accum_y = 0
end

function crossfoe:move_with_velocity()
	local dx, next_accum_x = enemy_consume_axis_accum(self.speed_accum_x, self.speed_x_num, self.speed_den)
	local dy, next_accum_y = enemy_consume_axis_accum(self.speed_accum_y, self.speed_y_num, self.speed_den)
	self.speed_accum_x = next_accum_x
	self.speed_accum_y = next_accum_y
	self.x = self.x + dx
	self.y = self.y + dy
end

function crossfoe:spawn_death_effect()
	enemy_death_effect_sequence = enemy_death_effect_sequence + 1
	spawn_object(enemy_explosion_module.enemy_explosion_def_id, {
		space_id = self.space_id,
		room_number = service(constants.ids.castle_service_instance).current_room.room_number,
		loot_type = self:choose_drop_type(),
		pos = { x = self.x, y = self.y, z = 114 },
	})
end

function crossfoe:take_weapon_hit(weapon_kind, hit_id)
	if self.last_weapon_kind == weapon_kind and self.last_weapon_hit_id == hit_id then
		return false
	end
	self.last_weapon_kind = weapon_kind
	self.last_weapon_hit_id = hit_id
	self.health = self.health - 1
	if self.health <= 0 then
		self.health = 0
		self.dangerous = false
		self:spawn_death_effect()
		eventemitter.eventemitter.instance:emit(constants.events.enemy_defeated, self.id, {
			room_number = service(constants.ids.castle_service_instance).current_room.room_number,
			enemy_id = self.id,
			kind = 'crossfoe',
			trigger = self.trigger,
		})
		self:mark_for_disposal()
	end
	return true
end

function crossfoe:on_overlap(event)
	if event.other_id ~= constants.ids.player_instance then
		return
	end
	local player = object(constants.ids.player_instance)
	local other_collider = player:get_component_by_id(event.other_collider_id)
	if other_collider.id_local == constants.ids.player_sword_collider_local then
		if player:has_tag('g.sw') then
			self:take_weapon_hit('sword', player.sword_id)
		end
		return
	end
	if other_collider.id_local == constants.ids.player_body_collider_local and self.dangerous then
		player:take_hit(self.damage, self.x + math.modf(self.sx / 2), self.y + math.modf(self.sy / 2), 'crossfoe')
	end
end

function crossfoe.register_enemy_definition()
	define_prefab({
		def_id = 'pietious.enemy.def.crossfoe',
		class = crossfoe,
		fsms = { constants.ids.enemy_fsm },
		defaults = {
			space_id = constants.spaces.castle,
			trigger = '',
			conditions = {},
			damage = constants.damage.enemy_contact_damage,
			max_health = constants.enemy.default_health,
			health = constants.enemy.default_health,
			last_weapon_kind = '',
			last_weapon_hit_id = -1,
			dangerous = true,
			speed_x_num = 0,
			speed_y_num = 0,
			speed_den = 1,
			speed_accum_x = 0,
			speed_accum_y = 0,
			direction = 'right',
			despawn_on_room_switch = false,
		},
	})
end

crossfoe.enemy_def_id = 'pietious.enemy.def.crossfoe'


return crossfoe

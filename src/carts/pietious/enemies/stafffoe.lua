local constants = require('constants')
local behaviourtree = require('behaviourtree')
local eventemitter = require('eventemitter')
local enemy_explosion_module = require('enemy_explosion')

local stafffoe = {}
stafffoe.__index = stafffoe

local function speed_components_from_angle(speed_num, angle_degrees)
	local radians = math.rad(angle_degrees)
	local speed_x_num = round_to_nearest(math.cos(radians) * speed_num)
	local speed_y_num = round_to_nearest(math.sin(radians) * speed_num)
	return speed_x_num, speed_y_num
end

function stafffoe.configure(self, def)
	self.max_health = 10
	self.health = self.max_health
	self.damage = 4
	self.staff_state = 'default'
	self.staff_spawn_count = 0
	self:gfx('stafffoe')
end

function stafffoe.bt_tick(self, blackboard)
	local node = blackboard.nodedata
	local room = service(constants.ids.castle_service_instance).current_room
	if self.staff_state == 'default' then
		local wait_ticks = node.staff_wait_ticks
		if wait_ticks == nil then
			wait_ticks = constants.enemy.staff_wait_before_spawn_state_steps
		end
		wait_ticks = wait_ticks - 1
		if wait_ticks > 0 then
			node.staff_wait_ticks = wait_ticks
			return behaviourtree.running
		end
		self.staff_state = 'spawning'
		self.staff_spawn_count = 0
		node.staff_wait_ticks = constants.enemy.staff_wait_before_spawn_steps
		return behaviourtree.running
	end

	if self.staff_spawn_count >= constants.enemy.staff_spawn_burst_count then
		self.staff_state = 'default'
		node.staff_wait_ticks = constants.enemy.staff_wait_before_spawn_state_steps
		return behaviourtree.running
	end

	local spawn_wait = node.staff_wait_ticks
	if spawn_wait == nil then
		spawn_wait = constants.enemy.staff_wait_before_spawn_steps
	end
	spawn_wait = spawn_wait - 1
	if spawn_wait > 0 then
		node.staff_wait_ticks = spawn_wait
		return behaviourtree.running
	end

	local player = object(constants.ids.player_instance)
	local bullets_dangerous = not player:has_inventory_item('greenvase')
	local base_angle = math.random(0, 359)
	for i = 0, 3 do
		local angle = (base_angle + (i * 90)) % 360
		local speed_x_num, speed_y_num = speed_components_from_angle(constants.enemy.staff_bullet_speed_num, angle)
	local spawned_staff = inst('pietious.enemy.def.staffspawn', {
		space_id = room.space_id,
		despawn_on_room_switch = true,
		pos = {
			x = self.x,
			y = self.y,
			z = 140,
		},
		})
		spawned_staff:configure_from_room_def({
			id = spawned_staff.id,
			kind = 'staffspawn',
			x = self.x,
			y = self.y,
			direction = speed_x_num < 0 and 'left' or 'right',
			speedx = speed_x_num,
			speedy = speed_y_num,
			speedden = constants.enemy.staff_bullet_speed_den,
			dangerous = bullets_dangerous,
		}, room)
	end
	self.staff_spawn_count = self.staff_spawn_count + 1
	node.staff_wait_ticks = constants.enemy.staff_wait_before_spawn_steps
	return behaviourtree.running
end

function stafffoe.register_behaviour_tree(bt_id)
	behaviourtree.register_definition(bt_id, {
		root = {
			type = 'action',
			action = function(target, blackboard)
				return stafffoe.bt_tick(target, blackboard)
			end,
		},
	})
end

function stafffoe.choose_drop_type(_self)
	return 'life'
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


function stafffoe:configure_from_room_def(def, room)
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

	stafffoe.configure(self, def)
	self:dispatch_state_event('reset_to_waiting')
	self.collider.generateoverlapevents = true
	self.collider.spaceevents = 'current'
	self.collider:apply_collision_profile('enemy')
	self.collider:set_shape_offset(0, 0)
	self.sprite_component.offset.z = 110
end

function stafffoe:bind_overlap_events()
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
function stafffoe:projectile_is_out_of_bounds()
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

function stafffoe:set_velocity(speed_x_num, speed_y_num, speed_den)
	self.speed_x_num = speed_x_num
	self.speed_y_num = speed_y_num
	self.speed_den = speed_den
	self.speed_accum_x = 0
	self.speed_accum_y = 0
end

function stafffoe:move_with_velocity()
	local dx, next_accum_x = enemy_consume_axis_accum(self.speed_accum_x, self.speed_x_num, self.speed_den)
	local dy, next_accum_y = enemy_consume_axis_accum(self.speed_accum_y, self.speed_y_num, self.speed_den)
	self.speed_accum_x = next_accum_x
	self.speed_accum_y = next_accum_y
	self.x = self.x + dx
	self.y = self.y + dy
end

function stafffoe:spawn_death_effect()
	enemy_death_effect_sequence = enemy_death_effect_sequence + 1
	local room_space = service(constants.ids.castle_service_instance).current_room.space_id
	inst(enemy_explosion_module.enemy_explosion_def_id, {
		room_number = service(constants.ids.castle_service_instance).current_room.room_number,
		loot_type = self:choose_drop_type(),
		space_id = room_space,
		pos = { x = self.x, y = self.y, z = 114 },
	})
end

function stafffoe:take_weapon_hit(weapon_kind, hit_id)
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
				kind = 'stafffoe',
				trigger = self.trigger,
			})
		self:mark_for_disposal()
	end
	return true
end

function stafffoe:on_overlap(event)
	if event.other_id ~= constants.ids.player_instance then
		return
	end
	local player = object(constants.ids.player_instance)
	if player:has_tag('g.sw') then
		self:take_weapon_hit('sword', player.sword_id)
		return
	end
	if self.dangerous then
		player:take_hit(self.damage, self.x + math.modf(self.sx / 2), self.y + math.modf(self.sy / 2), 'stafffoe')
	end
end

function stafffoe.register_enemy_definition()
	define_prefab({
		def_id = 'pietious.enemy.def.stafffoe',
		class = stafffoe,
		type = 'sprite',
		fsms = { constants.ids.enemy_fsm },
		defaults = {
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

stafffoe.enemy_def_id = 'pietious.enemy.def.stafffoe'


return stafffoe

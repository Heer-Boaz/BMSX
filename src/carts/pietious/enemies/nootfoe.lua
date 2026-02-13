local behaviourtree = require('behaviourtree')
local constants = require('constants')
local eventemitter = require('eventemitter')
local enemy_explosion_module = require('enemy_explosion')

local nootfoe = {}
nootfoe.__index = nootfoe

local noot_colors = {
	{ r = 1, g = 1, b = 1, a = 1 },
	{ r = 1, g = 0, b = 0, a = 1 },
	{ r = 0, g = 1, b = 1, a = 1 },
	{ r = 0, g = 1, b = 0, a = 1 },
	{ r = 1, g = 0.75, b = 0.8, a = 1 },
	{ r = 1, g = 1, b = 0, a = 1 },
	{ r = 0.93, g = 0.51, b = 0.93, a = 1 },
}

function nootfoe.configure(self, def)
	self.max_health = 1
	self.health = self.max_health
	self.damage = 2
	self.despawn_on_room_switch = true
	self.noot_color = noot_colors[math.random(1, #noot_colors)]
	self:set_image('muzieknootfoe')
	self.sprite_component.colorize = self.noot_color
end

function nootfoe.bt_tick(self, _blackboard)
	self:move_with_velocity()
	if self:projectile_is_out_of_bounds() then
		self:mark_for_disposal()
	end
	return behaviourtree.running
end

function nootfoe.register_behaviour_tree(bt_id)
	behaviourtree.register_definition(bt_id, {
		root = {
			type = 'action',
			action = function(target, blackboard)
				return nootfoe.bt_tick(target, blackboard)
			end,
		},
	})
end

function nootfoe.choose_drop_type(_self)
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


function nootfoe:configure_from_room_def(def, room)
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

	nootfoe.configure(self, def)
	self:dispatch_state_event('reset_to_waiting')
	self.collider.generateoverlapevents = true
	self.collider.spaceevents = 'current'
	self.collider:apply_collision_profile('enemy')
	self.collider:set_shape_offset(0, 0)
	self.sprite_component.offset.z = 110
end

function nootfoe:bind_overlap_events()
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
function nootfoe:projectile_is_out_of_bounds()
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

function nootfoe:set_velocity(speed_x_num, speed_y_num, speed_den)
	self.speed_x_num = speed_x_num
	self.speed_y_num = speed_y_num
	self.speed_den = speed_den
	self.speed_accum_x = 0
	self.speed_accum_y = 0
end

function nootfoe:move_with_velocity()
	local dx, next_accum_x = enemy_consume_axis_accum(self.speed_accum_x, self.speed_x_num, self.speed_den)
	local dy, next_accum_y = enemy_consume_axis_accum(self.speed_accum_y, self.speed_y_num, self.speed_den)
	self.speed_accum_x = next_accum_x
	self.speed_accum_y = next_accum_y
	self.x = self.x + dx
	self.y = self.y + dy
end

function nootfoe:spawn_death_effect()
	enemy_death_effect_sequence = enemy_death_effect_sequence + 1
	spawn_object(enemy_explosion_module.enemy_explosion_def_id, {
		room_number = service(constants.ids.castle_service_instance).current_room.room_number,
		loot_type = self:choose_drop_type(),
		pos = { x = self.x, y = self.y, z = 114 },
	})
end

function nootfoe:take_weapon_hit(weapon_kind, hit_id)
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
				kind = 'nootfoe',
				trigger = self.trigger,
			})
		self:mark_for_disposal()
	end
	return true
end

function nootfoe:on_overlap(event)
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
		player:take_hit(self.damage, self.x + math.modf(self.sx / 2), self.y + math.modf(self.sy / 2), 'nootfoe')
	end
end

function nootfoe.register_enemy_definition()
	define_prefab({
		def_id = 'pietious.enemy.def.nootfoe',
		class = nootfoe,
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

nootfoe.enemy_def_id = 'pietious.enemy.def.nootfoe'


return nootfoe

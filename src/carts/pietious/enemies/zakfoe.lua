local constants = require('constants')
local behaviourtree = require('behaviourtree')
local room_module = require('room')
local eventemitter = require('eventemitter')
local enemy_explosion_module = require('enemy_explosion')

local zakfoe = {}
zakfoe.__index = zakfoe

function zakfoe:ctor()
	self:bind_overlap_events()
end

function zakfoe.configure(self, _def)
	self.zak_state = 'prepare'
	self.current_vertical_speed = 0
	self.zak_ground_y = self.y
	self:gfx('zakfoe_stand')
	self.sprite_component.flip.flip_h = self.direction == 'left'
end

function zakfoe.bt_tick(self, blackboard)
	local node = blackboard.nodedata

	if self.zak_state == 'prepare' then
		local prepare_ticks = node.zak_prepare_ticks
		if prepare_ticks == nil then
			prepare_ticks = constants.enemy.zak_prepare_jump_steps
		end
		prepare_ticks = prepare_ticks - 1
		if prepare_ticks > 0 then
			node.zak_prepare_ticks = prepare_ticks
			return behaviourtree.running
		end
		node.zak_prepare_ticks = nil
		self.current_vertical_speed = constants.enemy.zak_vertical_speed_start
		self.zak_ground_y = self.y
		self.zak_state = 'jump'
		node.zak_jump_ticks = constants.enemy.zak_jump_steps
		self:gfx('zakfoe_jump')
		self.sprite_component.flip.flip_h = self.direction == 'left'
		return behaviourtree.running
	end

	if self.zak_state == 'jump' then
		local jump_ticks = node.zak_jump_ticks
		if jump_ticks == nil then
			jump_ticks = constants.enemy.zak_jump_steps
		end

		local direction_mod = self.direction == 'right' and 1 or -1
		self.x = self.x + (constants.enemy.zak_horizontal_speed_px * direction_mod)
		self.y = self.y + self.current_vertical_speed
		self.current_vertical_speed = self.current_vertical_speed + constants.enemy.zak_vertical_speed_step

		if self.direction == 'left' then
			if self.x < 0
				or room_module.is_solid_at_world(service(constants.ids.castle_service_instance).current_room, self.x + 2, self.y + 2)
				or not room_module.is_solid_at_world(service(constants.ids.castle_service_instance).current_room, self.x + 2 - constants.room.tile_half, self.y + 14 + constants.room.tile_size)
			then
				self.direction = 'right'
			end
		else
			if self.x + 14 >= service(constants.ids.castle_service_instance).current_room.world_width
				or room_module.is_solid_at_world(service(constants.ids.castle_service_instance).current_room, self.x + 14, self.y + 2)
				or not room_module.is_solid_at_world(service(constants.ids.castle_service_instance).current_room, self.x + 14 + constants.room.tile_half, self.y + 14 + constants.room.tile_size)
			then
				self.direction = 'left'
			end
		end

		jump_ticks = jump_ticks - 1
		if jump_ticks > 0 then
			node.zak_jump_ticks = jump_ticks
			return behaviourtree.running
		end
		node.zak_jump_ticks = nil
		self.y = self.zak_ground_y
		self.zak_state = 'recovery'
		self:gfx('zakfoe_recover')
		self.sprite_component.flip.flip_h = self.direction == 'left'
		node.zak_recovery_ticks = constants.enemy.zak_recovery_steps
		return behaviourtree.running
	end

	local recovery_ticks = node.zak_recovery_ticks
	if recovery_ticks == nil then
		recovery_ticks = constants.enemy.zak_recovery_steps
	end
	recovery_ticks = recovery_ticks - 1
	if recovery_ticks > 0 then
		node.zak_recovery_ticks = recovery_ticks
		return behaviourtree.running
	end
	node.zak_recovery_ticks = nil
	self.zak_state = 'prepare'
	self:gfx('zakfoe_stand')
	self.sprite_component.flip.flip_h = self.direction == 'left'
	node.zak_prepare_ticks = constants.enemy.zak_prepare_jump_steps
	return behaviourtree.running
end

function zakfoe.register_behaviour_tree(bt_id)
	behaviourtree.register_definition(bt_id, {
		root = {
			type = 'action',
			action = function(target, blackboard)
				return zakfoe.bt_tick(target, blackboard)
			end,
		},
	})
end

function zakfoe.choose_drop_type(_self)
	if math.random(100) <= constants.enemy.zak_drop_health_chance_pct then
		return 'life'
	end
	if math.random(100) <= constants.enemy.zak_drop_ammo_chance_pct then
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


function zakfoe:configure_from_room_def(def, room)
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

	zakfoe.configure(self, def)
	self:dispatch_state_event('reset_to_waiting')
	self.collider.generateoverlapevents = true
	self.collider.spaceevents = 'current'
	self.collider:apply_collision_profile('enemy')
	self.collider:set_shape_offset(0, 0)
	self.sprite_component.offset.z = 110
end

function zakfoe:bind_overlap_events()
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
function zakfoe:projectile_is_out_of_bounds()
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

function zakfoe:set_velocity(speed_x_num, speed_y_num, speed_den)
	self.speed_x_num = speed_x_num
	self.speed_y_num = speed_y_num
	self.speed_den = speed_den
	self.speed_accum_x = 0
	self.speed_accum_y = 0
end

function zakfoe:move_with_velocity()
	local dx, next_accum_x = enemy_consume_axis_accum(self.speed_accum_x, self.speed_x_num, self.speed_den)
	local dy, next_accum_y = enemy_consume_axis_accum(self.speed_accum_y, self.speed_y_num, self.speed_den)
	self.speed_accum_x = next_accum_x
	self.speed_accum_y = next_accum_y
	self.x = self.x + dx
	self.y = self.y + dy
end

function zakfoe:spawn_death_effect()
	local room = service(constants.ids.castle_service_instance).current_room
	enemy_death_effect_sequence = enemy_death_effect_sequence + 1
	inst(enemy_explosion_module.enemy_explosion_def_id, {
		room_number = room.room_number,
		loot_type = self:choose_drop_type(),
		space_id = room.space_id,
		pos = { x = self.x, y = self.y, z = 114 },
	})
end

function zakfoe:take_weapon_hit(weapon_kind, hit_id)
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
				kind = 'zakfoe',
				trigger = self.trigger,
			})
		self:mark_for_disposal()
	end
	return true
end

function zakfoe:on_overlap(event)
	if event.other_id ~= constants.ids.player_instance then
		return
	end
	local player = object(constants.ids.player_instance)
	if player:has_tag('g.sw') then
		self:take_weapon_hit('sword', player.sword_id)
		return
	end
	if self.dangerous then
		player:take_hit(self.damage, self.x + math.modf(self.sx / 2), self.y + math.modf(self.sy / 2), 'zakfoe')
	end
end

function zakfoe.register_enemy_definition()
	define_prefab({
		def_id = 'pietious.enemy.def.zakfoe',
		class = zakfoe,
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

zakfoe.enemy_def_id = 'pietious.enemy.def.zakfoe'


return zakfoe

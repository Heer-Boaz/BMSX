local constants = require('constants')
local behaviourtree = require('behaviourtree')
local room_module = require('room')
local eventemitter = require('eventemitter')
local enemy_explosion_module = require('enemy_explosion')

local muziekfoe = {}
muziekfoe.__index = muziekfoe

function muziekfoe:ctor()
	self:bind_overlap_events()
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

function muziekfoe.configure(self, def)
	self.max_health = 3
	self.health = self.max_health
	self.damage = 4
	self:gfx('muziekfoe')
end

function muziekfoe.bt_tick(self, blackboard)
	local node = blackboard.nodedata
	local room = service(constants.ids.castle_service_instance).current_room
	local dir_modifier = self.direction == 'left' and -1 or 1
	local move_accum = node.muziek_move_accum
	if move_accum == nil then
		move_accum = 0
	end
	move_accum = move_accum + constants.enemy.muziek_horizontal_speed_num
	while move_accum >= constants.enemy.muziek_horizontal_speed_den do
		self.x = self.x + dir_modifier
		move_accum = move_accum - constants.enemy.muziek_horizontal_speed_den
	end
	node.muziek_move_accum = move_accum

	if self.direction == 'left' then
		if self.x < 0 or room_module.is_solid_at_world(service(constants.ids.castle_service_instance).current_room, self.x, self.y) then
			self.direction = 'right'
		end
	else
		if self.x + 24 >= service(constants.ids.castle_service_instance).current_room.world_width or room_module.is_solid_at_world(service(constants.ids.castle_service_instance).current_room, self.x + 24, self.y + 16) then
			self.direction = 'left'
		end
	end

	local noot_ticks = node.muziek_noot_ticks
	if noot_ticks == nil then
		noot_ticks = constants.enemy.muziek_spawn_noot_steps
	end
	noot_ticks = noot_ticks - 1
	if noot_ticks <= 0 then
		local player = object(constants.ids.player_instance)
		local source_x = self.x + 12
		local source_y = self.y + 8
		local target_x = player.x
		local target_y = player.y + player.height
		local delta_scale = 8
		local delta_x, delta_y = get_delta_from_source_to_target_scaled(source_x, source_y, target_x, target_y, delta_scale)
		local delta_divisor = math.random(1, 2)
	local spawned_noot = inst('pietious.enemy.def.nootfoe', {
		space_id = room.space_id,
		despawn_on_room_switch = true,
		pos = {
			x = self.x + 12,
			y = self.y,
			z = 140,
		},
		})
		spawned_noot:configure_from_room_def({
			id = spawned_noot.id,
			kind = 'nootfoe',
			x = self.x + 12,
			y = self.y,
			direction = delta_x < 0 and 'left' or 'right',
			speedx = delta_x,
			speedy = delta_y,
			speedden = delta_scale * delta_divisor,
		}, room)
		noot_ticks = constants.enemy.muziek_spawn_noot_steps
	end
	node.muziek_noot_ticks = noot_ticks
	return behaviourtree.running
end

function muziekfoe.register_behaviour_tree(bt_id)
	behaviourtree.register_definition(bt_id, {
		root = {
			type = 'action',
			action = function(target, blackboard)
				return muziekfoe.bt_tick(target, blackboard)
			end,
		},
	})
end

function muziekfoe.choose_drop_type(_self)
	if math.random(100) <= constants.enemy.muziek_drop_health_chance_pct then
		return 'life'
	end
	if math.random(100) <= constants.enemy.muziek_drop_ammo_chance_pct then
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


function muziekfoe:configure_from_room_def(def, room)
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

	muziekfoe.configure(self, def)
	self:dispatch_state_event('reset_to_waiting')
	self.collider.generateoverlapevents = true
	self.collider.spaceevents = 'current'
	self.collider:apply_collision_profile('enemy')
	self.collider:set_shape_offset(0, 0)
	self.sprite_component.offset.z = 110
end

function muziekfoe:bind_overlap_events()
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
function muziekfoe:projectile_is_out_of_bounds()
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

function muziekfoe:set_velocity(speed_x_num, speed_y_num, speed_den)
	self.speed_x_num = speed_x_num
	self.speed_y_num = speed_y_num
	self.speed_den = speed_den
	self.speed_accum_x = 0
	self.speed_accum_y = 0
end

function muziekfoe:move_with_velocity()
	local dx, next_accum_x = enemy_consume_axis_accum(self.speed_accum_x, self.speed_x_num, self.speed_den)
	local dy, next_accum_y = enemy_consume_axis_accum(self.speed_accum_y, self.speed_y_num, self.speed_den)
	self.speed_accum_x = next_accum_x
	self.speed_accum_y = next_accum_y
	self.x = self.x + dx
	self.y = self.y + dy
end

function muziekfoe:spawn_death_effect()
	enemy_death_effect_sequence = enemy_death_effect_sequence + 1
	local room_space = service(constants.ids.castle_service_instance).current_room.space_id
	inst(enemy_explosion_module.enemy_explosion_def_id, {
		room_number = service(constants.ids.castle_service_instance).current_room.room_number,
		loot_type = self:choose_drop_type(),
		space_id = room_space,
		pos = { x = self.x, y = self.y, z = 114 },
	})
end

function muziekfoe:take_weapon_hit(weapon_kind, hit_id)
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
				kind = 'muziekfoe',
				trigger = self.trigger,
			})
		self:mark_for_disposal()
	end
	return true
end

function muziekfoe:on_overlap(event)
	if event.other_id ~= constants.ids.player_instance then
		return
	end
	local player = object(constants.ids.player_instance)
	if player:has_tag('g.sw') then
		self:take_weapon_hit('sword', player.sword_id)
		return
	end
	if self.dangerous then
		player:take_hit(self.damage, self.x + math.modf(self.sx / 2), self.y + math.modf(self.sy / 2), 'muziekfoe')
	end
end

function muziekfoe.register_enemy_definition()
	define_prefab({
		def_id = 'pietious.enemy.def.muziekfoe',
		class = muziekfoe,
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

muziekfoe.enemy_def_id = 'pietious.enemy.def.muziekfoe'


return muziekfoe

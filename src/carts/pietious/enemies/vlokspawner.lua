local constants = require('constants')
local behaviourtree = require('behaviourtree')
local eventemitter = require('eventemitter')
local enemy_explosion_module = require('enemy_explosion')

local vlokspawner = {}
vlokspawner.__index = vlokspawner

function vlokspawner:onspawn(pos)
	getmetatable(self).onspawn(self, pos)
	self:bind_overlap_events()
end

function vlokspawner.configure(self, _def)
	self.damage = 0
	self.dangerous = false
	self.max_health = 0
	self.health = 0
	self.visible = false
	self.collider.enabled = false
end

function vlokspawner.bt_tick(self, blackboard)
	local spawn_ticks = blackboard.nodedata.vlok_spawn_ticks
	if spawn_ticks == nil then
		spawn_ticks = constants.enemy.vlokspawner_spawn_steps
	end
	spawn_ticks = spawn_ticks - 1
	if spawn_ticks > 0 then
		blackboard.nodedata.vlok_spawn_ticks = spawn_ticks
		return behaviourtree.running
	end

	local room = service(constants.ids.castle_service_instance).current_room
	local spawn_x = math.random(2, 29) * room.tile_size
	local spawn_y = room.world_top
	local random_x = math.random(-5, 4)
	local spawned_vlok = inst('pietious.enemy.def.vlokfoe', {
		space_id = room.space_id,
		despawn_on_room_switch = true,
		pos = {
			x = spawn_x,
			y = spawn_y,
			z = 140,
		},
	})
	spawned_vlok:configure_from_room_def({
		id = spawned_vlok.id,
		kind = 'vlokfoe',
		x = spawn_x,
		y = spawn_y,
		direction = random_x < 0 and 'left' or 'right',
		speedx = random_x * 2,
		speedy = 5,
		speedden = 10,
	}, room)
	blackboard.nodedata.vlok_spawn_ticks = constants.enemy.vlokspawner_spawn_steps
	return behaviourtree.running
end

function vlokspawner.register_behaviour_tree(bt_id)
	behaviourtree.register_definition(bt_id, {
		root = {
			type = 'action',
			action = function(target, blackboard)
				return vlokspawner.bt_tick(target, blackboard)
			end,
		},
	})
end

function vlokspawner.choose_drop_type(_self)
	return 'none'
end




local enemy_death_effect_sequence = 0


function vlokspawner:configure_from_room_def(def, room)
		self.trigger = def.trigger or ''
	self.conditions = def.conditions or {}
		self.damage = 0
	self.max_health = 0
	self.health = self.max_health
	self.last_weapon_kind = ''
	self.last_weapon_hit_id = -1
	self.dangerous = def.dangerous ~= false
	self.direction = def.direction or 'right'
	self.despawn_on_room_switch = false

	self:set_velocity(def.speedx or 0, def.speedy or 0, def.speedden or 1)

	vlokspawner.configure(self, def)
	self:dispatch_state_event('reset_to_waiting')
	self.collider.generateoverlapevents = true
	self.collider.spaceevents = 'current'
	self.collider:set_shape_offset(0, 0)
	self.sprite_component.offset.z = 110
end

function vlokspawner:bind_overlap_events()
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
function vlokspawner:projectile_is_out_of_bounds()
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

function vlokspawner:set_velocity(speed_x_num, speed_y_num, speed_den)
	self.speed_x_num = speed_x_num
	self.speed_y_num = speed_y_num
	self.speed_den = speed_den
	self.speed_accum_x = 0
	self.speed_accum_y = 0
end

function vlokspawner:move_with_velocity()
	local dx, next_accum_x = consume_axis_accum(self.speed_accum_x, self.speed_x_num, self.speed_den)
	local dy, next_accum_y = consume_axis_accum(self.speed_accum_y, self.speed_y_num, self.speed_den)
	self.speed_accum_x = next_accum_x
	self.speed_accum_y = next_accum_y
	self.x = self.x + dx
	self.y = self.y + dy
end

function vlokspawner:spawn_death_effect()
	enemy_death_effect_sequence = enemy_death_effect_sequence + 1
	local room_space = service(constants.ids.castle_service_instance).current_room.space_id
	inst(enemy_explosion_module.enemy_explosion_def_id, {
		room_number = service(constants.ids.castle_service_instance).current_room.room_number,
		loot_type = self:choose_drop_type(),
		space_id = room_space,
		pos = { x = self.x, y = self.y, z = 114 },
	})
end

function vlokspawner:take_weapon_hit(weapon_kind, hit_id)
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
				kind = 'vlokspawner',
				trigger = self.trigger,
			})
		self:mark_for_disposal()
	end
	return true
end

function vlokspawner:on_overlap(event)
	if event.other_id ~= constants.ids.player_instance then
		return
	end
	local player = object(constants.ids.player_instance)
	if player:has_tag('g.sw') then
		self:take_weapon_hit('sword', player.sword_id)
		return
	end
	if self.dangerous then
		player:take_hit(self.damage, self.x + math.modf(self.sx / 2), self.y + math.modf(self.sy / 2), 'vlokspawner')
	end
end

function vlokspawner.register_enemy_definition()
	define_prefab({
		def_id = 'pietious.enemy.def.vlokspawner',
		class = vlokspawner,
		type = 'sprite',
		fsms = { constants.ids.enemy_fsm },
		defaults = {
			trigger = '',
			conditions = {},
			damage = 0,
			max_health = 0,
			health = 0,
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

return vlokspawner

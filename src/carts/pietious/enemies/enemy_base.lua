local worldobject = require('worldobject')
local combat_overlap = require('combat_overlap')

local enemy_base = {}
local damaging_contact_kinds = {
	sword = true,
	projectile = true,
}

function enemy_base.ctor(self)
	self.collider:apply_collision_profile('enemy')
	self.collider.spaceevents = 'current'
	self.collider:set_shape_offset(0, 0)
	self.sprite_component.offset.z = 110
end

function enemy_base.onspawn(self, pos)
	worldobject.onspawn(self, pos)
	self:bind_overlap_events()
end

function enemy_base.bind_overlap_events(self)
	self.events:on({
		event = 'overlap.begin',
		subscriber = self,
		handler = function(event)
			self:on_overlap(event)
		end,
	})

	self.events:on({
		event = 'weapon_hit',
		subscriber = self,
		handler = function(event)
			self:take_weapon_hit(event.weapon_kind)
		end,
	})

	self.events:on({
		event = 'room.switched',
		emitter = 'pietolon',
		subscriber = self,
		handler = function(_event)
			self:mark_for_disposal()
		end,
	})

	self.events:on({
		event = 'shrine_transition_enter',
		subscriber = self,
		handler = function()
			self:set_space('transition')
		end,
	})
	self.events:on({
		event = 'shrine_transition_exit',
		subscriber = self,
		handler = function()
			self:set_space('main')
		end,
	})
end

function enemy_base.projectile_is_out_of_bounds(self)
	local room = object('c').current_room
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
	if self.x > room.world_width then
		return true
	end
	if self.y + bound_bottom < room.world_top then
		return true
	end
	if self.y > room.world_height then
		return true
	end
	return false
end

function enemy_base.spawn_death_effect(self)
	local room = object('c').current_room
	inst('enemy_explosion', {
		room_number = room.room_number,
		loot_type = self:choose_drop_type(),
		pos = { x = self.x, y = self.y, z = 114 },
	})
end

function enemy_base.take_weapon_hit(self, weapon_kind)
	self.health = self.health - 1
	if self.health <= 0 then
		self.health = 0
		self.dangerous = false
		self:spawn_death_effect()
		local room_number = object('c').current_room.room_number
		object('c').events:emit('enemy.defeated', {
			enemy_id = self.id,
			room_number = room_number,
			kind = self.enemy_kind,
			trigger = self.trigger,
		})
		if self.trigger ~= nil then
			object('c').events:emit('room.condition_set', {
				room_number = room_number,
				condition = self.trigger,
			})
		end
		self:mark_for_disposal()
	else
		object('c').events:emit('foedamage')
	end
	return true
end

function enemy_base.on_overlap(self, event)
	local player = object('pietolon')
	local contact_kind = combat_overlap.classify_player_contact(event)
	if contact_kind == nil then
		return
	end
	if damaging_contact_kinds[contact_kind] then
		self.events:emit('weapon_hit', {
			weapon_kind = contact_kind,
			contact_kind = contact_kind,
			source_id = event.other_id,
			source_collider_local_id = event.other_collider_local_id,
		})
	end
	if contact_kind == 'body' and self.dangerous then
		player.events:emit('enemy.contact_damage', {
			amount = self.damage,
			source_x = self.x + math.modf(self.sx / 2),
			source_y = self.y + math.modf(self.sy / 2),
			reason = self.enemy_kind,
			enemy_id = self.id,
			contact_kind = contact_kind,
		})
	end
end

function enemy_base.extend(enemy_class, enemy_kind)
	local original_ctor = enemy_class.ctor
	enemy_class.enemy_kind = enemy_kind
	enemy_class.onspawn = enemy_base.onspawn
	enemy_class.bind_overlap_events = enemy_base.bind_overlap_events
	enemy_class.projectile_is_out_of_bounds = enemy_base.projectile_is_out_of_bounds
	enemy_class.spawn_death_effect = enemy_base.spawn_death_effect
	enemy_class.take_weapon_hit = enemy_base.take_weapon_hit
	enemy_class.on_overlap = enemy_base.on_overlap
	enemy_class.ctor = function(self, ...)
		enemy_base.ctor(self)
		if original_ctor then
			original_ctor(self, ...)
		end
	end
end

return enemy_base

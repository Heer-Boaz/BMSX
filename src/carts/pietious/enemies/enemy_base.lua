local combat_overlap = require('combat_overlap')
local constants = require('constants')
local components = require('components')

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

-- Attaches a screenboundarycomponent with room bounds and subscribes to
-- screen.leave so the projectile auto-disposes when it exits the room.
-- Call from the ctor of projectile-type enemies only (vlokfoe, nootfoe, etc.).
function enemy_base.setup_projectile_boundary(self)
	self:add_component(components.screenboundarycomponent.new({
		bounds = {
			left = 0,
			top = constants.room.hud_height,
			right = constants.room.width,
			bottom = constants.room.height,
		},
	}))
	self.events:on({
		event = 'screen.leave',
		subscriber = self,
		handler = function(_event)
			self:mark_for_disposal()
		end,
	})
end

function enemy_base.bind(self)
	self.events:on({
		event = 'overlap.begin',
		subscriber = self,
		handler = function(event)
			self:on_overlap(event)
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

function enemy_base.spawn_death_effect(self)
	local room = object('room')
	inst('enemy_explosion', {
		room_number = object('c').current_room_number,
		loot_type = self:choose_drop_type(),
		pos = { x = self.x, y = self.y, z = 114 },
	})
end

function enemy_base.take_weapon_hit(self, weapon_kind)
	local room_number = object('c').current_room_number
	self.health = self.health - 1
	if self.health <= 0 then
		self.health = 0
		self.dangerous = false
		self:spawn_death_effect()
		self.events:emit('enemy.defeated', {
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
		self.events:emit('combat.target_damaged', {
			target_id = self.id,
			target_kind = self.enemy_kind,
			room_number = room_number,
			weapon_kind = weapon_kind,
		})
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
		self:take_weapon_hit(contact_kind)
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
	enemy_class.bind = enemy_base.bind
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

local combat_overlap = require('combat_overlap')
local combat_damage = require('combat_damage')
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
	self.events:on({
		event = 'room.switched',
		emitter = 'pietolon',
		subscriber = self,
		handler = function()
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
		event = 'world_transition',
		emitter = 'd',
		subscriber = self,
		handler = function()
			self:mark_for_disposal()
		end,
	})
	self.events:on({
		event = 'room',
		emitter = 'd',
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

function enemy_base.apply_damage(self, request)
	self.health = self.health - 1
	if self.health <= 0 then
		self.health = 0
		self.dangerous = false
		return combat_damage.build_applied_result(request, 1, true, 'destroyed')
	end
	return combat_damage.build_applied_result(request, 1, false, 'damaged')
end

function enemy_base.process_damage_result(self, result)
	if result.status == 'rejected' then
		return
	end
	if result.destroyed then
		self:spawn_death_effect()
		if self.trigger ~= nil then
			object('c').events:emit('room.condition_set', {
				room_number = result.room_number,
				condition = self.trigger,
			})
		end
		self:mark_for_disposal()
		return
	end
end

function enemy_base.on_overlap(self, event)
	local player = object('pietolon')
	local contact_kind = combat_overlap.classify_player_contact(event)
	if contact_kind == nil then
		return
	end
	if damaging_contact_kinds[contact_kind] then
		local result = combat_damage.resolve(self, combat_damage.build_weapon_request(self, self.enemy_kind, event, contact_kind))
		self:process_damage_result(result)
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
	enemy_class.apply_damage = enemy_base.apply_damage
	enemy_class.process_damage_result = enemy_base.process_damage_result
	enemy_class.on_overlap = enemy_base.on_overlap
	enemy_class.ctor = function(self, ...)
		enemy_base.ctor(self)
		if original_ctor then
			original_ctor(self, ...)
		end
	end
end

return enemy_base

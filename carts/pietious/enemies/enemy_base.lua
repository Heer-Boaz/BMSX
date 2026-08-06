local world<const> = require('cartlib/world/world')
local combat_overlap<const> = require('combat/overlap')
local combat_damage<const> = require('combat/damage')
require('constants')
local screenboundarycomponent<const> = require('cartlib/physics/screenboundarycomponent')

local enemy_base<const> = {}
local damaging_contact_kinds<const> = {
	sword = true,
	projectile = true,
}

function enemy_base.ctor(self)
	self.collider.layer = collision_enemy_layer
	self.collider.mask = collision_enemy_mask
	self.sprite_component:set_offset_z(110)
end

-- Attaches projectile boundary behaviour with the room bounds. The shared
-- bind() below owns its event subscriptions after construction is complete.
-- Call from the ctor of projectile-type enemies only (vlokfoe, nootfoe, etc.).
function enemy_base.setup_projectile_boundary(self)
	self:add_component(screenboundarycomponent.new({
		left = 0,
		top = room_hud_height,
		right = room_width,
		bottom = room_height,
	}))
end

function enemy_base.bind(self)
	self.events:on({
		event = 'overlap.begin',
		subscriber = self,
		handler = function(_event_type, _emitter, payload)
			self:on_overlap(payload)
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
			self:despawn()
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

	if self:get_component(screenboundarycomponent) ~= nil then
		self.events:on({
			event = 'screen.leave',
			subscriber = self,
			handler = function()
				self:despawn()
			end,
		})
		self.events:on({
			event = 'room.switched',
			emitter = 'pietolon',
			subscriber = self,
			handler = function()
				self:despawn()
			end,
		})
	end
end

function enemy_base.spawn_death_effect(self)
	local room<const> = world:get('room')
	world:spawn('enemy_explosion', {
		room_number = world:get('c').current_room_number,
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
			world:get('c').events:emit('room.condition_set', {
				room_number = result.room_number,
				condition = self.trigger,
			})
		end
		self:despawn()
		return
	end
end

function enemy_base.on_overlap(self, event)
	local player<const> = world:get('pietolon')
	local contact_kind<const> = combat_overlap.classify_player_contact(event)
	if contact_kind == nil then
		return
	end
	if damaging_contact_kinds[contact_kind] then
		local result<const> = combat_damage.resolve(self, combat_damage.build_weapon_request(self, self.enemy_kind, event, contact_kind))
		self:process_damage_result(result)
	end
	if contact_kind == 'body' and self.dangerous then
		player.events:emit('enemy.contact_damage', {
			amount = self.damage,
			source_x = self.x + (self.sx // 2),
			source_y = self.y + (self.sy // 2),
			reason = self.enemy_kind,
			enemy_id = self.id,
			contact_kind = contact_kind,
		})
	end
end

function enemy_base.extend(enemy_class, enemy_kind)
	local original_ctor<const> = enemy_class.ctor
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

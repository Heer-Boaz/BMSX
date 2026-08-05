-- pepernoot_projectile.lua
-- player thrown projectile (pepernoot) — fires horizontally, disposes on
-- collision with terrain, room bounds, or enemies.
--
-- FREEZE/UNFREEZE PATTERN (shared with player.lua):
-- Root FSM `on` subscribes to 'seal_dissolution' → transitions to /freeze.
-- The freeze state tags the projectile with 'v.fz' so update_motion() can
-- skip movement (checked via has_tag).  On 'seal_flash_done', freeze does
-- pop_and_transition() to restore the previous state from the history stack.
-- This is the same pattern the player uses — temporary interruption with
-- automatic state restoration.

local fsm_library<const> = require('cartlib/fsm/library')
local state_machine_component<const> = require('cartlib/fsm/component')
local prefab<const> = require('cartlib/prefab')
local spriteobject<const> = require('cartlib/sprite')
local world<const> = require('cartlib/world/world')
require('constants')
local tilecollisioncomponent<const> = require('cartlib/collision/tile_collision_component')
local worldobject<const> = require('cartlib/world/object')

local pepernoot_projectile<const> = {}
pepernoot_projectile.__index = pepernoot_projectile

local state_tags<const> = {
	frozen = 'v.fz',
}

function pepernoot_projectile:ctor()
	self.collider.layer = collision_projectile_layer
	self.collider.mask = collision_projectile_mask
	self:add_component(tilecollisioncomponent.new({
		id_local = 'world',
		query = function(_component, owner, payload)
			local collision_flags<const> = world:get('room'):collision_flags_at_world(owner.x, owner.y)
			if collision_flags == collision_flags_none or collision_flags == collision_flags_elevator then
				return nil
			end
			payload.collision_flags = collision_flags
			payload.world_x = owner.x
			payload.world_y = owner.y
			return collision_flags
		end,
	}))
	self:gfx('pepernoot_16')
end

function pepernoot_projectile:onspawn(pos)
	local room<const> = world:get('room')
	local snapped_x<const>, snapped_y<const> = room:snap_world_to_tile(self.x, self.y)
	self.sprite_component.offset_x = snapped_x - self.x
	self.sprite_component.offset_y = snapped_y - self.y
end

function pepernoot_projectile:refresh_tile_aligned_sprite_offset()
	local room<const> = world:get('room')
	local snapped_x<const>, snapped_y<const> = room:snap_world_to_tile(self.x, self.y)
	self.sprite_component.offset_x = snapped_x - self.x
	self.sprite_component.offset_y = snapped_y - self.y
end

function pepernoot_projectile:update_motion()
	if self:has_tag(state_tags.frozen) then
		return
	end
	local room<const> = world:get('room')
	self.x = self.x + (self.direction * secondary_weapon_pepernoot_speed_px)
	self:refresh_tile_aligned_sprite_offset()

	if self.x <= 0 or self.x >= room.world_width then
		self:despawn()
		return
	end
end

local define_pepernoot_projectile_fsm<const> = function()
	fsm_library.register('pepernoot_projectile', {
		initial = 'active',
		on = {
			['tilecollision.begin'] = worldobject.despawn,
			['overlap.begin'] = function(self, _state, event)
				if event.other_layer ~= collision_enemy_layer then
					return
				end
				self:despawn()
			end,
			['room.switched'] = {
				emitter = 'pietolon',
				go = worldobject.despawn,
			},
			['seal_dissolution'] = '/freeze',
		},
		states = {
			active = {
				update = pepernoot_projectile.update_motion,
			},
			freeze = {
				tags = { state_tags.frozen },
				on = {
					['seal_flash_done'] = function(_self, state)
						state:pop_and_transition()
					end,
				},
			},
		},
	})
end

local register_pepernoot_projectile_definition<const> = function()
	prefab.define({
		def_id = 'pepernoot_projectile',
		class = pepernoot_projectile,
		base = spriteobject,
		components = { state_machine_component.factory({ 'pepernoot_projectile' }) },
		defaults = {
			owner_id = 'pietolon',
			direction = 1,
		},
	})
end

return {
	pepernoot_projectile = pepernoot_projectile,
	define_pepernoot_projectile_fsm = define_pepernoot_projectile_fsm,
	register_pepernoot_projectile_definition = register_pepernoot_projectile_definition,
}

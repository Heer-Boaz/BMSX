local collider_2d_component<const> = require('cartlib/collision/collider_2d_component')
local custom_visual_component<const> = require('cartlib/component/custom_visual_component')
local fixed_point_velocity_component<const> = require('cartlib/physics/fixed_point_velocity_component')
local fsm_component<const> = require('cartlib/fsm/fsm_component')
local fsm_library<const> = require('cartlib/fsm/library')
local prefab<const> = require('cartlib/world/prefab')
local registry<const> = require('cartlib/registry')
local world_object<const> = require('cartlib/world/world_object')
local player_state<const> = require('player/player_state')
require('constants')

local option_pickup<const> = {}
option_pickup.__index = option_pickup

local hit_area<const> = {
	left = 2,
	top = 2,
	right = 14,
	bottom = 8,
}
local new_collider<const> = collider_2d_component.factory({
	layer = collision_pickup_layer,
	mask = collision_pickup_mask,
	local_area = hit_area,
})

local draw_option<const> = function(component, draw)
	local owner<const> = component.parent
	owner.animation_frames[owner.animation_owner.option_anim_index]:blit(
		draw,
		owner.x,
		owner.y
	)
end
local new_visual<const> = custom_visual_component.factory({ draw = draw_option })

function option_pickup:ctor()
	self.motion = self:get_component(fixed_point_velocity_component)
	self.motion:set_velocity_pixels_per_second(player_option_pickup_speed_x_px_per_second, 0)
end

function option_pickup:update_active()
	if self.x < -player_width then
		self:mark_for_disposal()
	end
end

function option_pickup:on_overlap(_event_type, _emitter, event)
	if event.other_layer ~= collision_player_layer then
		return
	end
	local player<const> = registry:get(event.other_id)
	if player.player_state:grant_powerup(player_state.powerup_slot.option) then
		self.events:emit('pickup.option')
		self:mark_for_disposal()
	end
end

function option_pickup:bind()
	self.events:on({
		event = 'overlap.begin',
		handler = option_pickup.on_overlap,
	})
end

function option_pickup.register()
	fsm_library.register(ids_option_pickup_fsm, {
		initial = 'active',
		states = {
			active = {
				update = option_pickup.update_active,
			},
		},
	})
	prefab.define({
		def_id = ids_option_pickup_def,
		class = option_pickup,
		base = world_object,
		components = {
			new_visual,
			new_collider,
			fixed_point_velocity_component.new,
			fsm_component.factory({ ids_option_pickup_fsm }),
		},
		defaults = {
			z = 70,
		},
	})
end

return option_pickup

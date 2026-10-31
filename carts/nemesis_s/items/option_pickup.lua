local collider_2d_component<const> = require('cartlib/collision/collider_2d_component')
local visual_2d<const> = require('cartlib/component/visual_2d_component')
local gp0<const> = require('cartlib/gx/gp0')
local velocity<const> = require('cartlib/velocity')
local collision_storage<const> = require('collision_storage')
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
	geometry_pool = collision_storage.area,
	layer = collision_pickup_layer,
	mask = collision_pickup_mask,
	local_area = hit_area,
})

local option_visual<const> = {}
option_visual.__index = option_visual
setmetatable(option_visual, { __index = visual_2d })

function option_visual:draw_option(draw)
	self:resolve_pose()
	local source<const> = self.frames[self.animation_owner.option_anim_index]
	if self._translation_only then
		source:blit(draw, self.wox, self.woy)
	else
		source:draw_affine(draw, self.wox, self.woy,
			self.wxx * source.width, self.wxy * source.width,
			self.wyx * source.height, self.wyy * source.height,
			0, 0xffffffff, gp0.draw_mode_blend_half)
	end
end

function option_visual.new(owner)
	local self<const>, input<const> = visual_2d.new(owner, owner, 'option_visual')
	setmetatable(self, option_visual)
	self.frames = input.frames
	self.animation_owner = input.animation_owner
	self:set_draw_function(option_visual.draw_option)
	return self
end

function option_pickup:ctor()
	self.motion = self:get_component(fixed_point_velocity_component)
end

function option_pickup:update_active()
	local pose<const> = self.spatial
	if pose.ox < -player_width then
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
		spatial = { family = '2d', authority = 'root_origin' },
		components = {
			option_visual.new,
			new_collider,
			function(owner) return fixed_point_velocity_component.new(owner, owner) end,
			fsm_component.factory({ ids_option_pickup_fsm }),
		},
		defaults = {
			order = 70,
			velocity_x = velocity.pixels_per_second_to_velocity_q8(player_option_pickup_speed_x_px_per_second),
			velocity_y = 0,
		},
	})
end

return option_pickup

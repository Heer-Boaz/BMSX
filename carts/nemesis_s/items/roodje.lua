local collider_2d_component<const> = require('cartlib/collision/collider_2d_component')
local fsm_component<const> = require('cartlib/fsm/fsm_component')
local fsm_library<const> = require('cartlib/fsm/library')
local prefab<const> = require('cartlib/world/prefab')
local registry<const> = require('cartlib/registry')
local sprite_object<const> = require('cartlib/sprite')
local stage_scroll_follower_component<const> = require('stage_scroll_follower_component')
require('constants')

local roodje<const> = {}
roodje.__index = roodje

local hit_area<const> = {
	left = 0,
	top = 0,
	right = 16,
	bottom = 16,
}
local new_collider<const> = collider_2d_component.factory({
	layer = collision_pickup_layer,
	mask = collision_pickup_mask,
	local_area = hit_area,
})

function roodje:update_active()
	if self.x <= -roodje_width then
		self:mark_for_disposal()
	end
end

function roodje:on_overlap(_event_type, _emitter, event)
	if event.other_layer == collision_player_layer then
		local player<const> = registry:get(event.other_id)
		player.player_state:advance_powerup_selection()
		self.events:emit('pickup.powerup')
		self:mark_for_disposal()
	end
end

function roodje:bind()
	self.events:on({
		event = 'overlap.begin',
		handler = roodje.on_overlap,
	})
end

local define_fsm<const> = function()
	fsm_library.register(ids_roodje_fsm, {
		initial = 'active',
		states = {
			active = {
				update = roodje.update_active,
			},
		},
	})
end

local register_definition<const> = function()
	prefab.define({
		def_id = ids_roodje_def,
		class = roodje,
		base = sprite_object,
		components = {
			new_collider,
			stage_scroll_follower_component.new,
			fsm_component.factory({ ids_roodje_fsm }),
		},
		defaults = {
			imgid = assets_roodje,
			z = roodje_draw_z,
		},
	})
end

function roodje.register()
	define_fsm()
	register_definition()
end

return roodje

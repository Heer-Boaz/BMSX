local fsm_library<const> = require('cartlib/fsm/library')
local fsm_component<const> = require('cartlib/fsm/fsm_component')
local prefab<const> = require('cartlib/world/prefab')
local sprite_object<const> = require('cartlib/sprite')
local collision_storage<const> = require('collision_storage')
local collider_2d_component<const> = require('cartlib/collision/collider_2d_component')
require('constants')

local elevator<const> = {}
elevator.__index = elevator

function elevator:ctor()
	self.collider = self:get_component(collider_2d_component)
end

function elevator:update_motion()
	local player<const> = self.player
	local current_room_number<const> = self.castle.current_room_number
	local was_visible<const> = self.current_room_number == current_room_number
	local pose<const> = self.spatial
	local previous_y<const> = pose.oy
	local was_supported<const> = was_visible
		and player.on_vertical_elevator
		and player.vertical_elevator_id == self.id
	local target<const> = self.path[self.going_to]
	local vertical<const> = self.vertical_to_point[self.going_to]
	local x, y = pose.ox, pose.oy
	local delta_x = 0
	if x < target.x then x = x + 2; delta_x = 2 end
	if x > target.x then x = x - 2; delta_x = -2 end
	local delta_y
	local top_boundary<const> = room_hud_height + room_tile_size
	if vertical == 'down' then
		delta_y = 2
		y = y + 2
		if y > room_height then
			y = top_boundary
			self.current_room_number = target.room_number
		end
	else
		delta_y = -2
		y = y - 2
		if y < top_boundary then
			y = room_height - room_tile_size
			self.current_room_number = target.room_number
		end
	end
	self.spatial:set_world_origin(x, y)
	if was_supported and (delta_x ~= 0 or delta_y ~= 0) then
		local rider<const> = player.spatial:resolve_world()
		player.spatial:set_world_origin(rider.wox + delta_x, rider.woy + delta_y)
	end
	if was_visible and delta_y ~= 0 then
		player:resolve_overlap_with_elevator(self, previous_y)
	end
	if x == target.x and y == target.y
	and self.current_room_number == target.room_number then
		self.going_to = self.going_to == 1 and 2 or 1
	end
	local visible<const> = self.current_room_number == current_room_number
	self.sprite_component.visible = visible
	self.collider:set_enabled(visible)
	if visible then
		local rider<const> = player.spatial:resolve_world()
		local standing_on_top<const> = rider.woy == y - player_height
			and player:has_feet_over_elevator_top(self, rider.wox)
		if standing_on_top then
			player.next_vertical_elevator = true
			player.next_vertical_elevator_id = self.id
		end
		player:switch_room_from_position()
	end
end

local define_elevator_fsm<const> = function()
	fsm_library.register('elevator_platform', {
		initial = 'active',
		states = {
			active = {},
		},
	})
end

local register_elevator_definition<const> = function()
	prefab.define({
		def_id = 'elevator_platform',
		class = elevator,
		base = sprite_object,
		spatial = { family = '2d', authority = 'root_origin' },
		initial = { base_sprite = { order = 21, imgid = 'elevator_platform' } },
		components = {
			collider_2d_component.factory_for_sprite({ geometry_pool = collision_storage.sprite, layer = collision_world_layer, mask = collision_player_layer }),
			fsm_component.factory({ 'elevator_platform' }),
		},
		defaults = {
			path = nil,
			vertical_to_point = nil,
			going_to = 1,
			current_room_number = 0,
		},
	})
end

return {
	elevator = elevator,
	define_elevator_fsm = define_elevator_fsm,
	register_elevator_definition = register_elevator_definition,
}

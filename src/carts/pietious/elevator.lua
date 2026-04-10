local constants<const> = require('constants')

local elevator<const> = {}
elevator.__index = elevator

function elevator:ctor()
	self:gfx('elevator_platform')
	self.collider:set_enabled(true)
	self.collider.layer = constants.collision.world_layer
	self.collider.mask = constants.collision.player_layer
	self.collider.spaceevents = 'current'
end

local move_vertical<const> = function(self, target, vertical)
	local top_boundary<const> = constants.room.hud_height + constants.room.tile_size
	local delta_y = 0
	if vertical == 'down' then
		self.y = self.y + 2
		delta_y = 2
		if self.y > constants.room.height then
			self.y = top_boundary
			self.current_room_number = target.room_number
		end
		return delta_y
	end

	self.y = self.y - 2
	delta_y = -2
	if self.y < top_boundary then
		self.y = constants.room.height - constants.room.tile_size
		self.current_room_number = target.room_number
	end
	return delta_y
end

function elevator:update_motion()
	local player<const> = oget('pietolon')
	local current_room_number<const> = oget('c').current_room_number
	self.visible = self.current_room_number == current_room_number
	self.collider:set_enabled(self.visible)
	local previous_y<const> = self.y
	local was_supported<const> = self.visible
		and player.on_vertical_elevator
		and player.vertical_elevator_id == self.id

	local target<const> = self.path[self.going_to]
	local vertical<const> = self.vertical_to_point[self.going_to]
	local delta_x = 0

	if self.x < target.x then
		self.x = self.x + 2
		delta_x = 2
	end
	if self.x > target.x then
		self.x = self.x - 2
		delta_x = -2
	end
	local delta_y<const> = move_vertical(self, target, vertical)

	if was_supported and (delta_x ~= 0 or delta_y ~= 0) then
		player.x = player.x + delta_x
		player.y = player.y + delta_y
	end
	if self.visible and delta_y ~= 0 then
		player:resolve_overlap_with_elevator(self, previous_y)
	end

	if self.x == target.x
		and self.y == target.y
		and self.current_room_number == target.room_number
	then
		if self.going_to == 1 then
			self.going_to = 2
		else
			self.going_to = 1
		end
	end

	self.visible = self.current_room_number == current_room_number
	self.collider:set_enabled(self.visible)

	if self.visible then
		local standing_on_top<const> = player.y == (self.y - constants.player.height)
			and player:has_feet_over_elevator_top(self, player.x)
		if standing_on_top then
			player.next_vertical_elevator = true
			player.next_vertical_elevator_id = self.id
		end
		player:try_room_switches_from_position()
	end
end

local define_elevator_fsm<const> = function()
	define_fsm('elevator_platform', {
		initial = 'active',
		states = {
			active = {},
		},
	})
end

local register_elevator_definition<const> = function()
	define_prefab({
		def_id = 'elevator_platform',
		class = elevator,
		type = 'sprite',
		fsms = { 'elevator_platform' },
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

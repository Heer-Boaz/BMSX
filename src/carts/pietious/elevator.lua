local constants = require('constants')

local elevator = {}
elevator.__index = elevator

function elevator:ctor()
	self:gfx('elevator_platform')
	self.collider.enabled = true
	self.collider.layer = constants.collision.world_layer
	self.collider.mask = constants.collision.player_layer
	self.collider.spaceevents = 'current'
end

local function move_vertical(self, target, vertical)
	local top_boundary = constants.room.hud_height + constants.room.tile_size
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

local function try_snap_player_side(self, player)
	local feet_y = player.y + player.height
	local relative_feet_y = feet_y - self.y - 1
	if relative_feet_y < 0 or relative_feet_y >= constants.elevator.side_snap_y then
		return
	end

	local left_snap_x = player.x - self.x - constants.elevator.left_snap_x
	if left_snap_x >= 0 and left_snap_x < constants.elevator.left_snap_width then
		player.x = self.x + constants.elevator.left_snap_x
		return
	end

	local right_snap_x = player.x - self.x - constants.elevator.right_snap_x
	if right_snap_x >= 0 and right_snap_x < constants.elevator.right_snap_width then
		player.x = self.x + constants.elevator.right_snap_x + constants.elevator.right_snap_width - 1
	end
end

local function is_in_transport_x_band(self, player)
	local relative_x = (player.x - self.x) - constants.elevator.transport_min_x
	return relative_x >= 0 and relative_x < constants.elevator.transport_width
end

local function update_player_transport(self, player, delta_x)
	if not self.visible then
		self.transport_active = false
		self.transport_switch_cooldown_steps = 0
		return
	end

	if self.transport_switch_cooldown_steps > 0 then
		self.transport_switch_cooldown_steps = self.transport_switch_cooldown_steps - 1
		if self.transport_active then
			player.x = player.x + delta_x
			player.y = self.y - player.height
			player.on_vertical_elevator = true
		end
		return
	end

	local previous_transport_active = self.transport_active
	try_snap_player_side(self, player)

	local next_transport_active = false
	if is_in_transport_x_band(self, player) then
		local feet_y = player.y + player.height
		local tile_support = player:collides_at_support_profile(player.x, player.y, false)
		if feet_y < (self.y + constants.elevator.top_attach_feet_y) then
			if previous_transport_active or not tile_support then
				next_transport_active = true
			end
		else
			local bottom_offset = feet_y - self.y - constants.elevator.bottom_push_feet_y
			if bottom_offset >= 0
				and bottom_offset < constants.elevator.bottom_push_height
				and not tile_support
			then
				player.y = self.y + constants.room.tile_size2
			end
		end
	end

	self.transport_active = next_transport_active
	if next_transport_active then
		player.x = player.x + delta_x
		player.y = self.y - player.height
		player.on_vertical_elevator = true
	end
	if next_transport_active ~= previous_transport_active then
		self.transport_switch_cooldown_steps = constants.elevator.transport_switch_cooldown_steps
	end
end

function elevator:update_motion()
	local player = object('pietolon')
	local current_room_number = object('c').current_room_number
	self.visible = self.current_room_number == current_room_number
	self.collider.enabled = self.visible

	local target = self.path[self.going_to]
	local vertical = self.vertical_to_point[self.going_to]
	local delta_x = 0

	if self.x < target.x then
		self.x = self.x + 2
		delta_x = 2
	end
	if self.x > target.x then
		self.x = self.x - 2
		delta_x = -2
	end
	local delta_y = move_vertical(self, target, vertical)
	update_player_transport(self, player, delta_x)

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
	self.collider.enabled = self.visible

	if self.visible then
		player:try_room_switches_from_position()
	end
end

local function define_elevator_fsm()
	define_fsm('elevator_platform', {
		initial = 'active',
		states = {
			active = {},
		},
	})
end

local function register_elevator_definition()
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
			transport_active = false,
			transport_switch_cooldown_steps = 0,
		},
	})
end

return {
	elevator = elevator,
	define_elevator_fsm = define_elevator_fsm,
	register_elevator_definition = register_elevator_definition,
}

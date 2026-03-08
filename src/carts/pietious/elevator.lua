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

function elevator:update_motion()
	local player = object('pietolon')
	local current_room_number = object('c').current_room_number
	self.visible = self.current_room_number == current_room_number
	self.collider.enabled = self.visible

	if self.visible and player.last_dy >= 0 then
		player:try_snap_to_elevator_platform(player.x)
	end

	local character_over = false
	if self.visible
		and player.y >= (self.y - constants.room.tile_size2)
		and player.y < (self.y + constants.room.tile_size2)
	then
		local standing_on_top = player.y == (self.y - constants.player.height + constants.room.tile_size)
		if player.x > (self.x - constants.room.tile_size2)
			and player.x < (self.x + constants.room.tile_size4)
			and (player:has_tag('g.et') or standing_on_top)
		then
			character_over = true
		end
		if player.x > (self.x - (constants.room.tile_size2 - (constants.room.tile_unit * 5)))
			and player.x < ((self.x + constants.room.tile_size4) - (constants.room.tile_unit * 4))
		then
			character_over = true
		end
	end

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

	if character_over and (delta_x ~= 0 or delta_y ~= 0) then
		self.events:emit('elevator.platform_push', {
			player_id = player.id,
			platform_id = self.id,
			dx = delta_x,
			dy = delta_y,
		})
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

	if self.visible then
		player:try_room_switches_from_position()
	end
end

local function define_elevator_fsm()
	define_fsm('elevator_platform', {
		initial = 'active',
		states = {
			active = {
				update = elevator.update_motion,
			},
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
		},
	})
end

return {
	define_elevator_fsm = define_elevator_fsm,
	register_elevator_definition = register_elevator_definition,
}

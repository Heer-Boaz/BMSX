local constants = require('constants.lua')
local engine = require('engine')

local room_view = {}
room_view.__index = room_view

local room_view_fsm_id = constants.ids.room_view_fsm

function room_view:bind_visual()
	local rc = self:get_component('customvisualcomponent')
	rc.producer = function(_ctx)
		self:render_room()
	end
end

function room_view:get_room()
	return engine.service(self.game_service_id):get_current_room()
end

function room_view:render_room()
	if engine.get_space() ~= constants.spaces.castle then
		return
	end

	local room = self:get_room()
	local tile_size = room.tile_size
	local origin_x = room.tile_origin_x
	local origin_y = room.tile_origin_y

	for y = 1, room.tile_rows do
		local draw_y = origin_y + ((y - 1) * tile_size)
		local row = room.tiles[y]
		for x = 1, room.tile_columns do
			local draw_x = origin_x + ((x - 1) * tile_size)
			put_sprite(row[x], draw_x, draw_y, 20)
		end
	end
end

local function define_room_view_fsm()
	define_fsm(room_view_fsm_id, {
		initial = 'boot',
		states = {
			boot = {
				entering_state = function(self)
					self:bind_visual()
					return '/active'
				end,
			},
			active = {},
		},
	})
end

local function register_room_view_definition()
	define_world_object({
		def_id = constants.ids.room_view_def,
		class = room_view,
			fsms = { room_view_fsm_id },
			components = { 'customvisualcomponent' },
			defaults = {
				game_service_id = constants.ids.castle_service_instance,
				space_id = constants.spaces.castle,
			},
		})
end

return {
	room_view = room_view,
	define_room_view_fsm = define_room_view_fsm,
	register_room_view_definition = register_room_view_definition,
	room_view_def_id = constants.ids.room_view_def,
	room_view_instance_id = constants.ids.room_view_instance,
	room_view_fsm_id = room_view_fsm_id,
}

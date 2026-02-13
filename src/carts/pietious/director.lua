local constants = require('constants')

local director = {}
director.__index = director

function director:bind_visual()
	local rc = self:get_component('customvisualcomponent')
	rc.producer = function(_ctx)
		self:draw_room_tiles()
	end
end

function director:draw_room_tiles()
	local room = service(constants.ids.castle_service_instance).current_room
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

local function define_director_fsm()
	define_fsm(constants.ids.director_fsm, {
		initial = 'boot',
		states = {
			boot = {
				entering_state = function(self)
					self:bind_visual()
					return '/playing'
				end,
			},
			playing = {},
		},
	})
end

local function register_director_definition()
	define_prefab({
		def_id = constants.ids.director_def,
		class = director,
		fsms = { constants.ids.director_fsm },
		components = { 'customvisualcomponent' },
		defaults = {
		},
	})
end

return {
	director = director,
	define_director_fsm = define_director_fsm,
	register_director_definition = register_director_definition,
	director_def_id = constants.ids.director_def,
	director_instance_id = constants.ids.director_instance,
	director_fsm_id = constants.ids.director_fsm,
}

local constants = require('constants.lua')

local director = {}
director.__index = director

local director_fsm_id = constants.ids.director_fsm

function director:bind_visual()
	local rc = self:get_component('customvisualcomponent')
	rc.producer = function(_ctx)
		self:render_frame()
	end
end

function director:draw_frame_background()
	local view_w = display_width()
	local view_h = display_height()

	put_rectfillcolor(0, 0, view_w, view_h, 0, constants.palette.sky_bottom)
	put_rectfillcolor(0, 0, view_w, self.room.tile_origin_y, 1, constants.palette.sky_top)
end

function director:draw_room_tiles()
	local room = self.room
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

function director:draw_room_enemies()
	local enemies = self.room.enemies
	for i = 1, #enemies do
		local enemy = enemies[i]
		if enemy.facing > 0 then
			put_sprite('meijter_r', enemy.x, enemy.y, 105)
		else
			put_sprite('meijter_r', enemy.x, enemy.y, 105, { flip_h = true })
		end
	end
end

function director:render_frame()
	self:draw_frame_background()
	self:draw_room_tiles()
	self:draw_room_enemies()
end

local function define_director_fsm()
	define_fsm(director_fsm_id, {
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
	define_world_object({
		def_id = constants.ids.director_def,
		class = director,
		fsms = { director_fsm_id },
		components = { 'customvisualcomponent' },
		defaults = {
			room = nil,
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

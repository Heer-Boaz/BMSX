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

function director:tick(_dt)
	self.player_ref = object(self.player_id)
end

function director:draw_background()
	local view_w = display_width()
	local view_h = display_height()

	put_rectfillcolor(0, 0, view_w, 38, 0, constants.palette.sky_top)
	put_rectfillcolor(0, 38, view_w, view_h, 1, constants.palette.sky_bottom)
	put_rectfillcolor(0, 56, view_w, view_h, 2, constants.palette.castle_wall)

	for x = 0, view_w, 20 do
		put_rectfillcolor(x + 2, 46, x + 14, 56, 3, constants.palette.castle_wall_dark)
	end

	for y = 66, 206, 20 do
		put_rectfillcolor(0, y, view_w, y + 2, 4, constants.palette.castle_wall_dark)
	end

	local windows = self.room.windows
	for i = 1, #windows do
		local w = windows[i]
		put_rectfillcolor(w.x, w.y, w.x + w.w, w.y + w.h, 5, constants.palette.window)
		put_rectfillcolor(w.x + 2, w.y + 2, w.x + w.w - 2, w.y + w.h - 2, 6, constants.palette.sky_bottom)
	end
end

function director:draw_solids()
	local solids = self.room.solids
	for i = 1, #solids do
		local s = solids[i]
		put_rectfillcolor(s.x, s.y, s.x + s.w, s.y + s.h, 20, constants.palette.stone)
		put_rectfillcolor(s.x, s.y, s.x + s.w, s.y + 3, 21, constants.palette.stone_top)
	end
end

function director:draw_player(player)
	local body_color = constants.palette.player_tunic
	if player.state_name == 'jumping' or player.state_name == 'stopped_jumping' then
		body_color = constants.palette.player_air
	end
	if player.state_name == 'controlled_fall' or player.state_name == 'uncontrolled_fall' then
		body_color = constants.palette.player_air
	end

	local x = player.x
	local y = player.y
	local w = player.width
	local h = player.height

	put_rectfillcolor(x, y, x + w, y + h, 110, constants.palette.player_outline)
	put_rectfillcolor(x + 1, y + 1, x + w - 1, y + h - 1, 111, constants.palette.player_body)
	put_rectfillcolor(x + 2, y + 7, x + w - 2, y + h - 2, 112, body_color)
	if player.facing > 0 then
		put_rectfillcolor(x + 10, y + 4, x + 13, y + 7, 113, constants.palette.player_outline)
	else
		put_rectfillcolor(x + 3, y + 4, x + 6, y + 7, 113, constants.palette.player_outline)
	end
end

function director:draw_ui()
	local view_w = display_width()
	put_rectfillcolor(4, 4, view_w - 4, 22, 200, constants.palette.ui_banner)
	put_glyphs(constants.ui.help_line, 8, 10, 201, self.ui_glyph_opts)
end

function director:render_frame()
	self:draw_background()
	self:draw_solids()
	self:draw_player(self.player_ref)
	self:draw_ui()
end

local function define_director_fsm()
	define_fsm(director_fsm_id, {
		initial = 'boot',
		states = {
			boot = {
				entering_state = function(self)
					self:bind_visual()
					self.player_ref = object(self.player_id)
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
			player_id = constants.ids.player_instance,
			ui_glyph_opts = { layer = 'ui', color = constants.palette.ui_text },
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

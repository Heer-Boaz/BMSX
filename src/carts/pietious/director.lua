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

function director:draw_player(player)
	local imgid = 'pietolon_stand_r'
	local sword_imgid = nil
	local sword_offset_x = constants.player.width
	local is_airborne = player.state_name == 'jumping' or player.state_name == 'stopped_jumping' or player.state_name == 'controlled_fall' or player.state_name == 'uncontrolled_fall'
	if player.state_name == 'stairs' then
		if player.stairs_direction < 0 then
			if player.stairs_anim_frame == 0 then
				imgid = 'pietolon_stairs_up_1'
			else
				imgid = 'pietolon_stairs_up_2'
			end
		elseif player.stairs_direction > 0 then
			if player.stairs_anim_frame == 0 then
				imgid = 'pietolon_stairs_down_1'
			else
				imgid = 'pietolon_stairs_down_2'
			end
		end
	elseif player.state_name == 'walking_right' or player.state_name == 'walking_left' then
		if player.walk_frame == 0 then
			imgid = 'pietolon_stand_r'
		else
			imgid = 'pietolon_walk_r'
		end
	elseif player.state_name == 'jumping' or player.state_name == 'stopped_jumping' or player.state_name == 'controlled_fall' then
		imgid = 'pietolon_jump_r'
	elseif player.state_name == 'uncontrolled_fall' then
		if player.walk_frame == 0 then
			imgid = 'pietolon_stand_r'
		else
			imgid = 'pietolon_walk_r'
		end
	end
	if player:is_slashing() then
		if is_airborne then
			imgid = 'pietolon_jumpslash_r'
			sword_imgid = 'pietolon_jumpslash_sword_r'
		else
			imgid = 'pietolon_slash_r'
			sword_imgid = 'pietolon_slash_sword_r'
		end
	end

	if player.facing > 0 then
		put_sprite(imgid, player.x, player.y, 110)
		if sword_imgid ~= nil then
			put_sprite(sword_imgid, player.x + sword_offset_x, player.y, 111)
		end
	else
		put_sprite(imgid, player.x, player.y, 110, { flip_h = true })
		if sword_imgid ~= nil then
			put_sprite(sword_imgid, player.x - sword_offset_x, player.y, 111, { flip_h = true })
		end
	end
end

function director:draw_ui()
	local hud = constants.hud
	put_sprite('game_header', 0, 0, 200)

	local health_x = hud.health_bar_x
	local health_y = hud.health_bar_y
	for i = 0, (self.hud_health_level - 1) do
		put_sprite('energybar_stripe_blue', health_x + i, health_y, 201)
	end

	local weapon_x = hud.weapon_bar_x
	local weapon_y = hud.weapon_bar_y
	for i = 0, (self.hud_weapon_level - 1) do
		put_sprite('energybar_stripe_red', weapon_x + i, weapon_y, 201)
	end
end

function director:render_frame()
	self:draw_frame_background()
	self:draw_room_tiles()
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
			hud_health_level = constants.hud.health_level,
			hud_weapon_level = constants.hud.weapon_level,
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

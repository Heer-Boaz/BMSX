local constants = require('constants.lua')

local director = {}
director.__index = director

local director_fsm_id = constants.ids.director_fsm
local player_dying_timeline_id = 'pietious.director.player_dying'
local player_hit_fall_timeline_id = 'pietious.director.player_hit_fall'
local player_hit_recovery_timeline_id = 'pietious.director.player_hit_recovery'

local function append_sprite_frames(frames, sprite_id, frame_count)
	for _ = 1, frame_count do
		frames[#frames + 1] = { player_damage_imgid = sprite_id }
	end
end

local function build_dying_sprite_frames()
	local frames = {}
	append_sprite_frames(frames, 'pietolon_dying_1', 8)
	append_sprite_frames(frames, 'pietolon_dying_2', 8)
	append_sprite_frames(frames, 'pietolon_dying_3', 8)
	append_sprite_frames(frames, 'pietolon_dying_4', 8)
	append_sprite_frames(frames, 'pietolon_dying_5', 8)
	return frames
end

local function build_hit_fall_sprite_frames()
	return {
		{ player_damage_imgid = 'pietolon_hit_r' },
	}
end

local function build_hit_recovery_sprite_frames()
	local frames = {}
	append_sprite_frames(frames, 'pietolon_recover_r', constants.damage.hit_recovery_frames)
	return frames
end

local player_dying_frames = build_dying_sprite_frames()
local player_hit_fall_frames = build_hit_fall_sprite_frames()
local player_hit_recovery_frames = build_hit_recovery_sprite_frames()

if #player_dying_frames ~= constants.damage.death_frames then
	error(string.format(
		"pietious dying timeline mismatch: %d frames vs death_frames=%d",
		#player_dying_frames,
		constants.damage.death_frames
	))
end
if #player_hit_recovery_frames ~= constants.damage.hit_recovery_frames then
	error(string.format(
		"pietious hit_recovery timeline mismatch: %d frames vs hit_recovery_frames=%d",
		#player_hit_recovery_frames,
		constants.damage.hit_recovery_frames
	))
end

function director:bind_visual()
	local rc = self:get_component('customvisualcomponent')
	rc.producer = function(_ctx)
		self:render_frame()
	end
end

function director:update_damage_state_imgid(player)
	if player.state_name == 'dying' then
		local dying_timeline = self:get_timeline(player_dying_timeline_id)
		dying_timeline:force_seek(player.death_timer)
		self.player_damage_imgid = dying_timeline:value().player_damage_imgid
		return
	end
	if player.state_name == 'hit_fall' then
		local hit_fall_timeline = self:get_timeline(player_hit_fall_timeline_id)
		hit_fall_timeline:force_seek(player.hit_substate)
		self.player_damage_imgid = hit_fall_timeline:value().player_damage_imgid
		return
	end
	if player.state_name == 'hit_recovery' then
		local hit_recovery_timeline = self:get_timeline(player_hit_recovery_timeline_id)
		hit_recovery_timeline:force_seek(player.hit_recovery_timer)
		self.player_damage_imgid = hit_recovery_timeline:value().player_damage_imgid
		return
	end
	self.player_damage_imgid = ''
end

function director:tick(_dt)
	self.player_ref = object(self.player_id)
	self:update_damage_state_imgid(self.player_ref)

	self.hud_health_level = math.floor(self.player_ref.health)
	if self.hud_health_level < 0 then
		self.hud_health_level = 0
	end
	if self.hud_health_level > constants.damage.max_health then
		self.hud_health_level = constants.damage.max_health
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
		put_rectfillcolor(enemy.x, enemy.y, enemy.w, enemy.h, 105, constants.palette.enemy_body)
		put_rectfillcolor(enemy.x + 3, enemy.y + 4, 3, 3, 106, constants.palette.enemy_eye)
		put_rectfillcolor(enemy.x + 10, enemy.y + 4, 3, 3, 106, constants.palette.enemy_eye)
	end
end

function director:draw_player(player)
	if player.hit_invulnerability_timer > 0 and player.hit_blink_on and player.state_name ~= 'dying' then
		return
	end

	local imgid = 'pietolon_stand_r'
	local sword_imgid = nil
	local sword_offset_x = constants.player.width
	local is_airborne = player.state_name == 'jumping' or player.state_name == 'stopped_jumping' or player.state_name == 'controlled_fall' or player.state_name == 'uncontrolled_fall'
	if player.state_name == 'dying' or player.state_name == 'hit_fall' or player.state_name == 'hit_recovery' then
		imgid = self.player_damage_imgid
	elseif player.state_name == 'stairs' then
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
	self:draw_room_enemies()
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
					self:define_timeline(new_timeline({
						id = player_dying_timeline_id,
						frames = player_dying_frames,
						playback_mode = 'once',
					}))
					self:define_timeline(new_timeline({
						id = player_hit_fall_timeline_id,
						frames = player_hit_fall_frames,
						playback_mode = 'once',
					}))
					self:define_timeline(new_timeline({
						id = player_hit_recovery_timeline_id,
						frames = player_hit_recovery_frames,
						playback_mode = 'once',
					}))
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
			player_damage_imgid = player_dying_frames[1].player_damage_imgid,
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

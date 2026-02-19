local constants = require('constants')

local draaideur = {}
draaideur.__index = draaideur

function draaideur:configure_from_room_def(def, _room)
	self.x = def.x
	self.y = def.y
	self.kind = def.kind
	self.state = 0
	self.state2 = 0
	self:sync_sprite()
end

function draaideur:blocks_movement()
	return self.state >= 0
end

function draaideur:touches_player(player, walking_left, walking_right)
	if walking_left then
		if rect_overlaps(
			player.x,
			player.y,
			player.width,
			player.height,
			self.x + (constants.room.tile_size / 4),
			self.y,
			constants.room.tile_size,
			constants.room.tile_size
		) then
			return true
		end
		if rect_overlaps(
			player.x,
			player.y,
			player.width,
			player.height,
			self.x + (constants.room.tile_size / 4),
			self.y + constants.room.tile_size,
			constants.room.tile_size,
			constants.room.tile_size
		) then
			return true
		end
		return false
	end

	if not walking_right then
		return false
	end
	if rect_overlaps(
		player.x,
		player.y,
		player.width,
		player.height,
		self.x - (constants.room.tile_size / 4),
		self.y,
		constants.room.tile_size,
		constants.room.tile_size
	) then
		return true
	end
	if rect_overlaps(
		player.x,
		player.y,
		player.width,
		player.height,
		self.x - (constants.room.tile_size / 4),
		self.y + constants.room.tile_size,
		constants.room.tile_size,
		constants.room.tile_size
	) then
		return true
	end
	return false
end

function draaideur:try_begin_open(player, walking_left, walking_right)
	if self.kind == 2 and walking_right then
		self.state = 0
		return
	end
	if self.kind == 3 and walking_left then
		self.state = 0
		return
	end

	self.state = self.state + 1
	if self.state < 24 then
		return
	end

	self.state = -24
	if player.x > self.x then
		self.state2 = 1
	else
		self.state2 = 0
	end
	service('c').events:emit('evt.cue.rotatedoor', {})
	player:start_slow_doorpass()
end

function draaideur:tick_active()
	if self.state < 0 then
		self.state = self.state + 1
		self:sync_sprite()
		return
	end

	local player = object('pietolon')
	local walking_left = player:has_tag('v.wl')
	local walking_right = player:has_tag('v.wr')
	local touches = self:touches_player(player, walking_left, walking_right)

	if not touches then
		self.state = 0
		self:sync_sprite()
		return
	end

	self:try_begin_open(player, walking_left, walking_right)
	self:sync_sprite()
end

function draaideur:draw_sprite_info()
	local sprite_set_prefix
	if self.kind == 1 then
		sprite_set_prefix = 'draaideur_1_'
	else
		sprite_set_prefix = 'draaideur_2_'
	end

	if self.state >= 0 then
		return sprite_set_prefix .. 'closed', 0
	end

	if self.state < -16 then
		if self.state2 == 0 then
			return sprite_set_prefix .. 'open_1', -constants.room.tile_half
		end
		return sprite_set_prefix .. 'open_3', -constants.room.tile_half
	end
	if self.state < -8 then
		return sprite_set_prefix .. 'open_2', -constants.room.tile_size
	end
	if self.state2 == 0 then
		return sprite_set_prefix .. 'open_3', -constants.room.tile_half
	end
	return sprite_set_prefix .. 'open_1', -constants.room.tile_half
end

function draaideur:sync_sprite()
	local sprite_id, draw_offset_x = self:draw_sprite_info()
	self:gfx(sprite_id)
	self.sprite_component.offset.x = draw_offset_x
end

function draaideur:ctor()
	self.collider.enabled = false
	self:sync_sprite()
end

local function define_draaideur_fsm()
	define_fsm('draaideur.fsm', {
		initial = 'active',
		states = {
			active = {
				tick = draaideur.tick_active,
			},
		},
	})
end

local function register_draaideur_definition()
	define_prefab({
		def_id = 'draaideur.def',
		class = draaideur,
		type = 'sprite',
		fsms = { 'draaideur.fsm' },
		defaults = {
			kind = 1,
			state = 0,
			state2 = 0,
			tick_enabled = true,
		},
	})
end

return {
	draaideur = draaideur,
	define_draaideur_fsm = define_draaideur_fsm,
	register_draaideur_definition = register_draaideur_definition,
}

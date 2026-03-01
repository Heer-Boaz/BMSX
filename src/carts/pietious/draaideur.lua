local constants = require('constants')
local sprite_id_by_kind = {
	[1] = {
		closed = 'draaideur_1_closed',
		open_1 = 'draaideur_1_open_1',
		open_2 = 'draaideur_1_open_2',
		open_3 = 'draaideur_1_open_3',
	},
	[2] = {
		closed = 'draaideur_2_closed',
		open_1 = 'draaideur_2_open_1',
		open_2 = 'draaideur_2_open_2',
		open_3 = 'draaideur_2_open_3',
	},
}
local closed_offset_x = 0

local draaideur = {}
draaideur.__index = draaideur

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
		self.player_was_right = true
	else
		self.player_was_right = false
	end
	object('c').events:emit('rotatedoor')
	player:start_slow_doorpass()
end

function draaideur:update_active()
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

function draaideur:sync_sprite()
	local sprite_set = sprite_id_by_kind[self.kind]
	if self.state >= 0 then
		self:gfx(sprite_set.closed)
		self.sprite_component.offset.x = closed_offset_x
		return
	end

	if self.state < -16 then
		local sprite_id = self.player_was_right and sprite_set.open_3 or sprite_set.open_1
		self:gfx(sprite_id)
		self.sprite_component.offset.x = -constants.room.tile_half
		return
	end

	if self.state < -8 then
		self:gfx(sprite_set.open_2)
		self.sprite_component.offset.x = -constants.room.tile_size
		return
	end

	if not self.player_was_right then
		self:gfx(sprite_set.open_3)
		self.sprite_component.offset.x = -constants.room.tile_half
		return
	end

	self:gfx(sprite_set.open_1)
	self.sprite_component.offset.x = -constants.room.tile_half
end

function draaideur:ctor()
	self.collider.enabled = false
	self:sync_sprite()
end

local function define_draaideur_fsm()
	define_fsm('draaideur', {
		initial = 'active',
		states = {
			active = {
				update = draaideur.update_active,
			},
		},
	})
end

local function register_draaideur_definition()
	define_prefab({
		def_id = 'draaideur',
		class = draaideur,
		type = 'sprite',
		fsms = { 'draaideur' },
		defaults = {
			kind = 1,
			state = 0,
			player_was_right = false,
		},
	})
end

return {
	draaideur = draaideur,
	define_draaideur_fsm = define_draaideur_fsm,
	register_draaideur_definition = register_draaideur_definition,
}

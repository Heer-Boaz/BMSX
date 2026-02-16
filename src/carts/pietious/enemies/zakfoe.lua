local constants = require('constants')
local behaviourtree = require('behaviourtree')
local enemy_base = require('enemies/enemy_base')
local room_module = require('room')

local zakfoe = {}
zakfoe.__index = zakfoe

function zakfoe:ctor()
	self.zak_state = 'prepare'
	self.current_vertical_speed = 0
	self.zak_ground_y = self.y
	self:gfx('zakfoe_stand')
	self.sprite_component.flip.flip_h = self.direction == 'left'
end

function zakfoe.bt_tick(self, blackboard)
	local node = blackboard.nodedata

	if self.zak_state == 'prepare' then
		local prepare_ticks = node.zak_prepare_ticks
		if prepare_ticks == nil then
			prepare_ticks = constants.enemy.zak_prepare_jump_steps
		end
		prepare_ticks = prepare_ticks - 1
		if prepare_ticks > 0 then
			node.zak_prepare_ticks = prepare_ticks
			return behaviourtree.running
		end
		node.zak_prepare_ticks = nil
		self.current_vertical_speed = constants.enemy.zak_vertical_speed_start
		self.zak_ground_y = self.y
		self.zak_state = 'jump'
		node.zak_jump_ticks = constants.enemy.zak_jump_steps
		self:gfx('zakfoe_jump')
		self.sprite_component.flip.flip_h = self.direction == 'left'
		return behaviourtree.running
	end

	if self.zak_state == 'jump' then
		local jump_ticks = node.zak_jump_ticks
		if jump_ticks == nil then
			jump_ticks = constants.enemy.zak_jump_steps
		end

		local direction_mod = self.direction == 'right' and 1 or -1
		self.x = self.x + (constants.enemy.zak_horizontal_speed_px * direction_mod)
		self.y = self.y + self.current_vertical_speed
		self.current_vertical_speed = self.current_vertical_speed + constants.enemy.zak_vertical_speed_step

		if self.direction == 'left' then
			if self.x < 0
				or room_module.is_solid_at_world(service('c').current_room, self.x + 2, self.y + 2)
				or not room_module.is_solid_at_world(service('c').current_room, self.x + 2 - constants.room.tile_half, self.y + 14 + constants.room.tile_size)
			then
				self.direction = 'right'
			end
		else
			if self.x + 14 >= service('c').current_room.world_width
				or room_module.is_solid_at_world(service('c').current_room, self.x + 14, self.y + 2)
				or not room_module.is_solid_at_world(service('c').current_room, self.x + 14 + constants.room.tile_half, self.y + 14 + constants.room.tile_size)
			then
				self.direction = 'left'
			end
		end

		jump_ticks = jump_ticks - 1
		if jump_ticks > 0 then
			node.zak_jump_ticks = jump_ticks
			return behaviourtree.running
		end
		node.zak_jump_ticks = nil
		self.y = self.zak_ground_y
		self.zak_state = 'recovery'
		self:gfx('zakfoe_recover')
		self.sprite_component.flip.flip_h = self.direction == 'left'
		node.zak_recovery_ticks = constants.enemy.zak_recovery_steps
		return behaviourtree.running
	end

	local recovery_ticks = node.zak_recovery_ticks
	if recovery_ticks == nil then
		recovery_ticks = constants.enemy.zak_recovery_steps
	end
	recovery_ticks = recovery_ticks - 1
	if recovery_ticks > 0 then
		node.zak_recovery_ticks = recovery_ticks
		return behaviourtree.running
	end
	node.zak_recovery_ticks = nil
	self.zak_state = 'prepare'
	self:gfx('zakfoe_stand')
	self.sprite_component.flip.flip_h = self.direction == 'left'
	node.zak_prepare_ticks = constants.enemy.zak_prepare_jump_steps
	return behaviourtree.running
end

function zakfoe.register_behaviour_tree(bt_id)
	behaviourtree.register_definition(bt_id, {
		root = {
			type = 'action',
			action = function(target, blackboard)
				return zakfoe.bt_tick(target, blackboard)
			end,
		},
	})
end

function zakfoe.choose_drop_type(_self)
	if math.random(100) <= constants.enemy.zak_drop_health_chance_pct then
		return 'life'
	end
	if math.random(100) <= constants.enemy.zak_drop_ammo_chance_pct then
		return 'ammo'
	end
	return 'none'
end

enemy_base.extend(zakfoe, 'zakfoe')

function zakfoe.register_enemy_definition()
	define_prefab({
		def_id = 'enemy.def.zakfoe',
		class = zakfoe,
		type = 'sprite',
		bts = { 'enemy.bt.zakfoe' },
		defaults = {
			trigger = nil,
			conditions = {},
			damage = 2,
			max_health = 2,
			health = 2,dangerous = true,
			speed_x_num = 0,
			speed_y_num = 0,
			speed_den = 1,
			speed_accum_x = 0,
			speed_accum_y = 0,
			direction = 'right',
			despawn_on_room_switch = false,
			enemy_kind = 'zakfoe',
		},
	})
end

return zakfoe

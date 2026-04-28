local constants<const> = require('constants')
local behaviourtree<const> = require('bios/behaviourtree')
local enemy_base<const> = require('enemies/enemy_base')

local zakfoe<const> = {}
zakfoe.__index = zakfoe

function zakfoe:ctor()
	self.zak_state = 'prepare'
	self.current_vertical_speed = 0
	self.zak_ground_y = self.y
	self:gfx('zakfoe_stand')
	self.sprite_component.flip.flip_h = self.direction == 'left'
end

function zakfoe.bt_tick(self, blackboard)
	local node<const> = blackboard.nodedata

	if self.zak_state == 'prepare' then
		local prepare_ticks = node.zak_prepare_ticks or constants.enemy.zak_prepare_jump_steps
		prepare_ticks = prepare_ticks - 1
		if prepare_ticks > 0 then
			node.zak_prepare_ticks = prepare_ticks
			return 'RUNNING'
		end
		node.zak_prepare_ticks = nil
		self.current_vertical_speed = constants.enemy.zak_vertical_speed_start
		self.zak_ground_y = self.y
		self.zak_state = 'jump'
		node.zak_jump_ticks = constants.enemy.zak_jump_steps
		self:gfx('zakfoe_jump')
		self.sprite_component.flip.flip_h = self.direction == 'left'
		return 'RUNNING'
	end

	if self.zak_state == 'jump' then
		local jump_ticks = node.zak_jump_ticks or constants.enemy.zak_jump_steps

		local direction_mod<const> = self.direction == 'right' and 1 or -1
		self.x = self.x + (constants.enemy.zak_horizontal_speed_px * direction_mod)
		self.y = self.y + self.current_vertical_speed
		self.current_vertical_speed = self.current_vertical_speed + constants.enemy.zak_vertical_speed_step

		if self.direction == 'left' then
			local rm<const> = oget('room')
			if self.x < 0
				or rm:has_collision_flags_at_world(self.x + 2, self.y + 2, constants.collision_flags.solid_mask)
				or not rm:has_collision_flags_at_world(self.x + 2 - constants.room.tile_half, self.y + 14 + constants.room.tile_size, constants.collision_flags.solid_mask)
			then
				self.direction = 'right'
			end
		else
			local rm<const> = oget('room')
			if self.x + 14 >= rm.world_width
				or rm:has_collision_flags_at_world(self.x + 14, self.y + 2, constants.collision_flags.solid_mask)
				or not rm:has_collision_flags_at_world(self.x + 14 + constants.room.tile_half, self.y + 14 + constants.room.tile_size, constants.collision_flags.solid_mask)
			then
				self.direction = 'left'
			end
		end

		jump_ticks = jump_ticks - 1
		if jump_ticks > 0 then
			node.zak_jump_ticks = jump_ticks
			return 'RUNNING'
		end
		node.zak_jump_ticks = nil
		self.y = self.zak_ground_y
		self.zak_state = 'recovery'
		self:gfx('zakfoe_recover')
		self.sprite_component.flip.flip_h = self.direction == 'left'
		node.zak_recovery_ticks = constants.enemy.zak_recovery_steps
		return 'RUNNING'
	end

	local recovery_ticks = node.zak_recovery_ticks or constants.enemy.zak_recovery_steps
	recovery_ticks = recovery_ticks - 1
	if recovery_ticks > 0 then
		node.zak_recovery_ticks = recovery_ticks
		return 'RUNNING'
	end
	node.zak_recovery_ticks = nil
	self.zak_state = 'prepare'
	self:gfx('zakfoe_stand')
	self.sprite_component.flip.flip_h = self.direction == 'left'
	node.zak_prepare_ticks = constants.enemy.zak_prepare_jump_steps
	return 'RUNNING'
end

function zakfoe.register_behaviour_tree(bt_id)
	behaviourtree.register_definition(bt_id, {
		root = {
			type = 'ACTION',
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
	return nil
end

enemy_base.extend(zakfoe, 'zakfoe')

function zakfoe.register_enemy_definition()
	define_prefab({
		def_id = 'enemy.zakfoe',
		class = zakfoe,
		type = 'sprite',
		bts = { 'enemy_zakfoe' },
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
			enemy_kind = 'zakfoe',
		},
	})
end

return zakfoe

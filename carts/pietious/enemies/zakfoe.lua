local prefab<const> = require('cartlib/world/prefab')
local spriteobject<const> = require('cartlib/sprite')
require('constants')
local behaviourtree<const> = require('cartlib/behaviourtree/bt')
local bt_running<const> = behaviourtree.result.running
local behaviourtreelibrary<const> = require('cartlib/behaviourtree/library')
local btcomponent<const> = require('cartlib/behaviourtree/btcomponent')
local enemy_base<const> = require('enemies/enemy_base')

local zakfoe<const> = {}
zakfoe.__index = zakfoe

function zakfoe:ctor()
	self.zak_state = 'prepare'
	self.current_vertical_speed = 0
	self.zak_ground_y = self.y
	self:set_imgid('zakfoe_stand')
	self.sprite_component.flip_h = self.direction == 'left'
end

function zakfoe.bt_tick(self, blackboard)
	local node<const> = blackboard.node_data

	if self.zak_state == 'prepare' then
		local prepare_ticks = node.zak_prepare_ticks or enemy_zak_prepare_jump_steps
		prepare_ticks = prepare_ticks - 1
		if prepare_ticks > 0 then
			node.zak_prepare_ticks = prepare_ticks
			return bt_running
		end
		node.zak_prepare_ticks = nil
		self.current_vertical_speed = enemy_zak_vertical_speed_start
		self.zak_ground_y = self.y
		self.zak_state = 'jump'
		node.zak_jump_ticks = enemy_zak_jump_steps
		self:set_imgid('zakfoe_jump')
		self.sprite_component.flip_h = self.direction == 'left'
		return bt_running
	end

	if self.zak_state == 'jump' then
		local jump_ticks = node.zak_jump_ticks or enemy_zak_jump_steps

		local direction_mod<const> = self.direction == 'right' and 1 or -1
		self.x = self.x + (enemy_zak_horizontal_speed_px * direction_mod)
		self.y = self.y + self.current_vertical_speed
		self.current_vertical_speed = self.current_vertical_speed + enemy_zak_vertical_speed_step

		if self.direction == 'left' then
			local rm<const> = self.room
			if self.x < 0
				or rm:has_collision_flags_at_world(self.x + 2, self.y + 2, collision_flags_solid_mask)
				or not rm:has_collision_flags_at_world(self.x + 2 - room_tile_half, self.y + 14 + room_tile_size, collision_flags_solid_mask)
			then
				self.direction = 'right'
			end
		else
			local rm<const> = self.room
			if self.x + 14 >= rm.world_width
				or rm:has_collision_flags_at_world(self.x + 14, self.y + 2, collision_flags_solid_mask)
				or not rm:has_collision_flags_at_world(self.x + 14 + room_tile_half, self.y + 14 + room_tile_size, collision_flags_solid_mask)
			then
				self.direction = 'left'
			end
		end

		jump_ticks = jump_ticks - 1
		if jump_ticks > 0 then
			node.zak_jump_ticks = jump_ticks
			return bt_running
		end
		node.zak_jump_ticks = nil
		self.y = self.zak_ground_y
		self.zak_state = 'recovery'
		self:set_imgid('zakfoe_recover')
		self.sprite_component.flip_h = self.direction == 'left'
		node.zak_recovery_ticks = enemy_zak_recovery_steps
		return bt_running
	end

	local recovery_ticks = node.zak_recovery_ticks or enemy_zak_recovery_steps
	recovery_ticks = recovery_ticks - 1
	if recovery_ticks > 0 then
		node.zak_recovery_ticks = recovery_ticks
		return bt_running
	end
	node.zak_recovery_ticks = nil
	self.zak_state = 'prepare'
	self:set_imgid('zakfoe_stand')
	self.sprite_component.flip_h = self.direction == 'left'
	node.zak_prepare_ticks = enemy_zak_prepare_jump_steps
	return bt_running
end

function zakfoe.choose_drop_type(_self)
	if math.random(100) <= enemy_zak_drop_health_chance_pct then
		return 'life'
	end
	if math.random(100) <= enemy_zak_drop_ammo_chance_pct then
		return 'ammo'
	end
	return nil
end

enemy_base.extend(zakfoe, 'zakfoe')

function zakfoe.register()
	local root<const> = behaviourtree.action_node.new('enemy_zakfoe', zakfoe.bt_tick)
	behaviourtreelibrary.register(root)
	prefab.define({
		def_id = 'enemy.zakfoe',
		class = zakfoe,
		base = spriteobject,
		components = { btcomponent.factory(root.id) },
		defaults = {
			trigger = nil,
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

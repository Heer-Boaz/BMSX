local behaviourtree = require('behaviourtree')
local enemy_base = require('enemies/enemy_base')

local vlokfoe = {}
vlokfoe.__index = vlokfoe

function vlokfoe:ctor()
	self:gfx('vlok')
end

function vlokfoe.bt_tick(self, _blackboard)
	move_with_velocity(self)
	if self:projectile_is_out_of_bounds() then
		self:mark_for_disposal()
	end
	return behaviourtree.running
end

function vlokfoe.register_behaviour_tree(bt_id)
	behaviourtree.register_definition(bt_id, {
		root = {
			type = 'action',
			action = function(target, blackboard)
				return vlokfoe.bt_tick(target, blackboard)
			end,
		},
	})
end

function vlokfoe.choose_drop_type(_self)
	return nil
end

enemy_base.extend(vlokfoe, 'vlokfoe')

function vlokfoe.register_enemy_definition()
	define_prefab({
		def_id = 'enemy.vlokfoe',
		class = vlokfoe,
		type = 'sprite',
		bts = { 'enemy.bt.vlokfoe' },
		defaults = {
			trigger = nil,
			conditions = {},
			damage = 2,
			max_health = 1,
			health = 1,dangerous = true,
			speed_x_num = 0,
			speed_y_num = 0,
			speed_den = 1,
			speed_accum_x = 0,
			speed_accum_y = 0,
			direction = 'right',
			despawn_on_room_switch = true,
			enemy_kind = 'vlokfoe',
		},
	})
end

return vlokfoe

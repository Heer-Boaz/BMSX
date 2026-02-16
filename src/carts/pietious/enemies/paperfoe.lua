local behaviourtree = require('behaviourtree')
local enemy_base = require('enemies/enemy_base')

local paperfoe = {}
paperfoe.__index = paperfoe

function paperfoe:ctor()
	self:gfx('boekfoe_paper')
	self.sprite_component.flip.flip_h = self.speed_x_num < 0
end

function paperfoe.bt_tick(self, _blackboard)
	move_with_velocity(self)
	if self:projectile_is_out_of_bounds() then
		self:mark_for_disposal()
	end
	return behaviourtree.running
end

function paperfoe.register_behaviour_tree(bt_id)
	behaviourtree.register_definition(bt_id, {
		root = {
			type = 'action',
			action = function(target, blackboard)
				return paperfoe.bt_tick(target, blackboard)
			end,
		},
	})
end

function paperfoe.choose_drop_type(_self, _random_percent_hit)
	return 'none'
end

enemy_base.extend(paperfoe, 'paperfoe')

function paperfoe.register_enemy_definition()
	define_prefab({
		def_id = 'enemy.def.paperfoe',
		class = paperfoe,
		type = 'sprite',
		bts = { 'enemy.bt.paperfoe' },
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
			enemy_kind = 'paperfoe',
		},
	})
end

return paperfoe

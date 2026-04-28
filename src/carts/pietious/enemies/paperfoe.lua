local behaviourtree<const> = require('bios/behaviourtree')
local enemy_base<const> = require('enemies/enemy_base')

local paperfoe<const> = {}
paperfoe.__index = paperfoe

function paperfoe:ctor()
	self:gfx('boekfoe_paper')
	self.sprite_component.flip.flip_h = self.speed_x_num < 0
	enemy_base.setup_projectile_boundary(self)
end

function paperfoe.bt_tick(self, _blackboard)
	move_with_velocity(self)
	return 'RUNNING'
end

function paperfoe.register_behaviour_tree(bt_id)
	behaviourtree.register_definition(bt_id, {
		root = {
			type = 'ACTION',
			action = function(target, blackboard)
				return paperfoe.bt_tick(target, blackboard)
			end,
		},
	})
end

function paperfoe.choose_drop_type(_self, _random_percent_hit)
	return nil
end

enemy_base.extend(paperfoe, 'paperfoe')

function paperfoe.register_enemy_definition()
	define_prefab({
		def_id = 'enemy.paperfoe',
		class = paperfoe,
		type = 'sprite',
		bts = { 'enemy_paperfoe' },
		defaults = {
			trigger = nil,
			conditions = {},
			damage = 2,
			max_health = 1,
			health = 1,
			dangerous = true,
			speed_x_num = 0,
			speed_y_num = 0,
			speed_den = 1,
			speed_accum_x = 0,
			speed_accum_y = 0,
			direction = 'right',
			enemy_kind = 'paperfoe',
		},
	})
end

return paperfoe

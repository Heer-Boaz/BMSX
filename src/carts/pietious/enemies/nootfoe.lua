local behaviourtree<const> = require('behaviourtree')
local enemy_base<const> = require('enemies/enemy_base')

local nootfoe<const> = {}
nootfoe.__index = nootfoe

local noot_colors<const> = {
	{ r = 1, g = 1, b = 1, a = 1 },
	{ r = 1, g = 0, b = 0, a = 1 },
	{ r = 0, g = 1, b = 1, a = 1 },
	{ r = 0, g = 1, b = 0, a = 1 },
	{ r = 1, g = 0.75, b = 0.8, a = 1 },
	{ r = 1, g = 1, b = 0, a = 1 },
	{ r = 0.93, g = 0.51, b = 0.93, a = 1 },
}

function nootfoe:ctor()
	self.noot_color = noot_colors[math.random(1, #noot_colors)]
	self:gfx('muzieknootfoe')
	self.sprite_component.colorize = self.noot_color
	oget('c').events:emit('muzieknootspawn')
	enemy_base.setup_projectile_boundary(self)
end

function nootfoe.bt_tick(self, _blackboard)
	move_with_velocity(self)
	return 'RUNNING'
end

function nootfoe.register_behaviour_tree(bt_id)
	behaviourtree.register_definition(bt_id, {
		root = {
			type = 'ACTION',
			action = function(target, blackboard)
				return nootfoe.bt_tick(target, blackboard)
			end,
		},
	})
end

function nootfoe.choose_drop_type(_self)
	return nil
end

enemy_base.extend(nootfoe, 'nootfoe')

function nootfoe.register_enemy_definition()
	define_prefab({
		def_id = 'enemy.nootfoe',
		class = nootfoe,
		type = 'sprite',
		bts = { 'enemy_nootfoe' },
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
			enemy_kind = 'nootfoe',
		},
	})
end

return nootfoe

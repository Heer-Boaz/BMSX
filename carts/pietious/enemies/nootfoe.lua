local prefab<const> = require('cartlib/prefab')
local spriteobject<const> = require('cartlib/sprite')
local velocity<const> = require('cartlib/velocity')
local world<const> = require('cartlib/world/world')
local behaviourtree<const> = require('cartlib/behaviourtree')
local behaviourtreecomponent<const> = require('cartlib/behaviourtree/component')
local enemy_base<const> = require('enemies/enemy_base')

local nootfoe<const> = {}
nootfoe.__index = nootfoe

local noot_colors<const> = {
	0xffffffff,
	0xffff0000,
	0xff00ffff,
	0xff00ff00,
	0xffffbfcc,
	0xffffff00,
	0xffed82ed,
}

function nootfoe:ctor()
	self.noot_color = noot_colors[math.random(1, #noot_colors)]
	self:gfx('muzieknootfoe')
	self.sprite_component.color = self.noot_color
	world:get('c').events:emit('muzieknootspawn')
	enemy_base.setup_projectile_boundary(self)
end

function nootfoe.bt_tick(self, _blackboard)
	velocity.move_with_velocity(self)
	return 'RUNNING'
end

function nootfoe.choose_drop_type(_self)
	return nil
end

enemy_base.extend(nootfoe, 'nootfoe')

function nootfoe.register()
	prefab.define({
		def_id = 'enemy.nootfoe',
		class = nootfoe,
		base = spriteobject,
		components = { behaviourtreecomponent.factory(behaviourtree.action.new('enemy_nootfoe', nootfoe.bt_tick)) },
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

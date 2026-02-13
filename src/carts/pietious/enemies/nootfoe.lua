local behaviourtree = require('behaviourtree')

local nootfoe = {}

local noot_colors = {
	{ r = 1, g = 1, b = 1, a = 1 },
	{ r = 1, g = 0, b = 0, a = 1 },
	{ r = 0, g = 1, b = 1, a = 1 },
	{ r = 0, g = 1, b = 0, a = 1 },
	{ r = 1, g = 0.75, b = 0.8, a = 1 },
	{ r = 1, g = 1, b = 0, a = 1 },
	{ r = 0.93, g = 0.51, b = 0.93, a = 1 },
}

function nootfoe.configure(self, def)
	self.width = 8
	self.height = 8
	self.max_health = 1
	self.health = self.max_health
	self.damage = 2
	self.despawn_on_room_switch = true
	self.noot_color = noot_colors[math.random(1, #noot_colors)]
	self.sprite_component.imgid = 'muzieknootfoe'
	self.sprite_component.colorize = self.noot_color
end

function nootfoe.bt_tick(self, _blackboard)
	self:move_with_velocity()
	if self:projectile_is_out_of_bounds() then
		self:mark_for_disposal()
	end
	return behaviourtree.running
end

function nootfoe.register_behaviour_tree(bt_id)
	behaviourtree.register_definition(bt_id, {
		root = {
			type = 'action',
			action = function(target, blackboard)
				return nootfoe.bt_tick(target, blackboard)
			end,
		},
	})
end

function nootfoe.choose_drop_type(_self, _random_percent_hit)
	return 'none'
end

return nootfoe

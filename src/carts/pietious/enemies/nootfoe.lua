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
	self.width = def.w or 8
	self.height = def.h or 8
	self.max_health = def.health or 1
	self.health = self.max_health
	self.damage = def.damage or 2
	self.despawn_on_room_switch = true
	self.projectile_bound_right = 6
	self.projectile_bound_bottom = 8
	self.noot_color = noot_colors[math.random(1, #noot_colors)]
	self:set_body_hit_area(2, 0, 6, 8)
end

function nootfoe.sync_components(self)
	local imgid = 'muzieknootfoe'
	local flip_h = false
	local flip_v = false
	self:set_body_sprite(imgid, flip_h, flip_v, self.noot_color)
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

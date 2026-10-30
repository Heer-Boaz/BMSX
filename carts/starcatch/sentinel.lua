local bt_component<const> = require('cartlib/behaviour_tree/bt_component')
local bt_library<const> = require('cartlib/behaviour_tree/library')
local bt_result<const> = require('cartlib/behaviour_tree/result')
local timeline_component<const> = require('cartlib/timeline/timeline_component')
local prefab<const> = require('cartlib/world/prefab')
local poses<const> = require('poses')

local sentinel_module<const> = {}
local sentinel<const> = {}
local align<const> = {
	tick = function(enemy)
		enemy.mode = 'align'
		local target<const> = enemy.game.player.spatial:resolve_world()
		local pose<const> = enemy.spatial:resolve_world()
		local next_x
		if pose.wox < target.wox then next_x = math.min(target.wox, pose.wox + 1.25)
		else next_x = math.max(target.wox, pose.wox - 1.25) end
		pose:set_world_origin(next_x, pose.woy, pose.woz)
		pose:resolve_world()
		if math.abs(pose.wox - target.wox) <= 4 then return bt_result.success end
		return bt_result.running
	end,
}
local arm<const> = {
	tick = function(enemy)
		enemy.mode = 'charge'
		return bt_result.success
	end,
}
local fire<const> = {
	tick = function(enemy)
		enemy.mode = 'fire'
		enemy.game:fire_enemy(enemy)
		return bt_result.success
	end,
}

function sentinel:ctor(options)
	self.game = options.game
	self.mode = 'align'
	self.charge = 0
	self.brain = self:get_component(bt_component)
	self.brain:stop()
	self.timelines:define('charge', poses.enemy_charge)
end

function sentinel_module.install()
	bt_library.register('starcatch.sentinel', {
		root = { type = 'sequence', children = {
			{ type = 'task', task = align },
			{ type = 'task', task = arm },
			{ type = 'timeline', timeline_id = 'charge' },
			{ type = 'task', task = fire },
		} },
	})
	prefab.define({ def_id = 'starcatch.sentinel', class = sentinel,
		spatial = { family = '3d', authority = 'affine', local_transform = { 1,0,0,0,1,0,0,0,1,0,0,512 } },
		components = { timeline_component.new, bt_component.factory('starcatch.sentinel') } })
end

return sentinel_module

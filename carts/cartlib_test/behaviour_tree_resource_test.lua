local assets<const> = require('bmsx/assets')
local blackboard<const> = require('cartlib/behaviour_tree/blackboard')
local bt_component<const> = require('cartlib/behaviour_tree/bt_component')
local bt_resource<const> = require('cartlib/behaviour_tree/resource')
local bt_result<const> = require('cartlib/behaviour_tree/result')
local registry<const> = require('cartlib/registry')

local tree_id<const> = 'cartlib_resource_fixture'
local resource_address<const> = assets.data_behaviour_tree_resource_fixture_addr
local score_key<const> = blackboard.key('score')
local target<const> = {
	active = true,
	condition_checks = 0,
	recorded_score = 0,
	service_ticks = 0,
}

local record_task<const> = {
	execute = function(self, execution)
		self.recorded_score = execution.blackboard:get(score_key)
		return bt_result.success
	end,
}
local replacement_record_task<const> = {
	execute = function(self, execution)
		self.recorded_score = execution.blackboard:get(score_key) + 100
		return bt_result.success
	end,
}
local pulse_service<const> = {
	on_tick = function(self)
		self.service_ticks = self.service_ticks + 1
	end,
}
local ready_decorator<const> = {
	evaluate = function(self)
		self.condition_checks = self.condition_checks + 1
		return true
	end,
}

local manifest<const> = {
	blackboard = { score_key },
	tasks = { record = record_task },
	services = { pulse = pulse_service },
	decorators = { ready = ready_decorator },
}
bt_resource.register(resource_address, manifest)

local tree<const> = bt_component.new({ parent = target }, tree_id)
tree.id = 'cartlib_resource_fixture_component'
registry:register(tree)
registry:index(tree, bt_component)

local first_evaluate<const> = tree.evaluate
assert(first_evaluate(target, tree, tree.operand) == bt_result.success)
assert(target.recorded_score == 12)
assert(target.service_ticks == 1)
assert(target.condition_checks == 1)

tree.blackboard:set(score_key, 99)
assert(not pcall(function()
	bt_resource.register(resource_address, {
		blackboard = { score_key },
		tasks = {},
		services = { pulse = pulse_service },
		decorators = { ready = ready_decorator },
	})
end))
assert(not pcall(function()
	bt_resource.register(resource_address, {
		blackboard = { score_key },
		tasks = { record = record_task },
		services = { pulse = {} },
		decorators = { ready = ready_decorator },
	})
end))
assert(tree.evaluate == first_evaluate)
assert(tree.blackboard:get(score_key) == 99)

bt_resource.register(resource_address, {
	blackboard = { score_key },
	tasks = { record = replacement_record_task },
	services = { pulse = pulse_service },
	decorators = { ready = ready_decorator },
})
assert(tree.evaluate ~= first_evaluate)
assert(tree.blackboard:get(score_key) == 99)
assert(tree.evaluate(target, tree, tree.operand) == bt_result.success)
assert(target.recorded_score == 112)

cartlib_test_behaviour_tree_resource_ready = true

/** Actual cartlib compilation, publication, two actors and mutable input aliases. */
export const BT_COMPILATION_PROBE_SOURCE = `
local library<const> = require('cartlib/behaviour_tree/library')
local component<const> = require('cartlib/behaviour_tree/bt_component')
local registry<const> = require('cartlib/registry')
local recorder<const> = require('testlib/behaviour_tree/compile_recorder')
local result<const> = require('cartlib/behaviour_tree/result')

local task<const> = {
	node_memory = true,
	execute = function(_, memory)
		memory.ticks = 0
		return result.running
	end,
	tick = function(target, memory)
		memory.ticks = memory.ticks + 1
		target.ticks = target.ticks + 1
		if memory.ticks == 3 then return result.success end
		return result.running
	end,
}
local service<const> = { on_tick = function(target) target.services = target.services + 1 end }
local predicate<const> = { evaluate = function(target) target.predicates = target.predicates + 1; return true end }

probe = {}
function probe.observe()
	probe.recorder = recorder.new()
end
function probe.compile(width, retain)
	local shared<const> = { type = 'task', task = task }
	local children<const> = {}
	for index = 1, width do
		children[index] = { type = 'sequence', children = { shared } }
	end
	local definition<const> = { root = {
		type = 'sequence', children = children,
		services = { { service = service, interval = { period_units = 2, units_per_tick = 1 } } },
		decorators = { { type = 'predicate', decorator = predicate } },
	} }
	library.register('probe', definition)
	probe.weak_inputs = setmetatable({ definition, shared }, { __mode = 'v' })
	if retain then probe.definition = definition else probe.definition = nil end
	if probe.first == nil then
		probe.first = component.new({ parent = { ticks = 0, services = 0, predicates = 0 } }, 'probe')
		probe.second = component.new({ parent = { ticks = 0, services = 0, predicates = 0 } }, 'probe')
		probe.first.id = 'probe.first'
		probe.second.id = 'probe.second'
		for _, instance in ipairs({ probe.first, probe.second }) do
			registry:register(instance)
			registry:index(instance, component)
		end
	end
end
function probe.run(count)
	local first<const> = probe.first
	local second<const> = probe.second
	for index = 1, count do
		first.evaluate(first.parent, first, first.operand)
		second.evaluate(second.parent, second, second.operand)
	end
end
function probe.check()
	local compiled<const> = probe.recorder.completed_bindings[probe.first]
	local capture<const> = probe.recorder.programs[compiled]
	local nodes<const> = capture.nodes
	assert(compiled.evaluate == probe.first.evaluate and compiled.reset == probe.first.reset)
	assert(probe.recorder.completed_bindings[probe.second] == compiled)
	assert(capture.node_count == 5 and capture.declaration_count == 4)
	assert(nodes.type[1] == 'sequence' and nodes.parent[1] == 0 and nodes.subtree_end[1] == 5)
	assert(nodes.type[2] == 'sequence' and nodes.parent[2] == 1 and nodes.subtree_end[2] == 3)
	assert(nodes.type[3] == 'task' and nodes.parent[3] == 2 and nodes.subtree_end[3] == 3)
	assert(nodes.parent[4] == 1 and nodes.subtree_end[4] == 5 and nodes.parent[5] == 4)
	assert(nodes.declaration[3] == nodes.declaration[5])
	assert(nodes.evaluate[2] == nodes.evaluate[3] and nodes.reset[2] == nodes.reset[3])
	assert(nodes.evaluate[4] == nodes.evaluate[5])
	assert(nodes.evaluate[3] ~= nodes.evaluate[5])
	assert(nodes.first_slot[2] == nodes.first_slot[3] and nodes.last_slot[2] == nodes.last_slot[3])
	assert(nodes.last_slot[3] < nodes.first_slot[5])
	assert(nodes.last_slot[1] == capture.slot_count)
	assert(capture.service_count == 1 and #capture.record_slots == 2)
	assert(probe.first.evaluate == probe.second.evaluate)
	assert(probe.first._execution_state ~= probe.second._execution_state)
	for _, slot in ipairs(capture.record_slots) do
		assert(probe.first._execution_state[slot] ~= probe.second._execution_state[slot])
	end
end
function probe.mutate()
	local root<const> = probe.definition.root
	root.type = 'selector'
	root.children[1].type = 'selector'
	root.children[1].children[1].type = 'wait'
	root.children[1].children[1].duration_ticks = 99
	root.children[2] = nil
	assert(root.type == 'selector' and #root.children == 1)
end
function probe.drop_definition()
	probe.definition = nil
end
function probe.check_replaced()
	local previous_program<const> = probe.recorder.completed_bindings[probe.first]
	local previous<const> = probe.recorder.programs[previous_program]
	local weak<const> = setmetatable({ previous, previous_program, previous.nodes }, { __mode = 'v' })
	probe.compile(2, false)
	local current_program<const> = probe.recorder.completed_bindings[probe.first]
	local current<const> = probe.recorder.programs[current_program]
	assert(current ~= previous and current_program ~= previous_program)
	assert(current.nodes.parent ~= previous.nodes.parent)
	probe.displaced = weak
end
function probe.check_unobserved()
	assert(probe.first.parent.ticks == 0 and probe.second.parent.ticks == 0)
	assert(probe.first.parent.services == 0 and probe.second.parent.services == 0)
	assert(probe.first.parent.predicates == 0 and probe.second.parent.predicates == 0)
end
`;

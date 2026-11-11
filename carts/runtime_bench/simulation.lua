local world<const> = require('cartlib/world/world')
local prefab<const> = require('cartlib/world/prefab')
local registry<const> = require('cartlib/registry')
local base_system<const> = require('cartlib/world/base_system')
local clock<const> = require('cartlib/clock')
local tick_group<const> = require('cartlib/world/tick_group')
local actor<const> = require('actor')
local model<const> = require('model')

local simulation<const> = {}
local sizes<const> = { 16, 128, 512 }
local state<const> = {
	mode = 3, size_index = 1, count = sizes[1], target_steps = 256,
	steps = 0, work = 0, checksum = 0, events = 0, replacements = 0,
	generation = 0, finished = false,
	rows = {}, actor_ids = {}, payload = { pulse = 0 },
}
simulation.state = state
simulation.sizes = sizes
local actor_view
local clock_object

local system<const> = {}
system.__index = system
setmetatable(system, { __index = base_system })
system.tick = {
	group = tick_group.gameplay, priority = 0, clock_source = clock.gameplay, method = 'update',
}

function system.new()
	actor_view = world:active_definition_view('bench.actor')
	return setmetatable(base_system.new(system.tick), system)
end

function simulation.install()
	prefab.define({ def_id = 'bench.actor', class = actor })
	prefab.define({ def_id = 'bench.clock' })
end

function simulation.reset(mode, size_index)
	state.mode, state.size_index = mode, size_index
	state.count = sizes[size_index]
	state.steps, state.work, state.checksum, state.events, state.replacements = 0, 0, 0, 0, 0
	state.generation = state.generation + 1
	state.finished = false
	state.payload.pulse = 0
	state.rows, state.actor_ids = {}, {}
	world:clear()
	clock_object = world:spawn('bench.clock', { id = 'bench.clock' })
	for index = 1, state.count do
		if mode == 1 then
			state.rows[index] = model.new(index, 0)
		else
			local id<const> = 'bench.actor.' .. index
			state.actor_ids[index] = id
			world:spawn('bench.actor', { id = id, index = index, generation = 0, counters = state })
		end
	end
end

function system:update()
	if state.finished then return end
	local step<const> = state.steps + 1
	local pulse<const> = step % 8 == 0
	local checksum = 0
	if state.mode == 1 then
		local rows<const> = state.rows
		for index = 1, state.count do
			local row<const> = rows[index]
			if pulse then
				model.pulse(row, step)
				state.events = state.events + 1
			end
			checksum = (checksum + model.step(row, step)) & 0x7fffffff
		end
	else
		if pulse then
			state.payload.pulse = step
			clock_object.events:emit('bench.pulse', state.payload)
		end
		local actors<const> = actor_view.objects
		for index = 1, #actors do
			checksum = (checksum + actors[index]:step(step)) & 0x7fffffff
		end
	end
	-- A bounded, intentional lifecycle workload: one replacement every 16
	-- updates, not unbounded per-frame garbage. World commits at its barrier.
	if step % 16 == 0 then
		local slot<const> = state.replacements % state.count + 1
		state.replacements = state.replacements + 1
		if state.mode == 1 then
			state.rows[slot] = model.new(slot, state.replacements)
		else
			local previous<const> = registry:get(state.actor_ids[slot])
			previous:mark_for_disposal()
			local id<const> = 'bench.actor.' .. slot .. '.' .. state.replacements
			state.actor_ids[slot] = id
			world:spawn('bench.actor', { id = id, index = slot, generation = state.replacements, counters = state })
		end
	end
	state.steps = step
	state.work = state.work + state.count
	state.checksum = ((state.checksum << 1) ~ checksum) & 0x7fffffff
	state.finished = step == state.target_steps
end

function simulation.rows()
	return state.mode == 1 and state.rows or actor_view.objects
end

simulation.system = system
return simulation

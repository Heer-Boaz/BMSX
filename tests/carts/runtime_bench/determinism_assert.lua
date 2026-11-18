local simulation<const> = require('simulation')
local expected_checksums<const> = { 1726556469, 1659401335, 831473187 }
local registry<const> = require('cartlib/registry')

local snapshot<const> = function()
	local state<const> = runtime_bench
	assert(state.finished and state.steps == 256 and state.work == state.count * 256,
		'fixed run did not complete its declared update work')
	assert(state.events == state.count * 32 and state.replacements == 16,
		'event/lifecycle work changed, or retired listeners survived replacement')
	local captured<const> = { checksum = state.checksum, rows = {} }
	local rows<const> = simulation.rows()
	assert(#rows == state.count, 'world admission/disposal changed live population')
	for index = 1, #rows do
		local row<const> = state.mode == 1 and rows[index] or rows[index].state
		local values<const> = { row.x, row.y, row.velocity.x, row.velocity.y,
			row.stats.energy, row.stats.visits, row.stats.pulses }
		for slot = 1, 8 do values[7 + slot] = row.history[slot] end
		captured.rows[row.index] = values
		if state.mode ~= 1 then
			assert(registry:get(state.actor_ids[row.index]) == rows[index], 'registry identity differs from live view')
			if row.stats.visits ~= 0 then
				assert((not not rows[index]:has_tag('charged')) == (row.stats.energy >= 128), 'property/tag publication drifted')
			end
		end
	end
	return captured
end

local compare<const> = function(expected, actual)
	assert(actual.checksum == expected.checksum, 'drawing or object dispatch changed the simulation checksum')
	for index = 1, #expected.rows do
		for field = 1, 15 do
			assert(actual.rows[index][field] == expected.rows[index][field], 'mode/restart changed a raw gameplay field')
		end
	end
end

local exercise<const> = function(t, size)
	local pad<const> = size == 2 and 1 or nil
	t:wait_until('real BIOS/cartlib boot', function() return runtime_bench_ready end, 500)
	for selected = 2, size do
		t:press(pad and 'up' or 'ArrowUp', 3, pad)
		t:wait_until('larger population', function() return runtime_bench.size_index == selected end, 300)
	end
	assert(runtime_bench.mode == 3 and runtime_bench.size_index == size)
	t:wait_until('draw workload complete', function() return runtime_bench.finished end, 2000)
	local expected<const> = snapshot()
	assert(expected.checksum == expected_checksums[size], 'fixed workload result changed')
	t:log(string.format('runtime_bench rows=%d checksum=%d', runtime_bench.count, expected.checksum))
	if size == 1 then t:capture('world-draw-complete') end
	t:press(pad and 'left' or 'ArrowLeft', 3, pad)
	t:wait_until('no-draw selection', function() return runtime_bench.mode == 2 end, 120)
	t:wait_until('no-draw workload complete', function() return runtime_bench.finished end, 2000)
	compare(expected, snapshot())
	t:press(pad and 'left' or 'ArrowLeft', 3, pad)
	t:wait_until('plain selection', function() return runtime_bench.mode == 1 end, 120)
	t:wait_until('plain workload complete', function() return runtime_bench.finished end, 2000)
	compare(expected, snapshot())
	local generation<const> = runtime_bench.generation
	t:press(pad and 'a' or 'KeyX', 3, pad)
	t:wait_until('physical restart', function() return runtime_bench.generation == generation + 1 end, 120)
	t:wait_until('repeat workload complete', function() return runtime_bench.finished end, 2000)
	compare(expected, snapshot())
	t:wait_ticks(5)
	compare(expected, snapshot())
end

return {
	kind = 'integration',
	tests = {
		['small: physical selection, render independence and restart'] = function(t) exercise(t, 1) end,
		['medium: physical selection, render independence and restart'] = function(t) exercise(t, 2) end,
		['broad: physical selection, render independence and restart'] = function(t) exercise(t, 3) end,
	},
}

-- Deterministic gameplay state, independent of presentation and host time.
local model<const> = {}

function model.new(index, generation)
	return {
		index = index,
		x = (index * 17 + generation * 3) % 304,
		y = (index * 29 + generation * 5) % 160,
		velocity = { x = index % 3 + 1, y = index % 2 + 1 },
		stats = { energy = 100 + index % 31, visits = 0, pulses = 0 },
		history = { 0, 0, 0, 0, 0, 0, 0, 0 },
	}
end

function model.pulse(row, pulse)
	local stats<const> = row.stats
	stats.energy = (stats.energy + pulse + row.index) % 257
	stats.pulses = stats.pulses + 1
end

function model.step(row, step)
	local velocity<const> = row.velocity
	row.x = (row.x + velocity.x) % 304
	row.y = (row.y + velocity.y) % 160
	local stats<const> = row.stats
	stats.visits = stats.visits + 1
	stats.energy = (stats.energy + row.x + row.y + row.index) % 257
	row.history[(step & 7) + 1] = stats.energy
	if (step + row.index) % 23 == 0 then
		velocity.x, velocity.y = velocity.y, velocity.x
	end
	return (row.x * 17 + row.y * 31 + stats.energy * 7 + stats.visits + stats.pulses * 13) & 0x7fffffff
end

return model

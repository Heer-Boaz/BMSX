local MACHINE_ID = 'console_testmachine'

local IDLE_TO_RUNNING_TICKS = 120
local RUNNING_TO_IDLE_TICKS = 60

local function onRunningTick(_actor, state)
	state.data.elapsed = state.data.elapsed + 1
	if state.data.elapsed >= RUNNING_TO_IDLE_TICKS then
		return '../idle'
	end
end

return {
	id = MACHINE_ID,
	initial = 'idle',
	states = {
		idle = {
			data = { tickCounter = 0 },
			entering_state = function(_actor, state)
				state.data.tickCounter = 0
			end,
			tick = function(_actor, state)
				state.data.tickCounter = state.data.tickCounter + 1
				if state.data.tickCounter >= IDLE_TO_RUNNING_TICKS then
					return '../running'
				end
			end,
			on = {
				start = { to = '../running', scope = 'self' },
			},
		},
		running = {
			data = { elapsed = 0 },
			entering_state = function(_actor, state)
				state.data.elapsed = 0
				print('[testmachine] running state entered')
			end,
			tick = onRunningTick,
			on = {
				stop = { to = '../idle', scope = 'self' },
			},
		},
	},
}

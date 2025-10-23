return {
    id = '<MACHINE_ID>',
    enable_tape_autotick = true,
    ticks2advance_tape = 50,
    states = {
        _idle = { -- '_'-prefix to make it the initial state
            entering_state = function(self, state, payload)
            end,
            tick = function(self, state, payload)
            end,
            tapemove = function(self, state, payload)
                return '../running'
            end,
            on = {
                ['$start'] = '../running' -- '$'-prefix to denote self-scoped event
            }
        },
		enable_tape_autotick = true,
		ticks2advance_tape = 100,
        running = {
            entering_state = function(self, state, payload)
            end,
            tick = function(self, state, payload)
            end,
            tapemove = function(self, state, payload)
                return '../_idle'
            end,
            on = {
                ['$stop'] = '../idle' -- '$'-prefix to denote self-scoped event
            }
        }
    }
}

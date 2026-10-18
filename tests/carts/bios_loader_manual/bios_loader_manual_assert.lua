local storage<const> = require('results')
local result<const>: *bios_loader_manual_result = storage.result
local observations<const> = storage.observations

return {
	kind = 'integration',
	tests = {
		runtime_compilation = function(t)
			t:wait_until('runtime compilation observations complete', function()
				return result.completed == 1
			end, 64)
			assert(observations.load_error == nil)
			assert(type(observations.loaded) == 'function')
			assert(result.environment_before == 0)
			assert(result.environment_first == 3)
			assert(result.environment_second == 8)
			assert(observations.environment.total == 8)
			assert(observations.environment.step == 5)
			assert(result.external_first == 12)
			assert(result.external_second == 14)
			assert(observations.binding.value == 14)
			assert(observations.external_environment.external_value == 1000)
			assert(result.global_first == 7)
			assert(result.global_second == 9)
			assert(getglobal('bios_loader_manual_counter') == 9)
			assert(result.capture_first == 15)
			assert(result.capture_second == 25)
			assert(result.mode_value == 42)
			assert(observations.binary_chunk == nil)
			assert(observations.binary_error ==
				"attempt to load a text chunk (mode is 'b')")
			assert(observations.false_mode_chunk == nil)
			assert(observations.false_mode_error ==
				'Attempted to get length of an unsupported value.')
			assert(type(observations.false_environment) == 'function')
			assert(observations.false_environment_message == nil)
			assert(observations.false_environment_ok == false)
			assert(observations.false_environment_error ==
				'Attempted to index field on a non-table value.')
			assert(observations.invalid_chunk == nil)
			assert(observations.invalid_error ==
				'[load:manual.invalid] unexpected character at 1:8')
			assert(result.bare_count == 1)
			assert(result.fallthrough_count == 1)
			assert(result.expanded_count == 3)
			assert(result.single_count == 1)
			assert(observations.first == 3)
			assert(observations.middle == nil)
			assert(observations.last == 9)
			assert(result.factory_value == 42)
			assert(result.symbol_value == 7)
			assert(observations.syntax_ok == false)
			assert(observations.syntax_error ==
				'[load:manual.invalid_syntax] break outside loop at 1:1')
		end,
	},
}

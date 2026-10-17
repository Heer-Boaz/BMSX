local state<const> = require('results')
local result<const>: *input_manual_result = state.result

return {
	kind = 'integration',
	tests = {
		latched_levels_and_software_edges = function(t)
			t:wait_until('first input sample', function()
				return result.completed_samples ~= 0
			end, 8)
			assert(sizeof(input_manual_result) == 204)
			assert(result.key_a == 0)
			assert(result.press_count == 0)
			assert(result.release_count == 0)
			for index = 0, 7 do
				assert(result.keyboard[index] == 0)
			end
			for index = 0, 27 do
				assert(result.pads[index] == 0)
			end
			assert(result.pointer_buttons == 0)
			assert(result.pointer_x == 0)
			assert(result.pointer_y == 0)
			assert(result.pointer_wheel == 0)
			assert(result.rumble_support == 0)
			t:down('KeyA')
			t:wait_until('keyboard press observed', function()
				return result.press_count == 1
			end, 4)
			assert(result.last_press == 0x00000010)
			t:wait_ticks(2)
			assert(result.key_a == 0x00000010)
			assert(result.press_count == 1)
			assert(result.release_count == 0)
			t:down('a', 1)
			t:wait_until('pad A observed', function()
				return (result.pads[0] & 1) ~= 0
			end, 4)
			assert(result.press_count == 1)
			t:up('a', 1)
			t:wait_until('pad A released', function()
				return (result.pads[0] & 1) == 0
			end, 4)
			t:up('KeyA')
			t:wait_until('keyboard release observed', function()
				return result.release_count == 1
			end, 4)
			assert(result.key_a == 0)
			assert(result.last_release == 0x00000010)
			assert(result.press_count == 1)
			assert(result.sample_sequence ~= result.previous_sequence)
		end,
	},
}

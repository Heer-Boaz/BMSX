local storage<const> = require('storage')
local inputs<const>: *memory_sample = storage.inputs
local output<const>: *memory_sample = storage.output
local counter<const>: *word = storage.counter
local status<const>: *memory_status = storage.status
local input_words<const>: *word = storage.inputs
local output_words<const>: *word = storage.output
local input_bytes<const>: *u8 = storage.inputs
local output_bytes<const>: *u8 = storage.output

rodata expected_words: word[6] = {
	0x00000011, 0x12345678, 0x33441122,
	0x00000022, 0x9abcdef0, 0x77885566,
}

return {
	kind = 'integration',
	tests = {
		startup_storage_and_scalar_copy = function(t)
			t:wait_until('memory copy complete', function()
				return status.completed == 1
			end, 8)

			assert(sizeof(memory_sample) == 12)
			assert(sizeof(memory_sample[2]) == 24)
			assert(offsetof(memory_sample.tag) == 0)
			assert(offsetof(memory_sample.value) == 4)
			assert(offsetof(memory_sample.samples) == 8)
			assert(sizeof(memory_status) == 12)
			assert(storage.input_count == 2)
			assert(#storage.inputs == storage.input_count)
			assert(status.initial_counter == 0x12345678)
			assert(status.initial_output_or == 0)
			assert(*counter == 0x1234567a)

			assert(&inputs[0] == storage.inputs)
			assert(&inputs[1] == storage.inputs + 12)
			assert(&inputs[0].value == storage.inputs + 4)
			assert(&inputs[0].samples[0] == storage.inputs + 8)
			assert(&inputs[1].samples[1] == storage.inputs + 22)
			assert(&output[1] == storage.output + 12)
			assert(&output[1].samples[1] == storage.output + 22)
			local next_byte<const> = input_bytes + 1
			assert(next_byte == storage.inputs + 1)
			assert(next_byte ~= &inputs[1])
			assert(mem8[next_byte] == 0)

			for index = 0, #expected_words - 1 do
				assert(input_words[index] == expected_words[index])
				assert(output_words[index] == expected_words[index])
			end
			for index = 0, storage.input_count - 1 do
				assert(output[index].tag == inputs[index].tag)
				assert(output[index].value == inputs[index].value)
				assert(output[index].samples[0] == inputs[index].samples[0])
				assert(output[index].samples[1] == inputs[index].samples[1])
				for padding = 1, 3 do
					assert(input_bytes[index * sizeof(memory_sample) + padding] == 0)
					assert(output_bytes[index * sizeof(memory_sample) + padding] == 0)
				end
			end
			assert(inputs[0].tag == 0x11)
			assert(inputs[0].value == 0x12345678)
			assert(inputs[0].samples[0] == 0x1122)
			assert(inputs[0].samples[1] == 0x3344)
			assert(inputs[1].tag == 0x22)
			assert(inputs[1].value == 0x9abcdef0)
			assert(inputs[1].samples[0] == 0x5566)
			assert(inputs[1].samples[1] == 0x7788)
			assert(status.completed == 1)
			t:log('DATA12345678->1234567a; initial BSS OR0; sample size12,offsets0/4/8; element1+12,last u16+22,raw+1; readonly/output words11,12345678,33441122,22,9abcdef0,77885566; padding zero')
		end,
	},
}

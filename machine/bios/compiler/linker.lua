local arena<const> = require('compiler/arena')
local bytecode<const> = require('compiler/bytecode')
local isa<const> = require('bmsx/blua32')

local linker<const> = {}

function linker.link(program)
	local protos<const> = program.protos
	local function_record_byte_count<const> = #protos * isa.function_record_size
	local upvalue_byte_count = 0
	local code_byte_count = 0
	for index = 1, #protos do
		local proto<const> = protos[index]
		upvalue_byte_count = upvalue_byte_count
			+ #proto.upvalue_registers * isa.upvalue_record_size
		code_byte_count = code_byte_count
			+ #proto.instruction_words * isa.instruction_bytes
	end
	local code_byte_offset<const> = (
		function_record_byte_count
		+ upvalue_byte_count
		+ isa.instruction_bytes
		- 1
	) & -isa.instruction_bytes
	local function_table_address<const> = arena.allocate(
		code_byte_offset + code_byte_count,
		isa.function_alignment
	)

	local const_pool<const> = program.const_pool
	local const_relocations<const> = program.const_relocations
	for index = 1, #const_relocations do
		local relocation<const> = const_relocations[index]
		const_pool[relocation.const_index] = function_table_address
			+ (relocation.proto_index - 1) * isa.function_record_size
	end

	local upvalue_record: *u32 = function_table_address
		+ function_record_byte_count
	local code_address = function_table_address + code_byte_offset
	for index = 1, #protos do
		local proto<const> = protos[index]
		local upvalue_registers<const> = proto.upvalue_registers
		local proto_upvalue_address<const> = upvalue_record
		for upvalue_index = 1, #upvalue_registers do
			*upvalue_record = isa.upvalue_in_stack_mask
				| upvalue_registers[upvalue_index]
			upvalue_record = upvalue_record + isa.upvalue_record_size
		end
		local instruction_words<const> = proto.instruction_words
		local proto_code_byte_count<const> = #instruction_words * isa.instruction_bytes
		local function_record<const>: *u32 = function_table_address
			+ (index - 1) * isa.function_record_size
		function_record[isa.function_code_address_word_index] = code_address
		function_record[isa.function_code_byte_count_word_index] = proto_code_byte_count
		function_record[isa.function_num_params_word_index] = proto.parameter_count
		function_record[isa.function_max_stack_word_index] = proto.max_stack
		function_record[isa.function_flags_word_index] = 0
		function_record[isa.function_upvalue_table_address_word_index] = proto_upvalue_address
		function_record[isa.function_upvalue_count_word_index] = #upvalue_registers
		function_record[isa.function_reserved_word_index] = 0
		bytecode.write_instruction_words(instruction_words, code_address)
		code_address = code_address + proto_code_byte_count
	end

	local root_function_address<const> = function_table_address
		+ (program.root_proto_index - 1) * isa.function_record_size
	return root_function_address, const_pool
end

return linker

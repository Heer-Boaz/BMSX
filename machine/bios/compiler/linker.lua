local arena<const> = require('compiler/arena')
local bytecode<const> = require('compiler/bytecode')
local isa<const> = require('bmsx/blua32')

local linker<const> = {}

function linker.link(program)
	local protos<const> = program.protos
	local record_bytes<const> = #protos * isa.function_record_size
	local upvalue_bytes = 0
	local code_bytes = 0
	for index = 1, #protos do
		local proto<const> = protos[index]
		upvalue_bytes = upvalue_bytes
			+ #proto.upvalue_registers * isa.upvalue_record_size
		code_bytes = code_bytes + #proto.words * isa.instruction_bytes
	end
	local code_offset<const> = (record_bytes + upvalue_bytes + 3) & -4
	local block<const> = arena.allocate(
		code_offset + code_bytes,
		isa.function_alignment
	)

	local record_addresses<const> = {}
	for index = 1, #protos do
		record_addresses[index] = block + (index - 1) * isa.function_record_size
	end
	local const_pool<const> = program.const_pool
	local const_relocations<const> = program.const_relocations
	for index = 1, #const_relocations do
		local relocation<const> = const_relocations[index]
		const_pool[relocation.const_index] = record_addresses[relocation.proto_index]
	end

	local upvalue_address = block + record_bytes
	local code_address = block + code_offset
	for index = 1, #protos do
		local proto<const> = protos[index]
		local upvalue_registers<const> = proto.upvalue_registers
		local proto_upvalue_address<const> = upvalue_address
		for upvalue_index = 1, #upvalue_registers do
			bytecode.write_stack_upvalue(
				upvalue_address,
				upvalue_registers[upvalue_index]
			)
			upvalue_address = upvalue_address + isa.upvalue_record_size
		end
		local proto_code_bytes<const> = #proto.words * isa.instruction_bytes
		bytecode.write_function_record(
			record_addresses[index],
			code_address,
			proto_code_bytes,
			proto.parameter_count,
			proto.max_stack,
			proto_upvalue_address,
			#upvalue_registers
		)
		bytecode.write(proto.words, code_address)
		code_address = code_address + proto_code_bytes
	end

	return record_addresses[program.root_proto_index], const_pool
end

return linker

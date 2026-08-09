local isa<const> = require('bmsx/blua32')

local bytecode<const> = {}

local operand_mask<const> = (1 << isa.max_operand_bits) - 1
local bx_mask<const> = (1 << isa.max_bx_bits) - 1
local ext_bx_mask<const> = (1 << isa.ext_bx_bits) - 1
local base_bx_bits<const> = isa.max_bx_bits + isa.ext_bx_bits
local base_bx_mask<const> = (1 << base_bx_bits) - 1
local base_sbx_sign_bit<const> = 1 << (base_bx_bits - 1)
local wide_bx_mask<const> = (1 << (base_bx_bits + isa.max_operand_bits)) - 1

local pack_word<const> = function(op, a, b, c, ext)
	return ((ext & 0xff) << 24)
		| ((op & 0x3f) << 18)
		| ((a & operand_mask) << 12)
		| ((b & operand_mask) << 6)
		| (c & operand_mask)
end

function bytecode.emit_abc(instruction_words, op, a, b, c)
	local a_ext<const> = (a >> isa.max_operand_bits) & ((1 << isa.ext_a_bits) - 1)
	local b_ext<const> = (b >> isa.max_operand_bits) & ((1 << isa.ext_b_bits) - 1)
	local c_ext<const> = (c >> isa.max_operand_bits) & ((1 << isa.ext_c_bits) - 1)
	local a_wide<const> = a >> (isa.max_operand_bits + isa.ext_a_bits)
	local b_wide<const> = b >> (isa.max_operand_bits + isa.ext_b_bits)
	local c_wide<const> = c >> (isa.max_operand_bits + isa.ext_c_bits)
	if a_wide ~= 0 or b_wide ~= 0 or c_wide ~= 0 then
		instruction_words[#instruction_words + 1] = pack_word(
			isa.op_wide,
			a_wide,
			b_wide,
			c_wide,
			0
		)
	end
	local ext<const> = (a_ext << 6) | (b_ext << 3) | c_ext
	instruction_words[#instruction_words + 1] = pack_word(op, a, b, c, ext)
end

function bytecode.emit_signed_abx(instruction_words, op, a, sbx)
	local a_wide<const> = a >> isa.max_operand_bits
	local has_wide<const> = a_wide ~= 0
		or sbx < -base_sbx_sign_bit
		or sbx >= base_sbx_sign_bit
	local raw_bx<const> = sbx & (has_wide and wide_bx_mask or base_bx_mask)
	if has_wide then
		instruction_words[#instruction_words + 1] = pack_word(
			isa.op_wide,
			a_wide,
			raw_bx >> base_bx_bits,
			0,
			0
		)
	end
	local bx_low<const> = raw_bx & bx_mask
	local bx_ext<const> = (raw_bx >> isa.max_bx_bits) & ext_bx_mask
	instruction_words[#instruction_words + 1] = pack_word(
		op,
		a,
		bx_low >> isa.max_operand_bits,
		bx_low,
		bx_ext
	)
end

function bytecode.emit_closure_address_register(
	instruction_words,
	target,
	address_register
)
	local target_wide<const> = target >> isa.max_operand_bits
	local address_wide<const> = address_register
		>> base_bx_bits
	instruction_words[#instruction_words + 1] = pack_word(
		isa.op_wide,
		target_wide,
		address_wide,
		isa.closure_address_register_wide_c,
		0
	)
	local bx_low<const> = address_register & bx_mask
	local bx_ext<const> = address_register >> isa.max_bx_bits
	instruction_words[#instruction_words + 1] = pack_word(
		isa.op_closure,
		target,
		bx_low >> isa.max_operand_bits,
		bx_low,
		bx_ext
	)
end

function bytecode.write_instruction_words(instruction_words, address)
	for index = 1, #instruction_words do
		local word<const> = instruction_words[index]
		mem32le[address] = ((word >> 24) & 0x000000ff)
			| ((word >> 8) & 0x0000ff00)
			| ((word << 8) & 0x00ff0000)
			| (word << 24)
		address = address + isa.instruction_bytes
	end
end

function bytecode.write_function_record(
	address,
	code_address,
	code_byte_count,
	num_params,
	max_stack,
	upvalue_table_address,
	upvalue_count
)
	mem32le[address + isa.function_code_address_offset] = code_address
	mem32le[address + isa.function_code_byte_count_offset] = code_byte_count
	mem32le[address + isa.function_num_params_offset] = num_params
	mem32le[address + isa.function_max_stack_offset] = max_stack
	mem32le[address + isa.function_flags_offset] = 0
	mem32le[address + isa.function_upvalue_table_address_offset] = upvalue_table_address
	mem32le[address + isa.function_upvalue_count_offset] = upvalue_count
	mem32le[address + isa.function_reserved_offset] = 0
end

function bytecode.write_stack_upvalue(address, register_index)
	mem32le[address] = isa.upvalue_in_stack_mask | register_index
end

return bytecode

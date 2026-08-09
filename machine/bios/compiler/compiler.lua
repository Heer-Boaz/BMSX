local bytecode<const> = require('compiler/bytecode')
local isa<const> = require('bmsx/blua32')
local semantic<const> = require('compiler/semantic')
local syntax<const> = require('compiler/syntax')

local compiler<const> = {}

local constant_register<const> = function(parameter_count, const_index)
	return parameter_count + const_index - 1
end

local emit_path
emit_path = function(analysis, instruction_words, expression, target)
	if expression.kind == syntax.identifier_expression then
		bytecode.emit_abc(
			instruction_words,
			isa.op_mov,
			target,
			analysis.parameter_register_by_expression[expression],
			0
		)
		return
	end
	emit_path(analysis, instruction_words, expression.base, target)
	bytecode.emit_abc(
		instruction_words,
		isa.op_gett,
		target,
		target,
		constant_register(
			analysis.parameter_count,
			analysis.constant_index_by_expression[expression]
		)
	)
end

local emit_value<const> = function(
	analysis,
	instruction_words,
	expression,
	target
)
	local kind<const> = expression.kind
	if kind == syntax.identifier_expression
		or kind == syntax.member_expression
		or kind == syntax.index_expression then
		emit_path(analysis, instruction_words, expression, target)
		return
	end
	if kind == syntax.nil_literal_expression then
		bytecode.emit_abc(instruction_words, isa.op_knil, target, 0, 0)
		return
	end
	if kind == syntax.boolean_literal_expression then
		bytecode.emit_abc(
			instruction_words,
			expression.value and isa.op_ktrue or isa.op_kfalse,
			target,
			0,
			0
		)
		return
	end
	bytecode.emit_abc(
		instruction_words,
		isa.op_mov,
		target,
		constant_register(
			analysis.parameter_count,
			analysis.constant_index_by_expression[expression]
		),
		0
	)
end

local emit_assignment<const> = function(
	instruction_words,
	analysis,
	statement,
	target_register,
	value_register
)
	local target<const> = statement.target
	emit_path(analysis, instruction_words, target.base, target_register)
	emit_value(analysis, instruction_words, statement.value, value_register)
	bytecode.emit_abc(
		instruction_words,
		isa.op_sett,
		target_register,
		constant_register(
			analysis.parameter_count,
			analysis.constant_index_by_expression[target]
		),
		value_register
	)
end

local compile_function<const> = function(analysis)
	local parameter_count<const> = analysis.parameter_count
	local constant_count<const> = #analysis.constants
	local instruction_words<const> = {}
	for index = 0, constant_count - 1 do
		bytecode.emit_abc(
			instruction_words,
			isa.op_getup,
			parameter_count + index,
			index,
			0
		)
	end
	local target_register<const> = parameter_count + constant_count
	local value_register<const> = target_register + 1
	local statements<const> = analysis.function_expression.body.statements
	for index = 1, #statements do
		emit_assignment(
			instruction_words,
			analysis,
			statements[index],
			target_register,
			value_register
		)
	end
	bytecode.emit_abc(instruction_words, isa.op_knil, target_register, 0, 0)
	bytecode.emit_abc(instruction_words, isa.op_ret, target_register, 1, 0)

	local upvalue_registers<const> = {}
	for index = 1, constant_count do
		upvalue_registers[index] = index + 1
	end
	return {
		instruction_words = instruction_words,
		parameter_count = parameter_count,
		max_stack = value_register + 1,
		upvalue_registers = upvalue_registers,
	}
end

local compile_chunk<const> = function(constant_count, const_pool_register)
	local instruction_words<const> = {}
	bytecode.emit_abc(instruction_words, isa.op_getup, 0, 0, 0)
	for index = 1, constant_count + 1 do
		bytecode.emit_abc(instruction_words, isa.op_geti, index, 0, index)
	end
	local closure_register<const> = constant_count + 2
	bytecode.emit_closure_address_register(
		instruction_words,
		closure_register,
		1
	)
	bytecode.emit_abc(instruction_words, isa.op_ret, closure_register, 1, 0)
	return {
		instruction_words = instruction_words,
		parameter_count = 0,
		max_stack = closure_register + 1,
		upvalue_registers = { const_pool_register },
	}
end

local build_const_pool<const> = function(constants)
	local const_pool<const> = { 0 }
	for index = 1, #constants do
		const_pool[index + 1] = constants[index]
	end
	return const_pool
end

function compiler.compile(chunk, chunk_name, root_const_pool_register)
	local analysis<const> = semantic.analyze(chunk, chunk_name)
	local constants<const> = analysis.constants
	return {
		protos = {
			compile_chunk(#constants, root_const_pool_register),
			compile_function(analysis),
		},
		root_proto_index = 1,
		const_pool = build_const_pool(constants),
		const_relocations = {
			{ const_index = 1, proto_index = 2 },
		},
	}
end

return compiler

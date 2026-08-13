local lua_syntax<const> = require('cartlib/codegen/lua_syntax')

local lua_syntax_printer<const> = {}
local syntax_kind<const> = lua_syntax.kind
local binary_operator<const> = lua_syntax.binary_operator
local unary_operator<const> = lua_syntax.unary_operator
local format<const> = string.format
local tostring<const> = tostring

local binary_token<const> = {
	[binary_operator.logical_or] = 'or',
	[binary_operator.logical_and] = 'and',
	[binary_operator.equal] = '==',
	[binary_operator.not_equal] = '~=',
	[binary_operator.less_than] = '<',
	[binary_operator.less_equal] = '<=',
	[binary_operator.greater_than] = '>',
	[binary_operator.greater_equal] = '>=',
	[binary_operator.bitwise_or] = '|',
	[binary_operator.bitwise_xor] = '~',
	[binary_operator.bitwise_and] = '&',
	[binary_operator.shift_left] = '<<',
	[binary_operator.shift_right] = '>>',
	[binary_operator.concat] = '..',
	[binary_operator.add] = '+',
	[binary_operator.subtract] = '-',
	[binary_operator.multiply] = '*',
	[binary_operator.divide] = '/',
	[binary_operator.floor_divide] = '//',
	[binary_operator.modulus] = '%',
	[binary_operator.exponent] = '^',
}

local binary_precedence<const> = {
	[binary_operator.logical_or] = 1,
	[binary_operator.logical_and] = 2,
	[binary_operator.equal] = 3,
	[binary_operator.not_equal] = 3,
	[binary_operator.less_than] = 3,
	[binary_operator.less_equal] = 3,
	[binary_operator.greater_than] = 3,
	[binary_operator.greater_equal] = 3,
	[binary_operator.bitwise_or] = 4,
	[binary_operator.bitwise_xor] = 5,
	[binary_operator.bitwise_and] = 6,
	[binary_operator.shift_left] = 7,
	[binary_operator.shift_right] = 7,
	[binary_operator.concat] = 8,
	[binary_operator.add] = 9,
	[binary_operator.subtract] = 9,
	[binary_operator.multiply] = 10,
	[binary_operator.divide] = 10,
	[binary_operator.floor_divide] = 10,
	[binary_operator.modulus] = 10,
	[binary_operator.exponent] = 12,
}

local unary_token<const> = {
	[unary_operator.negate] = '-',
	[unary_operator.logical_not] = 'not ',
	[unary_operator.length] = '#',
	[unary_operator.bitwise_not] = '~',
}

local expression_precedence<const> = {
	[syntax_kind.identifier_expression] = 14,
	[syntax_kind.numeric_literal_expression] = 14,
	[syntax_kind.string_literal_expression] = 14,
	[syntax_kind.boolean_literal_expression] = 14,
	[syntax_kind.nil_literal_expression] = 14,
	[syntax_kind.member_expression] = 13,
	[syntax_kind.index_expression] = 13,
	[syntax_kind.call_expression] = 13,
	[syntax_kind.unary_expression] = 11,
	[syntax_kind.function_expression] = 0,
}

local append<const> = function(printer, value)
	local count<const> = printer.count + 1
	printer[count] = value
	printer.count = count
end

local write_indentation<const> = function(printer)
	for _ = 1, printer.indentation do
		append(printer, '\t')
	end
end

local write_line_start<const> = function(printer)
	if printer.at_line_start then
		write_indentation(printer)
		printer.at_line_start = false
	end
end

local write<const> = function(printer, value)
	write_line_start(printer)
	append(printer, value)
end

local write_newline<const> = function(printer)
	append(printer, '\n')
	printer.at_line_start = true
end

local write_expression
local write_statement

local write_expression_list<const> = function(printer, expressions)
	for index = 1, #expressions do
		if index > 1 then
			write(printer, ', ')
		end
		write_expression(printer, expressions[index], 0)
	end
end

local write_block<const> = function(printer, statements)
	printer.indentation = printer.indentation + 1
	for index = 1, #statements do
		write_statement(printer, statements[index])
	end
	printer.indentation = printer.indentation - 1
end

local write_identifier_expression<const> = function(printer, node)
	write(printer, node[2])
end

local write_numeric_literal_expression<const> = function(printer, node)
	write(printer, tostring(node[2]))
end

local write_string_literal_expression<const> = function(printer, node)
	write(printer, format('%q', node[2]))
end

local write_boolean_literal_expression<const> = function(printer, node)
	if node[2] then
		write(printer, 'true')
	else
		write(printer, 'false')
	end
end

local write_nil_literal_expression<const> = function(printer, _node)
	write(printer, 'nil')
end

local write_index_expression<const> = function(printer, node)
	write_expression(printer, node[2], 13)
	write(printer, '[')
	write_expression(printer, node[3], 0)
	write(printer, ']')
end

local write_member_expression<const> = function(printer, node)
	write_expression(printer, node[2], 13)
	write(printer, '.')
	write(printer, node[3])
end

local write_call_expression<const> = function(printer, node)
	write_expression(printer, node[2], 13)
	write(printer, '(')
	write_expression_list(printer, node[3])
	write(printer, ')')
end

local write_binary_expression<const> = function(printer, node)
	local operator<const> = node[2]
	local precedence<const> = binary_precedence[operator]
	write_expression(printer, node[3], precedence + 1)
	write(printer, ' ')
	write(printer, binary_token[operator])
	write(printer, ' ')
	write_expression(printer, node[4], precedence + 1)
end

local write_unary_expression<const> = function(printer, node)
	write(printer, unary_token[node[2]])
	write_expression(printer, node[3], 11)
end

local write_function_expression<const> = function(printer, node)
	write(printer, 'function(')
	local parameters<const> = node[2]
	for index = 1, #parameters do
		if index > 1 then
			write(printer, ', ')
		end
		write(printer, parameters[index])
	end
	write(printer, ')')
	write_newline(printer)
	write_block(printer, node[3])
	write(printer, 'end')
end

local expression_writer<const> = {
	[syntax_kind.identifier_expression] = write_identifier_expression,
	[syntax_kind.numeric_literal_expression] = write_numeric_literal_expression,
	[syntax_kind.string_literal_expression] = write_string_literal_expression,
	[syntax_kind.boolean_literal_expression] = write_boolean_literal_expression,
	[syntax_kind.nil_literal_expression] = write_nil_literal_expression,
	[syntax_kind.member_expression] = write_member_expression,
	[syntax_kind.index_expression] = write_index_expression,
	[syntax_kind.call_expression] = write_call_expression,
	[syntax_kind.binary_expression] = write_binary_expression,
	[syntax_kind.unary_expression] = write_unary_expression,
	[syntax_kind.function_expression] = write_function_expression,
}

write_expression = function(printer, node, parent_precedence)
	local node_kind<const> = node[1]
	local precedence<const> = node_kind == syntax_kind.binary_expression
		and binary_precedence[node[2]]
		or expression_precedence[node_kind]
	local parenthesized<const> = precedence < parent_precedence
	if parenthesized then
		write(printer, '(')
	end
	expression_writer[node_kind](printer, node)
	if parenthesized then
		write(printer, ')')
	end
end

local write_assignment_statement<const> = function(printer, node)
	write_expression_list(printer, node[2])
	write(printer, ' = ')
	write_expression_list(printer, node[3])
	write_newline(printer)
end

local write_local_declaration_statement<const> = function(printer, node)
	write(printer, 'local ')
	local names<const> = node[2]
	local is_const<const> = node[4]
	for index = 1, #names do
		if index > 1 then
			write(printer, ', ')
		end
		write(printer, names[index])
		if is_const then
			write(printer, '<const>')
		end
	end
	local values<const> = node[3]
	if #values > 0 then
		write(printer, ' = ')
		write_expression_list(printer, values)
	end
	write_newline(printer)
end

local write_call_statement<const> = function(printer, node)
	write_expression(printer, node[2], 0)
	write_newline(printer)
end

local write_if_statement<const> = function(printer, node)
	local clauses<const> = node[2]
	for index = 1, #clauses do
		local clause<const> = clauses[index]
		if index == 1 then
			write(printer, 'if ')
		elseif clause[1] ~= nil then
			write(printer, 'elseif ')
		else
			write(printer, 'else')
		end
		if clause[1] ~= nil then
			write_expression(printer, clause[1], 0)
			write(printer, ' then')
		end
		write_newline(printer)
		write_block(printer, clause[2])
	end
	write(printer, 'end')
	write_newline(printer)
end

local write_while_statement<const> = function(printer, node)
	write(printer, 'while ')
	write_expression(printer, node[2], 0)
	write(printer, ' do')
	write_newline(printer)
	write_block(printer, node[3])
	write(printer, 'end')
	write_newline(printer)
end

local write_for_numeric_statement<const> = function(printer, node)
	write(printer, 'for ')
	write(printer, node[2])
	write(printer, ' = ')
	write_expression(printer, node[3], 0)
	write(printer, ', ')
	write_expression(printer, node[4], 0)
	if node[5] ~= nil then
		write(printer, ', ')
		write_expression(printer, node[5], 0)
	end
	write(printer, ' do')
	write_newline(printer)
	write_block(printer, node[6])
	write(printer, 'end')
	write_newline(printer)
end

local write_return_statement<const> = function(printer, node)
	write(printer, 'return')
	local expressions<const> = node[2]
	if #expressions > 0 then
		write(printer, ' ')
		write_expression_list(printer, expressions)
	end
	write_newline(printer)
end

local write_break_statement<const> = function(printer, _node)
	write(printer, 'break')
	write_newline(printer)
end

local statement_writer<const> = {
	[syntax_kind.assignment_statement] = write_assignment_statement,
	[syntax_kind.local_declaration_statement] = write_local_declaration_statement,
	[syntax_kind.call_statement] = write_call_statement,
	[syntax_kind.if_statement] = write_if_statement,
	[syntax_kind.while_statement] = write_while_statement,
	[syntax_kind.for_numeric_statement] = write_for_numeric_statement,
	[syntax_kind.return_statement] = write_return_statement,
	[syntax_kind.break_statement] = write_break_statement,
}

write_statement = function(printer, node)
	statement_writer[node[1]](printer, node)
end

function lua_syntax_printer.print(chunk)
	local printer<const> = {
		count = 0,
		indentation = 0,
		at_line_start = true,
	}
	local statements<const> = chunk[2]
	for index = 1, #statements do
		write_statement(printer, statements[index])
	end
	return table.concat(printer, '', 1, printer.count)
end

return lua_syntax_printer

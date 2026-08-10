local syntax<const> = {
	chunk = 1,
	block = 2,
	assignment_statement = 3,
	return_statement = 4,
	function_expression = 5,
	identifier_expression = 6,
	member_expression = 7,
	index_expression = 8,
	number_literal_expression = 9,
	string_literal_expression = 10,
	boolean_literal_expression = 11,
	nil_literal_expression = 12,
	unary_expression = 13,
	binary_expression = 14,
	call_expression = 15,
	local_statement = 16,

	unary_negate = 1,
	unary_string_id = 2,

	binary_add = 1,
	binary_subtract = 2,
	binary_multiply = 3,
	binary_divide = 4,
	binary_floor_divide = 5,
	binary_modulus = 6,
}

return syntax

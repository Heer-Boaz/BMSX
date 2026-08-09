local token<const> = {
	left_parenthesis = 1,
	right_parenthesis = 2,
	left_bracket = 3,
	right_bracket = 4,
	minus = 5,
	ampersand = 6,
	equal = 7,
	comma = 8,
	dot = 9,
	semicolon = 10,
	string = 11,
	number = 12,
	identifier = 13,
	keyword_end = 14,
	keyword_false = 15,
	keyword_function = 16,
	keyword_nil = 17,
	keyword_return = 18,
	keyword_true = 19,
	eof = 20,
}

token.keyword_by_text = {
	['end'] = token.keyword_end,
	['false'] = token.keyword_false,
	['function'] = token.keyword_function,
	['nil'] = token.keyword_nil,
	['return'] = token.keyword_return,
	['true'] = token.keyword_true,
}

token.single_character_by_code = {
	[38] = token.ampersand,
	[40] = token.left_parenthesis,
	[41] = token.right_parenthesis,
	[44] = token.comma,
	[45] = token.minus,
	[46] = token.dot,
	[59] = token.semicolon,
	[61] = token.equal,
	[91] = token.left_bracket,
	[93] = token.right_bracket,
}

token.name = {
	[token.left_parenthesis] = '(',
	[token.right_parenthesis] = ')',
	[token.left_bracket] = '[',
	[token.right_bracket] = ']',
	[token.minus] = '-',
	[token.ampersand] = '&',
	[token.equal] = '=',
	[token.comma] = ',',
	[token.dot] = '.',
	[token.semicolon] = ';',
	[token.string] = 'string',
	[token.number] = 'number',
	[token.identifier] = 'identifier',
	[token.keyword_end] = 'end',
	[token.keyword_false] = 'false',
	[token.keyword_function] = 'function',
	[token.keyword_nil] = 'nil',
	[token.keyword_return] = 'return',
	[token.keyword_true] = 'true',
	[token.eof] = 'end of input',
}

return token

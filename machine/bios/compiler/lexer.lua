local byte<const> = __bmsx_string_byte
local char<const> = __bmsx_string_char
local concat<const> = require('table').concat
local sub<const> = require('string/base').sub
local token<const> = require('compiler/token')

local lexer<const> = {}
local keyword_by_text<const> = token.keyword_by_text
local single_character_by_code<const> = token.single_character_by_code

local ascii_bell<const> = 7
local ascii_backspace<const> = 8
local ascii_horizontal_tab<const> = 9
local ascii_line_feed<const> = 10
local ascii_vertical_tab<const> = 11
local ascii_form_feed<const> = 12
local ascii_carriage_return<const> = 13
local ascii_space<const> = 32
local ascii_double_quote<const> = 34
local ascii_dollar<const> = 36
local ascii_single_quote<const> = 39
local ascii_plus<const> = 43
local ascii_minus<const> = 45
local ascii_dot<const> = 46
local ascii_digit_0<const> = 48
local ascii_digit_9<const> = 57
local ascii_upper_a<const> = 65
local ascii_upper_e<const> = 69
local ascii_upper_f<const> = 70
local ascii_upper_x<const> = 88
local ascii_upper_z<const> = 90
local ascii_backslash<const> = 92
local ascii_underscore<const> = 95
local ascii_lower_a<const> = 97
local ascii_lower_b<const> = 98
local ascii_lower_e<const> = 101
local ascii_lower_f<const> = 102
local ascii_lower_n<const> = 110
local ascii_lower_r<const> = 114
local ascii_lower_t<const> = 116
local ascii_lower_v<const> = 118
local ascii_lower_x<const> = 120
local ascii_lower_z<const> = 122

local is_digit<const> = function(code)
	return code >= ascii_digit_0 and code <= ascii_digit_9
end

local is_lower<const> = function(code)
	return code >= ascii_lower_a and code <= ascii_lower_z
end

local is_upper<const> = function(code)
	return code >= ascii_upper_a and code <= ascii_upper_z
end

local is_identifier_start<const> = function(code)
	return is_lower(code) or code == ascii_underscore or code == ascii_dollar
end

local is_identifier_part<const> = function(code)
	return is_identifier_start(code) or is_digit(code)
end

local is_space<const> = function(code)
	return code == ascii_space
		or (code >= ascii_horizontal_tab and code <= ascii_carriage_return)
end

local fail<const> = function(state, message, line, column)
	error('[load:' .. state.chunk_name .. '] ' .. message .. ' at '
		.. tostring(line) .. ':' .. tostring(column))
end

local advance<const> = function(state)
	local code<const> = state.current_code
	local index<const> = state.index + 1
	state.index = index
	if index <= state.length then
		state.current_code = byte(state.source, index)
	else
		state.current_code = 0
	end
	if code == ascii_line_feed then
		state.line = state.line + 1
		state.column = 1
	else
		state.column = state.column + 1
	end
	return code
end

local scan_identifier<const> = function(state)
	local start<const> = state.index
	while state.index <= state.length and is_identifier_part(state.current_code) do
		advance(state)
	end
	local text<const> = sub(state.source, start, state.index - 1)
	local kind<const> = keyword_by_text[text] or token.identifier
	return kind, text
end

local is_hex_digit<const> = function(code)
	return is_digit(code)
		or (code >= ascii_upper_a and code <= ascii_upper_f)
		or (code >= ascii_lower_a and code <= ascii_lower_f)
end

local hex_digit_value<const> = function(code)
	if is_digit(code) then
		return code - ascii_digit_0
	end
	if code <= ascii_upper_f then
		return code - ascii_upper_a + 10
	end
	return code - ascii_lower_a + 10
end

local scan_digits<const> = function(state)
	while state.index <= state.length and is_digit(state.current_code) do
		advance(state)
	end
end

local scan_decimal_number<const> = function(state, line, column)
	scan_digits(state)
	if state.index < state.length
		and state.current_code == ascii_dot
		and is_digit(byte(state.source, state.index + 1)) then
		advance(state)
		scan_digits(state)
	end
	if state.index <= state.length then
		local code<const> = state.current_code
		if code == ascii_upper_e or code == ascii_lower_e then
			advance(state)
			if state.index <= state.length then
				local sign<const> = state.current_code
				if sign == ascii_plus or sign == ascii_minus then
					advance(state)
				end
			end
			if state.index > state.length or not is_digit(state.current_code) then
				fail(state, 'invalid numeric literal exponent', line, column)
			end
			scan_digits(state)
		end
	end
end

local scan_hex_integer<const> = function(state, line, column)
	advance(state)
	advance(state)
	if state.index > state.length or not is_hex_digit(state.current_code) then
		fail(state, 'hexadecimal literal requires digits', line, column)
	end
	while state.index <= state.length and is_hex_digit(state.current_code) do
		advance(state)
	end
end

local scan_number<const> = function(state, line, column)
	local start<const> = state.index
	if state.current_code == ascii_digit_0 and state.index < state.length then
		local prefix<const> = byte(state.source, state.index + 1)
		if prefix == ascii_upper_x or prefix == ascii_lower_x then
			scan_hex_integer(state, line, column)
		else
			scan_decimal_number(state, line, column)
		end
	else
		scan_decimal_number(state, line, column)
	end
	local text<const> = sub(state.source, start, state.index - 1)
	return tonumber(text)
end

local escaped_code_by_code<const> = {
	[ascii_double_quote] = ascii_double_quote,
	[ascii_single_quote] = ascii_single_quote,
	[ascii_backslash] = ascii_backslash,
	[ascii_lower_a] = ascii_bell,
	[ascii_lower_b] = ascii_backspace,
	[ascii_lower_f] = ascii_form_feed,
	[ascii_lower_n] = ascii_line_feed,
	[ascii_lower_r] = ascii_carriage_return,
	[ascii_lower_t] = ascii_horizontal_tab,
	[ascii_lower_v] = ascii_vertical_tab,
}

local scan_hex_escape<const> = function(state, line, column)
	local value = 0
	for _ = 1, 2 do
		if state.index > state.length or not is_hex_digit(state.current_code) then
			fail(state, 'invalid hexadecimal escape', line, column)
		end
		value = value * 16 + hex_digit_value(advance(state))
	end
	return value
end

local scan_string<const> = function(state, quote, line, column)
	local parts
	local segment_start = state.index
	while state.index <= state.length do
		local code<const> = advance(state)
		if code == quote then
			local segment_end<const> = state.index - 2
			if parts == nil then
				return sub(state.source, segment_start, segment_end)
			end
			if segment_end >= segment_start then
				parts[#parts + 1] = sub(state.source, segment_start, segment_end)
			end
			return concat(parts)
		end
		if code == ascii_line_feed or code == ascii_carriage_return then
			fail(state, 'unfinished string', line, column)
		end
		if code == ascii_backslash then
			if parts == nil then
				parts = {}
			end
			local segment_end<const> = state.index - 2
			if segment_end >= segment_start then
				parts[#parts + 1] = sub(state.source, segment_start, segment_end)
			end
			if state.index > state.length then
				fail(state, 'unfinished string', line, column)
			end
			local escape<const> = advance(state)
			if is_digit(escape) then
				local escaped = escape - ascii_digit_0
				local digits = 1
				while digits < 3 and state.index <= state.length
					and is_digit(state.current_code) do
					escaped = escaped * 10 + advance(state) - ascii_digit_0
					digits = digits + 1
				end
				if escaped > 255 then
					fail(state, 'decimal escape too large', line, column)
				end
				parts[#parts + 1] = char(escaped)
			elseif escape == ascii_lower_x then
				parts[#parts + 1] = char(scan_hex_escape(state, line, column))
			elseif escape == ascii_lower_z then
				while state.index <= state.length and is_space(state.current_code) do
					advance(state)
				end
			else
				local escaped_code<const> = escaped_code_by_code[escape]
				if escaped_code == nil then
					fail(state, 'invalid escape sequence', line, column)
				end
				parts[#parts + 1] = char(escaped_code)
			end
			segment_start = state.index
		end
	end
	fail(state, 'unfinished string', line, column)
end

local skip_space_and_comments<const> = function(state)
	while state.index <= state.length do
		local code<const> = state.current_code
		if is_space(code) then
			advance(state)
		elseif code == ascii_minus and state.index < state.length
			and byte(state.source, state.index + 1) == ascii_minus then
			advance(state)
			advance(state)
			while state.index <= state.length
				and state.current_code ~= ascii_line_feed do
				advance(state)
			end
		else
			return
		end
	end
end

function lexer.new(source, chunk_name)
	local length<const> = #source
	local current_code = 0
	if length ~= 0 then
		current_code = byte(source, 1)
	end
	return {
		source = source,
		chunk_name = chunk_name,
		index = 1,
		length = length,
		current_code = current_code,
		line = 1,
		column = 1,
		token_kind = token.eof,
		token_line = 1,
		token_column = 1,
	}
end

function lexer.next(state)
	skip_space_and_comments(state)
	if state.index > state.length then
		state.token_kind = token.eof
		state.token_line = state.line
		state.token_column = state.column
		return
	end
	local line<const> = state.line
	local column<const> = state.column
	state.token_line = line
	state.token_column = column
	local code<const> = state.current_code
	if is_upper(code) then
		fail(state, 'upper-case identifiers are not allowed', line, column)
	end
	if is_identifier_start(code) then
		state.token_kind, state.token_lexeme = scan_identifier(state)
		return
	end
	if is_digit(code) then
		state.token_kind = token.number
		state.token_literal = scan_number(state, line, column)
		return
	end
	if code == ascii_dot and state.index < state.length
		and is_digit(byte(state.source, state.index + 1)) then
		state.token_kind = token.number
		state.token_literal = scan_number(state, line, column)
		return
	end
	advance(state)
	if code == ascii_double_quote or code == ascii_single_quote then
		state.token_kind = token.string
		state.token_literal = scan_string(state, code, line, column)
		return
	end
	local kind<const> = single_character_by_code[code]
	if kind ~= nil then
		state.token_kind = kind
		return
	end
	fail(state, 'unexpected character', line, column)
end

return lexer

local byte<const> = __bmsx_string_byte
local char<const> = __bmsx_string_char
local concat<const> = require('table').concat
local sub<const> = require('string/base').sub
local token<const> = require('compiler/token')

local lexer<const> = {}
local keyword_by_text<const> = token.keyword_by_text
local single_character_by_code<const> = token.single_character_by_code

local is_digit<const> = function(code)
	return code >= 48 and code <= 57
end

local is_lower<const> = function(code)
	return code >= 97 and code <= 122
end

local is_upper<const> = function(code)
	return code >= 65 and code <= 90
end

local is_identifier_start<const> = function(code)
	return is_lower(code) or code == 95 or code == 36
end

local is_identifier_part<const> = function(code)
	return is_identifier_start(code) or is_digit(code)
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
	if code == 10 then
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
		or (code >= 65 and code <= 70)
		or (code >= 97 and code <= 102)
end

local scan_digits<const> = function(state)
	while state.index <= state.length and is_digit(state.current_code) do
		advance(state)
	end
end

local scan_decimal_number<const> = function(state, line, column)
	scan_digits(state)
	if state.index < state.length
		and state.current_code == 46
		and is_digit(byte(state.source, state.index + 1)) then
		advance(state)
		scan_digits(state)
	end
	if state.index <= state.length then
		local code<const> = state.current_code
		if code == 69 or code == 101 then
			advance(state)
			if state.index <= state.length then
				local sign<const> = state.current_code
				if sign == 43 or sign == 45 then
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
	if state.current_code == 48 and state.index < state.length then
		local prefix<const> = byte(state.source, state.index + 1)
		if prefix == 88 or prefix == 120 then
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
	[34] = 34,
	[39] = 39,
	[92] = 92,
	[97] = 7,
	[98] = 8,
	[102] = 12,
	[110] = 10,
	[114] = 13,
	[116] = 9,
	[118] = 11,
}

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
		if code == 10 or code == 13 then
			fail(state, 'unfinished string', line, column)
		end
		if code == 92 then
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
				local escaped = escape - 48
				local digits = 1
				while digits < 3 and state.index <= state.length
					and is_digit(state.current_code) do
					escaped = escaped * 10 + advance(state) - 48
					digits = digits + 1
				end
				if escaped > 255 then
					fail(state, 'decimal escape too large', line, column)
				end
				parts[#parts + 1] = char(escaped)
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
		if code == 32 or code == 9 or code == 10 or code == 13 then
			advance(state)
		elseif code == 45 and state.index < state.length
			and byte(state.source, state.index + 1) == 45 then
			advance(state)
			advance(state)
			while state.index <= state.length and state.current_code ~= 10 do
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
	advance(state)
	if code == 34 or code == 39 then
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

-- lua_parse.lua

local lua_formatter = require("lua_formatter")
local source_text = require("source_text")

local lua_parse = {}

local compile_chunk = load

local function find_first_non_whitespace(line)
	for index = 1, #line do
		local ch = string.byte(line, index)
		if ch ~= 32 and ch ~= 9 then
			return index
		end
	end
	return 1
end

local function parse_error_message(path, source, lines, message)
	local line = tonumber(string.match(message, ":(%d+):")) or 1
	local detail = string.match(message, ":%d+:%s*(.*)$") or message
	local token = string.match(detail, "near '([^']*)'") or string.match(detail, 'near "([^"]*)"')
	local line_text = lines[line]
	if line_text == nil then
		line_text = ""
	end
	local column
	if token == "<eof>" or string.find(detail, "<eof>", 1, true) then
		column = #line_text + 1
	elseif token and #token > 0 then
		local found = string.find(line_text, token, 1, true)
		column = found or find_first_non_whitespace(line_text)
	else
		column = find_first_non_whitespace(line_text)
	end
	return {
		name = "Syntax Error",
		message = detail,
		path = path,
		line = line,
		column = column,
		raw_message = message,
		source = source,
	}
end

function lua_parse.parse_lua_chunk(source, path, lines)
	local parsed = lua_parse.parse_lua_chunk_with_recovery(source, path, lines)
	if parsed.syntax_error then
		error(string.format("%s:%d:%d: %s", parsed.syntax_error.path, parsed.syntax_error.line, parsed.syntax_error.column, parsed.syntax_error.message))
	end
	return parsed
end

function lua_parse.parse_lua_chunk_with_recovery(source, path, lines)
	local resolved_lines = lines or source_text.split_text(source)
	local tokens = lua_formatter.scan_tokens(source)
	if not compile_chunk then
		return {
			chunk = nil,
			tokens = tokens,
			syntax_error = {
				name = "Syntax Error",
				message = "[lua_parse] load builtin unavailable.",
				path = path,
				line = 1,
				column = 1,
				source = source,
			},
		}
	end
	local chunk, error_message = compile_chunk(source, "@" .. path, "t")
	if chunk then
		return {
			chunk = chunk,
			tokens = tokens,
			syntax_error = nil,
		}
	end
	return {
		chunk = nil,
		tokens = tokens,
		syntax_error = parse_error_message(path, source, resolved_lines, error_message),
	}
end

return lua_parse

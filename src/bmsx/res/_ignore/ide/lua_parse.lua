local formatter = require("formatter")
local source_text = require("source_text")
local load_lua_chunk = load

local parse = {}

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
	local line_match = string.match(message, ":(%d+):")
	if not line_match then
		error(string.format("[parse] failed to resolve error line for %s: %s", path, message))
	end
	local line = tonumber(line_match)
	local detail = string.match(message, ":%d+:%s*(.*)$")
	if not detail then
		error(string.format("[parse] failed to resolve error detail for %s: %s", path, message))
	end
	local token = string.match(detail, "near '([^']*)'") or string.match(detail, 'near "([^"]*)"')
	local line_text = lines[line]
	if line_text == nil then
		error(string.format("[parse] error line %d out of range for %s", line, path))
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

function parse.parse_lua_chunk(source, path, lines)
	local parsed = parse.parse_lua_chunk_with_recovery(source, path, lines)
	if parsed.syntax_error then
		error(string.format("%s:%d:%d: %s", parsed.syntax_error.path, parsed.syntax_error.line, parsed.syntax_error.column, parsed.syntax_error.message))
	end
	return parsed
end

function parse.parse_lua_chunk_with_recovery(source, path, lines)
	if load_lua_chunk == nil then
		return {
			chunk = nil,
			tokens = {},
			syntax_error = {
				name = "Syntax Error",
				message = "load() is unavailable in this runtime.",
				path = path,
				line = 1,
				column = 1,
				raw_message = "load unavailable",
				source = source,
			},
		}
	end
	local resolved_lines = lines or source_text.split_text(source)
	local tokens = formatter.scan_tokens(source)
	local chunk, error_message = load_lua_chunk(source, "@" .. path, "t")
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

return parse

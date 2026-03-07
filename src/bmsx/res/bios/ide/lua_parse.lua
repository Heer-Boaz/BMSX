-- lua_parse.lua
-- Restore the nil-guard before invoking `load`
-- In the BIOS runtime we ship today, load is not one of the registered Lua builtins, which is why this module previously cached it and degraded to a synthetic syntax error when it was -- unavailable. Calling load(...) directly here means update_analysis_if_needed() now throws attempt to call a nil value (global 'load') on the first editor update instead of reporting parser diagnostics, so the new editor path crashes immediately in the environment this file runs in.

local lua_formatter = require("lua_formatter")
local source_text = require("source_text")

local lua_parse = {}

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
		error(string.format("[lua_parse] failed to resolve error line for %s: %s", path, message))
	end
	local line = tonumber(line_match)
	local detail = string.match(message, ":%d+:%s*(.*)$")
	if not detail then
		error(string.format("[lua_parse] failed to resolve error detail for %s: %s", path, message))
	end
	local token = string.match(detail, "near '([^']*)'") or string.match(detail, 'near "([^"]*)"')
	local line_text = lines[line]
	if line_text == nil then
		error(string.format("[lua_parse] error line %d out of range for %s", line, path))
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
	local chunk, error_message = load(source, "@" .. path, "t")
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

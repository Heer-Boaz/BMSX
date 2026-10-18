module<entry>

local state<const> = require('results')
local result<const>: *bios_format_manual_result = state.result

-- Width is a minimum; zeros follow the sign or base prefix.
local basic<const> = string.format('HP %d/%d', 7, 10)
local signed<const> = string.format('%+06d', 42)
local prefixed<const> = string.format('%#08x', 42)
result.basic_match = basic == 'HP 7/10' and 1 or 0
result.sign_match = signed == '+00042' and 1 or 0
result.prefix_match = prefixed == '0x00002a' and 1 or 0
print('Format fields', basic, signed, prefixed)

-- Stars consume width, then precision, then the value.
local stars<const> = string.format('%*.*f', 8, 2, 1.25)
local left<const> = string.format('%*s', -5, 'go')
result.stars_match = stars == '    1.25' and 1 or 0
result.left_match = left == 'go   ' and 1 or 0
print('Format stars', '[' .. stars .. ']', '[' .. left .. ']')

-- Integer precision zero clears zero digits; alternate octal restores one.
local zeros<const> = string.format('%.0d/%#.0o', 0, 0)
local unsigned<const> = string.format('%u', -1)
result.zero_integer_match = zeros == '/0' and 1 or 0
result.unsigned_match = unsigned == '4294967295' and 1 or 0
print('Format integers', zeros, unsigned)

-- Alternate general format retains its point and skips zero stripping.
local floating<const> = string.format('%.2f/%.1e/%#.3g', 1.25, 12.5, 100)
local special<const> = string.format('%+F/%e', 1 / 0, 0 / 0)
local large<const> = string.format('%.0f', 1000000)
result.float_match = floating == '1.25/1.3e+01/100.' and 1 or 0
result.special_match = special == '+INF/nan' and 1 or 0
result.fixed_large_match = large == '1e+06' and 1 or 0
print('Format numbers', floating, special, large)

-- Quoting emits visible escapes; %c retains both modf results in this BIOS.
local quoted<const> = string.format('%q', 'A\t"')
local nul<const> = string.format('%c', 0)
result.quote_match = quoted == '"A\\t\\""' and 1 or 0
result.nul_length = #nul
result.nul_codepoint = string.byte(nul)
result.nul_trailing_codepoint = string.byte(nul, 2)
print('Format text', quoted, result.nul_length, result.nul_codepoint,
	result.nul_trailing_codepoint)

-- These branches do not parse numeric text or impose a common type check.
result.empty_integer_length = #string.format('%d')
result.nonnumeric_width_match = string.format('%*s', '5', 'go') == 'go' and 1 or 0
print('Format argument paths', result.empty_integer_length,
	result.nonnumeric_width_match)

local incomplete_ok<const>, incomplete_error<const> = pcall(string.format, '%')
local unsupported_ok<const>, unsupported_error<const> =
	pcall(string.format, '%*p', 4, 'unused')
result.incomplete_error = not incomplete_ok
	and incomplete_error == 'string.format incomplete format specifier.'
	and 1 or 0
result.unsupported_error = not unsupported_ok
	and unsupported_error == "string.format unsupported format specifier '%p'."
	and 1 or 0
print('Format incomplete', incomplete_ok, incomplete_error)
print('Format unsupported', unsupported_ok, unsupported_error)

result.completed = 1
while true do
	halt_until_irq
end

// Headless IDE test: wrap_text_lines executes as BIOS Lua, not a host native.

const wrapped = t.evaluateLua(`
local wrap<const> = require('bios/util/wrap_text_lines').wrap_text_lines
local lines<const>, line_map<const> = wrap('alpha beta gamma', 10, '> ', '  ')
return #lines, lines[1], lines[2], lines[3], line_map[1], line_map[2], line_map[3]
`);
t.assert(wrapped[0] === 3, `wrap_text_lines line count mismatch: ${wrapped[0]}`);
t.assert(wrapped[1] === '> alpha', `wrap_text_lines first line mismatch: ${wrapped[1]}`);
t.assert(wrapped[2] === '  beta', `wrap_text_lines second line mismatch: ${wrapped[2]}`);
t.assert(wrapped[3] === '  gamma', `wrap_text_lines third line mismatch: ${wrapped[3]}`);
t.assert(wrapped[4] === 1 && wrapped[5] === 1 && wrapped[6] === 1, `wrap_text_lines line map mismatch: ${wrapped.slice(4).join(',')}`);

const logicalLines = t.evaluateLua(`
local wrap<const> = require('bios/util/wrap_text_lines').wrap_text_lines
local lines<const>, line_map<const> = wrap('one\\n\\nthree', 5)
return #lines, lines[1], lines[2], lines[3], line_map[1], line_map[2], line_map[3]
`);
t.assert(logicalLines[0] === 3, `logical line count mismatch: ${logicalLines[0]}`);
t.assert(logicalLines[1] === 'one', `first logical line mismatch: ${logicalLines[1]}`);
t.assert(logicalLines[2] === '', `empty logical line mismatch: ${logicalLines[2]}`);
t.assert(logicalLines[3] === 'three', `third logical line mismatch: ${logicalLines[3]}`);
t.assert(logicalLines[4] === 1 && logicalLines[5] === 2 && logicalLines[6] === 3, `logical line map mismatch: ${logicalLines.slice(4).join(',')}`);

const utf8Wrap = t.evaluateLua(`
local wrap<const> = require('bios/util/wrap_text_lines').wrap_text_lines
local lines<const>, line_map<const> = wrap('áβ c', 3)
return #lines, lines[1], lines[2], line_map[1], line_map[2]
`);
t.assert(utf8Wrap[0] === 2, `utf8 line count mismatch: ${utf8Wrap[0]}`);
t.assert(utf8Wrap[1] === 'áβ', `utf8 first line mismatch: ${utf8Wrap[1]}`);
t.assert(utf8Wrap[2] === 'c', `utf8 second line mismatch: ${utf8Wrap[2]}`);
t.assert(utf8Wrap[3] === 1 && utf8Wrap[4] === 1, `utf8 line map mismatch: ${utf8Wrap.slice(3).join(',')}`);

const prefixFailure = t.evaluateLua(`
local wrap<const> = require('bios/util/wrap_text_lines').wrap_text_lines
local ok<const>, message<const> = pcall(function() wrap('x', 2, '>>>') end)
return ok, message
`);
t.assert(prefixFailure[0] === false, 'wrap_text_lines should reject a prefix wider than max_chars');
t.assert(prefixFailure[1] === 'wrap_text_lines prefix exceeds max_chars.', `prefix failure mismatch: ${prefixFailure[1]}`);

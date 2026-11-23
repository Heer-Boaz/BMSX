/** Independent rational oracle: no binary32 scaling or BIOS conversion code. */
function fraction(word: number): [bigint, bigint] {
	const exponent = (word >>> 23) & 255;
	const mantissa = BigInt((word & 0x7fffff) | (exponent ? 0x800000 : 0));
	const shift = exponent ? exponent - 150 : -149;
	return shift < 0 ? [mantissa, 1n << BigInt(-shift)] : [mantissa << BigInt(shift), 1n];
}

function scaledRound(n: bigint, d: bigint, places: number): bigint {
	if (places < 0) d *= 10n ** BigInt(-places);
	else n *= 10n ** BigInt(places);
	return (2n * n + d) / (2n * d);
}

function exponent10(n: bigint, d: bigint): number {
	if (n === 0n) return 0;
	let exponent = n.toString().length - d.toString().length;
	if (exponent >= 0 ? n < d * 10n ** BigInt(exponent) : n * 10n ** BigInt(-exponent) < d) --exponent;
	return exponent;
}

function fixed(n: bigint, d: bigint, precision: number, alternate: boolean): string {
	const text = scaledRound(n, d, precision).toString().padStart(precision + 1, '0');
	return precision ? text.slice(0, -precision) + '.' + text.slice(-precision) : text + (alternate ? '.' : '');
}

export function formatFloat32(word: number, kind: string, precision = 6, alternate = false): string {
	const magnitude = word & 0x7fffffff;
	const sign = word >>> 31 && magnitude <= 0x7f800000 ? '-' : '';
	const upper = kind === kind.toUpperCase();
	if (magnitude >= 0x7f800000) return sign + (magnitude === 0x7f800000 ? (upper ? 'INF' : 'inf') : (upper ? 'NAN' : 'nan'));
	const [n, d] = fraction(word);
	if (kind.toLowerCase() === 'f') return sign + fixed(n, d, precision, alternate);
	const general = kind.toLowerCase() === 'g';
	const significant = general ? Math.max(1, precision) : precision + 1;
	let exponent = exponent10(n, d);
	let rounded = scaledRound(n, d, significant - 1 - exponent);
	if (rounded.toString().length > significant) { ++exponent; rounded /= 10n; }
	if (general && exponent >= -4 && exponent < significant) {
		let text = fixed(n, d, Math.max(0, significant - exponent - 1), alternate);
		if (!alternate && text.includes('.')) text = text.replace(/0+$/, '').replace(/\.$/, '');
		return sign + text;
	}
	const digits = rounded.toString().padStart(significant, '0');
	let mantissa = digits[0] + (significant > 1 || alternate ? '.' + digits.slice(1) : '');
	if (general && !alternate && mantissa.includes('.')) mantissa = mantissa.replace(/0+$/, '').replace(/\.$/, '');
	return sign + mantissa + (upper ? 'E' : 'e') + (exponent < 0 ? '-' : '+') + Math.abs(exponent).toString().padStart(2, '0');
}

export const FORMAT32_CASES: { word: number; format: string; expected: string }[] = [];
function add(word: number, kind: string, precision: number, alternate = false) {
	FORMAT32_CASES.push({ word: word >>> 0, format: `%${alternate ? '#' : ''}.${precision}${kind}`, expected: formatFloat32(word, kind, precision, alternate) });
}
for (const magnitude of [0, 1, 0x007fffff, 0x00800000, 0x3dcccccd, 0x3e800000, 0x3f800000,
	0x3fa00000, 0x411fffff, 0x41200000, 0x42c7ffff, 0x47800000, 0x4f000000, 0x7f7fffff, 0x7f800000, 0x7fc12345]) {
	for (const sign of [0, 0x80000000]) for (const [kind, precision, alternate] of [
		['f', 0, false], ['f', 9, true], ['E', 0, true], ['g', 0, false], ['g', 3, false], ['G', 3, true], ['g', 9, false],
	] as const) add((magnitude | sign) >>> 0, kind, precision, alternate);
}
add(1, 'f', 149);
add(0x7f7fffff, 'f', 100);
add(0x3f800001, 'e', 100);
add(0x3fa00000, 'g', 100);
add(0x3fa00000, 'g', 100, true);

// Shared by TS, native and the physical ARM run; every result is checked against
// the rational reference, not merely against another runtime's checksum.
export const FORMAT32_ROM_SOURCE = `
rodata inputs: word[${FORMAT32_CASES.length}] = { ${FORMAT32_CASES.map(c => `0x${c.word.toString(16)}`).join(',')} }
local boot<const> = require('test/boot')
return boot.pcall(function()
local string<const> = require('string/base')
local table<const> = require('table')
local format<const> = require('string/format').format
local formats<const> = { ${FORMAT32_CASES.map(c => JSON.stringify(c.format)).join(',')} }
local expected<const> = { ${FORMAT32_CASES.map(c => JSON.stringify(c.expected)).join(',')} }
local source<const>: *word = inputs
local checksum = 0
for index = 1, #formats do
 local actual<const> = format(formats[index], blua32.float_from_bits(source[index - 1]))
 if actual ~= expected[index] then boot.error('binary32 format mismatch at ' .. index .. ': ' .. actual .. ' vs ' .. expected[index]) end
 for character = 1, #actual do checksum = ((checksum << 5) | (checksum >> 27)) ~ string.byte(actual, character) end
end
local integers<const> = { 0, 1, -1, 0x7fffffff, 0x80000000, 16777217 }
local correct<const> = {
 '0/0/0/0/0', '1/1/1/1/1', '-1/4294967295/37777777777/ffffffff/FFFFFFFF',
 '2147483647/2147483647/17777777777/7fffffff/7FFFFFFF',
 '-2147483648/2147483648/20000000000/80000000/80000000',
 '16777217/16777217/100000001/1000001/1000001'
}
for index = 1, #integers do
 local value<const> = integers[index]
 if format('%d/%u/%o/%x/%X', value,value,value,value,value) ~= correct[index] then boot.error('word formatting mismatch') end
end
if format('%.2f/%.1e/%#.3g', 1.25, 12.5, 100) ~= '1.25/1.3e+01/100.' then boot.error('manual example') end
if format('%d/%.0f', 16777217, 16777217) ~= '16777217/16777216' then boot.error('integer promotion') end
if format('%+06d/%#08x/%*.*f/%*s/%.0d/%#.0o',42,42,8,2,1.25,-5,'go',0,0) ~= '+00042/0x00002a/    1.25/go   //0' then boot.error('fields') end
if format('%.3g/%.3g/%.3g', 999.5, 0.000099999997, 100.0) ~= '1e+03/0.0001/100' then boot.error('rounded general exponent') end
if format('%.2147483647g/%.2147483647s', 1.25, 'x') ~= '1.25/x' then boot.error('large precision without padding') end
if format('%g/%.0g/%#.0g', 100000.0, 1.25, 1.25) ~= '100000/1/1.' then boot.error('general zeros') end
if format('%.*s/%*s/%.1d', -1, 'éclair', -4.75, 'é', -12.75) ~= 'éclair/é  /-12' then boot.error('truncation or byte width') end
local nul<const> = string.char(0)
if format('é' .. nul .. '%%|%3c|%.2s|%q', 65.75, 'éx', 'A' .. nul) ~= 'é' .. nul .. '%|  A|é|"A\\\\000"' then boot.error('text bytes') end
local errors = 0
local reject<const> = function(...)
 local ok<const> = boot.pcall(format, ...)
 if ok then boot.error('invalid formatter argument admitted') end
 errors = errors + 1
end
reject('%d', 2147483648.0); reject('%u', 4294967296.0)
reject('%d', 1.0/0.0); reject('%d', 0.0/0.0); reject('%f', '1.5'); reject('%d')
reject('%*s', 0x80000000, 'x'); reject('%*s', 1.0/0.0, 'x'); reject('%.*f', 0.0/0.0, 1.0)
reject('%2147483648s', 'x'); reject('%.2147483648f', 1.0)
reject('%.2147483647f', 1.0); reject('%.2147483647e', 1.0)
reject('%'); reject('%*p', 4, 0)
reject('%c', 0.0/0.0); reject('%c', 1.0/0.0)
local saved<const> = tostring
local tostring_calls = 0
tostring = function() tostring_calls = tostring_calls + 1; return 'changed' end
local mutated<const> = format('%s/%d/%.2f', 12, 12, 1.25)
if mutated ~= 'changed/12/1.25' then boot.error('numeric tostring independence: ' .. mutated) end
if tostring_calls ~= 1 then boot.error('implicit tostring calls') end
if table.concat({'a',12,nil,false},'|',1,4) ~= 'a|12||false' or tostring_calls ~= 1 then boot.error('concat owns text conversion') end
tostring = saved
return checksum, ${FORMAT32_CASES.length}, errors, format('%#010x/%d', -1, 0x80000000), format('%.149f', blua32.float_from_bits(1))
end)
`;

export const FORMAT32_MODULES = ['base', 'number/parse', 'number/decimal', 'number/format',
	'table', 'math', 'math/trig', 'math/trig/reduce', 'string/base', 'string/format'];

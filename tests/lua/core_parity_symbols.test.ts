import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { auditPublicSymbolParity } from '../../scripts/analysis/core_parity/public_symbols';

test('public parity follows re-exported functions and checks shared pointees without imposing ownership on TS', () => {
	const root = mkdtempSync(join(tmpdir(), 'bmsx-symbol-parity-'));
	try {
		writeFileSync(join(root, 'tsconfig.base.json'), JSON.stringify({ compilerOptions: { strict: true } }));
		writeFileSync(join(root, 'codec.ts'), 'export function decode(bytes: Uint8Array): number { return bytes.length; }');
		writeFileSync(join(root, 'symbols.ts'), `export type Range = { line: number };
export type RangeRef = Range | null;
export type Symbols = {
	required: Range;
	missing: Range | null;
	alias: RangeRef;
	sequence: readonly RangeRef[];
	label?: string;
};
export { decode } from './codec';
`);
		const header = `namespace bmsx {
struct Range { int line; };
using RangeRef = std::shared_ptr<const Range>;
struct Symbols {
	RangeRef required;
	RangeRef missing;
	RangeRef alias;
	std::vector<RangeRef> sequence;
	std::optional<std::string> label;
};
auto decode(std::span<const u8> bytes) -> int;
}
`;
		const entries = [{ ts: 'symbols.ts', cpp_headers: ['symbols.h'] }];
		writeFileSync(join(root, 'symbols.h'), header);
		assert.deepEqual(auditPublicSymbolParity(root, entries), []);
		for (const mutant of [
			header.replace('const Range>', 'const int>'),
			header.replace('RangeRef required;', ''),
			header.replace('std::optional<std::string> label;', 'std::string label;'),
			header.replace('-> int;', '-> std::string;'),
			header.replace('auto decode(std::span<const u8> bytes) -> int;', ''),
		]) {
			writeFileSync(join(root, 'symbols.h'), mutant);
			assert.notEqual(auditPublicSymbolParity(root, entries).length, 0, mutant);
		}
	} finally {
		rmSync(root, { recursive: true });
	}
});

test('public parity compares optional parameters with native defaults and overloads', () => {
	const root = mkdtempSync(join(tmpdir(), 'bmsx-optional-signature-parity-'));
	try {
		writeFileSync(join(root, 'tsconfig.base.json'), JSON.stringify({ compilerOptions: { strict: true } }));
		writeFileSync(join(root, 'symbols.ts'), `export type Entry = { offset: number };
export function load(bytes: Uint8Array, entries?: readonly Entry[]): Entry | null { return null; }
`);
		const twoArguments = 'auto load(std::span<const u8> bytes, std::span<const Entry> entries) -> std::optional<Entry>;';
		const oneArgument = 'auto load(std::span<const u8> bytes) -> std::optional<Entry>;';
		const entries = [{ ts: 'symbols.ts', cpp_headers: ['symbols.h'] }];
		for (const candidate of [
			{
				label: 'a default parameter preserves both call forms',
				declaration: twoArguments.replace('entries)', 'entries = {})'),
				matches: true,
			},
			{
				label: 'explicit overloads preserve both call forms',
				declaration: `${oneArgument}\n${twoArguments}`,
				matches: true,
			},
			{
				label: 'the shorter signature alone loses the optional call form',
				declaration: oneArgument,
				matches: false,
			},
			{
				label: 'a required parameter loses the shorter call form',
				declaration: twoArguments,
				matches: false,
			},
			{
				label: 'a default does not conceal a different parameter type',
				declaration: twoArguments.replace('const Entry> entries)', 'const u8> entries = {})'),
				matches: false,
			},
		]) {
			writeFileSync(join(root, 'symbols.h'), `namespace bmsx {
struct Entry { u32 offset; };
${candidate.declaration}
}
`);
			const errors = auditPublicSymbolParity(root, entries);
			if (candidate.matches) {
				assert.deepEqual(errors, [], candidate.label);
			} else {
				assert.equal(errors.length, 1, candidate.label);
				assert.match(errors[0], /^symbols\.ts:load: TS signatures .* differ from C\+\+ /, candidate.label);
			}
		}
	} finally {
		rmSync(root, { recursive: true });
	}
});

test('public parity distinguishes default omission from an explicit absent sequence value', () => {
	const root = mkdtempSync(join(tmpdir(), 'bmsx-absent-sequence-parity-'));
	try {
		writeFileSync(join(root, 'tsconfig.base.json'), JSON.stringify({ compilerOptions: { strict: true } }));
		writeFileSync(join(root, 'symbols.ts'), `export type Entry = { offset: number };
export function load(bytes: Uint8Array, entries: readonly Entry[] | undefined = undefined): Entry | null { return null; }
`);
		const header = `namespace bmsx {
struct Entry { u32 offset; };
auto load(std::span<const u8> bytes, std::optional<std::span<const Entry>> entries = std::nullopt) -> std::optional<Entry>;
}
`;
		const entries = [{ ts: 'symbols.ts', cpp_headers: ['symbols.h'] }];
		writeFileSync(join(root, 'symbols.h'), header);
		assert.deepEqual(auditPublicSymbolParity(root, entries), []);
		for (const candidate of [
			{
				label: 'default omission alone does not declare an absent sequence value',
				header: header.replace('std::optional<std::span<const Entry>> entries = std::nullopt', 'std::span<const Entry> entries = {}'),
			},
			{
				label: 'an absent sequence value does not make its parameter omittable',
				header: header.replace(' = std::nullopt', ''),
			},
		]) {
			writeFileSync(join(root, 'symbols.h'), candidate.header);
			const errors = auditPublicSymbolParity(root, entries);
			assert.equal(errors.length, 1, candidate.label);
			assert.match(errors[0], /^symbols\.ts:load: TS signatures .* differ from C\+\+ /, candidate.label);
		}
	} finally {
		rmSync(root, { recursive: true });
	}
});

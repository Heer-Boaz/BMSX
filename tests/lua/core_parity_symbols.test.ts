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

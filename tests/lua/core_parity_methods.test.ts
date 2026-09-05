import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test } from 'node:test';

test('method parity selects the qualified C++ owner, not a same-named method in another class', () => {
	const root = mkdtempSync(join(tmpdir(), 'bmsx-method-parity-'));
	try {
		mkdirSync(join(root, 'machine/ts'), { recursive: true });
		mkdirSync(join(root, 'machine/cpp'), { recursive: true });
		mkdirSync(join(root, 'scripts'));
		const manifest = Object.fromEntries(Object.keys(JSON.parse(readFileSync('scripts/core_parity_manifest.json', 'utf8')))
			.map(key => [key, []]));
		manifest.strict_runtime_method_parity = [{
			ts: 'machine/ts/output.ts', cpp: ['machine/cpp/output.cpp'], cpp_class: 'Mixer',
			methods: ['captureState'], reason: 'qualified owner regression',
		}];
		writeFileSync(join(root, 'scripts/core_parity_manifest.json'), JSON.stringify(manifest));
		writeFileSync(join(root, 'machine/ts/output.ts'), `export class Mixer {
	public captureState(storage?: Uint8Array): void {}
}
`);
		const source = join(root, 'machine/cpp/output.cpp');
		for (const [declaration, success] of [
			['void Mixer::captureState(Bytes storage = {}) { return; }', true],
			['void Mixer::captureState(Bytes wrong) { return; }', false],
			['void Elsewhere::captureState(Bytes storage = {}) { return; }', false],
		] as const) {
			// A different class occurs first and is not an overload of Mixer.
			writeFileSync(source, `void Controller::captureState(int sampleRam) {}\n${declaration}\n`);
			const result = spawnSync(process.execPath, ['--import', resolve('node_modules/tsx/dist/loader.mjs'),
				resolve('scripts/audit_core_parity.ts')], {
				cwd: root, encoding: 'utf8',
				env: { ...process.env, TSX_TSCONFIG_PATH: resolve('tsconfig.base.json') },
			});
			assert.equal(result.status === 0, success, result.stdout + result.stderr);
			if (!success) assert.match(result.stderr, /Strict runtime method parity errors/);
		}
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

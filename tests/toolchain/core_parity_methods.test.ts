import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
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


test('keyboard parity manifest gates its real owners and shared methods without equating platform input APIs', () => {
	const root = mkdtempSync(join(tmpdir(), 'bmsx-keyboard-method-parity-'));
	try {
		const current = JSON.parse(readFileSync('scripts/core_parity_manifest.json', 'utf8'));
		const owners = new Set([
			'hosts/common/input/on_screen_keyboard.ts',
			'hosts/common/input/on_screen_keyboard_keys.ts',
			'hosts/common/host_on_screen_keyboard.ts',
			'hosts/common/input/host_keyboard_interaction.ts',
		]);
		const pairs = current.strict_file_pair_parity.filter(entry => owners.has(entry.ts));
		const methods = current.strict_runtime_method_parity.filter(entry => owners.has(entry.ts));
		assert.equal(pairs.length, 4, 'each logical keyboard, native schema, bitmap view and interaction owner has an explicit peer');
		assert.equal(methods.length, 3, 'the native schema is compared by the behavior runner, not a fabricated table parser');
		assert.ok(methods.every(entry => entry.cpp_class !== undefined && !entry.compare_public));
		assert.deepEqual(methods.find(entry => entry.cpp_class === 'HostKeyboardInteraction').methods, ['close'],
			'platform-specific open/tick inputs are not treated as language-independent signatures');
		const manifest = Object.fromEntries(Object.keys(current).map(key => [key, []]));
		manifest.strict_file_pair_parity = pairs;
		manifest.strict_runtime_method_parity = methods;
		mkdirSync(join(root, 'machine/ts'), { recursive: true });
		mkdirSync(join(root, 'machine/cpp'), { recursive: true });
		mkdirSync(join(root, 'scripts'));
		writeFileSync(join(root, 'scripts/core_parity_manifest.json'), JSON.stringify(manifest));
		const sources = new Map<string, string>();
		for (const pair of pairs) for (const file of [pair.ts, ...pair.cpp]) {
			sources.set(file, readFileSync(file, 'utf8'));
			mkdirSync(join(root, dirname(file)), { recursive: true });
			writeFileSync(join(root, file), sources.get(file)!);
		}
		const runAudit = () => spawnSync(process.execPath, ['--import', resolve('node_modules/tsx/dist/loader.mjs'),
			resolve('scripts/audit_core_parity.ts')], {
			cwd: root, encoding: 'utf8',
			env: { ...process.env, TSX_TSCONFIG_PATH: resolve('tsconfig.base.json') },
		});
		const baseline = runAudit();
		assert.equal(baseline.status, 0, baseline.stdout + baseline.stderr);
		for (const [file, before, after, diagnostic] of [
			['hosts/libretro/on_screen_keyboard.cpp', 'OnScreenKeyboard::activateKey(', 'DifferentKeyboard::activateKey(', 'method activateKey missing'],
			['hosts/libretro/on_screen_keyboard.cpp', 'OnScreenKeyboard::releaseSource(size_t source, bool completeModifierTap)', 'OnScreenKeyboard::releaseSource(size_t source, bool unrelatedRole)', 'releaseSource: TS params'],
			['hosts/libretro/host_on_screen_keyboard.cpp', 'HostOnScreenKeyboard::hitTestAt(', 'HostOnScreenKeyboard::hitSomethingElse(', 'method hitTestAt missing'],
			['hosts/libretro/host_keyboard_interaction.cpp', 'HostKeyboardInteraction::close()', 'HostKeyboardInteraction::unrelatedClose()', 'method close missing'],
		] as const) {
			const source = sources.get(file)!;
			assert.ok(source.includes(before), `the actual source must contain mutation target ${before}`);
			writeFileSync(join(root, file), source.replace(before, after));
			const mutation = runAudit();
			assert.notEqual(mutation.status, 0, `${before}: ${mutation.stdout}${mutation.stderr}`);
			assert.ok(mutation.stderr.includes(diagnostic), mutation.stderr);
			writeFileSync(join(root, file), source);
		}
		rmSync(join(root, 'hosts/libretro/on_screen_keyboard_keys.h'));
		const missingSchemaOwner = runAudit();
		assert.notEqual(missingSchemaOwner.status, 0);
		assert.match(missingSchemaOwner.stderr, /on_screen_keyboard_keys\.h: strict parity C\+\+ file missing/);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

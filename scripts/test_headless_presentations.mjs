import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const artifacts = join(root, '.bmsx');
const cases = new Map([
	['system-print-headless', { cart: 'system_print_test', script: 'tests/carts/system_print_test/run.mjs' }],
	['quick-menu-headless', {
		cart: 'renderhwtest',
		input: ['--input-timeline', 'tests/carts/renderhwtest/quick_menu_demo.json'],
		analyzer: 'tests/carts/renderhwtest/analyze_quick_menu.mjs',
	}],
	['pietious-scanout-headless', {
		cart: 'pietious',
		input: ['--test', 'tests/carts/pietious/pietious_scanout_assert.lua'],
		analyzer: 'tests/carts/pietious/analyze_scanout.mjs',
	}],
	['bare-metal-frame-scan', {
		cart: 'bare_metal_cart',
		input: ['--input-timeline', 'tests/carts/bare_metal_cart/bare_metal_cart_demo.json'],
		analyzer: 'tests/carts/bare_metal_cart/analyze_frame_sequence.mjs',
	}],
]);
const [phase, name, ...unexpected] = process.argv.slice(2);
if (unexpected.length !== 0 || !['prepare', 'run', 'all'].includes(phase) || (name !== undefined && !cases.has(name))) {
	console.error('Usage: test_headless_presentations.mjs <prepare|run|all> [scenario]');
	console.error(`Scenarios: ${[...cases.keys()].join(', ')}`);
	process.exit(2);
}
const selected = name === undefined ? cases : new Map([[name, cases.get(name)]]);

function run(command, args) {
	return new Promise((resolveRun, reject) => {
		const child = spawn(command, args, { cwd: root, stdio: 'inherit' });
		child.once('error', reject);
		child.once('close', (status, signal) => {
			if (status === 0) resolveRun();
			else reject(new Error(`${command} ${args.join(' ')} exited with ${status ?? signal}`));
		});
	});
}

if (phase !== 'run') {
	await run('npm', ['run', 'build:product:node-headless-tooling', '--', '--debug']);
	for (const { cart } of selected.values()) {
		await run('npm', ['run', 'build:toolchain:cart', '--', cart, '--debug']);
	}
}
if (phase !== 'prepare') {
	await mkdir(artifacts, { recursive: true });
	const results = await Promise.allSettled(Array.from(selected, async ([label, scenario]) => {
		const start = performance.now();
		console.log(`[presentation] start ${label}`);
		if (scenario.script !== undefined) {
			await run(process.execPath, [scenario.script]);
		} else {
			const captures = await mkdtemp(join(artifacts, `${label}-`));
			try {
				await run(process.execPath, ['dist/host_headless_tooling.debug.js',
					'--system-rom', 'dist/system/bmsx-bios.debug.rom', ...scenario.input, '--capture-dir', captures, scenario.cart]);
				await run(process.execPath, [scenario.analyzer, captures]);
				await rm(captures, { recursive: true });
			} catch (error) {
				console.error(`[presentation] ${label}: captures retained at ${captures}`);
				throw error;
			}
		}
		console.log(`[presentation] pass ${label} (${((performance.now() - start) / 1000).toFixed(2)} s)`);
	}));
	for (const result of results) {
		if (result.status === 'rejected') {
			console.error(result.reason);
			process.exitCode = 1;
		}
	}
}

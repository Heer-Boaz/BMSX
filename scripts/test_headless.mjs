import { spawn } from 'node:child_process';
import { closeSync, createReadStream, mkdirSync, mkdtempSync, openSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pipeline } from 'node:stream/promises';

const root = resolve(import.meta.dirname, '..');
const buildPaths = process.argv.slice(2);
if (buildPaths.length !== 3) {
	console.error('Usage: npm run test:headless -- <native-release-build> <native-debug-build> <interpreter-build>');
	process.exit(2);
}
const [release, debug, interpreter] = buildPaths.map(path => resolve(root, path));
// Firmware conformance writes a full state per checkpoint. Keep its evidence
// in the workspace artifact store, not in /tmp (often an unswappable tmpfs).
const artifacts = join(root, '.bmsx');
mkdirSync(artifacts, { recursive: true });
const directory = mkdtempSync(join(artifacts, 'headless-tests-'));
const reports = [];

async function run(name, command, args, env = process.env) {
	const filename = join(directory, `${reports.length}.log`);
	const report = { name, filename };
	reports.push(report);
	const start = performance.now();
	const log = openSync(filename, 'w');
	try {
		const child = spawn(command, args, { env, cwd: root, stdio: ['ignore', log, log] });
		report.status = await new Promise(resolveRun => {
			child.once('error', error => { report.error = error; });
			child.once('close', (code, signal) => resolveRun(signal ?? code));
		});
	} finally {
		closeSync(log);
	}
	report.seconds = (performance.now() - start) / 1000;
	return report.status === 0;
}

async function conformance(tests) {
	for (const [name, args = [], build] of tests) {
		const env = build === undefined ? process.env : { ...process.env, BMSX_TEST_NATIVE_BUILD_DIR: build };
		await run(name, 'npm', ['run', `test:${name}`, ...(args.length === 0 ? [] : ['--', ...args])], env);
	}
}

try {
	const units = (async () => {
		if (await run('Debug BIOS and Studio ROMs', 'npm', ['run', 'build:toolchain:cart', '--', 'studio_test', '--debug'])) {
			await run('Node test areas', 'bash', ['scripts/test_node_areas.sh', 'headless'], {
				...process.env,
				BMSX_CPU32_RUNNER: join(interpreter, 'bmsx_cpu32_tests'),
				BMSX_NUMERIC32_RUNNER: join(release, 'bmsx_numeric32_tests'),
				BMSX_VALUE32_RUNNER: join(release, 'bmsx_value32_tests'),
				BMSX_VALUE_STORAGE_RUNNER: join(release, 'bmsx_value_storage_tests'),
			});
		}
	})();
	const ctest = run('Debug CTest', 'ctest', ['--test-dir', debug, '-j4', '--output-on-failure', '--no-tests=error']);
	const replay = conformance([['runtime-replay', ['--native-build-dir', release]]]);
	const nativeWorkersReleased = Promise.all([ctest, replay]);

	const stages = await Promise.allSettled([
		units,
		// Start the long compiler lane once CTest releases its workers.
		ctest.then(() => conformance([
			['frame-evaluation-parity', [], release],
			['gc-stress', [], release],
			['bios-float-parity', [], release],
		])),
		// Don't stack the remaining conformance jobs on replay's live machines.
		nativeWorkersReleased.then(() => conformance([
			['firmware-fsm-parity', [join(debug, 'bmsx_firmware_fsm_runner'), join(interpreter, 'bmsx_firmware_fsm_runner'), directory]],
			['geometry-parity', [join(debug, 'bmsx_geometry_conformance_runner')]],
			['geometry-runtime-migration', [join(debug, 'bmsx_geometry_runtime_migration_runner')]],
			['heap-allocator-parity', [join(debug, 'bmsx_heap_allocator_conformance_runner')]],
			['pow-parity', [join(debug, 'bmsx_pow_conformance_runner')]],
			['keyboard-parity', [join(debug, 'bmsx_keyboard_conformance_runner')]],
			['host-shortcuts-parity', [join(debug, 'bmsx_host_shortcuts_conformance_runner')]],
		])),
		nativeWorkersReleased.then(() => conformance([
			['coroutines', [], interpreter],
			['coroutines', ['--compiled'], debug],
			['table-iteration', [], release],
			['symbols-parity', [], debug],
		])),
		replay.then(() => conformance([
			['terminal-parity', [], release],
			['cartridge-conformance', [], debug],
			['gc-young', [], release],
		])),
	]);
	const failures = stages.filter(stage => stage.status === 'rejected').map(stage => stage.reason);
	if (failures.length !== 0) throw new AggregateError(failures, 'Headless test runner failed');
	for (const { name, filename, status, seconds, error } of reports) {
		console.log(`\n=== ${name} (${seconds.toFixed(2)} s, status ${status}) ===`);
		await pipeline(createReadStream(filename), process.stdout, { end: false });
		if (error !== undefined) console.error(error);
		if (status !== 0) process.exitCode = 1;
	}
} finally {
	rmSync(directory, { recursive: true, force: true });
}

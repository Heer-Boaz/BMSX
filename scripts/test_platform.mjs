import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createReadStream, readdirSync } from 'node:fs';
import { mkdtemp, open, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const assistantFiles = [
	'studio_program_tools', 'studio_actor_execution_tools', 'studio_assistant',
	'studio_actor_tools', 'studio_assistant_presentation', 'studio_assistant_images',
	'studio_behavior_tools', 'studio_debugger_tools', 'studio_frame_tools', 'studio_navigation_tools',
	'studio_runtime_tools', 'studio_source_save_tools', 'studio_stack_tools', 'studio_terminal_tools',
	'studio_test_debugger_tools', 'studio_test_execution_tools', 'studio_test_inspection_tools',
].map(name => `${name}.test.ts`);
const root = resolve(import.meta.dirname, '..');
const platform = 'tests/platform';
const mode = process.argv[2];

if (mode === 'assistant') {
	const { run } = await import('node:test');
	const { tap } = await import('node:test/reporters');
	// One browser worker with private contexts and authored workspaces.
	// Node 22's CLI forces concurrency=1 with test isolation disabled.
	const tests = run({ isolation: 'none', concurrency: 6, files: assistantFiles.map(file => `${platform}/${file}`) });
	tests.on('test:fail', () => { process.exitCode = 1; });
	tests.compose(tap).pipe(process.stdout);
} else if (mode === undefined || mode === 'suite') {
	const env = { ...process.env, TSX_TSCONFIG_PATH: resolve(root, 'tsconfig.base.json') };
	async function execute(command, args, stdio = 'inherit') {
		const [status, signal] = await once(spawn(command, args, { cwd: root, env, stdio }), 'close');
		if (status !== 0) console.error(`${command} ${args.join(' ')} exited with ${signal ?? status}`);
		return status === 0;
	}

	// All packaged Studio tests consume these products. Refresh them once rather
	// than rerunning the focused npm entrypoints with overlapping preparation.
	const ready = await Promise.all([
		execute('npm', ['run', 'build:product:node-host-tools']),
		execute('npm', ['run', 'build:product:browser-studio', '--', '--debug']),
		(async () => {
			for (const cart of ['studio_test', 'hot_resume_test']) {
				if (!await execute('npm', ['run', 'build:toolchain:cart', '--', cart, '--debug'])) return false;
			}
			return true;
		})(),
	]);
	if (ready.includes(false)) process.exit(1);

	const files = readdirSync(resolve(root, platform)).filter(file =>
		/\.test\.(ts|mjs)$/.test(file) && !file.startsWith('browser_') && !assistantFiles.includes(file)
			&& file !== 'studio_external_clipboard.test.ts').map(file => `${platform}/${file}`);
	const node = process.execPath;
	const loader = ['--import', 'tsx', '--import', './tests/helpers/test_setup.ts'];
	const reports = await mkdtemp(join(tmpdir(), 'bmsx-platform-tests-'));
	const assistantReport = join(reports, 'assistant.tap');
	try {
		const log = await open(assistantReport, 'w');
		let results;
		try {
			const isolated = execute(node, [...loader, '--test', '--test-concurrency=3', ...files]);
			const browser = execute('bash', ['scripts/test_node_areas.sh', 'browser-platform']);
			// The two browser-host workers release their software-GPU processes
			// before Assistant admits its full Studio contexts. The independent
			// file pool may finish in parallel without those extra browser workers.
			const assistant = browser.then(() => execute(node, [...loader, import.meta.filename, 'assistant'],
				['ignore', log.fd, log.fd]));
			const lanes = [isolated, browser, assistant,
				execute('python3', ['-m', 'unittest', 'discover', '-s', platform, '-p', 'snesmini_*_test.py'])];
			if (mode === 'suite') {
				// Do not stack the packaged hosts on top of both Studio pools.
				lanes.push(Promise.all([isolated, browser]).then(() =>
					execute('bash', ['scripts/test_packaged_hosts.sh', ...process.argv.slice(3)])));
			}
			results = await Promise.allSettled(lanes);
		} finally {
			await log.close();
		}
		// Keep the Assistant TAP stream intact while the other lanes emit theirs.
		process.stdout.write('\n=== Studio Assistant ===\n');
		for await (const chunk of createReadStream(assistantReport)) {
			if (!process.stdout.write(chunk)) await once(process.stdout, 'drain');
		}
		const errors = results.filter(result => result.status === 'rejected').map(result => result.reason);
		if (errors.length !== 0) throw new AggregateError(errors, 'Platform test runner failed');
		if (results.some(result => !result.value)) process.exitCode = 1;
	} finally {
		await rm(reports, { recursive: true, force: true });
	}
} else {
	console.error('Usage: test_platform.mjs [assistant|suite <release-build> <debug-build>]');
	process.exitCode = 2;
}

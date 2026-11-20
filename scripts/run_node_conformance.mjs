import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { build } from 'esbuild';
import { NODE_TEST_BUNDLE_OPTIONS } from './lib/node_test_bundle.mjs';

const [entry, ...args] = process.argv.slice(2);
const root = NODE_TEST_BUNDLE_OPTIONS.absWorkingDir;
const artifacts = join(root, '.bmsx');
mkdirSync(artifacts, { recursive: true });
const directory = mkdtempSync(join(artifacts, 'node-conformance-'));
try {
	const outfile = join(directory, 'runner.cjs');
	await build({ ...NODE_TEST_BUNDLE_OPTIONS, entryPoints: [entry], outfile, format: 'cjs' });
	const result = spawnSync(process.execPath, ['--enable-source-maps', outfile, ...args], { cwd: root, stdio: 'inherit' });
	if (result.error) throw result.error;
	if (result.signal) throw new Error(`${entry} terminated by ${result.signal}`);
	process.exitCode = result.status;
} finally {
	rmSync(directory, { recursive: true, force: true });
}

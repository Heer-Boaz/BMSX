import { build } from 'esbuild';
import { NODE_TEST_BUNDLE_OPTIONS } from './lib/node_test_bundle.mjs';

const [outdir, ...entryPoints] = process.argv.slice(2);
// One entry per source test file keeps Node in charge of discovery,
// sharding and process isolation. Shared ESM chunks retain native bindings.
await build({
	...NODE_TEST_BUNDLE_OPTIONS,
	entryPoints,
	outbase: NODE_TEST_BUNDLE_OPTIONS.absWorkingDir,
	outdir,
	format: 'esm',
	splitting: true,
	outExtension: { '.js': '.mjs' },
});

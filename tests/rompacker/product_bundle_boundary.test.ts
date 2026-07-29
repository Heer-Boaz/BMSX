import assert from 'node:assert/strict';
import test from 'node:test';

import { assertPlayerBundleBoundary } from '../../scripts/analysis/product_bundle_boundary';

test('player bundle boundary accepts machine and host sources', () => {
	assert.doesNotThrow(() => {
		assertPlayerBundleBoundary('test player', {
			'hosts/browser/player.ts': {},
			'hosts/common/machine_runtime.ts': {},
			'machine/ts/machine/runtime/runtime.ts': {},
		});
	});
});

test('player bundle boundary rejects IDE, compiler, and tooling sources', () => {
	for (const source of [
		'ide/workbench/machine_runtime.ts',
		'machine/ts/lua/compiler.ts',
		'machine/ts/lua/compiler/optimizer/index.ts',
		'machine/ts/rompack/tooling/blua32_linker.ts',
		'scripts/analysis/code_quality.ts',
		'scripts/products/product_build.ts',
		'scripts/rompacker/rompacker.ts',
		'scripts/tooling/cli_arguments.ts',
		'scripts/bootrom/platforms/input_timeline.ts',
		'scripts/bootrom/platforms/node_tooling_entry.ts',
		'scripts/bootrom/platforms/node_tooling_options.ts',
		'scripts/bootrom/platforms/node_workspace_bridge.ts',
		'scripts/bootrom/platforms/headless_capture.ts',
		'scripts/bootrom/platforms/hostrunner/host_test_runner.ts',
	]) {
		assert.throws(
			() => assertPlayerBundleBoundary('test player', { [source]: {} }),
			(error: Error) => error.message.includes(source),
		);
	}
});

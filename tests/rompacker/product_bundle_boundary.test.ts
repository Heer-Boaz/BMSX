import assert from 'node:assert/strict';
import test from 'node:test';

import { assertPlayerBundleBoundary, assertStudioBundleBoundary } from '../../scripts/analysis/product_bundle_boundary';

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
		'toolchain/ts/lua/compiler.ts',
		'toolchain/ts/lua/compiler/optimizer/index.ts',
		'toolchain/ts/rompack/blua32_linker.ts',
		'scripts/analysis/code_quality.ts',
		'scripts/products/product_build.ts',
		'scripts/rompacker/rompacker.ts',
		'scripts/lib/cli_arguments.ts',
		'scripts/bootrom/platforms/input_timeline.ts',
		'scripts/bootrom/platforms/node_tooling_entry.ts',
		'scripts/bootrom/platforms/node_tooling_options.ts',
		'scripts/bootrom/platforms/node_workspace_bridge.ts',
		'scripts/bootrom/platforms/headless_capture.ts',
		'ide/testing/scenario/execution_service.ts',
		'scripts/bootrom/platforms/hostrunner/scenario_host_frame.ts',
		'node_modules/elkjs/lib/elk.bundled.js',
	]) {
		assert.throws(
			() => assertPlayerBundleBoundary('test player', { [source]: {} }),
			(error: Error) => error.message.includes(source),
		);
	}
});

test('Studio main-thread bundles accept native worker clients but never the layout engine, including in-process ELK', () => {
	assert.doesNotThrow(() => assertStudioBundleBoundary('Studio', {
		'ide/browser/graph_layout.ts': {},
		'ide/node/graph_layout.ts': {},
		'ide/workbench/services/graph_layout/worker_requests.ts': {},
		'ide/workbench/services/graph_layout/async_layout.ts': {},
		'ide/workbench/ui/graph/compound_layout.ts': {},
	}));
	for (const path of ['elk.bundled.js', 'elk-api.js', 'elk-worker.min.js', 'main.js']) {
		assert.throws(() => assertStudioBundleBoundary('Studio', { [`node_modules/elkjs/lib/${path}`]: {} }), /worker-only/);
	}
});

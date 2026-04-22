import assert from 'node:assert/strict';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { test } from 'node:test';

import { collectCartFiles, lintCartSources } from '../../scripts/rompacker/cart_lua_linter_runtime';

test('cart linter ignores non-runtime source files', async () => {
	const root = join(process.cwd(), 'tmp', 'tests', 'rompacker', 'cart_linter_ignore');
	try {
		await rm(root, { recursive: true, force: true });
		await mkdir(join(root, '_ignore'), { recursive: true });
		await mkdir(join(root, 'test'), { recursive: true });
		await writeFile(join(root, 'entry.lua'), 'return 1\n');
		await writeFile(join(root, '_ignore', 'bad.lua'), 'local floor<const> = math.floor\nreturn floor(1.5)\n');
		await writeFile(join(root, 'test', 'host_assert.lua'), 'return host.press("ArrowDown", 2)\n');

		const files = await collectCartFiles([root]);
		assert.deepEqual(files.map(file => basename(file)), ['entry.lua']);
		await lintCartSources({ roots: [root], profile: 'cart' });
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

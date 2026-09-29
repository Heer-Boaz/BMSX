import assert from 'node:assert/strict';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { test } from 'node:test';

import { prepareRomInputs } from '../../scripts/rompacker/build_inputs';
import { lintCartSources } from '../../scripts/rompacker/cart_lua_linter_runtime';
import { collectCartSourceFiles } from '../../scripts/rompacker/cart_source_files';

test('cart linter ignores non-runtime source files', async () => {
	const root = join(process.cwd(), 'tmp', 'tests', 'rompacker', 'cart_linter_ignore');
	try {
		await rm(root, { recursive: true, force: true });
		await mkdir(join(root, '_ignore'), { recursive: true });
		await mkdir(join(root, 'test'), { recursive: true });
		await writeFile(join(root, 'entry.lua'), 'return 1\n');
		await writeFile(join(root, '_ignore', 'bad.lua'), 'local floor<const> = math.floor\nreturn floor(1.5)\n');
		await writeFile(join(root, 'test', 'host_assert.lua'), 'return host.press("ArrowDown", 2)\n');

		const files = collectCartSourceFiles([root]);
		assert.deepEqual(files.map(file => basename(file)), ['entry.lua']);
		const inputs = await prepareRomInputs([], files);
		await lintCartSources({ sources: [...inputs.files.values()], profile: 'cart' });
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

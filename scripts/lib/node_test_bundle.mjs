import { resolve } from 'node:path';

export const NODE_TEST_BUNDLE_OPTIONS = {
	absWorkingDir: resolve(import.meta.dirname, '../..'),
	bundle: true,
	platform: 'node',
	target: 'node22',
	packages: 'external',
	conditions: ['bmsx-bundle'],
	loader: { '.rgba': 'binary', '.glsl': 'text', '.wgsl': 'text' },
	tsconfig: 'tsconfig.base.json',
	sourcemap: 'linked',
	sourcesContent: false,
};

import { relative, resolve } from 'node:path';

const PLAYER_FORBIDDEN_SOURCE_PATHS = [
	'ide/',
	'toolchain/ts/',
	'scripts/analysis/',
	'scripts/products/',
	'scripts/rompacker/',
	'scripts/tooling/',
	'scripts/bootrom/platforms/input_timeline.ts',
	'scripts/bootrom/platforms/node_tooling_entry.ts',
	'scripts/bootrom/platforms/node_tooling_options.ts',
	'scripts/bootrom/platforms/node_workspace_bridge.ts',
	'scripts/bootrom/platforms/headless_capture.ts',
	'scripts/bootrom/platforms/hostrunner/',
] as const;

function repositoryPath(inputPath: string): string {
	return relative(process.cwd(), resolve(process.cwd(), inputPath)).replace(/\\/g, '/');
}

function playerForbiddenSource(path: string): boolean {
	for (let index = 0; index < PLAYER_FORBIDDEN_SOURCE_PATHS.length; index += 1) {
		const forbiddenPath = PLAYER_FORBIDDEN_SOURCE_PATHS[index];
		if (forbiddenPath.endsWith('/')) {
			if (path.startsWith(forbiddenPath)) {
				return true;
			}
		} else if (path === forbiddenPath) {
			return true;
		}
	}
	return false;
}

export function assertPlayerBundleBoundary(
	product: string,
	inputs: Readonly<Record<string, unknown>>,
): void {
	const violations: string[] = [];
	for (const inputPath of Object.keys(inputs)) {
		const path = repositoryPath(inputPath);
		if (playerForbiddenSource(path)) {
			violations.push(path);
		}
	}
	if (violations.length > 0) {
		violations.sort();
		throw new Error(`${product} includes tooling sources:\n${violations.join('\n')}`);
	}
}

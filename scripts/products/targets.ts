export type NodePlayerTarget = 'cli' | 'headless';

export type ProductBuildTarget =
	| 'machine-runtime'
	| 'browser-player'
	| 'browser-studio'
	| 'node-cli-player'
	| 'node-headless-player'
	| 'node-headless-tooling'
	| 'libretro-wsl'
	| 'libretro-win';

export type JavaScriptProductTarget = Exclude<
	ProductBuildTarget,
	'libretro-wsl' | 'libretro-win'
>;

export function javascriptProductFilename(
	target: JavaScriptProductTarget,
	debug: boolean,
): string {
	let basename: string;
	switch (target) {
		case 'machine-runtime':
			basename = 'libbmsx';
			break;
		case 'browser-player':
			basename = 'engine';
			break;
		case 'browser-studio':
			basename = 'studio';
			break;
		case 'node-cli-player':
			basename = 'host_cli';
			break;
		case 'node-headless-player':
			basename = 'host_headless';
			break;
		case 'node-headless-tooling':
			basename = 'host_headless_tooling';
			break;
	}
	return debug ? `${basename}.debug.js` : `${basename}.js`;
}

const child = require('child_process');
const fs = require('fs');

const args = process.argv.slice(2);
if (args.length === 0) {
	console.error('Error: missing rom folder name.\nUsage: npm run headless:game -- <romFolderName>');
	process.exit(1);
}

const romFolder = args[0];

const romFilenameMap = {
	ella2023: 'yiear',
};

const cartRootCandidates = [
	`src/carts/${romFolder}`,
	`src/${romFolder}`,
];
const cartRoot = cartRootCandidates.find(candidate => fs.existsSync(candidate));
if (!cartRoot) {
	console.error(`Error: cart folder "${romFolder}" not found under src/carts or src.`);
	process.exit(1);
}
const cartResPath = `${cartRoot}/res`;
const romBase = romFilenameMap[romFolder] || romFolder;
const romPath = `dist/${romBase}.debug.rom`;
const engineRuntimePath = 'dist/engine.js';
const engineAssetsPath = 'dist/engine.assets.debug.rom';
const timelinePath = `${cartRoot}/test/${romFolder}_demo.json`;
const inputModulePath = `${cartRoot}/test/${romFolder}_assert_results.mjs`;

let result = child.spawnSync('npm', ['run', 'build:engine', '--', '--platform', 'headless'], { stdio: 'inherit' });
if (result.status !== 0) {
	console.error('Error: build:engine failed.');
	process.exit(result.status || 1);
}

result = child.spawnSync('npx', [
	'tsx',
	'scripts/rompacker/rompacker.ts',
	'--debug',
	'--force',
	'-romname', romFolder,
	'-respath', `./${cartResPath}`
], { stdio: 'inherit' });
if (result.status !== 0) {
	console.error('Error: cart build failed.');
	process.exit(result.status || 1);
}

const headlessArgs = [
	'dist/headless_debug.js',
	'--rom', romPath,
	'--engine-runtime', engineRuntimePath,
	'--engine-assets', engineAssetsPath,
];
if (fs.existsSync(timelinePath)) {
	headlessArgs.push('--input-timeline', timelinePath);
} else {
	console.warn(`[headless-run] Optional input timeline not found at ${timelinePath}. Running without a timeline.`);
}
if (fs.existsSync(inputModulePath)) {
	headlessArgs.push('--input-module', inputModulePath);
}

result = child.spawnSync('node', headlessArgs, { stdio: 'inherit' });
if (result.status !== 0) {
	console.error('Error: headless runner failed.');
	process.exit(result.status || 1);
}

process.exit(0);

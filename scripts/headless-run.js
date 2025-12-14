const child = require('child_process');
const fs = require('fs');

const args = process.argv.slice(2);
if (args.length === 0) {
	console.error('Error: missing rom folder name.\nUsage: npm run headless:game -- <romFolderName>');
	process.exit(1);
}

const romFolder = args[0];

const cartRoots = {
	luademo: 'src/carts/luademo',
	luashell: 'src/luashell',
	testcart: 'src/carts/testcart',
	emptycart: 'src/carts/emptycart',
	2025: 'src/carts/2025',
};

// Map folder name -> rom base filename when rommanifest differs from folder name
const romFilenameMap = {
	ella2023: 'yiear',
};

if (!cartRoots[romFolder]) {
	const romBase = romFilenameMap[romFolder] || romFolder;
	const romPath = `dist/${romBase}.debug.rom`;
	const timelinePath = `src/${romFolder}/test/${romFolder}_demo.json`;
	const inputModulePath = `src/${romFolder}/test/${romFolder}_assert_results.mjs`;
	let result = child.spawnSync('npm', ['run', 'build:game:headless', romFolder], { stdio: 'inherit' });
	if (result.status !== 0) {
		console.error('Error: build:game:headless failed.');
		process.exit(result.status || 1);
	}
	const headlessArgs = ['dist/headless_debug.js', '--rom', romPath];
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
}

const cartRoot = cartRoots[romFolder];
const cartResPath = `${cartRoot}/res`;
const engineRomPath = 'dist/engine.debug.rom';
const engineRuntimePath = 'dist/engine.js';

let result = child.spawnSync('npx', [
	'tsx',
	'scripts/rompacker/rompacker.ts',
	'--mode', 'engine',
	'--debug',
	'--force',
	'--nodeploy',
	'--skiptypecheck',
	'--platform', 'headless',
	'-romname', 'engine',
	'-title', 'BMSX Engine',
	'-bootloaderpath', './src/bmsx/console/default_cart',
	'-respath', './src/bmsx/res'
], { stdio: 'inherit' });
if (result.status !== 0) {
	console.error('Error: engine build failed.');
	process.exit(result.status || 1);
}


result = child.spawnSync('npx', [
	'tsx',
	'scripts/rompacker/rompacker.ts',
	'--debug',
	'--force',
	'--nodeploy',
	'--skiptypecheck',
	'--platform', 'headless',
	'-romname', romFolder,
	'-title', romFolder,
	'-bootloaderpath', `./${cartRoot}`,
	'-respath', `./${cartResPath}`
], { stdio: 'inherit' });
if (result.status !== 0) {
	console.error('Error: cart build failed.');
	process.exit(result.status || 1);
}

const romBase = romFilenameMap[romFolder] || romFolder;
const romPath = `dist/${romBase}.debug.rom`;
const timelinePath = `${cartRoot}/test/${romFolder}_demo.json`;
const inputModulePath = `${cartRoot}/test/${romFolder}_assert_results.mjs`;

const headlessArgs = ['dist/headless_debug.js', '--rom', romPath, '--engine', engineRomPath, '--engine-runtime', engineRuntimePath];
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

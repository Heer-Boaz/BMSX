const child = require('child_process');
const fs = require('fs');

const args = process.argv.slice(2);
if (args.length === 0) {
	console.error('Error: missing rom folder name.\nUsage: npm run headless:game -- <romFolderName>');
	process.exit(1);
}

const romFolder = args[0];

// Map folder name -> rom base filename when rommanifest differs from folder name
// Add additional mappings here as needed.
const romFilenameMap = {
	"ella2023": "yiear"
};

const romBase = romFilenameMap[romFolder] || romFolder;
const romPath = `dist/${romBase}.debug.rom`;
const timelinePath = `src/${romFolder}/test/${romFolder}_demo.json`;

// Run the build:game:headless <romFolder>
let result = child.spawnSync('npm', ['run', 'build:game:headless', romFolder], { stdio: 'inherit' });
if (result.status !== 0) {
	console.error('Error: build:game:headless failed.');
	process.exit(result.status || 1);
}

// Run the headless debug runner with computed paths
const headlessArgs = ['dist/headless_debug.js', '--rom', romPath];
if (fs.existsSync(timelinePath)) {
	headlessArgs.push('--input-timeline', timelinePath);
} else {
	console.warn(`[headless-run] Optional input timeline not found at ${timelinePath}. Running without a timeline.`);
}
result = child.spawnSync('node', headlessArgs, { stdio: 'inherit' });
if (result.status !== 0) {
	console.error('Error: headless runner failed.');
	process.exit(result.status || 1);
}

process.exit(0);

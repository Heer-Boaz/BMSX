import { execFileSync } from 'node:child_process';
import { playableStudioCartSkip } from '../tests/helpers/playable_studio_carts.mjs';

const [suite, ...args] = process.argv.slice(2);
const suites = {
	workflows: {
		host: 'browser-studio',
		carts: ['nemesis_s'],
		run: ['tests/conformance/runtime_replay/browser.mjs', '--studio', 'dist/system/bmsx-bios.debug.rom', 'dist/nemesis_s.debug.rom'],
	},
	yaml: {
		host: 'node-headless-tooling',
		carts: ['pietious', 'nemesis_s'],
		run: ['--test', '--test-concurrency=1', 'tests/ide/yaml_source_editing.mjs'],
	},
};
if (!Object.hasOwn(suites, suite)) throw new Error('Expected a playable Studio suite: workflows or yaml');
if (playableStudioCartSkip) {
	console.log(`SKIP Studio ${suite}: ${playableStudioCartSkip}`);
	process.exit(0);
}

const { host, carts, run } = suites[suite];
execFileSync('npm', ['run', `build:product:${host}`, '--', '--debug'], { stdio: 'inherit' });
for (const cart of carts) execFileSync('npm', ['run', 'build:toolchain:cart', '--', cart, '--debug'], { stdio: 'inherit' });
execFileSync(process.execPath, [...run, ...args], { stdio: 'inherit' });

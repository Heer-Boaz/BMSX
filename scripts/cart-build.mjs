#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import path from 'node:path';

const argv = process.argv.slice(2);
const isRelease = argv.includes('--release');
const cartArg = argv.find(arg => arg.startsWith('--cart='));
const cartName = process.env.npm_config_cart || (cartArg ? cartArg.split('=')[1] : undefined);
if (!cartName) {
	console.error('Usage: npm run build:cart -- --cart=<name> [--release] [--root=path] [--res=path] [--title="Title"]');
	process.exit(1);
}

function resolveEnv(key, fallback) {
	const value = process.env[`npm_config_${key}`];
	if (value && value.length > 0) return value;
	const arg = argv.find(entry => entry.startsWith(`--${key}=`));
	if (arg) {
		const [, raw] = arg.split('=');
		if (raw && raw.length > 0) return raw;
	}
	return fallback;
}

const inferredRoot = cartName.includes('/') ? path.join('src', cartName) : path.join('src/carts', cartName);
const cartRoot = resolveEnv('root', inferredRoot);
const resPath = resolveEnv('res', path.join(cartRoot, 'res'));
const title = resolveEnv('title', cartName);

const romName = resolveEnv('romname', cartName);

const args = [
	'tsx',
	'scripts/rompacker/rompacker.ts',
	'--mode',
	'cart',
];

if (!isRelease) {
	args.push('--debug');
}

args.push('--force', '--nodeploy', '--skiptypecheck');
args.push('-romname', romName);
args.push('-title', title);
args.push('-bootloaderpath', cartRoot.startsWith('./') ? cartRoot : `./${cartRoot}`);
args.push('-respath', resPath.startsWith('./') ? resPath : `./${resPath}`);

const result = spawnSync('npx', args, { stdio: 'inherit' });
if (result.status !== 0) {
	process.exit(result.status || 1);
}

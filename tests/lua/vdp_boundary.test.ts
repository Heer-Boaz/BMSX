import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

const root = process.cwd();

function collectFiles(dir: string, out: string[] = []): string[] {
	for (const entry of readdirSync(dir)) {
		const path = join(dir, entry);
		const stat = statSync(path);
		if (stat.isDirectory()) {
			collectFiles(path, out);
			continue;
		}
		if (stat.isFile()) {
			if (/\.(ts|tsx|js|mjs|cpp|cc|c|h|hpp|lua)$/.test(path)) {
				out.push(path);
			}
		}
	}
	return out;
}

function assertNoMatches(dirs: string[], patterns: readonly RegExp[]): void {
	const hits: string[] = [];
	for (const dir of dirs) {
		for (const file of collectFiles(join(root, dir))) {
			const text = readFileSync(file, 'utf8');
			for (const pattern of patterns) {
				if (pattern.test(text)) {
					hits.push(`${file.slice(root.length + 1)} matches ${pattern.source}`);
				}
			}
		}
	}
	assert.deepEqual(hits, []);
}

function assertNoMatchesOutsideVdpDevice(dirs: string[], patterns: readonly RegExp[]): void {
	const hits: string[] = [];
	for (const dir of dirs) {
		for (const file of collectFiles(join(root, dir))) {
			const relative = file.slice(root.length + 1);
			if (relative.includes('/machine/devices/vdp/')) {
				continue;
			}
			const text = readFileSync(file, 'utf8');
			for (const pattern of patterns) {
				if (pattern.test(text)) {
					hits.push(`${relative} matches ${pattern.source}`);
				}
			}
		}
	}
	assert.deepEqual(hits, []);
}

test('only VDP device code calls private VDP ingress methods', () => {
	assertNoMatchesOutsideVdpDevice([
		'src/bmsx',
		'src/bmsx_cpp',
	], [
		/writeVdpRegister/,
		/consumeDirectVdpCommand/,
	]);
});

test('render/shared does not know or program VDP registers', () => {
	assertNoMatches([
		'src/bmsx/render/shared',
		'src/bmsx_cpp/render/shared',
	], [
		/writeVdpRegister/,
		/consumeDirectVdpCommand/,
		/VDP_REG_/,
		/machine\/devices\/vdp\/registers/,
	]);
});

test('VDP device code does not import host render modules', () => {
	assertNoMatches([
		'src/bmsx/machine/devices/vdp',
		'src/bmsx_cpp/machine/devices/vdp',
	], [
		/render\/vdp\/framebuffer/,
		/render\/vdp\//,
		/render\/backend/,
		/render\/shared\/queues/,
	]);
});

test('cart-facing firmware/runtime VDP submissions go through memory MMIO', () => {
	assertNoMatches([
		'src/bmsx/machine/firmware',
		'src/bmsx/machine/runtime',
		'src/bmsx_cpp/machine/firmware',
		'src/bmsx_cpp/machine/runtime',
	], [
		/writeVdpRegister/,
		/consumeDirectVdpCommand/,
	]);
});

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

function assertFileDoesNotMatch(file: string, patterns: readonly RegExp[]): void {
	const text = readFileSync(join(root, file), 'utf8');
	const hits: string[] = [];
	for (const pattern of patterns) {
		if (pattern.test(text)) {
			hits.push(`${file} matches ${pattern.source}`);
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

test('GameView does not route renderer submissions into VDP MMIO adapters', () => {
	assertFileDoesNotMatch('src/bmsx/render/gameview.ts', [
		/machine\/runtime\/vdp_submissions/,
		/vdpSubmissions/,
		/IO_VDP_REG_/,
		/IO_VDP_CMD/,
	]);
	assertFileDoesNotMatch('src/bmsx_cpp/render/gameview.cpp', [
		/machine\/runtime\/vdp_submissions/,
		/VdpSubmissions/,
		/IO_VDP_REG_/,
		/IO_VDP_CMD/,
	]);
});

test('old high-level VDP scene command ABI is gone', () => {
	assertNoMatches([
		'src/bmsx',
		'src/bmsx_cpp',
		'src/carts',
	], [
		/processVdpCommand/,
		/processVdpBufferedCommand/,
		/command_processor/,
		/packet_schema/,
		/IO_CMD_VDP_/,
		/sys_vdp_stream_packet_header_words/,
		/VDP_STREAM_PACKET_HEADER_WORDS/,
		/VDP_STREAM_PAYLOAD_CAPACITY_WORDS/,
		/sys_vdp_cmd_(clear|fill_rect|blit|draw_line|glyph_run|tile_run)/,
	]);
});

test('machine runtime does not import render submission or font types for VDP emission', () => {
	assertNoMatches([
		'src/bmsx/machine/runtime',
		'src/bmsx_cpp/machine/runtime',
	], [
		/render\/shared\/submissions/,
		/render\/shared\/bitmap_font/,
		/core\/font/,
		/vdp_submissions/,
	]);
});

test('TS host 2D queue tags submissions without mutating or copying payloads', () => {
	assertFileDoesNotMatch('src/bmsx/render/shared/queues.ts', [
		/\.type\s*=/,
		/\{\s*\.\.\.item/,
		/Object\.assign/,
	]);
	const text = readFileSync(join(root, 'src/bmsx/render/shared/queues.ts'), 'utf8');
	assert.match(text, /host2dKindQueue/);
	assert.match(text, /host2dRefQueue/);
});

test('native host 2D submissions do not disappear into an unconsumed C++ queue', () => {
	assertFileDoesNotMatch('src/bmsx_cpp/render/shared/queues.h', [
		/Host2D/,
		/submitSprite/,
		/submitRectangle/,
		/submitDrawPolygon/,
		/submitGlyphs/,
		/\bRenderSubmission\b/,
	]);
	assertFileDoesNotMatch('src/bmsx_cpp/render/shared/queues.cpp', [
		/s_host2DQueue/,
		/Host2D/,
		/RenderSubmission\s+submission/,
		/submitSprite/,
		/submitRectangle/,
		/submitDrawPolygon/,
		/submitGlyphs/,
	]);
	assertFileDoesNotMatch('src/bmsx_cpp/render/gameview.cpp', [
		/RenderQueues::submitSprite/,
		/RenderQueues::submitRectangle/,
		/RenderQueues::submitDrawPolygon/,
		/RenderQueues::submitGlyphs/,
	]);
});

test('renderer-side code does not write VDP command registers', () => {
	assertNoMatches([
		'src/bmsx/render',
		'src/bmsx_cpp/render',
	], [
		/IO_VDP_REG_/,
		/IO_VDP_CMD/,
	]);
});

test('presentation helper does not receive the raw VDP device object', () => {
	assertNoMatches([
		'src/bmsx/render/vdp',
		'src/bmsx_cpp/render/vdp',
	], [
		/presentVdpFrameBufferPages\s*\([^)]*VDP/,
		/presentVdpFrameBufferPages\s*\([^)]*vdp/,
	]);
	assertFileDoesNotMatch('src/bmsx/machine/runtime/vblank.ts', [
		/presentVdpFrameBufferPages\s*\(\s*vdp\s*\)/,
	]);
	assertFileDoesNotMatch('src/bmsx_cpp/machine/runtime/vblank.cpp', [
		/presentVdpFrameBufferPages\s*\(\s*vdp\s*\)/,
	]);
});


test('TS and C++ VDP host bridge expose the same read and ack contract names', () => {
	assertFileDoesNotMatch('src/bmsx_cpp/machine/devices/vdp/vdp.h', [
		/hostOutput\s*\(/,
	]);
	assertFileDoesNotMatch('src/bmsx/machine/devices/vdp/vdp.ts', [
		/hostOutputState/,
	]);
	const tsText = readFileSync(join(root, 'src/bmsx/machine/devices/vdp/vdp.ts'), 'utf8');
	const cppText = readFileSync(join(root, 'src/bmsx_cpp/machine/devices/vdp/vdp.h'), 'utf8');
	assert.match(tsText, /readHostOutput\s*\(/);
	assert.match(tsText, /completeHostExecution\s*\(/);
	assert.match(cppText, /readHostOutput\s*\(/);
	assert.match(cppText, /completeHostExecution\s*\(/);
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

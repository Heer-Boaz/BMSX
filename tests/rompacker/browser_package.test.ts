import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { type TestContext } from 'node:test';
import { promisify } from 'node:util';
import { decodeHTML } from 'entities';
import { encodeBinary } from '../../machine/ts/common/serializer/binencoder';
import { CART_ROM_HEADER_SIZE } from '../../machine/ts/spec/bmsx/rom_package';
import { PLAYER_INPUT_TRACE_SCRIPT, PLAYER_MANIFEST, renderPlayerPage } from '../../scripts/products/player_page';
import type { RomArtifact } from '../../toolchain/ts/rompack/build_manifest';
import { writeCartRomHeader } from '../../toolchain/ts/rompack/header_encode';

const run = promisify(execFile);

async function fixture(t: TestContext) {
	const root = await mkdtemp(join(tmpdir(), 'bmsx-browser-package-'));
	t.after(() => rm(root, { recursive: true, force: true }));
	const id = 'a'.repeat(64), store = join(root, 'store'), host = join(root, 'host');
	const artifactDir = join(store, 'artifacts', id);
	await mkdir(join(artifactDir, 'system'), { recursive: true });
	await mkdir(host);
	const title = 'Piet & "Test" $& {{BMSX_SYSTEM_ROM}}';
	const manifest = encodeBinary({ title, hardware: [{ type: 'rom' }] });
	const cart = new Uint8Array(CART_ROM_HEADER_SIZE + manifest.byteLength);
	writeCartRomHeader(cart, {
		headerSize: CART_ROM_HEADER_SIZE, manifestOffset: CART_ROM_HEADER_SIZE, manifestLength: manifest.byteLength,
		tocOffset: 0, tocLength: 0, dataOffset: 0, dataLength: 0,
		blua32ImageOffset: 0, blua32ImageByteCount: 0, blua32StartupFunctionAddress: 0,
		blua32IrqFunctionAddress: 0, blua32ExceptionFunctionAddress: 0,
		blua32StaticLayoutTokenLo: 0, blua32StaticLayoutTokenHi: 0, blua32DiagnosticDirectoryOffset: 0,
		metadataOffset: 0, metadataLength: 0,
	});
	cart.set(manifest, CART_ROM_HEADER_SIZE);
	const system = Buffer.from([1, 2, 3, 4]);
	await writeFile(join(artifactDir, 'cart.rom'), cart);
	await writeFile(join(artifactDir, 'system/bios.rom'), system);
	const artifact: RomArtifact = {
		id, target: 'cart',
		system: { key: 'system', name: 'bios', inputs: 'system-inputs',
			recipe: { domain: 'system', debug: false, optLevel: 3, projectRoot: 'machine/bios', toolchain: 'test' },
			outputs: [{ file: 'system/bios.rom', digest: createHash('sha256').update(system).digest('hex') }] },
		cart: { key: 'cart', name: 'cart', inputs: 'cart-inputs',
			recipe: { domain: 'cart', debug: false, optLevel: 3, projectRoot: 'carts/cart', toolchain: 'test' },
			outputs: [{ file: 'cart.rom', digest: createHash('sha256').update(cart).digest('hex') }] },
	};
	await writeFile(join(artifactDir, 'artifact.json'), JSON.stringify(artifact));
	await writeFile(join(host, 'engine.js'), '/* selected host */');
	await writeFile(join(host, 'bmsx_icon.png'), Buffer.from([9]));
	await writeFile(join(host, PLAYER_MANIFEST), JSON.stringify({ name: 'BMSX', short_name: 'BMSX', start_url: './', scope: './' }));
	await writeFile(join(host, 'player.template.html'), '<title>{{BMSX_TITLE}}</title><body data-default-rom="{{BMSX_CARTRIDGE}}" data-system-rom="{{BMSX_SYSTEM_ROM}}">');
	await writeFile(join(host, 'player.input-trace.template.html'), '<title>{{BMSX_TITLE}}</title><body data-default-rom="{{BMSX_CARTRIDGE}}" data-system-rom="{{BMSX_SYSTEM_ROM}}"><div id="player-surface"></div>'
		+ `<script src="${PLAYER_INPUT_TRACE_SCRIPT}" crossorigin="anonymous"></script><script src="engine.js" crossorigin="anonymous"></script>`);
	await writeFile(join(host, PLAYER_INPUT_TRACE_SCRIPT), '/* selected early input observer */');
	const args = ['--import', 'tsx', 'scripts/products/deploy_builder.ts', '--artifact', id, '--store-dir', store, '--host-dir', host];
	return { root, id, args, title, cart, system };
}

test('input trace is an explicit package asset loaded before the same selected engine', async t => {
	const { root, args } = await fixture(t);
	const ordinary = join(root, 'ordinary'), diagnostic = join(ordinary, 'ios');
	await run(process.execPath, [...args, '--output-dir', ordinary]);
	await run(process.execPath, [...args, '--output-dir', diagnostic, '--input-trace']);
	assert.ok(!(await readdir(ordinary)).includes(PLAYER_INPUT_TRACE_SCRIPT));
	assert.equal(await readFile(join(diagnostic, 'engine.js'), 'utf8'), await readFile(join(ordinary, 'engine.js'), 'utf8'));
	const page = await readFile(join(diagnostic, 'index.html'), 'utf8');
	assert.ok(page.indexOf(`src="${PLAYER_INPUT_TRACE_SCRIPT}"`) < page.indexOf('src="engine.js"'));
	const receipt = JSON.parse(await readFile(join(diagnostic, 'package.json'), 'utf8'));
	const traceAsset = receipt.host.find((asset: { file: string }) => asset.file === PLAYER_INPUT_TRACE_SCRIPT);
	assert.equal(traceAsset.digest, createHash('sha256').update(await readFile(join(diagnostic, PLAYER_INPUT_TRACE_SCRIPT))).digest('hex'));
});

test('player slots escape titles and URL attributes in one pass', () => {
	const page = renderPlayerPage('<title>{{BMSX_TITLE}}</title><body data-default-rom="{{BMSX_CARTRIDGE}}" data-system-rom="{{BMSX_SYSTEM_ROM}}">',
		'"<& $& {{BMSX_CARTRIDGE}}', 'https://media.test/cart.rom?a=1&b="two"', 'system/bios.rom');
	assert.equal(page, '<title>&quot;&lt;&amp; $&amp; {{BMSX_CARTRIDGE}}</title><body data-default-rom="https://media.test/cart.rom?a=1&amp;b=&quot;two&quot;" data-system-rom="system/bios.rom">');
});

for (const split of [false, true]) {
	test(`browser package keeps paired media ${split ? 'on its explicit separate origin' : 'beside the player'}`, async t => {
		const { root, id, args, title, cart, system } = await fixture(t);
		const output = join(root, 'player'), media = split ? join(root, 'media') : output;
		const base = `https://media.example/bmsx/${id}/`;
		await run(process.execPath, [...args, '--output-dir', output,
			...(split ? ['--media-base-url', base, '--media-output-dir', media] : [])]);
		const html = await readFile(join(output, 'index.html'), 'utf8');
		assert.equal(decodeHTML(html.match(/<title>(.*?)<\/title>/)![1]), title);
		assert.ok(html.includes(`data-default-rom="${split ? base : ''}cart.rom"`));
		assert.ok(html.includes(`data-system-rom="${split ? base : ''}system/bios.rom"`));
		assert.deepEqual(new Uint8Array(await readFile(join(media, 'cart.rom'))), cart);
		assert.deepEqual(await readFile(join(media, 'system/bios.rom')), system);
		const manifest = JSON.parse(await readFile(join(output, PLAYER_MANIFEST), 'utf8'));
		assert.deepEqual(manifest, { name: title, short_name: title, start_url: './', scope: './' });
		const receipt = JSON.parse(await readFile(join(output, 'package.json'), 'utf8'));
		assert.equal(receipt.artifact, id);
		assert.deepEqual(receipt.media, { system: `${split ? base : ''}system/bios.rom`, cartridge: `${split ? base : ''}cart.rom` });
		for (const selected of receipt.host) {
			assert.equal(createHash('sha256').update(await readFile(join(output, selected.file))).digest('hex'), selected.digest);
		}
		if (split) assert.deepEqual((await readdir(output)).sort(), ['bmsx_icon.png', 'engine.js', 'index.html', PLAYER_MANIFEST, 'package.json'].sort());
	});
}

import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { finalizeRompack, generateRomAssets, getResMetaByFilename } from '../../scripts/rompacker/rombuilder';
import { structuredTextAssetFromPath, type StructuredTextAsset } from '../../toolchain/ts/rompack/assets';
import { loadRomAssetList } from '../../toolchain/ts/rompack/loader';
import { layoutRomPrefix } from '../../toolchain/ts/rompack/rom_prefix_layout';

test('workspace and packer classify the same authored filenames and asset ids', () => {
	const filenames: readonly [string, StructuredTextAsset][] = [
		['res/data/Stage Map.yaml', { type: 'data', resid: 'stagemap', format: 'yaml' }],
		['res/data/settings.YML', { type: 'data', resid: 'settings', format: 'yaml' }],
		['configuration.json', { type: 'data', resid: 'configuration', format: 'json' }],
		['events.aem.yaml', { type: 'aem', resid: 'events', format: 'yaml' }],
		['res/sound/EVENTS.AEM.JSON', { type: 'aem', resid: 'events', format: 'json' }],
		['events.aem.extra.yml', { type: 'aem', resid: 'events', format: 'yaml' }],
		['events.aem_backup.yaml', { type: 'aem', resid: 'events', format: 'yaml' }],
		['stage.extra.yaml', { type: 'data', resid: 'stage', format: 'yaml' }],
		['stage.aem.collision.yaml', { type: 'collision_map', resid: 'stage.aem', format: 'yaml' }],
		['Stage.Extra.Collision.YML', { type: 'collision_map', resid: 'stage.extra', format: 'yaml' }],
		['stage.collision.json', { type: 'data', resid: 'stage', format: 'json' }],
		['folder.aem/events.yaml', { type: 'data', resid: 'events', format: 'yaml' }],
		['.hidden.yaml', { type: 'data', resid: '', format: 'yaml' }],
	];
	for (const [path, expected] of filenames) {
		assert.deepEqual(structuredTextAssetFromPath(path), expected, path);
		const packed = getResMetaByFilename(path);
		assert.deepEqual({ type: packed.type, resid: packed.name, format: packed.datatype }, expected, path);
	}
	for (const path of ['entry.lua', 'res/sound/shot.wav', 'res/events.aem', '.yaml', 'res/no-extension', 'res/']) {
		assert.equal(structuredTextAssetFromPath(path), undefined, path);
	}
});

test('debug packages retain exact authored text independently of cooked bytes; release packages omit it', async t => {
	const directory = await mkdtemp(join(tmpdir(), 'bmsx-authored-source-'));
	t.after(() => rm(directory, { recursive: true, force: true }));
	const yaml = '# Keep accents, comments, anchors and CRLF: café 🐉\r\nbase: &base "01"\r\nvalue: *base\r\n';
	const json = '{\r\n  "value": "01"\r\n}\r\n';
	const aem = '# Authored event layout\r\nevents: {}\r\n';
	const assets = await generateRomAssets([
		{ type: 'data', name: 'stage', id: 1, datatype: 'yaml', sourcePath: 'res/stage.yaml', buffer: Buffer.from(yaml) },
		{ type: 'data', name: 'json', id: 2, datatype: 'json', sourcePath: 'res/value.json', buffer: Buffer.from(json) },
		{ type: 'aem', name: 'events', id: 3, datatype: 'yaml', sourcePath: 'res/events.aem.yaml', buffer: Buffer.from(aem), eventMap: {} },
		{ type: 'bin', name: 'binary', id: 4, buffer: Buffer.from([0xff, 0x00, 0x01]) },
	]);
	const authored = new Map([['stage', yaml], ['json', json], ['events', aem]]);
	for (const debug of [true, false]) {
		await finalizeRompack('authored', { debug, blua32: null, outputDirectory: directory,
			layout: layoutRomPrefix(assets, debug, { hardware: [{ type: 'rom' }] }) });
		const bytes = await readFile(join(directory, `authored${debug ? '.debug' : ''}.rom`));
		const { entries } = await loadRomAssetList(bytes, 'cart');
		for (const entry of entries) {
			const asset = assets.find(asset => asset.resid === entry.resid)!;
			assert.deepEqual(bytes.subarray(entry.start!, entry.end!), asset.buffer);
			assert.equal(entry.sourcemeta?.text, debug ? authored.get(entry.resid) : undefined);
		}
	}
});

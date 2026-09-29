import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rename, rm, stat, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { prepareRomInputs } from '../../scripts/rompacker/build_inputs';
import { recordRomBuild, romBuildStatus, type RomBuildRecipe } from '../../scripts/rompacker/build_state';
import { lintCartSources } from '../../scripts/rompacker/cart_lua_linter_runtime';
import { loadGLTFModel } from '../../scripts/rompacker/gltfloader';
import { generateRomAssets, getResMetaList, getResourcesList } from '../../scripts/rompacker/rombuilder';

test('discovery, lint and packaged source consume captured bytes after disk changes', async t => {
	const root = await mkdtemp(join(tmpdir(), 'bmsx-build-inputs-'));
	t.after(() => rm(root, { recursive: true, force: true }));
	const path = join(root, 'entry.lua');
	const source = 'module<entry>\nreturn 42';
	await writeFile(path, source);
	const inputs = await prepareRomInputs([root], [path]);
	await writeFile(path, 'module<entry>\nreturn (');
	const metadata = await getResMetaList(inputs, { domain: 'cart', virtualRoot: root,
		sourceOnlyLuaRootFiles: [], sourceOnlyLuaModuleRoots: [] });
	const assets = await generateRomAssets(await getResourcesList(metadata));
	await lintCartSources({ sources: [inputs.files.get(path)!], profile: 'cart' });
	assert.equal(assets[0].buffer!.toString(), source);
	assert.equal(assets[0].update_timestamp, inputs.files.get(path)!.modifiedMs);
	assert.ok(assets[0].compiled_buffer);
	assert.notEqual((await prepareRomInputs([root], [])).identity, inputs.identity);
});

test('content and membership changes invalidate even when mtimes do not advance', async t => {
	const root = await mkdtemp(join(tmpdir(), 'bmsx-build-membership-'));
	t.after(() => rm(root, { recursive: true, force: true }));
	const path = join(root, 'data.bin');
	await writeFile(path, 'first');
	const initial = await prepareRomInputs([root], []);
	const metadata = await stat(path);
	assert.equal((await prepareRomInputs([root], [])).identity, initial.identity);
	assert.notEqual((await prepareRomInputs([], [path])).identity, initial.identity);
	await writeFile(path, 'other');
	await utimes(path, metadata.atime, metadata.mtime);
	const edited = await prepareRomInputs([root], []);
	assert.notEqual(edited.identity, initial.identity);
	const moved = join(root, 'moved.bin');
	await rename(path, moved);
	const renamed = await prepareRomInputs([root], []);
	assert.notEqual(renamed.identity, edited.identity);
	await rm(moved);
	assert.notEqual((await prepareRomInputs([root], [])).identity, renamed.identity);
});

test('GLTF buffers and images outside the resource root are captured before conversion', async t => {
	const root = await mkdtemp(join(tmpdir(), 'bmsx-build-gltf-'));
	t.after(() => rm(root, { recursive: true, force: true }));
	const resources = join(root, 'res');
	await mkdir(resources);
	const mesh = join(resources, 'mesh.gltf');
	const buffer = join(root, 'geometry.bin'), image = join(root, 'texture.png');
	const vertices = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]);
	await writeFile(buffer, Buffer.from(vertices.buffer));
	await writeFile(image, Buffer.from([5, 6, 7, 8]));
	await writeFile(mesh, JSON.stringify({ asset: { version: '2.0' }, buffers: [{ uri: '../geometry.bin', byteLength: vertices.byteLength }],
		bufferViews: [{ buffer: 0, byteLength: vertices.byteLength }], accessors: [{ bufferView: 0, componentType: 5126, count: 3, type: 'VEC3' }],
		meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }], images: [{ uri: '../texture.png' }] }));
	const inputs = await prepareRomInputs([resources], []);
	assert.ok(inputs.modelBufferFiles.has(buffer));
	assert.equal(inputs.files.size, 3);
	await writeFile(buffer, Buffer.from([9, 10, 11, 12]));
	await writeFile(image, Buffer.from([13, 14, 15, 16]));
	const model = await loadGLTFModel(inputs.models.get(mesh)!, 'mesh');
	assert.deepEqual(new Uint8Array(model.imageBuffers[0]), new Uint8Array([5, 6, 7, 8]));
	assert.deepEqual(model.meshes[0].positions, vertices);
	assert.notEqual((await prepareRomInputs([resources], [])).identity, inputs.identity);
});

test('build receipts bind effective options, input identity and output bytes', async t => {
	const root = await mkdtemp(join(tmpdir(), 'bmsx-build-receipt-'));
	t.after(() => rm(root, { recursive: true, force: true }));
	const output = join(root, 'cart.rom'), payload = Buffer.from([1, 2, 3, 4]);
	const recipe: RomBuildRecipe = { domain: 'cart', debug: true, optLevel: 0, projectRoot: 'carts/example', toolchain: 'compiler-a' };
	assert.equal(await romBuildStatus(output, recipe, 'sources-a'), 'not-built');
	await writeFile(output, payload);
	const beforeRecord = await prepareRomInputs([root], []);
	await recordRomBuild(output, { recipe, inputs: 'sources-a', outputs: [{ file: 'cart.rom', digest: createHash('sha256').update(payload).digest('hex') }] });
	assert.equal((await prepareRomInputs([root], [])).identity, beforeRecord.identity);
	assert.equal(await romBuildStatus(output, recipe, 'sources-a'), 'up-to-date');
	assert.equal(await romBuildStatus(output, { ...recipe, optLevel: 3 }, 'sources-a'), 'recipe-changed');
	assert.equal(await romBuildStatus(output, { ...recipe, toolchain: 'compiler-b' }, 'sources-a'), 'recipe-changed');
	assert.equal(await romBuildStatus(output, recipe, 'sources-b'), 'inputs-changed');
	await writeFile(output, Buffer.from([4, 3, 2, 1]));
	assert.equal(await romBuildStatus(output, recipe, 'sources-a'), 'output-changed');
	await rm(output);
	assert.equal(await romBuildStatus(output, recipe, 'sources-a'), 'output-changed');
	const recordPath = join(root, '.bmsx', 'cart.rom.build.json');
	await writeFile(recordPath, '{');
	await assert.rejects(romBuildStatus(output, recipe, 'sources-a'), SyntaxError);
	assert.equal(await readFile(recordPath, 'utf8'), '{');
});

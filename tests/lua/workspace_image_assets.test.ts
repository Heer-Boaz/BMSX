import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { createLuaSourceRegistry } from '../../ide/runtime/source_registry';
import { WorkspaceImageAssets } from '../../ide/workspace/image_assets';
import { createTestRuntimeSourceState, TEST_CARTRIDGE_CONTEXT_IDS } from '../helpers/runtime_sources';
import { createPackedImageFixture } from '../helpers/packed_images';

function fixture(t: TestContext) {
	const packed = [new Uint8Array([255, 0, 0, 255]), new Uint8Array([0, 255, 0, 255])]
		.map(pixels => createPackedImageFixture('shared-image', 1, 1, pixels, 'shared-atlas'));
	const sources = createTestRuntimeSourceState(createLuaSourceRegistry('system', ''),
		[createLuaSourceRegistry('project', ''), null], 0,
		{ system: packed[0].entries, cartridgeSlots: [packed[1].entries, []] });
	const catalog = sources.catalog, contexts = [catalog.getContext(sources.systemContextId), catalog.getContext(TEST_CARTRIDGE_CONTEXT_IDS[0])];
	for (let index = 0; index < contexts.length; index++) {
		const context = contexts[index], image = packed[index];
		context.previewRom!.bytes = image.bytes; context.previewRom!.index.entries.push(...image.entries);
		context.previewPackage.img['shared-image'] = image.entries[0];
	}
	const images = new WorkspaceImageAssets(catalog), used = new Set(['shared-image']);
	t.after(() => { images.dispose(); catalog.dispose(); });
	return { catalog, contexts, images, used, packed };
}

test('a reader retains exact image/provider/packed identity through unrelated catalog publication', t => {
	const f = fixture(t), [system, project] = f.contexts;
	f.images.update(system.id, f.used); const systemBitmap = f.images.get('shared-image')!.bitmap;
	assert.deepEqual(systemBitmap.image.pixels, f.packed[0].pixels);
	let retired = 0; systemBitmap.onDispose(() => retired++);
	f.images.update(project.id, f.used); const projectBitmap = f.images.get('shared-image')!.bitmap;
	assert.notEqual(projectBitmap, systemBitmap); assert.equal(retired, 1);
	assert.deepEqual(projectBitmap.image.pixels, f.packed[1].pixels);
	f.catalog.rebuildResources(); f.images.update(project.id, f.used);
	assert.ok(f.images.get('shared-image')!.bitmap === projectBitmap, 'new binding records do not replace the same exact packed image');
	let projectRetired = 0; projectBitmap.onDispose(() => projectRetired++);
	delete project.previewPackage.img['shared-image']; f.catalog.rebuildResources(); f.images.update(project.id, f.used);
	assert.equal(projectRetired, 1);
	assert.deepEqual(f.images.get('shared-image')!.bitmap.image.pixels, f.packed[0].pixels, 'the current declared dependency supplies the image');
});

test('packed generation replacement and unused images retire resources without stale or placeholder pixels', t => {
	const f = fixture(t), project = f.contexts[1];
	f.images.update(project.id, f.used); const old = f.images.get('shared-image')!.bitmap;
	let retired = 0; old.onDispose(() => retired++);
	project.previewRom!.bytes = f.packed[0].bytes;
	f.images.update(project.id, f.used);
	const current = f.images.get('shared-image')!.bitmap; assert.notEqual(current, old); assert.equal(retired, 1);
	assert.deepEqual(current.image.pixels, f.packed[0].pixels);
	let currentRetired = 0; current.onDispose(() => currentRetired++);
	f.images.update(project.id, new Set(['missing-image']));
	assert.equal(f.images.get('shared-image'), undefined); assert.equal(f.images.get('missing-image'), undefined);
	assert.equal(currentRetired, 1);
	f.images.update(project.id, f.used); const fresh = f.images.get('shared-image')!.bitmap;
	assert.notEqual(fresh, current); let disposed = 0; fresh.onDispose(() => disposed++);
	f.images.dispose(); assert.equal(disposed, 1); assert.equal(f.images.get('shared-image'), undefined);
});

test('a source-only provider supplies no made-up bitmap', t => {
	const f = fixture(t), provider = f.catalog.admitContext({ ...f.contexts[0],
		admission: { id: 'source-only', projectRoot: 'source-only' }, dependencyContextIds: [], previewRom: null });
	f.images.update(provider.id, f.used); assert.equal(f.images.get('shared-image'), undefined);
});

test('distinct logical images share their physical atlas until its last reader binding retires', t => {
	const f = fixture(t), project = f.contexts[1];
	project.previewPackage.img.second = { ...f.packed[1].image, resid: 'second', source_path: 'second.png' };
	f.catalog.rebuildResources(); f.images.update(project.id, new Set(['shared-image', 'second']));
	const first = f.images.get('shared-image')!, second = f.images.get('second')!;
	assert.ok(first.bitmap === second.bitmap);
	assert.notEqual(first, second); let retired = 0; first.bitmap.onDispose(() => retired++);
	f.images.update(project.id, new Set(['second'])); assert.equal(retired, 0);
	assert.ok(f.images.get('second') === second);
	f.images.update(project.id, new Set()); assert.equal(retired, 1);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { AssistantAttachments } from '../../ide/workbench/contrib/assistant/attachments';
import { ImagePreviewCache } from '../../ide/workbench/ui/image_preview';
import { HostBitmap, HostBitmapTextures } from '../../machine/ts/render/host_overlay/bitmap';
import { HostOverlayQuadStream } from '../../machine/ts/render/host_overlay/quad_stream';
import { Host2DKind } from '../../machine/ts/render/host_overlay/commands';
import type { ClipboardImageData } from '../../hosts/common/clipboard';

const pixels = { width: 2, height: 1, pixels: new Uint8Array([255, 0, 0, 255, 0, 255, 0, 128]) };

test('removal and draft replacement retire pending clipboard reads; failed files remain removable', async () => {
	const draft = new AssistantAttachments();
	const pending = Promise.withResolvers<ClipboardImageData>();
	draft.add([{ read: () => pending.promise }]);
	assert.equal(draft.ready, false);
	draft.remove(0); draft.set(['new-image']);
	pending.resolve({ url: 'old-image', preview: pixels }); await pending.promise;
	assert.deepEqual(draft.urls, ['new-image']);
	draft.add([{ read: async () => { throw new Error('Invalid external image'); } }]);
	await Promise.resolve();
	assert.equal(draft.images[1].state, 'error'); assert.equal(draft.ready, false);
	draft.remove(1); assert.equal(draft.ready, true);
});

test('visible image cache reuses decoded pixels and releases backend textures on eviction and teardown', async () => {
	let decodes = 0, uploads = 0, releases = 0;
	const cache = new ImagePreviewCache(async () => { decodes++; return pixels; });
	const textures = new HostBitmapTextures(() => ++uploads, () => { releases++; });
	cache.beginFrame(); const preview = cache.use('one'); await Promise.resolve();
	assert.equal(textures.get(preview.bitmap!), 1); cache.endFrame();
	cache.beginFrame(); assert.equal(cache.use('one'), preview); assert.equal(textures.get(preview.bitmap!), 1); cache.endFrame();
	assert.equal(decodes, 1); assert.equal(uploads, 1);
	cache.beginFrame(); cache.endFrame(); assert.equal(releases, 1);
	cache.beginFrame(); const fresh = cache.use('one', pixels); cache.endFrame();
	assert.equal(textures.get(fresh.bitmap!), 2); assert.equal(decodes, 1, 'clipboard preview is already decoded');
	textures.dispose(); cache.dispose(); assert.equal(releases, 2, 'backend teardown detaches image listeners');
});

test('bitmap batches preserve clip and order and do not retarget later game-frame sampling', () => {
	const image = new HostBitmap(pixels), stream = new HostOverlayQuadStream();
	stream.reset(100, 100);
	stream.appendEntry(Host2DKind.Bitmap, { bitmap: image, area: { left: 0, top: 0, right: 20, bottom: 10, z: 0 } });
	stream.appendEntry(Host2DKind.Clip, { left: 10, top: 10, right: 90, bottom: 90 });
	stream.appendEntry(Host2DKind.Bitmap, { bitmap: image, area: { left: 0, top: 0, right: 20, bottom: 10, z: 0 } });
	stream.appendEntry(Host2DKind.Frame, { area: { left: 20, top: 20, right: 40, bottom: 40, z: 0 } });
	assert.equal(stream.batchCount, 3);
	assert.equal(stream.batches[0].bitmap, image); assert.equal(stream.batches[1].bitmap, image);
	assert.equal(stream.batches[1].clip, stream.batches[2].clip); assert.equal(stream.batches[2].bitmap, undefined);
	stream.reset(100, 100);
	assert.ok(stream.batches.every(batch => batch.bitmap === undefined), 'idle retained batch slots do not pin evicted pixels');
});

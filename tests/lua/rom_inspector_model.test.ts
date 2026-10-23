import assert from 'node:assert/strict';
import { test } from 'node:test';
import { RomInspectorModel } from '../../ide/workbench/contrib/rom_inspector/model';
import { RomInspectorContentModel } from '../../ide/workbench/contrib/rom_inspector/content_model';
import { ROM_CATEGORIES } from '../../ide/workbench/contrib/rom_inspector/colors';
import { parseCartHeader, type CartRomHeader } from '../../machine/ts/rompack/format';
import { INSTRUCTION_BYTES, writeInstruction } from '../../machine/ts/spec/blua32/instruction_format';
import { OpCode } from '../../machine/ts/spec/blua32/opcode';
import { finalizePackedRomAssets, type RomAsset } from '../../toolchain/ts/rompack/assets';
import { encodeCollisionShapeVariants, type CollisionShapeVariant } from '../../toolchain/ts/rompack/collision_shape_codec';
import { encodeDirect16GxUpload } from '../../toolchain/ts/rompack/gp0_encode';
import { encodeDirect16GxTexture } from '../../toolchain/ts/rompack/gx_texture_codec';
import { encodeImgDecStream } from '../../toolchain/ts/rompack/imgdec_codec';
import { GX_SYSTEM_TEXTURE_ASSET_ID } from '../../toolchain/ts/rompack/system_texture';
import { blua32SourceRangeAtPc } from '../../toolchain/ts/rompack/blua32_symbols';
import { loadRomAssetList } from '../../toolchain/ts/rompack/loader';
import { linkRawTestSystemBlua32 } from '../helpers/blua32';

const header: CartRomHeader = {
	headerSize: 72,
	manifestOffset: 0, manifestLength: 0,
	tocOffset: 176, tocLength: 16,
	metadataOffset: 144, metadataLength: 32,
	dataOffset: 72, dataLength: 72,
	blua32ImageOffset: 0, blua32ImageByteCount: 0,
	blua32StartupFunctionAddress: 0,
	blua32IrqFunctionAddress: 0,
	blua32ExceptionFunctionAddress: 0,
	blua32StaticLayoutTokenLo: 0,
	blua32StaticLayoutTokenHi: 0,
	blua32DiagnosticDirectoryOffset: 0,
};

const modelAsset: RomAsset = {
	resid: 'model', type: 'model', source_path: 'res/model.glb',
	start: 72, end: 88,
	model_texture_start: 88, model_texture_end: 104,
	collision_bin_start: 104, collision_bin_end: 128,
	metabuffer_start: 144, metabuffer_end: 160,
};

function inspector(assets: RomAsset[]): RomInspectorModel {
	finalizePackedRomAssets(assets);
	return new RomInspectorModel({ domain: 0, label: 'Cart 0', rom: new Uint8Array(192), header, assets });
}

test('asset content selects every retained physical range without replacing its source context', () => {
	const model = inspector([modelAsset]);
	const row = model.selection!;
	const content = new RomInspectorContentModel(model.snapshot); content.setSubject(row);
	assert.deepEqual(content.ranges.map(range => [range.kind, range.start, range.end]), [
		['data', 72, 88], ['metadata', 144, 160], ['model-texture', 88, 104], ['collision', 104, 128],
	]);
	assert.strictEqual(content.ranges, row.ranges);
	assert.strictEqual(content.selectedRange, content.ranges[0]);
	assert.equal(row.byteLength, 72);
	assert.equal(content.canPreviewImage, false);
	for (let index = 0; index < content.ranges.length; index++) {
		content.selectRange(index);
		assert.strictEqual(content.selectedRange, content.ranges[index]);
		assert.strictEqual(model.selection, row);
		assert.equal(model.selection.sourcePath, 'res/model.glb');
	}
	assert.equal(modelAsset.buffer, undefined);
});

test('held ranges survive catalog changes until the content owner explicitly follows another subject', () => {
	const bin: RomAsset = { resid: 'bin', type: 'bin', start: 128, end: 144 };
	const model = inspector([bin, modelAsset]);
	const content = new RomInspectorContentModel(model.snapshot);
	model.select(model.rows.findIndex(row => row.asset === modelAsset)); content.setSubject(model.selection);
	content.selectRange(3);
	const range = content.selectedRange;
	model.sort = 'size'; model.descending = true; model.project();
	assert.equal(model.selected, 0);
	assert.strictEqual(content.selectedRange, range);
	model.filter = 'model.glb'; model.project();
	assert.strictEqual(content.selectedRange, range);
	model.filter = ''; model.project();
	assert.strictEqual(content.selectedRange, range);
	const held = content.subject, properties = [...content.properties], revision = content.revision, rangeRevision = content.rangeRevision;
	model.select(model.rows.findIndex(row => row.asset === bin));
	assert.equal(content.subject, held); assert.equal(content.selectedRange, range);
	model.setMode('structure');
	assert.equal(content.subject, held); assert.deepEqual(content.properties, properties);
	assert.equal(content.revision, revision); assert.equal(content.rangeRevision, rangeRevision);
	model.setMode('assets'); model.select(model.rows.findIndex(row => row.asset === bin)); content.setSubject(model.selection);
	assert.strictEqual(content.selectedRange, content.ranges[0]);
	model.select(model.rows.findIndex(row => row.asset === modelAsset)); content.setSubject(model.selection);
	assert.equal(content.selectedRange.kind, 'data');
	model.filter = 'no matching asset'; model.project(); content.setSubject(model.selection);
	assert.equal(model.selection, undefined);
	assert.deepEqual(content.ranges, []);
	assert.equal(content.selectedRange, undefined);
	assert.equal(content.canPreviewImage, false);
});

test('metadata-only images have metadata bytes, while deletion operations never request a preview', () => {
	const sprite: RomAsset = {
		resid: 'sprite', type: 'image', metabuffer_start: 160, metabuffer_end: 176,
		imgmeta: { width: 4, height: 4, texture_u: 0, texture_v: 0, gx_atlas_id: 'atlas' },
	};
	const tombstones: RomAsset[] = [
		{ resid: 'removed image', type: 'image', op: 'delete' },
		{ resid: 'removed texture', type: 'texture', op: 'delete' },
	];
	const model = inspector([sprite, ...tombstones]);
	const content = new RomInspectorContentModel(model.snapshot);
	model.select(model.rows.findIndex(row => row.asset === sprite)); content.setSubject(model.selection);
	assert.equal(content.subject.kind, 'asset'); assert.equal(content.view, 'preview'); assert.equal(content.preview, undefined);
	assert.equal(content.canPreviewImage, true);
	assert.equal(content.selectedRange.kind, 'metadata');
	for (const tombstone of tombstones) {
		model.select(model.rows.findIndex(row => row.asset === tombstone)); content.setSubject(model.selection);
		assert.equal(content.canPreviewImage, false);
		assert.equal(content.view, 'info'); assert.equal(content.preview, undefined);
		assert.deepEqual(content.ranges, []);
		assert.equal(content.selectedRange, undefined);
		assert.equal(model.selection.asset.op, 'delete');
	}
});

test('Layout keeps its selected physical section instead of opening the asset primary payload', () => {
	const model = inspector([modelAsset]);
	const content = new RomInspectorContentModel(model.snapshot);
	model.setMode('structure'); content.setSubject(model.selection);
	assert.equal(content.subject.kind, 'section'); assert.equal(content.view, 'info');
	assert.deepEqual(content.selectedRange, { kind: 'header', start: 0, end: 72 });
	model.select(model.rows.findIndex(row => row.start === 88)); content.setSubject(model.selection);
	assert.strictEqual(model.selection.asset, modelAsset);
	assert.equal(model.selection.type, 'texture', 'Layout describes the actual model-texture buffer, not the generic asset container');
	assert.equal(model.selection.category, ROM_CATEGORIES.texture);
	assert.deepEqual(content.ranges, [{ kind: 'model-texture', start: 88, end: 104 }]);
	assert.equal(content.canPreviewImage, false);
});

test('held function content retains its captured image and lazy instruction index across catalog modes and empty filters', () => {
	const text = new Uint8Array(4 * INSTRUCTION_BYTES);
	writeInstruction(text, 0, OpCode.RET, 0, 0, 0, 0);
	writeInstruction(text, 1, OpCode.WIDE, 0, 0, 0, 0);
	writeInstruction(text, 2, OpCode.MOV, 1, 2, 0, 0);
	writeInstruction(text, 3, OpCode.RET, 0, 0, 0, 0);
	const linked = linkRawTestSystemBlua32({ text, functions: [
		{ firstWord: 0, wordCount: 1 }, { firstWord: 1, wordCount: 3 },
	] });
	const model = new RomInspectorModel({ domain: -1, label: 'System', rom: linked.romBytes, header: parseCartHeader(linked.romBytes), assets: [] });
	const content = new RomInspectorContentModel(model.snapshot);
	model.setMode('code');
	model.select(model.rows.findIndex(row => row.functionIndex === 1));
	const fn = model.code!.layout.functions[1], byteCount = fn.codeByteCount;
	let indexReads = 0;
	Object.defineProperty(fn, 'codeByteCount', { configurable: true, get: () => { indexReads++; return byteCount; } });
	content.setSubject(model.selection);
	assert.equal(indexReads, 0, 'binding a caption while the reader is hidden must not index instructions');
	assert.equal(model.selection.type, 'function');
	assert.equal(model.selection.category, ROM_CATEGORIES.blua32, 'function rows share program category without becoming physical map sections');
	const expected = [linked.image.functions[1].codeAddress, linked.image.functions[1].codeAddress + 2 * INSTRUCTION_BYTES];
	assert.deepEqual([...content.instructions], expected);
	assert.ok(indexReads > 0); const preparedIndexReads = indexReads;
	assert.equal(content.selectedRange.kind, 'instructions');
	const held = content.subject, image = model.code, addresses = content.instructions, properties = [...content.properties];
	assert.equal(held.kind, 'function'); assert.equal(held.image, image); assert.equal(content.view, 'bytes');
	model.filter = 'no matching function'; model.project();
	assert.equal(model.selection, undefined); assert.equal(content.subject, held);
	model.filter = ''; model.setMode('structure');
	assert.equal(content.subject, held); assert.equal(content.instructions, addresses); assert.deepEqual(content.properties, properties);
	assert.equal(content.selectedRange.kind, 'instructions');
	for (let frame = 0; frame < 1000; frame++) {
		content.setSubject(held); content.setView('info'); content.setView('bytes');
		assert.equal(content.instructions, addresses);
	}
	assert.equal(indexReads, preparedIndexReads, 'retained instruction addresses must not be reindexed on view or catalog changes');
	content.setSubject(undefined);
	assert.equal(content.instructions.length, 0);
	assert.equal(content.selectedRange, undefined);
	model.setMode('code');
	model.select(model.rows.findIndex(row => row.functionIndex === 1)); content.setSubject(model.selection);
	assert.deepEqual([...content.instructions], expected);
	model.setMode('structure'); content.setSubject(model.selection);
	assert.equal(content.instructions.length, 0);
	assert.equal(content.selectedRange.kind, 'header');
});

test('preview changes retain decoded pixels and collision paths until selection changes', t => {
	const pixels = Uint8ClampedArray.of(255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, 255, 255, 255, 255);
	const texture = encodeDirect16GxTexture(2, 2, pixels);
	const upload = encodeDirect16GxUpload(texture, 0, 0);
	const shape: CollisionShapeVariant = {
		bounds: { left: 0, top: 0, right: 1, bottom: 1 },
		pieces: [{ kind: 'convex_poly', vertices: [0, 0, 1, 0, 1, 1] }],
	};
	const collisionBytes = encodeCollisionShapeVariants({ original: shape, fliph: shape, flipv: shape, fliphv: shape });
	const collisionStart = 72 + upload.length;
	const collisionEnd = collisionStart + collisionBytes.length;
	const fixtureHeader = { ...header, dataLength: collisionEnd - 72, metadataOffset: collisionEnd, tocOffset: collisionEnd + 32 };
	const rom = new Uint8Array(fixtureHeader.tocOffset + fixtureHeader.tocLength);
	rom.set(upload, 72);
	rom.set(collisionBytes, collisionStart);
	const systemTexture: RomAsset = { resid: GX_SYSTEM_TEXTURE_ASSET_ID, type: 'bin', start: 72, end: 72 + upload.length };
	const sprite: RomAsset = {
		resid: 'sprite', type: 'image', source_path: 'res/sprite.png', metabuffer_start: collisionEnd, metabuffer_end: collisionEnd + 16,
		collision_bin_start: collisionStart, collision_bin_end: collisionEnd,
		imgmeta: { width: 2, height: 2, texture_u: 0, texture_v: 0 },
	};
	const second: RomAsset = { resid: 'second', type: 'image', metabuffer_start: collisionEnd + 16, metabuffer_end: collisionEnd + 32,
		imgmeta: { width: 1, height: 2, texture_u: 1, texture_v: 0 } };
	const removed: RomAsset = { resid: 'removed', type: 'image', op: 'delete' };
	const entries = [systemTexture, sprite, second, removed];
	finalizePackedRomAssets(entries);
	const model = new RomInspectorModel({ domain: -1, label: 'System', rom, header: fixtureHeader, assets: entries });
	const content = new RomInspectorContentModel(model.snapshot);
	const originalBytes = rom.slice(), physical = model.inspection.sections.map(section => ({ ...section }));
	t.after(() => content.dispose());
	model.select(model.rows.findIndex(row => row.asset === sprite)); content.setSubject(model.selection);
	assert.equal(content.preview, undefined, 'binding a subject must not decode hidden pixels');
	content.preparePreview();
	const bitmap = content.preview!;
	const release = t.mock.method(bitmap, 'dispose');
	const paths = content.collisionPaths;
	const collision = content.collision;
	const preparedRevision = content.rangeRevision;
	assert.deepEqual(bitmap.image.pixels, new Uint8Array(pixels));
	assert.deepEqual(collision, shape);
	assert.deepEqual(paths, [[0, 0, 1, 0, 1, 1, 0, 0]]);
	assert.equal(content.hasCollision, true);
	model.sort = 'size'; model.descending = true; model.project();
	content.preparePreview();
	content.selectRange(1); content.preparePreview();
	assert.equal(content.selectedRange.kind, 'collision');
	assert.equal(content.rangeRevision, preparedRevision + 1);
	assert.equal(content.view, 'bytes');
	content.setView('preview'); content.preparePreview();
	content.imageView.layout(0, 0, 80, 64);
	content.imageView.setScale(16);
	content.imageView.pan(8, 8);
	content.showCollision = true;
	content.preparePreview();
	assert.equal(content.view, 'preview');
	assert.equal(content.rangeRevision, preparedRevision + 1, 'preview readiness, zoom and view changes must not reset byte reading position');
	assert.strictEqual(content.preview, bitmap);
	assert.strictEqual(content.collisionPaths, paths);
	assert.strictEqual(content.collision, collision);
	assert.equal(release.mock.callCount(), 0);
	model.select(model.rows.findIndex(row => row.asset === second)); content.setSubject(model.selection);
	assert.equal(content.preview, undefined, 'a changed subject is prepared only when the visible preview asks');
	content.preparePreview();
	assert.equal(release.mock.callCount(), 1);
	assert.notStrictEqual(content.preview, bitmap);
	assert.deepEqual(content.collisionPaths, []);
	assert.equal(content.collision, undefined);
	assert.equal(content.showCollision, true, 'Shape is a reader preference, not stale collision data from the previous asset');
	const releaseSecond = t.mock.method(content.preview!, 'dispose');
	model.select(model.rows.findIndex(row => row.asset === removed)); content.setSubject(model.selection);
	assert.equal(content.preview, undefined);
	assert.equal(content.view, 'info');
	assert.equal(content.showCollision, true); assert.equal(content.collision, undefined); assert.deepEqual(content.collisionPaths, []);
	assert.equal(releaseSecond.mock.callCount(), 1);
	content.setSubject(model.selection);
	assert.equal(release.mock.callCount(), 1);
	assert.equal(releaseSecond.mock.callCount(), 1);
	model.setMode('structure'); model.select(model.rows.findIndex(row => row.asset === sprite)); content.setSubject(model.selection);
	assert.equal(content.subject.kind, 'section'); assert.equal(content.subject.asset, sprite);
	assert.equal(content.canPreviewImage, false, 'a physical image collision section is not a logical image preview');
	assert.equal(content.view, 'info'); assert.equal(content.preview, undefined);
	assert.deepEqual(content.ranges, [{ kind: 'collision', start: collisionStart, end: collisionEnd }]);
	assert.equal(content.subject.sourcePath, 'res/sprite.png');
	assert.equal(content.properties.filter(property => property.label === 'collision').length, 0,
		'physical Info must not list unrelated logical asset ranges');
	assert.deepEqual(rom, originalBytes); assert.deepEqual(model.inspection.sections, physical);
});

test('content revisions separate actual subject/range changes from view and idempotent binding', () => {
	const model = inspector([modelAsset]), content = new RomInspectorContentModel(model.snapshot);
	const row = model.selection!;
	content.setSubject(row); assert.equal(content.view, 'info');
	const subjectRevision = content.revision, rangeRevision = content.rangeRevision;
	const properties = content.properties, propertyRows = [...properties];
	for (let frame = 0; frame < 1000; frame++) {
		content.setSubject(row); assert.equal(content.properties, properties);
		for (let index = 0; index < propertyRows.length; index++) assert.equal(content.properties[index], propertyRows[index]);
	}
	assert.equal(content.revision, subjectRevision); assert.equal(content.rangeRevision, rangeRevision);
	content.setView('bytes'); assert.equal(content.revision, subjectRevision + 1); assert.equal(content.rangeRevision, rangeRevision);
	content.setView('info'); content.selectRange(0);
	assert.equal(content.view, 'bytes'); assert.equal(content.rangeRevision, rangeRevision);
	content.selectRange(3); assert.equal(content.rangeRevision, rangeRevision + 1);
	assert.equal(content.properties[2].label, 'Selected collision range');
	assert.equal(content.properties[2].value, '00000068h .. 00000080h');
	const selectedRevision = content.revision; content.selectRange(3);
	assert.equal(content.revision, selectedRevision); assert.equal(content.rangeRevision, rangeRevision + 1);
});

test('subject binding leaves metadata projection cold until Info actually reads it', () => {
	const model = inspector([modelAsset]), content = new RomInspectorContentModel(model.snapshot), row = model.selection!;
	let sourceReads = 0;
	Object.defineProperty(row, 'sourcePath', { configurable: true, get: () => { sourceReads++; return 'res/model.glb'; } });
	content.setSubject(row); content.selectRange(2); content.setView('bytes');
	assert.equal(sourceReads, 0, 'hidden Info must not format the selected subject');
	const properties = content.properties, authored = properties.find(property => property.label === 'Authored source')!;
	assert.equal(authored.value, 'res/model.glb'); assert.ok(sourceReads > 0);
	const preparedReads = sourceReads;
	for (let frame = 0; frame < 1000; frame++) {
		content.setView('info'); assert.equal(content.properties, properties); content.setView('bytes');
	}
	assert.equal(sourceReads, preparedReads);
});

test('changing logical image subjects releases one bitmap but reuses the captured atlas decode', t => {
	const texture = encodeDirect16GxTexture(2, 1, Uint8ClampedArray.of(255, 0, 0, 255, 0, 255, 0, 255));
	const stream = encodeImgDecStream(texture.words, texture.textureWordCount, texture.clutWordCount), end = 72 + stream.length;
	const rom = new Uint8Array(end + 48); rom.set(stream, 72);
	const atlas: RomAsset = { resid: 'atlas', type: 'texture', start: 72, end, texturemeta: {
		mode: texture.mode, word_width: texture.wordWidth, height: texture.height,
		texture_word_count: texture.textureWordCount, clut_word_count: texture.clutWordCount,
	} };
	const images: RomAsset[] = [0, 1].map(index => ({ resid: `image-${index}`, type: 'image',
		metabuffer_start: end + index * 16, metabuffer_end: end + (index + 1) * 16,
		imgmeta: { width: 1, height: 1, texture_u: index, texture_v: 0, gx_atlas_id: 'atlas' } }));
	const assets = [atlas, ...images]; finalizePackedRomAssets(assets);
	const model = new RomInspectorModel({ domain: 0, label: 'Cart 0', rom, assets,
		header: { ...header, dataLength: stream.length, metadataOffset: end, tocOffset: end + 32 } });
	const content = new RomInspectorContentModel(model.snapshot); t.after(() => content.dispose());
	let atlasReads = 0;
	Object.defineProperty(atlas, 'start', { configurable: true, get: () => { atlasReads++; return 72; } });
	content.setSubject(model.assets.find(row => row.asset === images[0]));
	assert.equal(content.preview, undefined); assert.equal(atlasReads, 0);
	content.preparePreview();
	const first = content.preview!, released = t.mock.method(first, 'dispose'), initialReads = atlasReads;
	assert.ok(initialReads > 0); assert.deepEqual(first.image.pixels, Uint8Array.of(255, 0, 0, 255));
	content.setSubject(model.assets.find(row => row.asset === images[1]));
	assert.equal(released.mock.callCount(), 1); assert.equal(content.preview, undefined); assert.equal(atlasReads, initialReads);
	content.preparePreview();
	assert.notEqual(content.preview, first); assert.deepEqual(content.preview!.image.pixels, Uint8Array.of(0, 255, 0, 255));
	assert.equal(atlasReads, initialReads, 'another image from the same captured atlas must not decompress the payload again');
});


test('a generated function with an instruction source does not acquire an invented authored declaration', async () => {
	const text = new Uint8Array(INSTRUCTION_BYTES);
	writeInstruction(text, 0, OpCode.RET, 0, 0, 0, 0);
	const instructionSource = { path: 'inlined/callee', start: { line: 3, column: 1 }, end: { line: 3, column: 8 } };
	const linked = linkRawTestSystemBlua32({ text, functions: [{ firstWord: 0, wordCount: 1 }],
		functionIds: ['generated'], debugRanges: [instructionSource] });
	const rom = linked.romBytes, loaded = await loadRomAssetList(rom, 'system');
	const model = new RomInspectorModel({ domain: -1, label: 'System', rom, header: parseCartHeader(rom), assets: loaded.entries });
	model.setMode('code');
	const row = model.functions[0];
	assert.equal(row.kind, 'function');
	assert.equal(row.image!.symbols!.metadata.functionDefinitions[0], null);
	assert.deepEqual(blua32SourceRangeAtPc(row.image!.symbols!, row.image!.layout.header.textAddress,
		row.image!.layout.functions[0].codeAddress), instructionSource, 'the fixture must retain a real, different instruction-source relation');
	assert.equal(row.sourcePath, undefined, 'Source is the function declaration, never its inlined instruction mapping');
});

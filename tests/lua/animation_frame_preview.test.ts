import assert from 'node:assert/strict';
import { test } from 'node:test';
import { encodeDirect16GxTexture } from '../../toolchain/ts/rompack/gx_texture_codec';
import { encodeImgDecStream } from '../../toolchain/ts/rompack/imgdec_codec';
import { buildLuaSemanticWorkspaceSnapshot } from '../../toolchain/ts/lua/semantic/model';
import { buildResourceLuaSemanticFixtureFile, createResourceModuleProjectFixture } from '../helpers/lua_semantic_project';
import { createScenarioTestSourceState } from '../helpers/scenario_sources';
import { buildAnimationSourceDocument } from '../../ide/workbench/contrib/animation/source';
import { AnimationFramePreview } from '../../ide/workbench/contrib/animation/frame_preview';
import { finalizePackedRomAssets, type RomAsset } from '../../toolchain/ts/rompack/assets';

test('only a proven sprite factory treats a native frame value as a packed image reference', t => {
	const sources = createScenarioTestSourceState([]), rom = sources.cartridgeSlots[0]!.rom;
	const texture = encodeDirect16GxTexture(1, 1, new Uint8ClampedArray([255, 0, 0, 255]));
	rom.bytes = new Uint8Array(encodeImgDecStream(texture.words, texture.textureWordCount, texture.clutWordCount));
	const assets: RomAsset[] = [{ resid: 'sprite', type: 'image', imgmeta: { width: 1, height: 1, texture_u: 0, texture_v: 0, gx_atlas_id: 'atlas' } },
		{ resid: 'atlas', type: 'texture', start: 0, end: rom.bytes.length, texturemeta: {
			mode: texture.mode, word_width: texture.wordWidth, height: texture.height,
			texture_word_count: texture.textureWordCount, clut_word_count: texture.clutWordCount,
		} }];
	finalizePackedRomAssets(assets);
	rom.index.entries.push(...assets);
	const document = buildAnimationSourceDocument({ domain: 0, path: 'animation.lua' },
		buildLuaSemanticWorkspaceSnapshot(...createResourceModuleProjectFixture([buildResourceLuaSemanticFixtureFile("return {frames={'sprite'}}", { domain: 0, path: 'animation.lua' })], [])))!;
	const preview = new AnimationFramePreview(); t.after(() => preview.dispose());
	preview.update(document, 0, 0, sources);
	assert.equal(preview.bitmap, undefined, 'a timeline value is not an image even if its string matches a packed asset');
	preview.update({ ...document, family: 'sprite' }, 0, 0, sources);
	assert.deepEqual(preview.bitmap!.image.pixels, new Uint8Array([255, 0, 0, 255]));
	let released = false; preview.bitmap!.onDispose(() => { released = true; });
	preview.update(document, 0, 0, sources);
	assert.equal(released, true); assert.equal(preview.bitmap, undefined);
});

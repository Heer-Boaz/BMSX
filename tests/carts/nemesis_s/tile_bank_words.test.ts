import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { createCanvas, loadImage } from 'canvas';
import { parse } from 'yaml';
import { encodeDirect16GxTexture, encodePalette4GxTexture, gxTextureFitsPalette4 } from '../../../toolchain/ts/rompack/gx_texture_codec';

test('stage bank cells preserve native RGB555 words, zero transparency and STP across texture formats', async () => {
    const stage = parse(readFileSync('carts/nemesis_s/res/data/nemesis_s_stage_runtime.yaml', 'utf8'));
    let tested = 0, transparent = 0, opaqueBlack = 0;
    for (const name of stage.tile_banks.assets) {
        const image = await loadImage(`carts/nemesis_s/res/img/${name}@atlas=gameplay.png`);
        const canvas = createCanvas(256, 256), context = canvas.getContext('2d');
        context.drawImage(image, 0, 0);
        const bank = encodeDirect16GxTexture(256, 256, context.getImageData(0, 0, 256, 256).data);
        for (let cell = 0; cell < 1024 && tested < stage.tile_banks.tile_count; cell++, tested++) {
            const x = (cell & 31) * 8, y = (cell >> 5) * 8;
            const rgba = context.getImageData(x, y, 8, 8).data;
            const direct = encodeDirect16GxTexture(8, 8, rgba);
            const palette = gxTextureFitsPalette4(rgba) ? encodePalette4GxTexture(8, 8, rgba) : null;
            for (let pixel = 0; pixel < 64; pixel++) {
                const word = bank.words.readUInt16LE(((y + (pixel >> 3)) * 256 + x + (pixel & 7)) * 2);
                assert.equal(word, direct.words.readUInt16LE(pixel * 2));
                if (palette) {
                    const packed = palette.words.readUInt16LE((pixel >> 2) * 2);
                    const index = (packed >> ((pixel & 3) * 4)) & 15;
                    assert.equal(word, palette.words.readUInt16LE(palette.textureWordCount * 4 + index * 2));
                }
                if (word === 0) transparent++;
                if (word === 0x8000) opaqueBlack++;
            }
        }
    }
    assert.equal(tested, stage.tile_banks.tile_count);
    assert.ok(transparent > 0, 'transparent harbor poses must remain zero words');
    assert.ok(opaqueBlack > 0, 'opaque black is distinct from transparent zero');
});

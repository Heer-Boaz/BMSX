import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { PNG } from 'pngjs';
import { buildBiosMonitorTimeline } from './bios_monitor_timeline.mjs';

const screenshotDir = process.argv[2];
const { captures } = buildBiosMonitorTimeline();
const glyphRoot = path.join('machine', 'firmware', 'res', 'img', 'tinyfont');
const glyphs = new Array(256);
const black = 0x000000;
const text = 0xffffff;
const accent = 0xffff39;

function frame(name) {
	const number = captures[name];
	const file = path.join(screenshotDir, `frame_${String(number).padStart(5, '0')}.png`);
	return PNG.sync.read(fs.readFileSync(file));
}

function rgbAt(png, x, y) {
	const offset = (y * png.width + x) * 4;
	return (png.data[offset] << 16) | (png.data[offset + 1] << 8) | png.data[offset + 2];
}

function glyph(character) {
	const codepoint = character.charCodeAt(0);
	let mask = glyphs[codepoint];
	if (!mask) {
		const code = codepoint.toString(16).padStart(2, '0');
		mask = PNG.sync.read(fs.readFileSync(path.join(glyphRoot, `tiny_3b_font_code_0x${code}.png`)));
		glyphs[codepoint] = mask;
	}
	return mask;
}

function assertGlyph(png, row, column, character, foreground) {
	const mask = glyph(character);
	for (let y = 0; y < mask.height; y += 1) {
		for (let x = 0; x < mask.width; x += 1) {
			const maskOffset = (y * mask.width + x) * 4 + 3;
			const expected = mask.data[maskOffset] === 0 ? black : foreground;
			if (rgbAt(png, column * 4 + x, row * 6 + y) !== expected) {
				throw new Error(`glyph ${character} differs at cell ${column},${row} pixel ${x},${y}`);
			}
		}
	}
}

function assertText(png, row, column, value, foreground) {
	for (let index = 0; index < value.length; index += 1) {
		assertGlyph(png, row, column + index, value[index], foreground);
	}
}

function assertTerminalPalette(png) {
	for (let y = 0; y < png.height; y += 1) {
		for (let x = 0; x < png.width; x += 1) {
			const color = rgbAt(png, x, y);
			if (color !== black && color !== text && color !== accent) {
				throw new Error(`non-terminal pixel 0x${color.toString(16)} at ${x},${y}`);
			}
		}
	}
}

const game = frame('game');
assert.equal(game.width, 320);
assert.equal(game.height, 240);

for (const name of Object.keys(captures)) {
	if (name === 'game') continue;
	const output = frame(name);
	assert.equal(output.width, 256, `${name} width`);
	assert.equal(output.height, 192, `${name} height`);
}

assertGlyph(frame('uppercaseInput'), 4, 2, 'H', text);
assertText(frame('firstCandidate'), 31, 0, 'REBOOT', accent);
assertText(frame('firstCandidate'), 31, 8, 'REGS', text);
assertText(frame('secondCandidate'), 31, 0, 'REBOOT', text);
assertText(frame('secondCandidate'), 31, 8, 'REGS', accent);
assertText(frame('acceptedCandidate'), 4, 2, 'REGS', text);
assertText(frame('wordBackspace'), 4, 2, 'REGS TWO', text);
assertText(frame('wordDelete'), 4, 2, 'REGS ', text);
assertText(frame('scrolled'), 0, 0, 'COMMAND  DESCRIPTION', accent);

const pagerText = '-- MORE --  ENTER LINE  SPACE PAGE  UP/DOWN SCROLL  Q QUIT';
assertText(frame('firstPage'), 31, 0, pagerText, accent);
assertText(frame('secondPage'), 31, 0, pagerText, accent);
assertTerminalPalette(frame('scrolled'));
assertTerminalPalette(frame('firstPage'));
assertTerminalPalette(frame('secondPage'));

console.log(JSON.stringify(captures, null, 2));

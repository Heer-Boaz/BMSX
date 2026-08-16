import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { PNG } from 'pngjs';
import { load as loadYaml } from 'js-yaml';

const screenWidth = 256;
const screenHeight = 192;
const glyphWidth = 8;
const glyphHeight = 8;
const textTop = 16;
const maximumCharactersPerLine = 28;
const root = process.cwd();
const screenshotDirectory = process.argv[2] || path.join(root, 'tests', 'carts', '2024', 'screenshots');
const imageDirectory = path.join(root, 'carts', '2024', 'res', 'img');
const fontDirectory = path.join(imageDirectory, 'font');
const quizData = loadYaml(fs.readFileSync(path.join(root, 'carts', '2024', 'res', 'data', 'quiz.yaml'), 'utf8'));

const glyphNames = {
	' ': 'Letter_Space',
	',': 'Letter_Comma',
	'.': 'Letter_Dot',
	'!': 'Letter_Exclamation',
	'?': 'Letter_Question',
	"'": 'Letter_Apostroph',
	':': 'Letter_Colon',
	'-': 'Letter_Streep',
	'/': 'Letter_Slash',
	'%': 'Letter_Percent',
	'[': 'Letter_SpeakStart',
	']': 'Letter_SpeakEnd',
	'(': 'Letter_HaakjeOpen',
	')': 'Letter_HaakjeSluit',
	'+': 'Letter_Question',
	'ĳ': 'Letter_IJ',
	'Ĳ': 'Letter_IJ',
};

for (let digit = 0; digit <= 9; digit += 1) {
	glyphNames[String(digit)] = `Letter_${digit}`;
}
for (let codepoint = 65; codepoint <= 90; codepoint += 1) {
	const upper = String.fromCharCode(codepoint);
	glyphNames[upper] = `Letter_${upper}`;
	glyphNames[upper.toLowerCase()] = `Letter_${upper}`;
}

function readPng(filePath) {
	return PNG.sync.read(fs.readFileSync(filePath));
}

const glyphs = {};
for (const [character, imageName] of Object.entries(glyphNames)) {
	glyphs[character] = readPng(path.join(fontDirectory, `${imageName}.png`));
}

// This is the historical TypeScript engine's wrapGlyphs algorithm. Explicit
// line breaks intentionally produce an additional empty rendered line.
function wrapHistoricalText(text) {
	const words = text.match(/(\S+|\n)/g) || [];
	const lines = [];
	let currentLine = '';
	for (const word of words) {
		if (word === '\n') {
			lines.push(currentLine.trim());
			currentLine = '';
			lines.push('');
			continue;
		}
		const candidate = currentLine ? `${currentLine} ${word}` : word;
		if (candidate.length <= maximumCharactersPerLine) {
			currentLine = candidate;
		} else if (currentLine) {
			lines.push(currentLine.trim());
			currentLine = word;
		} else {
			lines.push(word);
			currentLine = '';
		}
	}
	if (currentLine.trim()) {
		lines.push(currentLine.trim());
	}
	return lines;
}

function quantizeDirect16Channel(value) {
	const fiveBit = value >> 3;
	return (fiveBit << 3) | (fiveBit >> 2);
}

function blitDirect16(target, source, destinationX, destinationY) {
	for (let sourceY = 0; sourceY < source.height; sourceY += 1) {
		for (let sourceX = 0; sourceX < source.width; sourceX += 1) {
			const sourceOffset = (sourceY * source.width + sourceX) * 4;
			if (source.data[sourceOffset + 3] === 0) {
				continue;
			}
			const targetX = destinationX + sourceX;
			const targetY = destinationY + sourceY;
			if (targetX < 0 || targetY < 0 || targetX >= target.width || targetY >= target.height) {
				continue;
			}
			const targetOffset = (targetY * target.width + targetX) * 4;
			target.data[targetOffset] = quantizeDirect16Channel(source.data[sourceOffset]);
			target.data[targetOffset + 1] = quantizeDirect16Channel(source.data[sourceOffset + 1]);
			target.data[targetOffset + 2] = quantizeDirect16Channel(source.data[sourceOffset + 2]);
			target.data[targetOffset + 3] = 255;
		}
	}
}

function renderExpectedFrame(imageId, text) {
	const frame = new PNG({ width: screenWidth, height: screenHeight });
	frame.data.fill(0);
	for (let offset = 3; offset < frame.data.length; offset += 4) {
		frame.data[offset] = 255;
	}

	const portrait = readPng(path.join(imageDirectory, `${imageId}.png`));
	blitDirect16(frame, portrait, screenWidth - portrait.width, screenHeight - portrait.height);

	const lines = wrapHistoricalText(text);
	let longestLineLength = 0;
	for (const line of lines) {
		if (line.length > longestLineLength) {
			longestLineLength = line.length;
		}
	}
	const textLeft = (screenWidth - longestLineLength * glyphWidth) / 2;
	for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
		const line = lines[lineIndex];
		const lineTop = textTop + lineIndex * glyphHeight;
		for (let characterIndex = 0; characterIndex < line.length; characterIndex += 1) {
			const characterLeft = textLeft + characterIndex * glyphWidth;
			for (let y = lineTop; y < lineTop + glyphHeight; y += 1) {
				for (let x = characterLeft; x < characterLeft + glyphWidth; x += 1) {
					const offset = (y * screenWidth + x) * 4;
					frame.data[offset] = 0;
					frame.data[offset + 1] = 0;
					frame.data[offset + 2] = 0;
					frame.data[offset + 3] = 255;
				}
			}
			blitDirect16(frame, glyphs[line[characterIndex]], characterLeft, lineTop);
		}
	}
	return frame;
}

function questionText(questionIndex) {
	const question = quizData.questions[questionIndex];
	const heading = quizData.question_heading
		.replace('%d', String(questionIndex + 1))
		.replace('%d', String(quizData.questions.length));
	return `${heading}${question.question}\n${question.options[0]}\n${question.options[1]}`;
}

const expectedFrames = [
	['frame_00240.png', 'quiz', quizData.intro.join('\n')],
	['frame_00480.png', 'film', questionText(0)],
	['frame_00730.png', 'film', questionText(1)],
	['frame_01000.png', 'goed', quizData.questions[1].reaction_a],
	['frame_01250.png', 'hmm', questionText(2)],
	['frame_01600.png', 'sport', questionText(11)],
	['frame_01900.png', 'goed', quizData.questions[11].reaction_b],
	['frame_02300.png', 'hmm', questionText(26)],
	['frame_02900.png', 'klaar', quizData.complete.join('\n')],
];

for (const [fileName, imageId, text] of expectedFrames) {
	const actual = readPng(path.join(screenshotDirectory, fileName));
	const expected = renderExpectedFrame(imageId, text);
	assert.equal(actual.width, expected.width, `${fileName} width`);
	assert.equal(actual.height, expected.height, `${fileName} height`);
	let differentChannels = 0;
	let maximumDelta = 0;
	for (let offset = 0; offset < actual.data.length; offset += 1) {
		const delta = Math.abs(actual.data[offset] - expected.data[offset]);
		if (delta !== 0) {
			differentChannels += 1;
			if (delta > maximumDelta) {
				maximumDelta = delta;
			}
		}
	}
	assert.equal(
		differentChannels,
		0,
		`${fileName} differs from the historical composition in ${differentChannels} channels (maximum delta ${maximumDelta}).`,
	);
	console.log(`${fileName}: exact`);
}

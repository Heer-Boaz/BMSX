import {
	IMGDEC_HISTORY_WORD_CAPACITY,
	IMGDEC_STREAM_HEADER_WORDS,
	IMGDEC_STREAM_MAGIC,
	IMGDEC_TOKEN_BACK_REFERENCE_DISTANCE_MASK,
	IMGDEC_TOKEN_BACK_REFERENCE_LENGTH_MASK,
	IMGDEC_TOKEN_BACK_REFERENCE_LENGTH_SHIFT,
	IMGDEC_TOKEN_BACK_REFERENCE_MIN_LENGTH,
	IMGDEC_TOKEN_KIND_BACK_REFERENCE,
	IMGDEC_TOKEN_KIND_LITERAL,
	IMGDEC_TOKEN_KIND_REPEAT,
	IMGDEC_TOKEN_KIND_SHIFT,
	IMGDEC_TOKEN_KIND_ZERO,
	IMGDEC_TOKEN_RUN_LENGTH_MASK,
} from '../../../machine/ts/spec/imgdec/stream';

export type DecodedImgDecStream = {
	payload: Buffer;
	textureWordCount: number;
	clutWordCount: number;
};

const MATCH_HASH_BITS = 16;
const MATCH_HASH_SIZE = 1 << MATCH_HASH_BITS;
const MATCH_CHAIN_LIMIT = 64;

function payloadWord(payload: Buffer, index: number): number {
	return payload.readUInt32LE(index << 2);
}

function matchHash(payload: Buffer, index: number): number {
	const first = payloadWord(payload, index);
	const second = payloadWord(payload, index + 1);
	const third = payloadWord(payload, index + 2);
	const mixed = Math.imul(first ^ ((second << 11) | (second >>> 21)) ^ ((third << 22) | (third >>> 10)), 0x9e3779b1);
	return mixed >>> (32 - MATCH_HASH_BITS);
}

function appendLiteralTokens(tokens: Uint32Array, tokenCount: number, start: number, end: number): number {
	let literalStart = start;
	while (literalStart < end) {
		const runLength = end - literalStart > IMGDEC_TOKEN_RUN_LENGTH_MASK + 1
			? IMGDEC_TOKEN_RUN_LENGTH_MASK + 1
			: end - literalStart;
		tokens[tokenCount] = (IMGDEC_TOKEN_KIND_LITERAL << IMGDEC_TOKEN_KIND_SHIFT) | (runLength - 1);
		tokenCount += 1;
		literalStart += runLength;
	}
	return tokenCount;
}

function appendMatchPositions(
	payload: Buffer,
	previous: Int32Array,
	head: Int32Array,
	start: number,
	end: number,
	wordCount: number,
): void {
	for (let index = start; index < end && index + 2 < wordCount; index += 1) {
		const hash = matchHash(payload, index);
		previous[index] = head[hash]!;
		head[hash] = index;
	}
}

export function encodeImgDecStream(payload: Buffer, textureWordCount: number, clutWordCount: number): Buffer {
	const wordCount = textureWordCount + clutWordCount;
	const tokens = new Uint32Array(wordCount);
	const head = new Int32Array(MATCH_HASH_SIZE);
	const previous = new Int32Array(wordCount);
	head.fill(-1);
	previous.fill(-1);
	let tokenCount = 0;
	let literalStart = 0;
	let cursor = 0;

	while (cursor < wordCount) {
		const word = payloadWord(payload, cursor);
		if (word === 0) {
			let runEnd = cursor + 1;
			while (runEnd < wordCount && payloadWord(payload, runEnd) === 0) {
				runEnd += 1;
			}
			tokenCount = appendLiteralTokens(tokens, tokenCount, literalStart, cursor);
			tokens[tokenCount] = (IMGDEC_TOKEN_KIND_ZERO << IMGDEC_TOKEN_KIND_SHIFT) | (runEnd - cursor - 1);
			tokenCount += 1;
			appendMatchPositions(payload, previous, head, cursor, runEnd, wordCount);
			cursor = runEnd;
			literalStart = cursor;
			continue;
		}

		let bestLength = 0;
		let bestDistance = 0;
		if (cursor + 2 < wordCount) {
			let candidate = head[matchHash(payload, cursor)]!;
			let chain = 0;
			const maxLength = wordCount - cursor > IMGDEC_TOKEN_BACK_REFERENCE_LENGTH_MASK + IMGDEC_TOKEN_BACK_REFERENCE_MIN_LENGTH
				? IMGDEC_TOKEN_BACK_REFERENCE_LENGTH_MASK + IMGDEC_TOKEN_BACK_REFERENCE_MIN_LENGTH
				: wordCount - cursor;
			while (candidate >= 0 && cursor - candidate <= IMGDEC_HISTORY_WORD_CAPACITY && chain < MATCH_CHAIN_LIMIT) {
				let length = 0;
				while (length < maxLength && payloadWord(payload, candidate + length) === payloadWord(payload, cursor + length)) {
					length += 1;
				}
				if (length > bestLength) {
					bestLength = length;
					bestDistance = cursor - candidate;
					if (length === maxLength) break;
				}
				candidate = previous[candidate]!;
				chain += 1;
			}
		}

		if (bestLength >= IMGDEC_TOKEN_BACK_REFERENCE_MIN_LENGTH) {
			tokenCount = appendLiteralTokens(tokens, tokenCount, literalStart, cursor);
			tokens[tokenCount] = (IMGDEC_TOKEN_KIND_BACK_REFERENCE << IMGDEC_TOKEN_KIND_SHIFT)
				| ((bestLength - IMGDEC_TOKEN_BACK_REFERENCE_MIN_LENGTH) << IMGDEC_TOKEN_BACK_REFERENCE_LENGTH_SHIFT)
				| (bestDistance - 1);
			tokenCount += 1;
			appendMatchPositions(payload, previous, head, cursor, cursor + bestLength, wordCount);
			cursor += bestLength;
			literalStart = cursor;
			continue;
		}

		let repeatEnd = cursor + 1;
		while (repeatEnd < wordCount && payloadWord(payload, repeatEnd) === word) {
			repeatEnd += 1;
		}
		if (repeatEnd - cursor >= 2) {
			tokenCount = appendLiteralTokens(tokens, tokenCount, literalStart, cursor);
			tokens[tokenCount] = (IMGDEC_TOKEN_KIND_REPEAT << IMGDEC_TOKEN_KIND_SHIFT) | (repeatEnd - cursor - 1);
			tokenCount += 1;
			appendMatchPositions(payload, previous, head, cursor, repeatEnd, wordCount);
			cursor = repeatEnd;
			literalStart = cursor;
			continue;
		}

		appendMatchPositions(payload, previous, head, cursor, cursor + 1, wordCount);
		cursor += 1;
	}

	tokenCount = appendLiteralTokens(tokens, tokenCount, literalStart, wordCount);
	let encodedWordCount = IMGDEC_STREAM_HEADER_WORDS;
	for (let index = 0; index < tokenCount; index += 1) {
		const token = tokens[index]!;
		const tokenKind = token >>> IMGDEC_TOKEN_KIND_SHIFT;
		encodedWordCount += 1;
		if (tokenKind === IMGDEC_TOKEN_KIND_LITERAL) {
			encodedWordCount += (token & IMGDEC_TOKEN_RUN_LENGTH_MASK) + 1;
		} else if (tokenKind === IMGDEC_TOKEN_KIND_REPEAT) {
			encodedWordCount += 1;
		}
	}
	const output = Buffer.allocUnsafe(encodedWordCount << 2);
	output.writeUInt32LE(IMGDEC_STREAM_MAGIC, 0);
	output.writeUInt32LE(textureWordCount, 4);
	output.writeUInt32LE(clutWordCount, 8);
	let outputWord = IMGDEC_STREAM_HEADER_WORDS;
	let payloadCursor = 0;
	for (let index = 0; index < tokenCount; index += 1) {
		const token = tokens[index]!;
		const tokenKind = token >>> IMGDEC_TOKEN_KIND_SHIFT;
		const runLength = tokenKind === IMGDEC_TOKEN_KIND_BACK_REFERENCE
			? ((token >>> IMGDEC_TOKEN_BACK_REFERENCE_LENGTH_SHIFT) & IMGDEC_TOKEN_BACK_REFERENCE_LENGTH_MASK)
				+ IMGDEC_TOKEN_BACK_REFERENCE_MIN_LENGTH
			: (token & IMGDEC_TOKEN_RUN_LENGTH_MASK) + 1;
		output.writeUInt32LE(token, outputWord << 2);
		outputWord += 1;
		if (tokenKind === IMGDEC_TOKEN_KIND_LITERAL) {
			payload.copy(output, outputWord << 2, payloadCursor << 2, (payloadCursor + runLength) << 2);
			outputWord += runLength;
		} else if (tokenKind === IMGDEC_TOKEN_KIND_REPEAT) {
			output.writeUInt32LE(payloadWord(payload, payloadCursor), outputWord << 2);
			outputWord += 1;
		}
		payloadCursor += runLength;
	}
	return output;
}

export function decodeImgDecStream(
	source: Uint8Array,
	byteOffset = 0,
	byteLength = source.byteLength - byteOffset,
): DecodedImgDecStream {
	if ((byteLength & 3) !== 0) {
		throw new Error('Compressed image stream must contain whole words.');
	}
	const view = new DataView(source.buffer, source.byteOffset + byteOffset, byteLength);
	let inputWord = 0;
	if (view.getUint32(inputWord << 2, true) !== IMGDEC_STREAM_MAGIC) {
		throw new Error('Compressed image stream has an unsupported format.');
	}
	const textureWordCount = view.getUint32((inputWord + 1) << 2, true);
	const clutWordCount = view.getUint32((inputWord + 2) << 2, true);
	inputWord += IMGDEC_STREAM_HEADER_WORDS;
	const outputWordCount = textureWordCount + clutWordCount;
	const payload = Buffer.alloc(outputWordCount << 2);
	let outputWord = 0;

	while (outputWord < outputWordCount) {
		const token = view.getUint32(inputWord << 2, true);
		const tokenKind = token >>> IMGDEC_TOKEN_KIND_SHIFT;
		const runLength = tokenKind === IMGDEC_TOKEN_KIND_BACK_REFERENCE
			? ((token >>> IMGDEC_TOKEN_BACK_REFERENCE_LENGTH_SHIFT) & IMGDEC_TOKEN_BACK_REFERENCE_LENGTH_MASK)
				+ IMGDEC_TOKEN_BACK_REFERENCE_MIN_LENGTH
			: (token & IMGDEC_TOKEN_RUN_LENGTH_MASK) + 1;
		inputWord += 1;
		if (runLength > outputWordCount - outputWord) {
			throw new Error('Compressed image stream run exceeds its declared payload.');
		}
		switch (tokenKind) {
			case IMGDEC_TOKEN_KIND_LITERAL: {
				for (let index = 0; index < runLength; index += 1) {
					payload.writeUInt32LE(view.getUint32(inputWord << 2, true), outputWord << 2);
					inputWord += 1;
					outputWord += 1;
				}
				break;
			}
			case IMGDEC_TOKEN_KIND_REPEAT: {
				const word = view.getUint32(inputWord << 2, true);
				inputWord += 1;
				for (let index = 0; index < runLength; index += 1) {
					payload.writeUInt32LE(word, outputWord << 2);
					outputWord += 1;
				}
				break;
			}
			case IMGDEC_TOKEN_KIND_BACK_REFERENCE: {
				const distance = (token & IMGDEC_TOKEN_BACK_REFERENCE_DISTANCE_MASK) + 1;
				if (distance > outputWord) {
					throw new Error('Compressed image stream references unavailable history.');
				}
				for (let index = 0; index < runLength; index += 1) {
					const word = payload.readUInt32LE((outputWord - distance) << 2);
					payload.writeUInt32LE(word, outputWord << 2);
					outputWord += 1;
				}
				break;
			}
			case IMGDEC_TOKEN_KIND_ZERO: {
				outputWord += runLength;
				break;
			}
		}
	}
	if (inputWord !== (byteLength >> 2)) {
		throw new Error('Compressed image stream has trailing words.');
	}

	return {
		payload,
		textureWordCount,
		clutWordCount,
	};
}

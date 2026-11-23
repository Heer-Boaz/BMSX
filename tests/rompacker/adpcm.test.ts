import assert from 'node:assert/strict';
import { test } from 'node:test';
import { encodeAudioAssetToAdpcm, parseBadpHeader } from '../../scripts/rompacker/adpcm';

test('BADP asset seeks start at independently decodable blocks', async () => {
	const frames = 4097;
	const sampleRate = 44100;
	const wav = Buffer.alloc(44 + frames * 2);
	wav.write('RIFF', 0);
	wav.writeUInt32LE(wav.length - 8, 4);
	wav.write('WAVEfmt ', 8);
	wav.writeUInt32LE(16, 16);
	wav.writeUInt16LE(1, 20);
	wav.writeUInt16LE(1, 22);
	wav.writeUInt32LE(sampleRate, 24);
	wav.writeUInt32LE(sampleRate * 2, 28);
	wav.writeUInt16LE(2, 32);
	wav.writeUInt16LE(16, 34);
	wav.write('data', 36);
	wav.writeUInt32LE(frames * 2, 40);
	for (let frame = 0; frame < frames; ++frame) {
		wav.writeInt16LE(frame < 2048 ? 1024 : ((frame & 1) === 0 ? 16384 : -16384), 44 + frame * 2);
	}
	const { buffer } = await encodeAudioAssetToAdpcm(wav, { audiotype: 'sfx', priority: 0 });
	const header = parseBadpHeader(buffer);
	let frame = 0;
	let offset = header.dataOffset;
	const blockLengths = new Set<number>();
	for (let entry = 0; entry < header.seekEntryCount; ++entry) {
		const seek = header.seekTableOffset + entry * 8;
		assert.equal(buffer.readUInt32LE(seek), frame);
		assert.equal(buffer.readUInt32LE(seek + 4), offset - header.dataOffset);
		const blockFrames = buffer.readUInt16LE(offset);
		assert.ok(blockFrames > 0 && blockFrames <= header.seekStrideFrames);
		blockLengths.add(blockFrames);
		frame += blockFrames;
		offset += buffer.readUInt16LE(offset + 2);
	}
	assert.ok(blockLengths.size > 1);
	assert.equal(frame, frames);
	assert.equal(offset, buffer.length);
});

import { clamp } from '../../src/bmsx/utils/clamp';
import { decodeWavToPcm } from '../../src/bmsx/utils/wav';
import { parseAudioInfo } from '../../src/bmsx/emulator/runtime_assets';

export type AudioPreviewPcm = {
	samples: Int16Array;
	sampleRate: number;
	channels: number;
	frames: number;
	format: 'wav' | 'badp';
};

const BADP_STEP_TABLE = [
	7, 8, 9, 10, 11, 12, 13, 14, 16, 17,
	19, 21, 23, 25, 28, 31, 34, 37, 41, 45,
	50, 55, 60, 66, 73, 80, 88, 97, 107, 118,
	130, 143, 157, 173, 190, 209, 230, 253, 279, 307,
	337, 371, 408, 449, 494, 544, 598, 658, 724, 796,
	876, 963, 1060, 1166, 1282, 1411, 1552, 1707, 1878, 2066,
	2272, 2499, 2749, 3024, 3327, 3660, 4026, 4428, 4871, 5358,
	5894, 6484, 7132, 7845, 8630, 9493, 10442, 11487, 12635, 13899,
	15289, 16818, 18500, 20350, 22385, 24623, 27086, 29794, 32767,
];

const BADP_INDEX_TABLE = [
	-1, -1, -1, -1, 2, 4, 6, 8,
	-1, -1, -1, -1, 2, 4, 6, 8,
];

function isWavBuffer(bytes: Uint8Array): boolean {
	return (
		bytes.byteLength >= 12
		&& bytes[0] === 0x52
		&& bytes[1] === 0x49
		&& bytes[2] === 0x46
		&& bytes[3] === 0x46
		&& bytes[8] === 0x57
		&& bytes[9] === 0x41
		&& bytes[10] === 0x56
		&& bytes[11] === 0x45
	);
}

function decodeBadpToPcm(bytes: Uint8Array): AudioPreviewPcm {
	const info = parseAudioInfo(bytes);
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	const samples = new Int16Array(info.frames * info.channels);

	let frame = 0;
	let offset = info.dataOffset;

	while (frame < info.frames) {
		if (offset + 4 > bytes.byteLength) {
			throw new Error('[audio_preview] BADP block header exceeds track bounds.');
		}

		const blockFrames = view.getUint16(offset, true);
		const blockBytes = view.getUint16(offset + 2, true);
		if (blockFrames <= 0) {
			throw new Error('[audio_preview] BADP block has zero frames.');
		}

		const blockHeaderBytes = 4 + info.channels * 4;
		if (blockBytes < blockHeaderBytes) {
			throw new Error('[audio_preview] BADP block header length is invalid.');
		}

		const blockEnd = offset + blockBytes;
		if (blockEnd > bytes.byteLength) {
			throw new Error('[audio_preview] BADP block exceeds track bounds.');
		}

		const predictors = new Int32Array(2);
		const stepIndices = new Int32Array(2);
		let cursor = offset + 4;
		for (let channel = 0; channel < info.channels; channel += 1) {
			const predictor = view.getInt16(cursor, true);
			const stepIndex = view.getUint8(cursor + 2);
			if (stepIndex < 0 || stepIndex > 88) {
				throw new Error('[audio_preview] BADP step index out of range.');
			}
			predictors[channel] = predictor;
			stepIndices[channel] = stepIndex;
			cursor += 4;
		}

		const payloadOffset = offset + blockHeaderBytes;
		let nibbleCursor = 0;
		for (let blockFrame = 0; blockFrame < blockFrames && frame < info.frames; blockFrame += 1, frame += 1) {
			let left = 0;
			let right = 0;
			for (let channel = 0; channel < info.channels; channel += 1) {
				const payloadIndex = payloadOffset + (nibbleCursor >> 1);
				if (payloadIndex >= blockEnd) {
					throw new Error('[audio_preview] BADP payload underrun.');
				}
				const packed = bytes[payloadIndex];
				const code = (nibbleCursor & 1) === 0 ? ((packed >> 4) & 0x0f) : (packed & 0x0f);
				nibbleCursor += 1;

				const step = BADP_STEP_TABLE[stepIndices[channel]];
				let diff = step >> 3;
				if ((code & 4) !== 0) diff += step;
				if ((code & 2) !== 0) diff += step >> 1;
				if ((code & 1) !== 0) diff += step >> 2;
				if ((code & 8) !== 0) {
					predictors[channel] -= diff;
				} else {
					predictors[channel] += diff;
				}
				predictors[channel] = clamp(predictors[channel], -32768, 32767) | 0;
				stepIndices[channel] = clamp(stepIndices[channel] + BADP_INDEX_TABLE[code], 0, 88) | 0;

				if (channel === 0) {
					left = predictors[channel];
				} else {
					right = predictors[channel];
				}
			}

			if (info.channels === 1) {
				samples[frame] = left;
			} else {
				const base = frame * 2;
				samples[base] = left;
				samples[base + 1] = right;
			}
		}

		offset = blockEnd;
	}

	return {
		samples,
		sampleRate: info.sampleRate,
		channels: info.channels,
		frames: info.frames,
		format: 'badp',
	};
}

export function decodeAudioPreviewToPcm(bytes: Uint8Array): AudioPreviewPcm {
	if (isWavBuffer(bytes)) {
		const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
		const decoded = decodeWavToPcm(buffer);
		return {
			samples: decoded.samples,
			sampleRate: decoded.sampleRate,
			channels: decoded.channels,
			frames: decoded.frames,
			format: 'wav',
		};
	}
	return decodeBadpToPcm(bytes);
}

import { clamp } from '../../src/bmsx/common/clamp';
import { decodeWavToPcm } from '../../src/bmsx/common/wav';

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
	let samples = new Int16Array(info.frames * info.channels);

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
		// Read per-channel header (predictor + stepIndex). If the step index
		// is out of the expected 0..88 range, clamp it and stop decoding
		// further blocks gracefully instead of throwing.
		let badHeader = false;
		for (let channel = 0; channel < info.channels; channel += 1) {
			const predictor = view.getInt16(cursor, true);
			let stepIndex = view.getUint8(cursor + 2);
			if (stepIndex > 88) {
				// Step index out of expected range; clamp and mark header as bad
				// so we bail out cleanly. Avoid logging to keep the UI output
				// free of debug messages.
				stepIndex = clamp(stepIndex, 0, 88);
				badHeader = true;
			}
			predictors[channel] = predictor;
			stepIndices[channel] = stepIndex;
			cursor += 4;
		}
		if (badHeader) {
			// Stop decoding further blocks; we'll return the partial PCM we
			// decoded so far.
			break;
		}


		const payloadOffset = offset + blockHeaderBytes;
		// Determine how many frames the payload can actually represent. Each
		// packed byte contains two 4-bit samples (nibbles), and each frame
		// contains `info.channels` nibbles.
		const payloadAvailableBytes = Math.max(0, blockEnd - payloadOffset);
		const nibblesAvailable = payloadAvailableBytes * 2;
		const maxFramesFromPayload = Math.floor(nibblesAvailable / info.channels);
		const framesRemaining = info.frames - frame;
		const framesToProcess = Math.min(blockFrames, framesRemaining, maxFramesFromPayload);

		if (framesToProcess <= 0) {
			// Nothing decodable in this block — treat as truncated and stop.
			break;
		}

		let nibbleCursor = 0;
		let stopDecoding = false;
		for (let blockFrame = 0; blockFrame < framesToProcess; blockFrame += 1, frame += 1) {
			let left = 0;
			let right = 0;
			for (let channel = 0; channel < info.channels; channel += 1) {
				const payloadIndex = payloadOffset + (nibbleCursor >> 1);
				if (payloadIndex >= blockEnd) {
					// Defensive: stop rather than throwing.
					stopDecoding = true;
					break;
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

			if (stopDecoding) break;

			if (info.channels === 1) {
				samples[frame] = left;
			} else {
				const base = frame * 2;
				samples[base] = left;
				samples[base + 1] = right;
			}
		}

		// If we couldn't process all claimed frames for this block, stop
		// decoding further blocks — the data is truncated or inconsistent.
		if (framesToProcess < blockFrames || stopDecoding) {
			break;
		}

		offset = blockEnd;
	}

	const actualFrames = frame;
	if (actualFrames * info.channels !== samples.length) {
		// Trim the samples buffer to the actual decoded length so callers
		// don't see trailing zeros for frames we couldn't decode.
		samples = samples.subarray(0, actualFrames * info.channels);
	}

	return {
		samples,
		sampleRate: info.sampleRate,
		channels: info.channels,
		frames: actualFrames,
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
function parseAudioInfo(bytes: Uint8Array) {
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

	// If the buffer contains a BADP/ADPCM header (written by the rompacker),
	// parse it directly rather than using heuristics. This gives accurate
	// frames/channels/sampleRate/dataOffset metadata and fixes incorrectly
	// decoded waveforms when the header+seek table push the first block far
	// beyond the first 64 bytes.
	const ADPCM_HEADER_SIZE = 48;
	const startsWithMagic = bytes.byteLength >= 4
		&& bytes[0] === 0x42 /* B */
		&& bytes[1] === 0x41 /* A */
		&& bytes[2] === 0x44 /* D */
		&& bytes[3] === 0x50 /* P */;

	if (startsWithMagic && bytes.byteLength >= ADPCM_HEADER_SIZE) {
		// Header layout (little-endian):
		// 0..3   : 'BADP'
		// 4..5   : version (uint16)
		// 6..7   : channels (uint16)
		// 8..11  : sampleRate (uint32)
		// 12..15 : frames (uint32)
		// 16..19 : loopStartFrame (uint32)
		// 20..23 : loopEndFrame (uint32)
		// 24..27 : seekStrideFrames (uint32)
		// 28..31 : seekEntryCount (uint32)
		// 32..35 : seekTableOffset (uint32)
		// 36..39 : dataOffset (uint32)
		const version = view.getUint16(4, true);
		// Only support version 1 here; fall back to heuristics otherwise.
		if (version === 1) {
			const channels = view.getUint16(6, true);
			const sampleRate = view.getUint32(8, true);
			const frames = view.getUint32(12, true);
			const dataOffset = view.getUint32(36, true);
			// Basic validation
			if (channels >= 1 && channels <= 2 && sampleRate > 0 && frames > 0 && dataOffset >= ADPCM_HEADER_SIZE && dataOffset <= bytes.byteLength) {
				return {
					frames,
					channels,
					sampleRate,
					dataOffset,
				};
			}
		}
	}

	// Fallback: legacy heuristic scan for the first BADP block header.
	const maxSearchStart = Math.min(64, bytes.byteLength - 8);
	const searchFrom = startsWithMagic ? 4 : 0;

	let foundOffset: number | null = null;
	let foundChannels = 1;

	// Try to locate the first BADP block header by heuristics.
	for (let offset = searchFrom; offset <= maxSearchStart; offset += 1) {
		for (const channels of [1, 2]) {
			if (offset + 4 > bytes.byteLength) continue;
			const blockFrames = view.getUint16(offset, true);
			const blockBytes = view.getUint16(offset + 2, true);
			if (blockFrames <= 0) continue;
			const blockHeaderBytes = 4 + channels * 4;
			if (blockBytes < blockHeaderBytes) continue;
			const blockEnd = offset + blockBytes;
			if (blockEnd > bytes.byteLength) continue;

			// Check per-channel step index ranges (should be 0..88)
			let ok = true;
			let cursor = offset + 4;
			for (let ch = 0; ch < channels; ch += 1) {
				if (cursor + 2 >= bytes.byteLength) { ok = false; break; }
				const stepIndex = view.getUint8(cursor + 2);
				if (stepIndex > 88) { ok = false; break; }
				cursor += 4;
			}
			if (!ok) continue;

			foundOffset = offset;
			foundChannels = channels;
			break;
		}
		if (foundOffset !== null) break;
	}

	if (foundOffset === null) {
		throw new Error('[audio_preview] Unable to locate BADP block header.');
	}

	// Walk blocks to compute total frames and validate bounds.
	// Be tolerant of truncated/partial final blocks: stop scanning when a
	// block appears incomplete instead of throwing, so we can still decode
	// the valid portion of the stream. Also ensure payload bytes are
	// sufficient for the claimed number of frames; if not, only count the
	// frames that are actually representable by the payload.
	let frames = 0;
	let offset = foundOffset;
	while (offset < bytes.byteLength) {
		// If we don't have enough bytes to read a block header, treat it as
		// the end of the stream rather than a hard error.
		if (offset + 4 > bytes.byteLength) {
			break;
		}

		const blockFrames = view.getUint16(offset, true);
		const blockBytes = view.getUint16(offset + 2, true);
		const blockHeaderBytes = 4 + foundChannels * 4;

		// Invalid or sentinel values: stop scanning further blocks.
		if (blockFrames <= 0) {
			break;
		}
		if (blockBytes < blockHeaderBytes) {
			break;
		}

		const blockEnd = offset + blockBytes;

		// If the block claims to extend past the available bytes, treat it as
		// a truncated final block and stop rather than throwing an exception.
		if (blockEnd > bytes.byteLength) {
			break;
		}

		// Verify payload has enough packed nibbles for the claimed frames.
		const payloadBytes = blockBytes - blockHeaderBytes;
		if (payloadBytes <= 0) {
			break;
		}
		const maxFramesFromPayload = Math.floor((payloadBytes * 2) / foundChannels);
		if (maxFramesFromPayload <= 0) {
			break;
		}

		frames += Math.min(blockFrames, maxFramesFromPayload);
		offset = blockEnd;
	}

	// Attempt to discover a plausible sample rate in the header area (before data).
	const commonRates = new Set([8000, 11025, 16000, 22050, 32000, 44100, 48000, 88200, 96000, 176400, 192000]);
	let sampleRate = 44100;
	for (let pos = 0; pos + 4 <= foundOffset; pos += 1) {
		const v = view.getUint32(pos, true);
		if (commonRates.has(v)) { sampleRate = v; break; }
	}

	return {
		frames,
		channels: foundChannels,
		sampleRate,
		dataOffset: foundOffset,
	};
}


import { clamp } from './clamp';

export type DecodedWavPcm = {
	samples: Int16Array;
	sampleRate: number;
	channels: number;
	bitsPerSample: number;
	frames: number;
};

export type WavInfo = {
	sampleRate: number;
	channels: number;
	bitsPerSample: number;
	dataOffset: number;
	dataLength: number;
	frames: number;
};

function readTag(dv: DataView, offset: number): string {
	return String.fromCharCode(
		dv.getUint8(offset),
		dv.getUint8(offset + 1),
		dv.getUint8(offset + 2),
		dv.getUint8(offset + 3),
	);
}

function readWavChunks(dv: DataView, label: string): {
	audioFormat: number;
	channels: number;
	sampleRate: number;
	bitsPerSample: number;
	dataOffset: number;
	dataLength: number;
} {
	if (dv.byteLength < 12) {
		throw new Error(`[${label}] WAV data too small.`);
	}
	if (readTag(dv, 0) !== 'RIFF' || readTag(dv, 8) !== 'WAVE') {
		throw new Error(`[${label}] Invalid WAV header.`);
	}

	let offset = 12;
	let audioFormat = 0;
	let channels = 0;
	let sampleRate = 0;
	let bitsPerSample = 0;
	let dataOffset = 0;
	let dataLength = 0;

	while (offset + 8 <= dv.byteLength) {
		const chunkId = readTag(dv, offset);
		const chunkSize = dv.getUint32(offset + 4, true);
		offset += 8;
		const chunkEnd = offset + chunkSize;
		if (chunkEnd > dv.byteLength) {
			throw new Error(`[${label}] Invalid WAV chunk size.`);
		}
		if (chunkId === 'fmt ') {
			if (chunkSize < 16) {
				throw new Error(`[${label}] Invalid WAV fmt chunk size.`);
			}
			audioFormat = dv.getUint16(offset + 0, true);
			channels = dv.getUint16(offset + 2, true);
			sampleRate = dv.getUint32(offset + 4, true);
			bitsPerSample = dv.getUint16(offset + 14, true);
		} else if (chunkId === 'data') {
			dataOffset = offset;
			dataLength = chunkSize;
		}
		offset = chunkEnd + (chunkSize & 1);
	}

	if (dataOffset === 0 || dataLength === 0) {
		throw new Error(`[${label}] WAV file missing data chunk.`);
	}
	if (channels <= 0 || sampleRate <= 0) {
		throw new Error(`[${label}] Invalid WAV channels or sample rate.`);
	}

	return {
		audioFormat,
		channels,
		sampleRate,
		bitsPerSample,
		dataOffset,
		dataLength,
	};
}

export function parseWavInfo(buffer: Uint8Array): WavInfo {
	const dv = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
	const {
		audioFormat,
		channels,
		sampleRate,
		bitsPerSample,
		dataOffset,
		dataLength,
	} = readWavChunks(dv, 'parseWavInfo');

	if (audioFormat !== 1) {
		throw new Error(`[parseWavInfo] Unsupported WAV encoding ${audioFormat}.`);
	}
	if (bitsPerSample !== 8 && bitsPerSample !== 16) {
		throw new Error('[parseWavInfo] Unsupported WAV bit depth.');
	}

	const bytesPerSample = bitsPerSample / 8;
	const totalSamples = Math.floor(dataLength / bytesPerSample);
	const frames = Math.floor(totalSamples / channels);

	return {
		sampleRate,
		channels,
		bitsPerSample,
		dataOffset,
		dataLength,
		frames,
	};
}

export function decodeWavToPcm(buffer: ArrayBuffer): DecodedWavPcm {
	const dv = new DataView(buffer);
	const {
		audioFormat,
		channels,
		sampleRate,
		bitsPerSample,
		dataOffset,
		dataLength,
	} = readWavChunks(dv, 'decodeWavToPcm');
	if (audioFormat !== 1 && audioFormat !== 3) {
		throw new Error(`[decodeWavToPcm] Unsupported WAV encoding ${audioFormat}.`);
	}
	if (bitsPerSample <= 0 || (bitsPerSample % 8) !== 0) {
		throw new Error('[decodeWavToPcm] Invalid WAV bit depth.');
	}
	if (audioFormat === 3 && bitsPerSample !== 32) {
		throw new Error('[decodeWavToPcm] Unsupported WAV float bit depth.');
	}

	const bytesPerSample = bitsPerSample / 8;
	const totalSamples = Math.floor(dataLength / bytesPerSample);
	const frames = Math.floor(totalSamples / channels);
	const sampleCount = frames * channels;
	const out = new Int16Array(sampleCount);

	let cursor = dataOffset;
	for (let index = 0; index < sampleCount; index += 1) {
		let sample = 0;
		if (audioFormat === 3) {
			sample = dv.getFloat32(cursor, true);
		} else {
			if (bitsPerSample === 8) {
				sample = (dv.getUint8(cursor) - 128) / 128;
			} else if (bitsPerSample === 16) {
				sample = dv.getInt16(cursor, true) / 32768;
			} else if (bitsPerSample === 24) {
				const b0 = dv.getUint8(cursor);
				const b1 = dv.getUint8(cursor + 1);
				const b2 = dv.getUint8(cursor + 2);
				let value = (b2 << 16) | (b1 << 8) | b0;
				if (value & 0x800000) {
					value |= 0xff000000;
				}
				sample = value / 8388608;
			} else if (bitsPerSample === 32) {
				sample = dv.getInt32(cursor, true) / 2147483648;
			} else {
				throw new Error('[decodeWavToPcm] Unsupported WAV bit depth.');
			}
		}
		const clamped = clamp(sample, -1, 1);
		const scaled = clamped < 0 ? Math.round(clamped * 32768) : Math.round(clamped * 32767);
		out[index] = clamp(scaled, -32768, 32767) | 0;
		cursor += bytesPerSample;
	}

	return {
		samples: out,
		sampleRate,
		channels,
		bitsPerSample: 16,
		frames,
	};
}

// Source-demand probe, not a second audio implementation. The production mixer
// owns phase, loop/neighbor order, PCM interpolation and the actual BADP decoder.
// A numeric-index-only test byte view records its addressed reads. It does not
// alter machine/runtime sources or invent a persistent PCM cache.
import assert from 'node:assert/strict';
import { readLE32, writeLE16, writeLE32 } from '../../machine/ts/common/endian.ts';
import { ApuOutputMixer } from '../../machine/ts/machine/devices/audio/output.ts';
import type { ApuAudioSource } from '../../machine/ts/machine/devices/audio/contracts.ts';
import { emitBadpRequestVectors, emitBadpStepVectors } from './apu_badp_vectors.ts';
import {
    APU_GAIN_Q12_ONE, APU_PARAMETER_REGISTER_COUNT,
    APU_PARAMETER_RATE_STEP_Q16_INDEX, APU_PARAMETER_GAIN_Q12_INDEX,
    APU_PARAMETER_START_SAMPLE_INDEX, APU_SAMPLE_RATE_HZ,
} from '../../machine/ts/spec/audio/apu.ts';

const OUTPUT_FRAMES = 1024;
const SOURCE_FRAMES = 8192;

export type Case = {
    id: string; bits: number; channels: number; hz: number;
    rate: number; block: number; start: number; loopStart: number;
    loopEnd: number; offset: number; voices: number; sourceFrames: number; seekEveryBlocks: number; mutateFrame: number; rateChangeFrame: number; rateChangeWord: number;
};
export type Fixture = {
    spec: Case; bytes: Uint8Array; kinds: Uint8Array; blockStarts: Uint8Array;
    dataOffset: number; stride: number;
};

const baseCase: Omit<Case, 'id' | 'bits' | 'channels' | 'hz'> = {
    rate: 0x10000, block: 0, start: 0, loopStart: 0, loopEnd: 0,
    offset: 0, voices: 1, sourceFrames: SOURCE_FRAMES, seekEveryBlocks: 1, mutateFrame: -1, rateChangeFrame: -1, rateChangeWord: 0,
};
const cases: Case[] = [];
for (const bits of [8, 16]) for (const channels of [1, 2]) for (const hz of [22050, 44100])
    cases.push({ ...baseCase, id: `pcm${bits}_${channels}ch_${hz}_1x`, bits, channels, hz });
for (const [label, rate] of [['half', 0x8000], ['2x', 0x20000], ['4x', 0x40000], ['reverse', 0xffff0000]] as const)
    cases.push({ ...baseCase, id: `pcm16_2ch_44100_${label}`, bits: 16, channels: 2,
        hz: 44100, rate, start: label === 'reverse' ? 4096 : 0 });
for (const channels of [1, 2]) for (const block of [64, 256]) for (const hz of [22050, 44100])
    cases.push({ ...baseCase, id: `badp_${channels}ch_b${block}_${hz}_1x`, bits: 4, channels, hz, block });
for (const channels of [1, 2]) for (const [label, rate] of [['half', 0x8000], ['2x', 0x20000], ['4x', 0x40000]] as const)
    cases.push({ ...baseCase, id: `badp_${channels}ch_b256_44100_${label}`, bits: 4,
        channels, hz: 44100, rate, block: 256 });
for (const channels of [1, 2]) for (const block of [64, 256]) {
    cases.push({ ...baseCase, id: `badp_${channels}ch_b${block}_loop33_97`, bits: 4,
        channels, hz: 44100, block, start: 33, loopStart: 33, loopEnd: 97 });
    cases.push({ ...baseCase, id: `badp_${channels}ch_b${block}_reverse_loop33_97`, bits: 4,
        channels, hz: 44100, rate: 0xffff0000, block, start: 96, loopStart: 33, loopEnd: 97 });
}
for (const channels of [1, 2]) for (const offset of [1, 3]) {
    cases.push({ ...baseCase, id: `pcm16_${channels}ch_unaligned${offset}_loop33_97`, bits: 16,
        channels, hz: 44100, start: 33, loopStart: 33, loopEnd: 97, offset });
    cases.push({ ...baseCase, id: `badp_${channels}ch_unaligned${offset}`, bits: 4,
        channels, hz: 44100, block: 256, offset });
}
for (const channels of [1, 2])
    cases.push({ ...baseCase, id: `badp_${channels}ch_16_simultaneous`, bits: 4,
        channels, hz: 44100, block: 256, voices: 16 });
cases.push({ ...baseCase, id: 'pcm16_1ch_frozen_live_write', bits: 16, channels: 1,
    hz: 44100, rate: 0, mutateFrame: 16 });
cases.push({ ...baseCase, id: 'badp_1ch_frozen_live_write', bits: 4, channels: 1,
    hz: 44100, rate: 0, block: 256, mutateFrame: 16 });
for (const bits of [4, 16]) for (const channels of [1, 2]) {
    for (const hz of [32000, 48000])
        cases.push({ ...baseCase, id: `${bits === 4 ? 'badp' : 'pcm16'}_${channels}ch_${hz}_rational`,
            bits, channels, hz, block: bits === 4 ? 256 : 0 });
    cases.push({ ...baseCase, id: `${bits === 4 ? 'badp' : 'pcm16'}_${channels}ch_live_rate_half_to2x`,
        bits, channels, hz: 44100, rate: 0x8000, block: bits === 4 ? 256 : 0,
        offset: channels === 1 ? 1 : 3, rateChangeFrame: 17, rateChangeWord: 0x20000 });
}

// Eight simultaneously active stereo voices are a separate assurance target,
// not a sum of mono/stereo examples. Small blocks use shorter distinct banks;
// all eight supplied source extents remain inside the physical512KiB pool.
const eightStereoBadp: Case = {
    ...baseCase, id: '', bits: 4, channels: 2, hz: 44100, block: 256, voices: 8,
};
for (const block of [1, 2, 4, 16, 64, 256])
    cases.push({ ...eightStereoBadp, id: `eight_stereo_badp_b${block}_44100_1x`,
        block, sourceFrames: block <= 4 ? 2048 : SOURCE_FRAMES });
for (const block of [1, 4, 64, 256]) for (const offset of [1, 3])
    cases.push({ ...eightStereoBadp, id: `eight_stereo_badp_b${block}_unaligned${offset}`,
        block, offset, sourceFrames: block <= 4 ? 2048 : SOURCE_FRAMES });
for (const [label, rate] of [['zero', 0], ['half', 0x8000], ['2x', 0x20000], ['4x', 0x40000]] as const)
    cases.push({ ...eightStereoBadp, id: `eight_stereo_badp_b256_${label}`, rate });
for (const block of [64, 256]) for (const hz of [22050, 48000])
    cases.push({ ...eightStereoBadp, id: `eight_stereo_badp_b${block}_${hz}`, block, hz });
for (const block of [64, 256]) {
    cases.push({ ...eightStereoBadp, id: `eight_stereo_badp_b${block}_loop33_97`,
        block, start: 33, loopStart: 33, loopEnd: 97 });
    cases.push({ ...eightStereoBadp, id: `eight_stereo_badp_b${block}_reverse_loop33_97`,
        block, rate: 0xffff0000, start: 96, loopStart: 33, loopEnd: 97 });
}
cases.push({ ...eightStereoBadp, id: 'eight_stereo_badp_b256_crossblock_loop253_259',
    start: 253, loopStart: 253, loopEnd: 259 });
cases.push({ ...eightStereoBadp, id: 'eight_stereo_badp_b256_reverse_crossblock_loop253_259',
    rate: 0xffff0000, start: 258, loopStart: 253, loopEnd: 259 });
cases.push({ ...eightStereoBadp, id: 'eight_stereo_badp_b256_late_start255', start: 255 });
cases.push({ ...eightStereoBadp, id: 'eight_stereo_badp_b256_late_start4095', start: 4095 });
cases.push({ ...eightStereoBadp, id: 'eight_stereo_badp_b64_sparse_seek8_late4095',
    block: 64, seekEveryBlocks: 8, start: 4095 });
cases.push({ ...eightStereoBadp, id: 'eight_stereo_badp_b64_empty_seek_late4095',
    block: 64, seekEveryBlocks: 0, start: 4095 });
cases.push({ ...eightStereoBadp, id: 'eight_stereo_badp_b256_sparse_seek8_loop33_97',
    seekEveryBlocks: 8, start: 33, loopStart: 33, loopEnd: 97 });
cases.push({ ...eightStereoBadp, id: 'eight_stereo_badp_b1_sparse_seek8_4x_loop0_4096',
    block: 1, seekEveryBlocks: 8, sourceFrames: 4096, rate: 0x40000, loopStart: 0, loopEnd: 4096 });

// A repeated fractional final-frame position can discard/redecode the end
// sample when its loop-start neighbor replaces the two retained BADP frames.
// These are ordinary forward resampling cases, not malformed block metadata.
cases.push({ ...eightStereoBadp, id: 'eight_stereo_badp_b256_half_loop0_256_start255',
    rate: 0x8000, start: 255, loopStart: 0, loopEnd: 256 });
cases.push({ ...eightStereoBadp, id: 'eight_stereo_badp_b256_22050_loop0_256_start255',
    hz: 22050, start: 255, loopStart: 0, loopEnd: 256 });
for (const block of [64, 256])
    cases.push({ ...eightStereoBadp, id: `eight_stereo_badp_b${block}_half_loop33_97_start96`,
        block, rate: 0x8000, start: 96, loopStart: 33, loopEnd: 97 });
cases.push({ ...eightStereoBadp, id: 'eight_stereo_badp_b256_half_loop0_512_start511',
    rate: 0x8000, start: 511, loopStart: 0, loopEnd: 512 });

function fixture(spec: Case): Fixture {
    const blocks = spec.block === 0 ? 0 : spec.sourceFrames / spec.block;
    const seekEntries = spec.seekEveryBlocks === 0 ? 0 : blocks / spec.seekEveryBlocks;
    const dataOffset = 64 + seekEntries * 8;
    const blockBytes = 4 + 4 * spec.channels + spec.block * spec.channels / 2;
    const payloadBytes = spec.bits === 4 ? blocks * blockBytes : spec.sourceFrames * spec.channels * (spec.bits / 8);
    const bytes = new Uint8Array(spec.offset + dataOffset + payloadBytes);
    const kinds = new Uint8Array(bytes.length);
    const blockStarts = new Uint8Array(bytes.length);
    if (spec.bits === 4) {
        writeLE32(bytes, spec.offset + 28, seekEntries);
        writeLE32(bytes, spec.offset + 32, 64);
        kinds.fill(2, spec.offset + 28, spec.offset + 36);
        for (let block = 0; block < blocks; ++block) {
            if (spec.seekEveryBlocks !== 0 && block % spec.seekEveryBlocks === 0) {
                const entry = spec.offset + 64 + block / spec.seekEveryBlocks * 8;
                writeLE32(bytes, entry, block * spec.block);
                writeLE32(bytes, entry + 4, block * blockBytes);
                kinds.fill(2, entry, entry + 8);
            }
            const begin = spec.offset + dataOffset + block * blockBytes;
            writeLE16(bytes, begin, spec.block);
            writeLE16(bytes, begin + 2, blockBytes);
            blockStarts[begin] = 1;
            kinds.fill(1, begin, begin + 4 + spec.channels * 4);
            for (let channel = 0; channel < spec.channels; ++channel) {
                writeLE16(bytes, begin + 4 + channel * 4, (block * 109 + channel * 211) & 0xffff);
                bytes[begin + 6 + channel * 4] = 20 + channel;
            }
            const payload = begin + 4 + spec.channels * 4;
            for (let n = 0; n < spec.block * spec.channels / 2; ++n)
                bytes[payload + n] = (n * 37 + block * 11 + 0x21) & 0xff;
            kinds.fill(3, payload, begin + blockBytes);
        }
    } else {
        const data = spec.offset + dataOffset;
        for (let n = 0; n < spec.sourceFrames * spec.channels; ++n) {
            if (spec.bits === 16) writeLE16(bytes, data + n * 2, (n * 173 + 731) & 0xffff);
            else bytes[data + n] = (n * 37 + 41) & 0xff;
        }
        kinds.fill(3, data);
    }
    const stride = (bytes.length + 3) & ~3;
    return { spec, bytes, kinds, blockStarts, dataOffset, stride };
}

class AccessEpoch {
    words: number[] = [];
    byteReads = 0;
    nibbles = 0;
    blockLoads = 0;
    seekByteReads = 0;
    blockHeaderByteReads = 0;
    reset(): void {
        this.words = [];
        this.byteReads = 0; this.nibbles = 0; this.blockLoads = 0;
        this.seekByteReads = 0; this.blockHeaderByteReads = 0;
    }
    view(data: Fixture, bytes: Uint8Array, base: number): Uint8Array {
        // Every access made by the selected production decoder/mixer is a
        // numeric byte subscript; no typed-array method is virtualized here.
        return new Proxy(bytes, {
            get: (target, key) => {
                const address = Number(key);
                const word = (base + address) & ~3;
                if (this.words.length === 0 || this.words[this.words.length - 1] !== word)
                    this.words.push(word);
                ++this.byteReads;
                if (data.spec.bits === 4) {
                    if (data.kinds[address] === 3) ++this.nibbles;
                    if (data.kinds[address] === 1) ++this.blockHeaderByteReads;
                    if (data.kinds[address] === 2) ++this.seekByteReads;
                    if (data.blockStarts[address]) ++this.blockLoads;
                }
                return target[address];
            },
        });
    }
}

function run(data: Fixture) {
    const spec = data.spec;
    if (spec.voices === 8) assert.ok(data.stride * spec.voices <= 0x80000);
    const mixer = new ApuOutputMixer();
    const registers = new Uint32Array(APU_PARAMETER_REGISTER_COUNT);
    registers[APU_PARAMETER_RATE_STEP_Q16_INDEX] = spec.rate;
    registers[APU_PARAMETER_GAIN_Q12_INDEX] = APU_GAIN_Q12_ONE / spec.voices;
    registers[APU_PARAMETER_START_SAMPLE_INDEX] = spec.start;
    const source: ApuAudioSource = {
        sourceAddr: 0x40000000 + spec.offset, sourceBytes: data.bytes.length - spec.offset,
        sampleRateHz: spec.hz, channels: spec.channels, bitsPerSample: spec.bits,
        frameCount: spec.sourceFrames, dataOffset: data.dataOffset,
        dataBytes: data.bytes.length - spec.offset - data.dataOffset,
        loopStartSample: spec.loopStart, loopEndSample: spec.loopEnd,
        generatorKind: 0, generatorDutyQ12: 0,
    };
    const epoch = new AccessEpoch();
    const buffers: Uint8Array[] = [];
    for (let voice = 0; voice < spec.voices; ++voice) {
        const bytes = data.bytes.slice();
        buffers.push(bytes);
        mixer.playVoice(voice, { ...source, sourceAddr: source.sourceAddr + voice * data.stride }, {
            bytes: epoch.view(data, bytes, voice * data.stride),
            byteOffset: spec.offset, byteLength: bytes.length - spec.offset,
            cartridgeSlot: 0,
        }, registers);
    }
    const cold = {
        word_runs: epoch.words, byte_reads: epoch.byteReads,
        nibbles: epoch.nibbles, block_loads: epoch.blockLoads,
        seek_byte_reads: epoch.seekByteReads,
        block_header_byte_reads: epoch.blockHeaderByteReads,
    };
    const frames: number[][] = [];
    const frameByteReads: number[] = [], frameNibbles: number[] = [], frameBlockLoads: number[] = [];
    const frameSeekReads: number[] = [], frameHeaderReads: number[] = [];
    let checksum = 0x811c9dc5;
    let endedMask = 0;
    let changedSample = 0;
    for (let frame = 0; frame < OUTPUT_FRAMES; ++frame) {
        epoch.reset();
        if (frame === spec.rateChangeFrame) {
            registers[APU_PARAMETER_RATE_STEP_Q16_INDEX] = spec.rateChangeWord;
            for (let voice = 0; voice < spec.voices; ++voice)
                mixer.writeSlotRegisterWord(voice, source, registers, APU_PARAMETER_RATE_STEP_Q16_INDEX);
        }
        if (frame === spec.mutateFrame) {
            for (const bytes of buffers) {
                const address = spec.offset + data.dataOffset + (spec.bits === 4 ? 4 + spec.channels * 4 : 0);
                writeLE16(bytes, address, 0x2abc);
            }
        }
        endedMask |= mixer.renderMachineFrames(1, frame);
        const packed = mixer.outputRing.readFramePacked();
        checksum = Math.imul(checksum ^ packed, 0x01000193) >>> 0;
        if (frame === 16) changedSample = packed;
        frames.push(epoch.words);
        frameByteReads.push(epoch.byteReads); frameNibbles.push(epoch.nibbles);
        frameBlockLoads.push(epoch.blockLoads); frameSeekReads.push(epoch.seekByteReads);
        frameHeaderReads.push(epoch.blockHeaderByteReads);
    }
    assert.equal(endedMask, 0);
    if (spec.id === 'pcm16_1ch_frozen_live_write') assert.equal(changedSample, 0x2abc2abc);
    if (spec.id === 'badp_1ch_frozen_live_write') {
        assert.equal(frames[16].length, 0);
        assert.equal(frameNibbles[16], 0);
    }
    return {
        id: spec.id, format: spec.bits === 4 ? 'BADP' : `PCM${spec.bits}`,
        voices: spec.voices, channels: spec.channels, source_hz: spec.hz,
        rate_step_word: spec.rate, block_frames: spec.block, start_frame: spec.start,
        source_frames: spec.sourceFrames, seek_every_blocks: spec.seekEveryBlocks, loop_start: spec.loopStart, loop_end: spec.loopEnd,
        source_byte_offset: spec.offset, source_data_offset: data.dataOffset,
        source_stride_bytes: data.stride, storage_bytes: data.stride * spec.voices,
        mutate_frame: spec.mutateFrame, rate_change_frame: spec.rateChangeFrame,
        rate_change_word: spec.rateChangeWord, checksum32: checksum, ended_mask: endedMask,
        cold, frames, frame_byte_reads: frameByteReads, frame_nibbles: frameNibbles,
        frame_block_loads: frameBlockLoads, frame_seek_byte_reads: frameSeekReads,
        frame_block_header_byte_reads: frameHeaderReads,
    };
}

if (process.argv.includes('--badp-step-input')) {
    emitBadpStepVectors();
} else if (process.argv.includes('--badp-request-input')) {
    emitBadpRequestVectors(fixture, eightStereoBadp);
} else if (process.argv.includes('--cpp-input')) {
    process.stdout.write(`${cases.length} ${OUTPUT_FRAMES}\n`);
    for (const spec of cases) {
        const data = fixture(spec);
        process.stdout.write(`${spec.id} ${spec.bits} ${spec.channels} ${spec.hz} ${spec.rate} ${spec.start} ${spec.loopStart} ${spec.loopEnd} ${spec.offset} ${spec.voices} ${spec.mutateFrame} ${spec.rateChangeFrame} ${spec.rateChangeWord} ${data.dataOffset} ${data.bytes.length} ${spec.sourceFrames}\n`);
        process.stdout.write(`${data.bytes.join(' ')}\n`);
    }
} else if (process.argv.includes('--eight-stereo-input')) {
    // Physical SRAM replay receives the very same fixture bytes and addressed
    // mixer reads. Only selected critical output epochs are replayed; original
    // epoch numbers remain explicit rather than pretending they are adjacent.
    const selectedCases = cases.filter(spec => spec.voices === 8 && spec.bits === 4 && spec.channels === 2);
    process.stdout.write(`${selectedCases.length}\n`);
    for (const spec of selectedCases) {
        const data = fixture(spec);
        const result = run(data);
        const image = new Uint8Array(data.stride * spec.voices);
        for (let voice = 0; voice < spec.voices; ++voice)
            image.set(data.bytes, voice * data.stride);
        let maxRawIndex = 0, maxNibbleIndex = 0;
        for (let frame = 1; frame < OUTPUT_FRAMES; ++frame) {
            if (result.frames[frame].length > result.frames[maxRawIndex].length) maxRawIndex = frame;
            if (result.frame_nibbles[frame] > result.frame_nibbles[maxNibbleIndex]) maxNibbleIndex = frame;
        }
        const selected = new Set([0, 1, maxRawIndex - 1, maxRawIndex, maxRawIndex + 1, maxNibbleIndex]);
        if (spec.rateChangeFrame >= 0) selected.add(spec.rateChangeFrame);
        const windows = [...selected].filter(frame => frame >= 0 && frame < OUTPUT_FRAMES).sort((a, b) => a - b);
        process.stdout.write(`${spec.id} ${image.length / 4} ${windows.length} 32\n`);
        const words: string[] = [];
        for (let address = 0; address < image.length; address += 4) {
            words.push(readLE32(image, address).toString(16).padStart(8, '0'));
            if (words.length === 256) {
                process.stdout.write(`${words.join(' ')}\n`);
                words.length = 0;
            }
        }
        if (words.length !== 0) process.stdout.write(`${words.join(' ')}\n`);
        process.stdout.write(`${result.cold.word_runs.length}\n`);
        process.stdout.write(`${result.cold.word_runs.map(address => address >>> 2).join(' ')}\n`);
        for (const frame of windows) {
            const reads = result.frames[frame];
            process.stdout.write(`${frame} ${reads.length} ${reads.map(address => address >>> 2).join(' ')}\n`);
        }
    }
} else {
    const results: ReturnType<typeof run>[] = [];
    let eightVoiceCompositionCases = 0;
    for (const spec of cases) {
        const data = fixture(spec);
        const result = run(data);
        if (spec.voices === 8) {
            const one = run({ ...data, spec: { ...spec, voices: 1 } });
            assert.equal(result.checksum32, one.checksum32);
            assert.equal(result.cold.word_runs.length, one.cold.word_runs.length * 8);
            for (let voice = 0; voice < 8; ++voice) {
                for (let word = 0; word < one.cold.word_runs.length; ++word)
                    assert.equal(result.cold.word_runs[voice * one.cold.word_runs.length + word],
                        one.cold.word_runs[word] + voice * data.stride);
            }
            for (const field of ['byte_reads', 'nibbles', 'block_loads', 'seek_byte_reads', 'block_header_byte_reads'] as const)
                assert.equal(result.cold[field], one.cold[field] * 8);
            for (let frame = 0; frame < OUTPUT_FRAMES; ++frame) {
                assert.equal(result.frames[frame].length, one.frames[frame].length * 8);
                for (let voice = 0; voice < 8; ++voice) {
                    for (let word = 0; word < one.frames[frame].length; ++word)
                        assert.equal(result.frames[frame][voice * one.frames[frame].length + word],
                            one.frames[frame][word] + voice * data.stride);
                }
                for (const field of ['frame_byte_reads', 'frame_nibbles', 'frame_block_loads', 'frame_seek_byte_reads', 'frame_block_header_byte_reads'] as const)
                    assert.equal(result[field][frame], one[field][frame] * 8);
            }
            ++eightVoiceCompositionCases;
        }
        results.push(result);
    }
    process.stdout.write(`${JSON.stringify({
        scope: 'Actual TS ApuOutputMixer, PCM/BADP decoders and phase/loop owners, with direct source views. Binding admission and physical buses are not exercised by this probe. Word runs coalesce only consecutive addressed byte reads within one output epoch; no persistent physical cache is supplied.',
        reference_url: 'https://github.com/stenzek/duckstation/blob/master/src/core/spu.cpp',
        reference: 'DuckStation SPU separates decoded block storage from source RAM reads; no PS1 ADPCM format, cache or timing is substituted for BMSX BADP.',
        output_frames: OUTPUT_FRAMES, output_hz: APU_SAMPLE_RATE_HZ,
        eight_voice_composition_cases: eightVoiceCompositionCases,
        scenarios: results,
    })}\n`);
}

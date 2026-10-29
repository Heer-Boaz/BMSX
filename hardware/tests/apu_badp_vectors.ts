// Golden vectors call the production BADP decoder. This file supplies source
// bytes and request schedules; it does not reproduce its arithmetic or cache.
import assert from 'node:assert/strict';
import { clamp } from '../../machine/ts/common/clamp.ts';
import { readLE16, readLE32, writeLE16, writeLE32 } from '../../machine/ts/common/endian.ts';
import { shiftRightSigned } from '../../machine/ts/machine/common/numeric.ts';
import {
    createApuBadpDecoderState, readApuBadpFrameAt, resetApuBadpDecoder,
    type ApuBadpDecodeTarget,
} from '../../machine/ts/machine/devices/audio/badp_decoder_hot_path.ts';
import type { ApuBadpDecoderState } from '../../machine/ts/machine/devices/audio/badp_decoder.ts';
import { ApuOutputMixer } from '../../machine/ts/machine/devices/audio/output.ts';
import { interpolateApuPcmSample } from '../../machine/ts/machine/devices/audio/pcm_decoder_hot_path.ts';
import type { ApuBadpDecoderSaveState } from '../../machine/ts/machine/devices/audio/save_state.ts';
import type { ApuAudioSource } from '../../machine/ts/machine/devices/audio/contracts.ts';
import {
    APU_PARAMETER_GAIN_Q12_INDEX, APU_PARAMETER_RATE_STEP_Q16_INDEX,
    APU_PARAMETER_REGISTER_COUNT, APU_PARAMETER_START_SAMPLE_INDEX,
} from '../../machine/ts/spec/audio/apu.ts';
import type { Case, Fixture } from './apu_workloads.ts';

export function emitBadpStepVectors(): void {
    const predictors = [0, 1, -1, 32767, -32768, 32760, -32760, 12345, -12345];
    const bytes = new Uint8Array(16);
    writeLE16(bytes, 0, 1);
    writeLE16(bytes, 2, 13);
    const record: ApuBadpDecodeTarget = {
        sourceBytes: bytes, dataOffset: 0, frames: 1, channels: 2,
        badpSeekTable: { bytes, byteOffset: 0, entryCount: 0 },
        badp: createApuBadpDecoderState(),
    };
    process.stdout.write(`${89 * 16 * predictors.length}\n`);
    for (let index = 0; index < 89; ++index) for (let code = 0; code < 16; ++code) {
        for (let seed = 0; seed < predictors.length; ++seed) {
            const left = predictors[seed];
            const right = predictors[(seed + 4) % predictors.length];
            const rightIndex = 88 - index;
            const packed = (code << 4) | (code ^ 8);
            writeLE16(bytes, 4, left);
            bytes[6] = index;
            writeLE16(bytes, 8, right);
            bytes[10] = rightIndex;
            bytes[12] = packed;
            resetApuBadpDecoder(record, 0);
            process.stdout.write(`${left} ${right} ${index} ${rightIndex} ${packed} ${record.badp.decodedLeft} ${record.badp.decodedRight} ${record.badp.stepIndices[0]} ${record.badp.stepIndices[1]}\n`);
        }
    }
}

// Event fields are op, output epoch, voice, arg0, arg1, arg2, packed current,
// packed neighbor, followed by these sixteen raw decoder-state fields. Offsets
// in state remain relative to the data base, as in the production decoder.
function decoderFields(state: ApuBadpDecoderState | ApuBadpDecoderSaveState): number[] {
    return [state.predictors[0], state.predictors[1], state.stepIndices[0], state.stepIndices[1],
        state.nextFrame, state.blockEnd, state.blockFrames, state.blockFrameIndex,
        state.payloadOffset, state.nibbleCursor, state.decodedFrame,
        ((state.decodedLeft & 0xffff) | ((state.decodedRight & 0xffff) << 16)) >>> 0,
        state.previousDecodedFrame,
        ((state.previousDecodedLeft & 0xffff) | ((state.previousDecodedRight & 0xffff) << 16)) >>> 0,
        state.decodedFrame >= 0 ? 1 : 0, state.previousDecodedFrame >= 0 ? 1 : 0];
}

type Mutation = {
    epoch: number; voice: number; byteAddress: number; byteMask: number; word: number;
};
type RequestCase = {
    spec: Case; outputs: number; mutations: Mutation[]; seeks: { epoch: number; frame: number }[];
    manualFrames?: number[];
    fixture?: Fixture;
};

function structuralFixture(spec: Case): Fixture {
    // Both layouts have four frames and the same two16-byte physical blocks.
    // The third payload byte is padding under the original2+2 frame counts,
    // but becomes a real sample under1+3. An empty seek table keeps the changed
    // global-frame mapping consistent without a concurrent table rewrite.
    const bytes = new Uint8Array(96), kinds = new Uint8Array(96), blockStarts = new Uint8Array(96);
    writeLE32(bytes, 32, 64);
    for (let block = 0; block < 2; ++block) {
        const begin = 64 + block * 16;
        writeLE16(bytes, begin, 2);writeLE16(bytes, begin + 2, 16);
        writeLE16(bytes, begin + 4, 100 + block * 1000);bytes[begin + 6] = 20 + block;
        writeLE16(bytes, begin + 8, -200 - block * 1300);bytes[begin + 10] = 23 + block;
        bytes[begin + 12] = block === 0 ? 0x12 : 0x9a;
        bytes[begin + 13] = block === 0 ? 0x34 : 0xbc;
        bytes[begin + 14] = block === 0 ? 0x56 : 0xde;
        bytes[begin + 15] = block === 0 ? 0x78 : 0xf0;
        blockStarts[begin] = 1;
    }
    return { spec, bytes, kinds, blockStarts, dataOffset: 64, stride: 96 };
}

export function emitBadpRequestVectors(makeFixture: (spec: Case) => Fixture, baseline: Case): void {
    const requests: RequestCase[] = [];
    const add = (id: string, outputs: number, override: Partial<Case> = {}): RequestCase => {
        const item = { spec: { ...baseline, sourceFrames: 512, id, ...override }, outputs,
            mutations: [] as Mutation[], seeks: [] as { epoch: number; frame: number }[] };
        requests.push(item);
        return item;
    };
    add('eight_loop0_256_unity', 260, { loopStart: 0, loopEnd: 256 });
    add('eight_loop0_256_half', 10, { start: 255, rate: 0x8000, loopStart: 0, loopEnd: 256 });
    add('eight_loop0_256_22050', 10, { start: 255, hz: 22050, loopStart: 0, loopEnd: 256 });
    add('eight_loop0_512_half', 10, { start: 511, rate: 0x8000, loopStart: 0, loopEnd: 512 });
    add('eight_loop_one_frame', 10, { start: 33, rate: 0x8000, loopStart: 33, loopEnd: 34 });
    add('eight_loop_two_frames', 10, { start: 34, rate: 0x8000, loopStart: 33, loopEnd: 35 });
    add('eight_loop33_97_half', 132, { start: 96, rate: 0x8000, loopStart: 33, loopEnd: 97 });
    add('eight_loop_split_block', 16, { start: 258, rate: 0x8000, loopStart: 253, loopEnd: 259 });
    add('eight_loop_two_single_frame_blocks', 10,
        { block: 1, start: 4, rate: 0x8000, loopStart: 3, loopEnd: 5 });
    add('eight_cold_late4095', 4, { sourceFrames: 8192, start: 4095 });
    add('eight_cold_before_loop', 6, { start: 1, loopStart: 4, loopEnd: 8 });
    add('eight_cold_unaligned3', 6, { start: 255, offset: 3 });

    const retained = add('eight_two_frame_loop_overlapping_commit', 12,
        { start: 34, rate: 0x8000, loopStart: 33, loopEnd: 35 });
    // Changing both compressed operands must not replace the two decoded
    // frames already retained by this short loop. A later START_SAMPLE does.
    const retainedData = makeFixture(retained.spec);
    const retainedPayload = retained.spec.offset + retainedData.dataOffset + 12;
    for (let voice = 0; voice < 8; ++voice) {
        retained.mutations.push({ epoch: 3, voice, byteAddress: voice * retainedData.stride + ((retainedPayload + 32) & ~3),
            byteMask: 15, word: 0xfedcba98 });
        retained.mutations.push({ epoch: 3, voice, byteAddress: voice * retainedData.stride + ((retainedPayload - 8) & ~3),
            byteMask: 15, word: 0x00137e01 });
    }
    retained.seeks.push({ epoch: 8, frame: 33 });

    const prefix = add('eight_half_loop_postcommit_mixed_prefix', 12,
        { start: 255, rate: 0x8000, loopStart: 0, loopEnd: 256 });
    const prefixData = makeFixture(prefix.spec);
    const prefixPayload = prefix.spec.offset + prefixData.dataOffset + 12;
    for (let voice = 0; voice < 8; ++voice)
        prefix.mutations.push({ epoch: 1, voice, byteAddress: voice * prefixData.stride + ((prefixPayload + 252) & ~3),
            byteMask: 15, word: 0x01234567 });

    const future = add('eight_future_payload_and_header_commit', 12);
    const futureData = makeFixture(future.spec);
    const futurePayload = future.spec.offset + futureData.dataOffset + 12;
    for (let voice = 0; voice < 8; ++voice) {
        future.mutations.push({ epoch: 2, voice, byteAddress: voice * futureData.stride + futurePayload,
            byteMask: 15, word: 0xfedcba98 });
        future.mutations.push({ epoch: 2, voice, byteAddress: voice * futureData.stride + futurePayload - 8,
            byteMask: 15, word: 0x00117f00 });
        future.mutations.push({ epoch: 4, voice, byteAddress: voice * futureData.stride + futurePayload + 4,
            byteMask: 4, word: 0x00610000 });
    }
    future.seeks.push({ epoch: 7, frame: 0 });

    const disjoint = add('eight_disjoint_upload_bursts', 12,
        { start: 34, rate: 0x8000, loopStart: 33, loopEnd: 35 });
    const disjointData = makeFixture(disjoint.spec);
    for (const epoch of [0, 1, 4, 8]) for (let word = 0; word < 32; ++word)
        disjoint.mutations.push({ epoch, voice: 0, byteAddress: disjointData.stride * 8 + word * 4,
            byteMask: 15, word: (0x9e3779b9 ^ (epoch * 137 + word * 113)) >>> 0 });

    // Ready-work capacity probes, not proofs that39 words may publish in every
    // frame. The transfer-owner bench separately drives legal16→16→7 arrivals.
    for (const block of [1, 256]) {
        const capacity = add(`eight_forward_b${block}_39write_capacity`, 4, { block });
        const capacityData = makeFixture(capacity.spec);
        for (let epoch = 0; epoch < 4; ++epoch) for (let word = 0; word < 39; ++word)
            capacity.mutations.push({ epoch, voice: 0, byteAddress: capacityData.stride * 8 + word * 4,
                byteMask: 15, word: (0x11223344 ^ (epoch * 271 + word * 557)) >>> 0 });
    }
    const structural = add('eight_structural_block_count_commit', 5,
        { block: 2, sourceFrames: 4, seekEveryBlocks: 0, loopStart: 0, loopEnd: 4 });
    structural.manualFrames = [1, 2, 3, 0, 3];
    structural.fixture = structuralFixture(structural.spec);
    for (let voice = 0; voice < 8; ++voice) {
        structural.mutations.push({ epoch: 1, voice, byteAddress: voice * 96 + 64,
            byteMask: 3, word: 0x00100001 });
        structural.mutations.push({ epoch: 1, voice, byteAddress: voice * 96 + 80,
            byteMask: 3, word: 0x00100003 });
    }
    add('eight_reverse_unity_loop33_97', 8,
        { start: 35, rate: 0xffff0000, loopStart: 33, loopEnd: 97 });
    add('eight_reverse_half_loop0_512', 8,
        { start: 0, rate: 0xffff8000, loopStart: 0, loopEnd: 512 });
    add('eight_reverse_half_two_frame_loop', 10,
        { start: 34, rate: 0xffff8000, loopStart: 33, loopEnd: 35 });
    add('eight_zero_rate_at_loop_end', 6,
        { start: 255, rate: 0, loopStart: 0, loopEnd: 256 });
    const beyondDeclared = add('eight_loop_beyond_declared_frame_count', 8,
        { block: 4, sourceFrames: 4, loopStart: 0, loopEnd: 8 });
    beyondDeclared.fixture = makeFixture({ ...beyondDeclared.spec, sourceFrames: 12 });
    // READ5 is the retained previous frame after READ6. READ4 then takes the
    // distinct backward-request path outside FRAME_COUNT: seeking clears the
    // pair and sets nextFrame=4, but the read continues from loaded block and
    // nibble state. READ3 subsequently performs a real in-range seek.
    // The final real seek precedes the structural write. Normal forward decode
    // loads that zero-frame header once and still emits its payload; the next
    // request loads the following positive block. No seek scans the zero block.
    beyondDeclared.manualFrames = [6, 5, 4, 3, 6, 3, 4, 5];
    for (let voice = 0; voice < 8; ++voice)
        beyondDeclared.mutations.push({ epoch: 6, voice,
            byteAddress: voice * beyondDeclared.fixture.stride + beyondDeclared.fixture.dataOffset + 16,
            byteMask: 3, word: 0x00100000 });

    process.stdout.write(`${requests.length}\n`);
    for (const item of requests) {
        const { spec } = item;
        const data = item.fixture === undefined ? makeFixture(spec) : item.fixture;
        const image = new Uint8Array(data.stride * 8 + 256);
        assert.ok(image.length <= 0x80000);
        const voices: ApuBadpDecodeTarget[] = [];
        const descriptors: number[][] = [];
        const events: number[][] = [];
        const sources: ApuAudioSource[] = [];
        const mixer = new ApuOutputMixer();
        const registers = new Uint32Array(APU_PARAMETER_REGISTER_COUNT);
        registers[APU_PARAMETER_RATE_STEP_Q16_INDEX] = spec.rate;
        registers[APU_PARAMETER_GAIN_Q12_INDEX] = 512;
        registers[APU_PARAMETER_START_SAMPLE_INDEX] = spec.start;
        for (let voice = 0; voice < 8; ++voice) {
            const bank = voice * data.stride;
            image.set(data.bytes, bank);
            for (let byte = 0; byte < data.blockStarts.length; ++byte) {
                if (data.blockStarts[byte] !== 0) {
                    writeLE16(image, bank + byte + 4, readLE16(image, bank + byte + 4) + voice * 257);
                    writeLE16(image, bank + byte + 8, readLE16(image, bank + byte + 8) - voice * 193);
                }
            }
            const sourceBase = bank + spec.offset;
            const target: ApuBadpDecodeTarget = {
                sourceBytes: image, dataOffset: sourceBase + data.dataOffset,
                frames: spec.sourceFrames, channels: 2,
                badpSeekTable: { bytes: image,
                    byteOffset: sourceBase + readLE32(image, sourceBase + 32),
                    entryCount: readLE32(image, sourceBase + 28) },
                badp: createApuBadpDecoderState(),
            };
            voices.push(target);
            // voice, source baseABS, data offsetREL, frames, channels, seek
            // baseABS, seek count, loop start, loop end. Tail256 bytes are a
            // disjoint physical upload area, not part of any bound source.
            descriptors.push([voice, sourceBase, data.dataOffset, spec.sourceFrames, 2,
                target.badpSeekTable.byteOffset, target.badpSeekTable.entryCount,
                spec.loopStart, spec.loopEnd]);
            resetApuBadpDecoder(target, spec.start);
            events.push([0, -1, voice, spec.start, 0, 0, 0, 0, ...decoderFields(target.badp)]);
            const source: ApuAudioSource = {
                sourceAddr: 0x40000000 + sourceBase, sourceBytes: data.bytes.length - spec.offset,
                sampleRateHz: spec.hz, channels: 2, bitsPerSample: 4,
                frameCount: spec.sourceFrames, dataOffset: data.dataOffset,
                dataBytes: data.bytes.length - spec.offset - data.dataOffset,
                loopStartSample: spec.loopStart, loopEndSample: spec.loopEnd,
                generatorKind: 0, generatorDutyQ12: 0,
            };
            sources.push(source);
            mixer.playVoice(voice, source, { bytes: image, byteOffset: sourceBase,
                byteLength: data.bytes.length - spec.offset, cartridgeSlot: 0 }, registers);
        }
        const initialImage = image.slice();
        for (const actual of mixer.captureState().voices)
            assert.deepEqual(decoderFields(voices[actual.slot].badp), decoderFields(actual.badp), `${spec.id} PLAY`);
        for (let epoch = 0; epoch < item.outputs; ++epoch) {
            for (const mutation of item.mutations) {
                if (mutation.epoch !== epoch) continue;
                const address = mutation.byteAddress;
                for (let byte = 0; byte < 4; ++byte)
                    if ((mutation.byteMask & (1 << byte)) !== 0)
                        image[address + byte] = mutation.word >>> (byte * 8);
                events.push([3, epoch, mutation.voice, address, mutation.byteMask, mutation.word,
                    0, 0, ...decoderFields(voices[mutation.voice].badp)]);
            }
            for (const seek of item.seeks) {
                if (seek.epoch !== epoch) continue;
                registers[APU_PARAMETER_START_SAMPLE_INDEX] = seek.frame;
                for (let voice = 0; voice < 8; ++voice) {
                    resetApuBadpDecoder(voices[voice], seek.frame);
                    mixer.writeSlotRegisterWord(voice, sources[voice], registers, APU_PARAMETER_START_SAMPLE_INDEX);
                    events.push([0, epoch, voice, seek.frame, 0, 0, 0, 0, ...decoderFields(voices[voice].badp)]);
                }
            }
            if (item.manualFrames !== undefined) {
                // These boundary cases are decoder-request regressions, not
                // a second playback/phase implementation. Only the unchanged
                // production decoder supplies its golden state and operands.
                const frame = item.manualFrames[epoch];
                for (let voice = 0; voice < 8; ++voice) {
                    const packed = readApuBadpFrameAt(voices[voice], frame) >>> 0;
                    events.push([1, epoch, voice, frame, 0, 0, packed, 0,
                        ...decoderFields(voices[voice].badp)]);
                }
                continue;
            }
            let sumLeft = 0, sumRight = 0;
            for (const actual of mixer.captureState().voices) {
                let cursor = actual.cursorQ16;
                if (spec.loopEnd > spec.loopStart) {
                    const length = (spec.loopEnd - spec.loopStart) * 65536;
                    const relative = (cursor - spec.loopStart * 65536) % length;
                    cursor = spec.loopStart * 65536 + (relative < 0 ? relative + length : relative);
                }
                const fraction = cursor % 65536;
                const current = (cursor - fraction) / 65536;
                let neighbor = current + 1;
                if (spec.loopEnd > spec.loopStart && neighbor >= spec.loopEnd) neighbor = spec.loopStart;
                else if (spec.loopEnd <= spec.loopStart && neighbor >= spec.sourceFrames) neighbor = current;
                const target = voices[actual.slot];
                const packedCurrent = readApuBadpFrameAt(target, current) >>> 0;
                const packedNeighbor = neighbor === current ? packedCurrent : readApuBadpFrameAt(target, neighbor) >>> 0;
                events.push([2, epoch, actual.slot, current, neighbor, fraction,
                    packedCurrent, packedNeighbor, ...decoderFields(target.badp)]);
                sumLeft += interpolateApuPcmSample((packedCurrent << 16) >> 16,
                    (packedNeighbor << 16) >> 16, fraction) * 512;
                sumRight += interpolateApuPcmSample(packedCurrent >> 16, packedNeighbor >> 16, fraction) * 512;
            }
            assert.equal(mixer.renderMachineFrames(1, epoch), 0);
            const expectedLeft = clamp(shiftRightSigned(sumLeft, 12), -32768, 32767);
            const expectedRight = clamp(shiftRightSigned(sumRight, 12), -32768, 32767);
            assert.equal(mixer.outputRing.readFramePacked(),
                ((expectedLeft & 0xffff) | ((expectedRight & 0xffff) << 16)) >>> 0, `${spec.id} output ${epoch}`);
            for (const actual of mixer.captureState().voices)
                assert.deepEqual(decoderFields(voices[actual.slot].badp), decoderFields(actual.badp), `${spec.id} state ${epoch}`);
        }
        process.stdout.write(`${spec.id} ${initialImage.length / 4} 8 ${events.length}\n`);
        for (let byte = 0; byte < initialImage.length; byte += 1024) {
            const words: string[] = [];
            for (let address = byte; address < byte + 1024 && address < initialImage.length; address += 4)
                words.push(readLE32(initialImage, address).toString(16).padStart(8, '0'));
            process.stdout.write(`${words.join(' ')}\n`);
        }
        for (const descriptor of descriptors) process.stdout.write(`${descriptor.join(' ')}\n`);
        for (const event of events) process.stdout.write(`${event.join(' ')}\n`);
    }
}

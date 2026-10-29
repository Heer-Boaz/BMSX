// Proposed packed Q2.14 L/R control applied to current Q12 master gain.
// Compare unity-control cases directly to the unmodified TS mixer. Non-unity
// follows the stated candidate arithmetic through centrally owned numeric
// operations; this is not a public BMSX contract or full fade/voice pipeline.
import { clamp } from '../../machine/ts/common/clamp';
import { lowSignedHalfword, highSignedHalfword, toSignedWord, shiftRightSigned } from '../../machine/ts/machine/common/numeric';
import { writeLE16 } from '../../machine/ts/common/endian';
import { ApuOutputMixer } from '../../machine/ts/machine/devices/audio/output';
import { APU_PARAMETER_REGISTER_COUNT, APU_PARAMETER_GAIN_Q12_INDEX,
    APU_PARAMETER_RATE_STEP_Q16_INDEX } from '../../machine/ts/spec/audio/apu';

const cases = 768;
let seed = 0x81f7ac95;
function random(): number {
    seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5;
    return seed >>> 0;
}
function hex(value: number, digits: number): string {
    return (value >>> 0).toString(16).padStart(digits, '0');
}
process.stdout.write(`${cases}\n`);
for (let n = 0; n < cases; n++) {
    const legacy = n % 5 === 0;
    const mixer = legacy ? new ApuOutputMixer() : undefined;
    const regs = new Uint32Array(APU_PARAMETER_REGISTER_COUNT);
    regs[APU_PARAMETER_RATE_STEP_Q16_INDEX] = 0x10000;
    let mixLeft = 0, mixRight = 0, lines = '';
    for (let slot = 0; slot < 16; slot++) {
        let active = (random() & 3) !== 0;
        let left = random() & 0xffff;
        let right = random() & 0xffff;
        let gain = random();
        let levels = legacy ? 0x40004000 : random();
        if (n === 0) active = false;
        if (n === 1) { active = slot === 0; left = right = 10000; gain = 4096; levels = 0x00004000; }
        if (n === 2) { active = slot === 0; left = right = 10000; gain = 4096; levels = 0x40000000; }
        if (n === 3) { active = slot < 4; left = right = 5000; gain = 4096; levels = 0xc0004000; }
        if (n === 4) { active = true; left = 0x8000; right = 0x7fff; gain = 0x80000000; levels = 0x80008000; }
        if (n === 6) { active = slot < 2; left = 1; right = 0xffff; gain = 0xffffffff; levels = 0x00010001; }
        if (n === 7) { active = true; left = 0x7fff; right = 0x8000; gain = 0x7fffffff; levels = 0x80007fff; }
        if (n >= 11 && n <= 30 && !legacy) {
            // Successive inputs resembling a descending master-fade sequence;
            // this does not implement or prove the separate fade-state owner.
            active = slot < 8; left = 3000 + slot; right = 0xffff - slot;
            gain = (4096 - (n - 11) * 192) >>> 0; levels = 0x20004000;
        }
        if (active) {
            const signedGain = toSignedWord(gain);
            const gainLeft = shiftRightSigned(signedGain * lowSignedHalfword(levels), 14);
            const gainRight = shiftRightSigned(signedGain * highSignedHalfword(levels), 14);
            mixLeft += lowSignedHalfword(left) * gainLeft;
            mixRight += lowSignedHalfword(right) * gainRight;
            if (mixer) {
                const bytes = new Uint8Array(4);
                writeLE16(bytes, 0, left); writeLE16(bytes, 2, right);
                regs[APU_PARAMETER_GAIN_Q12_INDEX] = gain;
                mixer.playVoice(slot, {
                    sourceAddr: 0x40000000 + slot * 4, sourceBytes: 4,
                    sampleRateHz: 44100, channels: 2, bitsPerSample: 16,
                    frameCount: 1, dataOffset: 0, dataBytes: 4,
                    loopStartSample: 0, loopEndSample: 0,
                    generatorKind: 0, generatorDutyQ12: 0,
                }, { bytes, byteOffset: 0, byteLength: 4, cartridgeSlot: 0 }, regs);
            }
        }
        lines += `${active ? 1 : 0} ${hex(left, 4)} ${hex(right, 4)} ${hex(gain, 8)} ${hex(levels, 8)}\n`;
    }
    const outLeft = clamp(shiftRightSigned(mixLeft, 12), -0x8000, 0x7fff);
    const outRight = clamp(shiftRightSigned(mixRight, 12), -0x8000, 0x7fff);
    const expected = (((outRight & 0xffff) << 16) | (outLeft & 0xffff)) >>> 0;
    if (mixer) {
        mixer.renderMachineFrames(1, 0);
        const actual = mixer.outputRing.readFramePacked();
        if (actual !== expected) throw new Error(`legacy-unity case ${n}: ${hex(actual, 8)} != ${hex(expected, 8)}`);
    }
    process.stdout.write(`${legacy ? 1 : 0}\n${lines}${hex(expected, 8)}\n`);
}

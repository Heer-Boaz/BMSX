// Vector producer uses the actual TS ApuOutputMixer on one-frame PCM16 stereo
// sources. The RTL under test receives the exact decoded slot samples and gain
// words; this is a gain/mix datapath comparison, not a source/playback test.
import { ApuOutputMixer } from '../../machine/ts/machine/devices/audio/output.ts';
import { writeLE16 } from '../../machine/ts/common/endian.ts';
import { APU_PARAMETER_REGISTER_COUNT, APU_PARAMETER_GAIN_Q12_INDEX,
    APU_PARAMETER_RATE_STEP_Q16_INDEX } from '../../machine/ts/spec/audio/apu.ts';

const cases = 512;
let seed = 0x8dbe3197;
function random(): number {
    seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5;
    return seed >>> 0;
}
function hex(value: number, digits: number): string {
    return (value >>> 0).toString(16).padStart(digits, '0');
}
process.stdout.write(`${cases}\n`);
for (let n = 0; n < cases; n++) {
    const mixer = new ApuOutputMixer();
    const regs = new Uint32Array(APU_PARAMETER_REGISTER_COUNT);
    regs[APU_PARAMETER_RATE_STEP_Q16_INDEX] = 0x10000;
    let lines = '';
    for (let slot = 0; slot < 16; slot++) {
        let active = (random() & 3) !== 0;
        let left = random() & 0xffff;
        let right = random() & 0xffff;
        let gain = n % 3 === 0 ? random() : (random() % 16385) - 8192;
        if (n === 0) active = false;
        if (n === 1) { active = slot < 2; left = 1; right = 0xffff; gain = 2048; }
        if (n === 2) { active = slot < 2; left = 20000; right = 0xb1e0; gain = 4096; }
        if (n === 3) { active = true; left = 0x8000; right = 0x7fff; gain = 0x80000000; }
        if (n === 4) { active = slot < 8; left = 0x8000; right = 0x7fff; gain = slot & 1 ? 0x80000000 : 0x7fffffff; }
        regs[APU_PARAMETER_GAIN_Q12_INDEX] = gain >>> 0;
        if (active) {
            const bytes = new Uint8Array(4);
            writeLE16(bytes, 0, left);writeLE16(bytes, 2, right);
            mixer.playVoice(slot, {
                sourceAddr: 0x40000000 + 4 * slot, sourceBytes: 4,
                sampleRateHz: 44100, channels: 2, bitsPerSample: 16,
                frameCount: 1, dataOffset: 0, dataBytes: 4,
                loopStartSample: 0, loopEndSample: 0,
                generatorKind: 0, generatorDutyQ12: 0,
            }, { bytes, byteOffset: 0, byteLength: 4, cartridgeSlot: 0 }, regs);
        }
        lines += `${active ? 1 : 0} ${hex(left,4)} ${hex(right,4)} ${hex(gain,8)}\n`;
    }
    mixer.renderMachineFrames(1, 0);
    process.stdout.write(lines + hex(mixer.outputRing.readFramePacked(), 8) + '\n');
}

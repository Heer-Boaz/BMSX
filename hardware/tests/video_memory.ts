// Probe the actual address owner; do not copy its address encoding here.
import assert from 'node:assert/strict';
import { gxGpuLocalMemoryAddress32, gxGpuLocalMemoryAddressGpu24 }
    from '../../machine/ts/machine/devices/gx/gpu_local_memory.ts';

let checks = 0;
// All low-coordinate residues. Higher page/block/base terms are even.
for (const base of [0, 511 * 4096]) {
    for (const width of [0, 16, 63]) {
        for (let y = 0; y < 32; ++y) {
            for (let x = 0; x < 64; ++x) {
                const address = gxGpuLocalMemoryAddress32(base, width, x, y);
                assert.equal(address & 1, 0);
                assert.equal(address >>> 1, ((address + 1) & 0xfffff) >>> 1);
                ++checks;
            }
        }
    }
}
const physicalReads = new Set<number>();
for (let sample = 0; sample < 640; ++sample) {
    const x = sample * 4;
    const words = [gxGpuLocalMemoryAddressGpu24(0, 16, x, 0, 0) >>> 1,
        gxGpuLocalMemoryAddressGpu24(0, 16, x, 0, 1) >>> 1,
        gxGpuLocalMemoryAddress32(0x80000, 16, x, 0) >>> 1];
    assert.equal(new Set(words).size, 3);
    for (const word of words) physicalReads.add(word);
}
assert.equal(checks, 12288);
assert.equal(physicalReads.size, 1920);
console.log(JSON.stringify({owner: 'TypeScript', alignment_residue_checks: checks,
    profile_samples: 640, distinct_32bit_reads: physicalReads.size,
    maximum_reads_per_profile_sample: 3}));

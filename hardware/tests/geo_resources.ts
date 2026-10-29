// Count the real owners' memory operations; fixture preparation/result inspection
// bypass only the counters, not processRecord's actual Memory implementation.
import assert from 'node:assert/strict';
import { readLE32, writeLE32 } from '../../machine/ts/common/endian.ts';
import { Memory } from '../../machine/ts/machine/memory/memory.ts';
import { GeometryXform2Unit } from '../../machine/ts/machine/devices/geometry/xform2.ts';
import { GeometrySat2Unit } from '../../machine/ts/machine/devices/geometry/sat2.ts';
import type { GeometryJobState } from '../../machine/ts/machine/devices/geometry/job.ts';
import {
    GEO_SHAPE_CONVEX_POLY, GEO_VERTEX2_BYTES, GEO_XFORM2_RECORD_BYTES,
    GEO_XFORM2_MATRIX_BYTES, GEO_XFORM2_MAX_VERTICES, GEO_SAT2_PAIR_BYTES,
    GEO_SAT2_DESC_BYTES, GEO_SAT2_RESULT_WORDS, IO_CMD_GEO_XFORM2_BATCH,
    IO_CMD_GEO_SAT2_BATCH,
} from '../../machine/ts/machine/devices/geometry/contracts.ts';
import { cyclesUntilBudgetUnits } from '../../machine/ts/machine/scheduler/budget.ts';
import { RAM_BASE, GEO_SCRATCH_BASE } from '../../machine/ts/spec/bmsx/memory_map.ts';
import { PSX_MACHINE_SPEC } from '../../machine/ts/spec/bmsx/model.ts';

class CountedMemory extends Memory {
    public reads = 0;
    public writes = 0;
    public readonly readAddresses = new Set<number>();
    public readonly writeAddresses = new Set<number>();

    public override readU32(address: number): number {
        ++this.reads;
        this.readAddresses.add(address);
        return super.readU32(address);
    }

    public override writeU32(address: number, word: number): void {
        ++this.writes;
        this.writeAddresses.add(address);
        super.writeU32(address, word);
    }
}

const memory = new CountedMemory({ systemRom: new Uint8Array(0),
    cartridgeSlots: [null, null] }, PSX_MACHINE_SPEC.ramBytes);
const ram = memory.ramData();
const count = GEO_XFORM2_MAX_VERTICES;
const record = GEO_SCRATCH_BASE;
const vertices = GEO_SCRATCH_BASE + 0x1000;
const matrix = GEO_SCRATCH_BASE + 0x2000;
const transformed = GEO_SCRATCH_BASE + 0x3000;
const bounds = GEO_SCRATCH_BASE + 0x4000;
const pair = GEO_SCRATCH_BASE + 0x5000;
const descriptors = GEO_SCRATCH_BASE + 0x6000;
const result = GEO_SCRATCH_BASE + 0x7000;

// The parabola chain and closing chord form a strictly convex 64-gon. Every
// coordinate is an exactly representable raw Q16 word; no trig/converter shim.
for (let i = 0; i < count; ++i) {
    writeLE32(ram, vertices - RAM_BASE + i * GEO_VERTEX2_BYTES, i << 16);
    writeLE32(ram, vertices - RAM_BASE + i * GEO_VERTEX2_BYTES + 4, (i * i) << 16);
}
for (const [i, word] of [0, 0, 0, 0, count, 0].entries())
    writeLE32(ram, record - RAM_BASE + i * 4, word);
for (const [i, word] of [0x10000, 0, 0, 0, 0x10000, 0].entries())
    writeLE32(ram, matrix - RAM_BASE + i * 4, word);

const xformJob: GeometryJobState = {
    cmd: IO_CMD_GEO_XFORM2_BATCH, src0: record, src1: vertices, src2: matrix,
    dst0: transformed, dst1: bounds, count: 1, param0: 0, param1: 0,
    stride0: GEO_XFORM2_RECORD_BYTES, stride1: GEO_VERTEX2_BYTES,
    stride2: GEO_XFORM2_MATRIX_BYTES, processed: 0, resultCount: 0,
    exactPairCount: 0, broadphasePairCount: 0,
};
assert.equal(new GeometryXform2Unit(memory).processRecord(xformJob), 0);
assert.equal(memory.reads, 140);
assert.equal(memory.writes, 132);
assert.equal(memory.readAddresses.size, 140);
assert.equal(memory.writeAddresses.size, 132);
for (let i = 0; i < count; ++i) {
    assert.equal(readLE32(ram, transformed - RAM_BASE + i * GEO_VERTEX2_BYTES), i << 16);
    assert.equal(readLE32(ram, transformed - RAM_BASE + i * GEO_VERTEX2_BYTES + 4), (i * i) << 16);
}
const boundsWords = Array.from({ length: 4 }, (_, i) => readLE32(ram, bounds - RAM_BASE + i * 4));
assert.deepEqual(boundsWords, [0, 0, 63 << 16, (63 * 63) << 16]);
const xformReport = { vertices: count, reads_u32: memory.reads, writes_u32: memory.writes,
    distinct_input_words: memory.readAddresses.size, distinct_output_words: memory.writeAddresses.size,
    signed_32x32_products: 4 * count, bounds_words: boundsWords };

for (const [i, word] of [0, 0, 0, 1, 0].entries())
    writeLE32(ram, pair - RAM_BASE + i * 4, word);
for (const [i, word] of [GEO_SHAPE_CONVEX_POLY, count, 0, 0,
    GEO_SHAPE_CONVEX_POLY, count, transformed - vertices, 0].entries())
    writeLE32(ram, descriptors - RAM_BASE + i * 4, word);
const satJob: GeometryJobState = {
    cmd: IO_CMD_GEO_SAT2_BATCH, src0: pair, src1: descriptors, src2: vertices,
    dst0: result, dst1: 0, count: 1, param0: 0, param1: 0,
    stride0: GEO_SAT2_PAIR_BYTES, stride1: GEO_SAT2_DESC_BYTES, stride2: 0,
    processed: 0, resultCount: 0, exactPairCount: 0, broadphasePairCount: 0,
};
memory.reads = 0;
memory.writes = 0;
memory.readAddresses.clear();
memory.writeAddresses.clear();
assert.equal(new GeometrySat2Unit(memory).processRecord(satJob), 0);
assert.equal(memory.reads, 33549);
assert.equal(memory.writes, 5);
assert.equal(memory.readAddresses.size, 269);
assert.equal(memory.writeAddresses.size, 5);
const satWords = Array.from({ length: GEO_SAT2_RESULT_WORDS }, (_, i) => readLE32(ram, result - RAM_BASE + i * 4));
assert.equal(satWords[0], 1);
// The minimum-width axis is the parabola's middle tangent/closing-chord
// normal. The owner uses FP64, then its specified nearest/saturating Q16 output.
assert.equal(satWords[3], 1031802);
assert.equal(satWords[4], 31);
assert.equal(satWords[1], 0xffff0008);
assert.equal(satWords[2], 1040);
const axes = 2 * count;
const satReport = { vertices_a: count, vertices_b: count, reads_u32: memory.reads,
    writes_u32: memory.writes, distinct_input_words: memory.readAddresses.size,
    distinct_output_words: memory.writeAddresses.size, fp64_dot_products: axes * axes,
    fp64_square_roots: axes, fp64_divisions: 2 * axes + 4, result_words: satWords };

const countOneCharge = cyclesUntilBudgetUnits(PSX_MACHINE_SPEC.cpuFreqHz,
    PSX_MACHINE_SPEC.geoWorkUnitsPerSec, 0, 1);
assert.equal(countOneCharge, 3);
console.log(JSON.stringify({ owner: 'TypeScript Memory + GeometryXform2Unit + GeometrySat2Unit',
    system_hz: PSX_MACHINE_SPEC.cpuFreqHz, public_outer_records_per_second: PSX_MACHINE_SPEC.geoWorkUnitsPerSec,
    public_count_one_processing_charge_cycles: countOneCharge, xform64: xformReport, sat64_identical: satReport,
    engineering_interpretation: {
        optimistic_transfer_assumption: 'One 32-bit memory word per CORE clock, no setup, refresh, arbitration or arithmetic stalls; not a guaranteed physical deadline.',
        xform_cold_words_under_assumption: xformReport.distinct_input_words + xformReport.distinct_output_words,
        sat_cold_words_with_complete_vertex_reuse_under_assumption: satReport.distinct_input_words + satReport.distinct_output_words,
        cache_boundary: '33549 SAT reads are actual uncached software-owner calls, not an unavoidable physical-memory lower bound. Local vertex reuse can reduce reads; externally addressed results still require their writes.',
        arithmetic_boundary: '256 XFORM products describe work, not 256 mandatory clocks: lane count and unit latency are not specified here.',
        scope: 'Resource evidence only; no emulator timing change, ASIC implementation or sign-off.',
    } }));

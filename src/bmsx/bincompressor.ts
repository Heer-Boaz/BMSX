interface CompressorOptions {
    windowSize?: number; // Size of the LZ77 window
    minMatch?: number; // Minimum match length
    maxMatch?: number; // Maximum match length
    rleThreshold?: number; // RLE threshold
    disableLZ77?: boolean; // Disable LZ77 compression
    disableRLE?: boolean; // Disable RLE compression
};

export const optimalGameStateCompressorOptions: CompressorOptions = {
    windowSize: 2048, // Size of the LZ77 window
    minMatch: 4, // Minimum match length
    maxMatch: 255, // Maximum match length
    rleThreshold: 4, // RLE threshold
    disableLZ77: false, // Disable LZ77 compression
    disableRLE: false, // Disable RLE compression
};

export const optimalRompakCompressorOptions: CompressorOptions = {
    windowSize: 4048, // Size of the LZ77 window
    minMatch: 4, // Minimum match length
    maxMatch: 255, // Maximum match length
    rleThreshold: 8, // RLE threshold
    disableLZ77: false, // Disable LZ77 compression
    disableRLE: false, // Disable RLE compression
};

export class BinaryCompressor {
    static readonly WINDOW_SIZE = 2048; // Size of the LZ77 window
    static readonly MIN_MATCH = 4; // Minimum match length
    static readonly MAX_MATCH = 255; // Maximum match length
    static readonly MAX_RUN = 255; // Maximum run length
    static readonly RLE_THRESHOLD = 4; // RLE threshold
    static COMPRESS_SCRATCH = new Uint8Array(9000); // initial size, will grow as needed
    static readonly CURRENT_VERSION = 0x01; // Current version of the compressor
    static readonly MAGIC_HEADER = new Uint8Array([0x42, 0x43, BinaryCompressor.CURRENT_VERSION]); // "BC" v1

    /**
     * Compresses a Uint8Array using RLE and LZ77 with a hash table for fast match search.
     * @param input The input data to compress.
     * @param options Optional tuning parameters.
     */
    static compressBinary(input: Uint8Array, options?: CompressorOptions): Uint8Array {
        const DISABLE_LZ77 = options?.disableLZ77 ?? false;
        const DISABLE_RLE = options?.disableRLE ?? false;
        const WINDOW_SIZE = options?.windowSize ?? this.WINDOW_SIZE;
        const MIN_MATCH = options?.minMatch ?? this.MIN_MATCH;
        const MAX_MATCH = options?.maxMatch ?? this.MAX_MATCH;
        const RLE_THRESHOLD = options?.rleThreshold ?? this.RLE_THRESHOLD;
        // Grow the scratch buffer if needed
        if (this.COMPRESS_SCRATCH.length < input.length * 2) {
            this.COMPRESS_SCRATCH = new Uint8Array(input.length * 2);
        }
        // Write magic header
        for (let i = 0; i < this.MAGIC_HEADER.length; ++i) {
            this.COMPRESS_SCRATCH[i] = this.MAGIC_HEADER[i];
        }
        let rp = 0; // read pointer for input
        let wp = this.MAGIC_HEADER.length; // write pointer for output (COMPRESS_SCRATCH)

        // --- Hash table for fast LZ77 search (12-bit hash, covers 4096 entries) ---
        const HASH_BITS = 12;
        const HASH_SIZE = 1 << HASH_BITS;
        const hashTable = new Uint32Array(HASH_SIZE);
        hashTable.fill(0xFFFFFFFF); // 0xFFFFFFFF = invalid
        function hash4(a: number, b: number, c: number, d: number) {
            // Simple rolling hash for 4 bytes
            return ((a * 31 + b * 17 + c * 13 + d) & (HASH_SIZE - 1));
        }

        console.debug(`[COMPRESS START] input.length=${input.length}`);
        let lastRp = -1;
        let iterations = 0;
        const maxIterations = input.length * 2 + 10000;
        while (rp < input.length) {
            if (iterations++ > maxIterations) {
                throw new Error(`compressBinary: Exceeded max iterations (${maxIterations}), possible infinite loop. rp=${rp}, input.length=${input.length}`);
            }
            const rpBefore = rp;
            // ---- optional RLE pass ---------------------------------------
            let run = 1;
            if (!DISABLE_RLE) {
                while (rp + run < input.length && input[rp + run] === input[rp] && run < this.MAX_RUN) run++;
                if (run >= RLE_THRESHOLD) {
                    // console.debug(`[RLE] rp=${rp} run=${run} val=${input[rp]}`);
                    this.COMPRESS_SCRATCH[wp++] = 0xFF;
                    this.COMPRESS_SCRATCH[wp++] = run;
                    this.COMPRESS_SCRATCH[wp++] = input[rp];
                    rp += run;
                    continue;
                }
            }

            // ---- optionally skip LZ77 for debugging --------------------------------
            let bestLen = 0, bestOff = 0;
            if (!DISABLE_LZ77) {
                /* ---- LZ77 with hash table --------------------------------------- */
                let candidate = -1;
                if (rp + MIN_MATCH <= input.length) {
                    const h = hash4(input[rp], input[rp + 1], input[rp + 2], input[rp + 3]);
                    candidate = hashTable[h];
                    hashTable[h] = rp;
                    if (candidate !== 0xFFFFFFFF && candidate < rp && rp - candidate <= WINDOW_SIZE) {
                        let ml = 0;
                        while (ml < MAX_MATCH && rp + ml < input.length && input[candidate + ml] === input[rp + ml]) ml++;
                        if (ml >= MIN_MATCH) {
                            bestLen = ml;
                            bestOff = rp - candidate;
                        }
                    }
                }
                // Brute-force fallback removed for efficiency
            }
            // If LZ77 produced a match, emit it
            if (bestLen >= MIN_MATCH) {
                if (bestOff > 0xFFFF) {
                    throw new Error("Offset too large for LZ77 compression");
                }
                // console.debug(`[LZ77] rp=${rp} bestLen=${bestLen} bestOff=${bestOff}`);
                this.COMPRESS_SCRATCH[wp++] = 0xFE; // LZ77 tag
                this.COMPRESS_SCRATCH[wp++] = bestOff & 0xFF; // offset low byte
                this.COMPRESS_SCRATCH[wp++] = bestOff >> 8; // offset high byte
                this.COMPRESS_SCRATCH[wp++] = bestLen - MIN_MATCH; // length - MIN_MATCH
                rp += bestLen;
                continue;
            }

            /* ---- literal / escape ------------------------------------------ */
            const byte = input[rp++];
            if (byte >= 0xFD) {                    // escape: FD, FE, FF
                // console.debug(`[ESCAPE] rp=${rp - 1} byte=${byte}`);
                this.COMPRESS_SCRATCH[wp++] = 0xFD; // escape tag
                this.COMPRESS_SCRATCH[wp++] = byte;
            } else {
                // console.debug(`[LITERAL] rp=${rp - 1} byte=${byte}`);
                this.COMPRESS_SCRATCH[wp++] = byte;
            }
            if (rp === rpBefore) {
                throw new Error(`compressBinary: rp did not advance at rp=${rp}, possible infinite loop.`);
            }
        }
        console.debug(`[COMPRESS END] final rp=${rp}, output.length=${wp}`);
        return new Uint8Array(this.COMPRESS_SCRATCH.slice(0, wp));
    }

    /**
     * Decompresses a Uint8Array produced by compressBinary.
     * Uses a preallocated output buffer for speed and memory efficiency.
     * Throws on malformed input.
     */
    static decompressBinary(input: Uint8Array): Uint8Array {
        // Check magic header
        if (input.length < this.MAGIC_HEADER.length) throw new Error("Input too short for magic header");
        for (let i = 0; i < this.MAGIC_HEADER.length; ++i) {
            if (input[i] !== this.MAGIC_HEADER[i]) throw new Error("Missing or invalid magic header/version");
        }
        let pos = this.MAGIC_HEADER.length;
        // Preallocate output buffer (input.length * 3 is a safe upper bound for most data)
        let out = new Uint8Array(input.length * 3);
        let outPos = 0;
        while (pos < input.length) {
            const tag = input[pos++];
            if (tag === 0xFF) { // RLE
                if (pos + 2 > input.length) throw new Error("Malformed RLE tag");
                const run = input[pos++];
                const val = input[pos++];
                if (outPos + run > out.length) {
                    // Grow output buffer
                    const newOut = new Uint8Array(out.length * 2);
                    newOut.set(out, 0);
                    out = newOut;
                }
                // Fast fill for RLE
                out.fill(val, outPos, outPos + run);
                outPos += run;
            } else if (tag === 0xFE) { // LZ77
                if (pos + 3 > input.length) throw new Error("Malformed LZ77 tag");
                const off = input[pos++] | (input[pos++] << 8);
                const len = input[pos++] + this.MIN_MATCH;
                const start = outPos - off;
                if (start < 0 || outPos + len > out.length) {
                    // Grow output buffer if needed
                    if (outPos + len > out.length) {
                        const newOut = new Uint8Array((out.length + len) * 2);
                        newOut.set(out, 0);
                        out = newOut;
                    }
                    if (start < 0) throw new Error("LZ77 offset out of bounds");
                }
                // Correct copy for overlapping regions
                for (let i = 0; i < len; ++i) {
                    out[outPos + i] = out[start + i];
                }
                outPos += len;
            } else if (tag === 0xFD) { // escaped literal
                if (pos >= input.length) throw new Error("Malformed escape tag");
                out[outPos++] = input[pos++];
            } else { // literal
                out[outPos++] = tag;
            }
        }
        return out.subarray(0, outPos);
    }

    /**
     * Test function: compresses and decompresses all possible byte values (0x00-0xFF) and checks for lossless round-trip.
     * Logs the result to the console. Returns true if successful, false otherwise.
     */
    static testRoundTrip(): boolean {
        const original = new Uint8Array(256);
        for (let i = 0; i < 256; ++i) original[i] = i;
        const compressed = this.compressBinary(original);
        const decompressed = this.decompressBinary(compressed);
        let ok = decompressed.length === original.length;
        for (let i = 0; i < original.length && ok; ++i) {
            if (original[i] !== decompressed[i]) {
                console.error(`Mismatch at index ${i}: original=${original[i]}, decompressed=${decompressed[i]}`);
                ok = false;
            }
        }
        if (ok) {
            console.log("BinaryCompressor round-trip test PASSED.");
        } else {
            console.error("BinaryCompressor round-trip test FAILED.");
        }
        return ok;
    }

    /**
     * Test function: encodes a sample object to binary, compresses, decompresses, decodes, and checks for round-trip equality.
     * Logs the result to the console. Returns true if successful, false otherwise.
     */
    static testFullPipeline(): boolean {
        // Import here to avoid circular import issues if any
        // @ts-ignore
        const { encodeBinary, decodeBinary } = require('./binencoder');
        // Use a sample object with various types and nested structure
        const sample = {
            a: 42,
            b: "hello",
            c: [1, 2, 3, 0xFD, 0xFE, 0xFF],
            d: { x: true, y: null, z: undefined },
            e: new Uint8Array([0, 1, 2, 0xFD, 0xFE, 0xFF]),
        };
        const encoded = encodeBinary(sample);
        const compressed = this.compressBinary(encoded);
        const decompressed = this.decompressBinary(compressed);
        // Check that decompressed is byte-for-byte identical to encoded
        let ok = decompressed.length === encoded.length;
        for (let i = 0; i < encoded.length && ok; ++i) {
            if (encoded[i] !== decompressed[i]) {
                console.error(`Mismatch in binary at index ${i}: encoded=${encoded[i]}, decompressed=${decompressed[i]}`);
                ok = false;
            }
        }
        if (!ok) {
            console.error("BinaryCompressor full pipeline test FAILED (binary mismatch before decode).\n");
            return false;
        }
        // Now decode and compare to original object (shallow equality)
        const decoded = decodeBinary(decompressed);
        // Simple shallow check (deep equality would require a helper)
        function shallowEqual(a: any, b: any): boolean {
            if (typeof a !== typeof b) {
                // Special case: treat undefined, null, and missing as equivalent
                if ((a === undefined || a === null || a === void 0) && (b === undefined || b === null || b === void 0)) return true;
                return false;
            }
            if (a === b) return true;
            if (Array.isArray(a) && Array.isArray(b)) {
                if (a.length !== b.length) return false;
                for (let i = 0; i < a.length; ++i) if (!shallowEqual(a[i], b[i])) return false;
                return true;
            }
            if (a instanceof Uint8Array && b instanceof Uint8Array) {
                if (a.length !== b.length) return false;
                for (let i = 0; i < a.length; ++i) if (a[i] !== b[i]) return false;
                return true;
            }
            if (typeof a === 'object' && typeof b === 'object') {
                const ka = Object.keys(a), kb = Object.keys(b);
                // Accept missing or undefined/null properties as equivalent
                const allKeys = new Set([...ka, ...kb]);
                for (const k of allKeys) {
                    const va = a[k], vb = b[k];
                    if ((va === undefined || va === null) && (vb === undefined || vb === null)) continue;
                    if (!shallowEqual(va, vb)) return false;
                }
                return true;
            }
            return false;
        }
        const ok2 = shallowEqual(sample, decoded);
        if (ok2) {
            console.log("BinaryCompressor full pipeline test PASSED.");
        } else {
            console.error("BinaryCompressor full pipeline test FAILED (object mismatch after decode).\nSample:", sample, "\nDecoded:", decoded);
        }
        return ok && ok2;
    }

    static findBug(state: any): void {
        // 'state' is already the raw Uint8Array buffer
        const raw = state as Uint8Array;
        const rawCopy = new Uint8Array(raw.length);
        for (let i = 0; i < raw.length; i++) {
            rawCopy[i] = raw[i];
        }

        const compressed = BinaryCompressor.compressBinary(rawCopy, {
            disableLZ77: true,
            disableRLE: false
        });
        const round = BinaryCompressor.decompressBinary(compressed);
        let idx = 0;
        for (let i = 0; i < rawCopy.length; i++) {
            if (rawCopy[i] !== round[i]) {
                console.error('Mismatch at', i, 'raw=', rawCopy[i], 'dec=', round[i]);
                idx = i;
                const start = Math.max(0, idx - 16);
                console.log(
                    'raw:', Array.from(rawCopy.subarray(start, start + 32)).map(b => b.toString(16)),
                    'round:', Array.from(round.subarray(start, start + 32)).map(b => b.toString(16))
                );
                debugger;
                break;
            }
        }
    }

    /**
     * Test function: compresses and decompresses a real JSON string as UTF-8, checks for lossless round-trip.
     * Logs the result to the console. Returns true if successful, false otherwise.
     */
    static testJsonUtf8RoundTrip(): boolean {
        const json = '[{"resid":1,"resname":"b","type":"image","imgmeta":{"atlassed":true,"atlasid":0,"width":15,"height":19,"boundingbox":{"original":{"start":{"x":0,"y":0},"end":{"x":14,"y":18}},"fliph":{"start":{"x":1,"y":0},"end":{"x":15,"y":18}},"flipv":{"start":{"x":0,"y":1},"end":{"x":14,"y":19}},"fliphv":{"start":{"x":1,"y":1},"end":{"x":15,"y":19}}},"centerpoint":{"x":7,"y":9},"texcoords":[0,0,1,0,0,0.487179487179,0,0.487179487179,1,0,1,0.487179487179],"texcoords_fliph":[1,0,0,0,1,0.487179487179,1,0,0,0,1,0.487179487179],"texcoords_flipv":[0,1,1,1,0,0.487179487179,0,0.487179487179,1,1,1,0.487179487179],"texcoords_fliphv":[1,1,0,1,1,0.487179487179,1,0.487179487179,0,1,0,0.487179487179]},"start":0,"end":1234}]';
        const encoder = new TextEncoder();
        const decoder = new TextDecoder('utf-8');
        const original = encoder.encode(json);
        const compressed = this.compressBinary(original);
        const decompressed = this.decompressBinary(compressed);
        const roundtrip = decoder.decode(decompressed);
        const ok = roundtrip === json;
        if (ok) {
            console.log('BinaryCompressor JSON UTF-8 round-trip test PASSED.');
        } else {
            console.error('BinaryCompressor JSON UTF-8 round-trip test FAILED.');
            for (let i = 0; i < Math.min(original.length, decompressed.length); ++i) {
                if (original[i] !== decompressed[i]) {
                    console.error('Mismatch at byte', i, 'original=', original[i], 'decompressed=', decompressed[i]);
                    break;
                }
            }
            console.error('Original:', json);
            console.error('Roundtrip:', roundtrip);
        }
        return ok;
    }

}

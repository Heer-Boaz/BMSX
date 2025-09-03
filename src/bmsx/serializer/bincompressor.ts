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
    // Hash tables reused across calls (12-bit = 4096)
    private static readonly HASH_BITS = 12;
    private static readonly HASH_SIZE = 1 << BinaryCompressor.HASH_BITS;
    private static _hashPos = new Uint32Array(BinaryCompressor.HASH_SIZE);
    private static _hashStamp = new Uint32Array(BinaryCompressor.HASH_SIZE);
    private static _globalStamp = 1;

    /**
     * Compresses a Uint8Array using RLE and LZ77 with a hash table for fast match search.
     * @param input The input data to compress.
     * @param options Optional tuning parameters.
     */

    static compressBinary(input: Uint8Array, options?: CompressorOptions): Uint8Array {
        // cache constants locally (avoid this.* lookups in hot loop)
        const DISABLE_LZ77 = options?.disableLZ77 === true;
        const DISABLE_RLE = options?.disableRLE === true;
        const WINDOW_SIZE = options?.windowSize ?? BinaryCompressor.WINDOW_SIZE;
        const MIN_MATCH = options?.minMatch ?? BinaryCompressor.MIN_MATCH;
        const MAX_MATCH = options?.maxMatch ?? BinaryCompressor.MAX_MATCH;
        const MAX_RUN = BinaryCompressor.MAX_RUN;
        const RLE_THRESHOLD = options?.rleThreshold ?? BinaryCompressor.RLE_THRESHOLD;

        // ensure output scratch capacity (grow x2)
        if (BinaryCompressor.COMPRESS_SCRATCH.length < (input.length + 8)) {
            const cap = Math.max(BinaryCompressor.COMPRESS_SCRATCH.length * 2, input.length * 2);
            BinaryCompressor.COMPRESS_SCRATCH = new Uint8Array(cap);
        }

        // write magic header
        BinaryCompressor.COMPRESS_SCRATCH.set(BinaryCompressor.MAGIC_HEADER, 0);

        let rp = 0;
        let wp = BinaryCompressor.MAGIC_HEADER.length;

        // stamp the hash tables instead of filling
        const hashPos = BinaryCompressor._hashPos;
        const hashStamp = BinaryCompressor._hashStamp;
        const myStamp = (++BinaryCompressor._globalStamp) >>> 0; // wrap naturally at 2^32

        // small inline 4-byte hash
        // assumes MIN_MATCH >= 4 (true here)
        const HASH_MASK = BinaryCompressor.HASH_SIZE - 1;
        const h4 = (a: number, b: number, c: number, d: number) =>
            ((a * 31 + (b << 1) + (c * 13) + d) & HASH_MASK) >>> 0;

        while (rp < input.length) {
            // ---- RLE
            if (!DISABLE_RLE) {
                let run = 1;
                const v = input[rp];
                // bounded run
                while ((rp + run) < input.length && input[rp + run] === v && run < MAX_RUN) run++;
                if (run >= RLE_THRESHOLD) {
                    BinaryCompressor.COMPRESS_SCRATCH[wp++] = 0xFF;
                    BinaryCompressor.COMPRESS_SCRATCH[wp++] = run;
                    BinaryCompressor.COMPRESS_SCRATCH[wp++] = v;
                    rp += run;
                    continue;
                }
            }

            // ---- LZ77 (single-candidate with hash)
            let bestLen = 0, bestOff = 0;
            if (!DISABLE_LZ77 && (rp + MIN_MATCH) <= input.length) {
                const a = input[rp], b = input[rp + 1], c = input[rp + 2], d = input[rp + 3];
                const h = h4(a, b, c, d);
                const seen = hashStamp[h] === myStamp;
                const cand = seen ? hashPos[h] : 0xFFFFFFFF;

                // update table with current pos
                hashStamp[h] = myStamp;
                hashPos[h] = rp;

                if (cand !== 0xFFFFFFFF && cand < rp) {
                    const off = rp - cand;
                    if (off <= WINDOW_SIZE) {
                        // word-wise compare, then byte tail
                        let ml = 0;
                        // fast 4-byte chunks
                        const u32in = new Uint32Array(input.buffer, 0, (input.byteLength / 4) | 0);
                        const rp32 = rp >>> 2, cd32 = cand >>> 2;
                        // only use u32 while aligned and within bounds
                        if (((rp | cand) & 3) === 0) {
                            const max32 = Math.min(
                                ((input.length - rp) >>> 2),
                                (MAX_MATCH >>> 2)
                            );
                            let k = 0;
                            while (k < max32 && u32in[cd32 + k] === u32in[rp32 + k]) k++;
                            ml = (k << 2);
                        }
                        // byte tail
                        while (ml < MAX_MATCH && (rp + ml) < input.length &&
                            input[cand + ml] === input[rp + ml]) ml++;

                        if (ml >= MIN_MATCH) { bestLen = ml; bestOff = off; }
                    }
                } else {
                    // first time we touch this slot
                    hashStamp[h] = myStamp;
                    hashPos[h] = rp;
                }
            }

            if (bestLen >= MIN_MATCH) {
                BinaryCompressor.COMPRESS_SCRATCH[wp++] = 0xFE;
                BinaryCompressor.COMPRESS_SCRATCH[wp++] = bestOff & 0xFF;
                BinaryCompressor.COMPRESS_SCRATCH[wp++] = bestOff >>> 8;
                BinaryCompressor.COMPRESS_SCRATCH[wp++] = bestLen - MIN_MATCH;
                rp += bestLen;
                continue;
            }

            // literal / escape
            const byte = input[rp++];
            if (byte >= 0xFD) {
                BinaryCompressor.COMPRESS_SCRATCH[wp++] = 0xFD;
                BinaryCompressor.COMPRESS_SCRATCH[wp++] = byte;
            } else {
                BinaryCompressor.COMPRESS_SCRATCH[wp++] = byte;
            }
        }

        // IMPORTANT: single copy, not double copy
        return BinaryCompressor.COMPRESS_SCRATCH.slice(0, wp);
    }

    /**
     * Decompresses a Uint8Array produced by compressBinary.
     * Uses a preallocated output buffer for speed and memory efficiency.
     * Throws on malformed input.
     */
    static decompressBinary(input: Uint8Array): Uint8Array {
        // header check unchanged …

        let pos = BinaryCompressor.MAGIC_HEADER.length;
        let out = new Uint8Array(input.length * 3);
        let outPos = 0;

        while (pos < input.length) {
            const tag = input[pos++];
            if (tag === 0xFF) {
                // RLE
                const run = input[pos++], val = input[pos++];
                if (outPos + run > out.length) {
                    const newOut = new Uint8Array(Math.max(out.length * 2, outPos + run));
                    newOut.set(out);
                    out = newOut;
                }
                out.fill(val, outPos, outPos + run);
                outPos += run;
            } else if (tag === 0xFE) {
                // LZ
                const off = input[pos++] | (input[pos++] << 8);
                const len = input[pos++] + BinaryCompressor.MIN_MATCH;
                const start = outPos - off;

                if (start < 0) throw new Error("LZ77 offset out of bounds");
                if (outPos + len > out.length) {
                    const newOut = new Uint8Array(Math.max(out.length * 2, outPos + len));
                    newOut.set(out);
                    out = newOut;
                }

                // Non-overlap fast path
                if (off >= len) {
                    out.set(out.subarray(start, start + len), outPos);
                } else {
                    // overlap-safe copy
                    for (let i = 0; i < len; i++) out[outPos + i] = out[start + i];
                }
                outPos += len;
            } else if (tag === 0xFD) {
                out[outPos++] = input[pos++]; // escaped literal
            } else {
                out[outPos++] = tag;          // literal
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
            d: ({ x: true, y: null as null, z: undefined as undefined } as const),
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

/**
 * Serializes a JavaScript object into a compact binary format.
 *
 * The encoding supports the following types:
 * - `undefined` and `null` (encoded as 0)
 * - `boolean` (encoded as 1 for `true`, 2 for `false`)
 * - `number` (encoded as 3, followed by 64-bit float)
 * - `string` (encoded as 4, followed by UTF-8 string)
 * - `Array` (encoded as 5, followed by length and recursively encoded elements)
 * - Object references with a single `$ref` property (encoded as 6, followed by reference string)
 * - Generic objects (encoded as 7, followed by key-value pairs)
 *
 * @param obj - The object to serialize.
 * @returns A `Uint8Array` containing the binary representation of the object.
 * @throws {Error} If an unsupported type is encountered during serialization.
 */
export function encodeBinary(obj: any): Uint8Array {
    // --- Property name interning table ---
    const propNameToId = new Map<string, number>();
    const propNames: string[] = [];
    // First pass: collect all property names (excluding reference objects)
    function collectProps(val: any) {
        if (val && typeof val === 'object') {
            if (Array.isArray(val)) {
                for (const v of val) collectProps(v);
                return;
            }
            // Special case: { r: id } reference object
            const keys = Object.keys(val);
            if (keys.length === 1 && keys[0] === 'r') return;
            for (const k of keys) {
                if (!propNameToId.has(k)) {
                    propNameToId.set(k, propNames.length);
                    propNames.push(k);
                }
                collectProps(val[k]);
            }
        }
    }
    collectProps(obj);

    // --- Write property table and data ---
    const w = new BinWriter();
    w.u8(0xA1); // version tag for future-proofing
    w.varuint(propNames.length);
    for (const name of propNames) w.str(name);
    w.writeWithPropTable(obj, propNameToId);
    return w.finish();
}

class BinWriter {
    buf = new Uint8Array(64 * 1024);
    pos = 0;
    private dv = new DataView(this.buf.buffer);
    textEncoder = new TextEncoder();
    // Static cache for encoded string bytes to avoid re-encoding
    static stringEncodeCache: Map<string, Uint8Array> = new Map();

    // Aggressively grow buffer: 2x + n
    ensure(n: number) {
        if (this.pos + n > this.buf.length) {
            let newLen = this.buf.length * 2;
            while (newLen < this.pos + n) newLen = newLen * 2;
            const newBuf = new Uint8Array(newLen);
            newBuf.set(this.buf, 0);
            this.buf = newBuf;
            // Update DataView to new buffer
            this.dv = new DataView(this.buf.buffer);
        }
    }
    u8(v: number) { this.ensure(1); this.buf[this.pos++] = v; }
    f64(v: number) { this.ensure(8); this.dv.setFloat64(this.pos, v, true); this.pos += 8; }
    varuint(v: number) {
        do {
            let b = v & 0x7F;
            v >>>= 7;
            if (v !== 0) b |= 0x80;
            this.u8(b);
        } while (v !== 0);
    }
    /**
     * Encodes a UTF-8 string, caching the result to avoid repeated TextEncoder work.
     */
    str(s: string) {
        if (!s || s.length === 0) {
            this.varuint(0);
            return;
        }
        let bytes = BinWriter.stringEncodeCache.get(s);
        if (!bytes) {
            bytes = this.textEncoder.encode(s);
            BinWriter.stringEncodeCache.set(s, bytes);
        }
        this.varuint(bytes.length);
        this.ensure(bytes.length);
        this.buf.set(bytes, this.pos);
        this.pos += bytes.length;
    }
    finish() { return this.buf.subarray(0, this.pos); }
    /**
     * Recursively writes any supported value into the binary stream.
     */
    write(val: any): void {
        switch (typeof val) {
            case 'undefined':
                this.u8(0); return;
            case 'boolean':
                this.u8(val ? 1 : 2); return;
            case 'number':
                this.u8(3); this.f64(val); return;
            case 'string':
                this.u8(4); this.str(val); return;
            case 'object':
                if (val === null) { this.u8(0); return; } // null
                if (Array.isArray(val)) { // Array
                    this.u8(5);
                    this.varuint(val.length);
                    for (let i = 0, len = val.length; i < len; i++) this.write(val[i]);
                    return;
                }
                // Handle uint8array (binary data) as a special case
                if (val instanceof Uint8Array) {
                    this.u8(8); // Treat Uint8Array as binary data
                    this.varuint(val.length); // Write length
                    this.ensure(val.length); // Ensure buffer has enough space
                    this.buf.set(val, this.pos); // Copy data
                    this.pos += val.length; // Update position
                    return;
                }

                const keys = Object.keys(val); // Object
                // Detect { r: id } reference (id is a number)
                if (keys.length === 1 && ('r' in val)) { // Object reference
                    this.u8(6);
                    this.varuint(val.r);
                    return;
                }
                this.u8(7); // Generic object
                this.varuint(keys.length); // Write number of keys
                for (let i = 0, klen = keys.length; i < klen; i++) { // Write each key-value pair
                    const k = keys[i];
                    this.str(k); // Write key as string
                    this.write(val[k]); // Write value recursively
                }
                return; // End of object
            default:
                throw new Error(`Unsupported type in encodeBinary: ${typeof val}`);
        }
    }

    /**
     * Recursively writes any supported value into the binary stream, using property name table.
     */
    writeWithPropTable(val: any, propNameToId: Map<string, number>): void {
        switch (typeof val) {
            case 'undefined':
                this.u8(0); return;
            case 'boolean':
                this.u8(val ? 1 : 2); return;
            case 'number':
                this.u8(3); this.f64(val); return;
            case 'string':
                this.u8(4); this.str(val); return;
            case 'object':
                if (val === null) { this.u8(0); return; }
                if (Array.isArray(val)) {
                    this.u8(5);
                    this.varuint(val.length);
                    for (let i = 0, len = val.length; i < len; i++) this.writeWithPropTable(val[i], propNameToId);
                    return;
                }
                // Special case: { r: id } reference object
                const keys = Object.keys(val);
                if (keys.length === 1 && keys[0] === 'r') {
                    this.u8(6);
                    this.varuint(val.r);
                    return;
                }
                this.u8(7); // Generic object
                this.varuint(keys.length);
                for (let i = 0, klen = keys.length; i < klen; i++) {
                    const k = keys[i];
                    this.varuint(propNameToId.get(k)!); // Write property id
                    this.writeWithPropTable(val[k], propNameToId);
                }
                return;
            default:
                throw new Error(`Unsupported type in encodeBinary: ${typeof val}`);
        }
    }
}

export function decodeBinary(buf: Uint8Array) {
    const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
    let offset = 0;
    const textDecoder = new TextDecoder();
    function readUint8(): number { return dv.getUint8(offset++); }
    function readVarUint(): number {
        let val = 0, shift = 0, b: number;
        do {
            b = buf[offset++];
            val |= (b & 0x7F) << shift;
            shift += 7;
        } while (b & 0x80);
        return val;
    }
    function readString(): string {
        const len = readVarUint();
        const arr = buf.subarray(offset, offset + len);
        offset += len;
        return textDecoder.decode(arr);
    }
    // --- Read property table ---
    const version = readUint8();
    if (version !== 0xA1) throw new Error('decodeBinary: unknown version');
    const propCount = readVarUint();
    const propNames: string[] = [];
    for (let i = 0; i < propCount; ++i) propNames.push(readString());
    function read(): any {
        const tag = readUint8();
        switch (tag) {
            case 0: return null;
            case 1: return true;
            case 2: return false;
            case 3: {
                const v = dv.getFloat64(offset, true);
                offset += 8;
                return v;
            }
            case 4: return readString();
            case 5: {
                const len = readVarUint();
                const arr = new Array(len);
                for (let i = 0; i < len; ++i) arr[i] = read();
                return arr;
            }
            case 6: {
                const ref = readVarUint();
                return { r: ref };
            }
            case 7: {
                const len = readVarUint();
                const obj: Record<string, any> = {};
                for (let i = 0; i < len; ++i) {
                    const propId = readVarUint();
                    const k = propNames[propId];
                    obj[k] = read();
                }
                return obj;
            }
            case 8: {
                const len = readVarUint();
                const arr = new Uint8Array(len);
                arr.set(buf.subarray(offset, offset + len));
                offset += len;
                return arr;
            }
            default:
                throw new Error(`Unknown tag in decodeBinary: ${tag}`);
        }
    }
    return read();
}

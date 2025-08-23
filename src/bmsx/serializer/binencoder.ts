export const VERSION = 0xA1;

const enum Tag {
    Null = 0,
    True = 1,
    False = 2,
    F64 = 3,
    Str = 4,
    Arr = 5,
    Ref = 6,
    Obj = 7,
    Bin = 8,
    Int = 9,
    F32 = 10,
    Set = 11,
}

/**
 * Encode an object to a binary format with property name interning.
 * The output is a Uint8Array that can be decoded with decodeBinary.
 *
 * This format is versioned; the current version is 0xA1.
 * The format is not compatible with the legacy A1 format.
 */
export function encodeBinary(obj: any): Uint8Array {
    // --- Property name interning table ---
    const propNameToId = new Map<string, number>();
    const propNames: string[] = [];

    // First pass: collect unique property names (excluding { r: id } refs)
    function collectProps(val: any) {
        if (val && typeof val === "object") {
            if (Array.isArray(val)) {
                for (const v of val) collectProps(v);
                return;
            }
            const keys = Object.keys(val);
            if (keys.length === 1 && keys[0] === "r") return; // skip ref objects
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

    const w = new BinWriter();
    w.u8(VERSION); // version tag (unchanged; see header comment re: breaking change)
    w.varuint(propNames.length);
    for (const name of propNames) w.str(name);
    w.writeWithPropTable(obj, propNameToId);
    return w.finish();
}

/**
 * BinWriter is a utility class for writing binary data in a specific format.
 * It supports writing various types including numbers, strings, arrays, objects,
 * and binary data with specific tags and encoding rules.
 */
class BinWriter {
    buf = new Uint8Array(64 * 1024);
    pos = 0;
    private dv = new DataView(this.buf.buffer);
    private textEncoder = new TextEncoder();
    // Static cache for encoded string bytes to avoid re-encoding
    static stringEncodeCache: Map<string, Uint8Array> = new Map();

    /** Ensure the buffer has enough space for n bytes, resizing if necessary. */
    private ensure(n: number) {
        if (this.pos + n > this.buf.length) {
            let newLen = this.buf.length * 2;
            while (newLen < this.pos + n) newLen *= 2;
            const newBuf = new Uint8Array(newLen);
            newBuf.set(this.buf, 0);
            this.buf = newBuf;
            this.dv = new DataView(this.buf.buffer);
        }
    }
    u8(v: number) { this.ensure(1); this.buf[this.pos++] = v; }
    f32(v: number) { this.ensure(4); this.dv.setFloat32(this.pos, v, true); this.pos += 4; }
    f64(v: number) { this.ensure(8); this.dv.setFloat64(this.pos, v, true); this.pos += 8; }

    /** Unsigned LEB128 / varuint */
    varuint(v: number) {
        // JS >>> is 32-bit so we need to loop carefully; here we assume v >=0 and <2^32 for prop counts/lengths.
        // For larger values use >>> 0 semantics; typical usage well within range.
        let x = v >>> 0;
        while (x >= 0x80) {
            this.u8((x & 0x7f) | 0x80);
            x >>>= 7;
        }
        this.u8(x);
    }

    /** ZigZag encode signed 32-bit then varuint. */
    varintSigned(n: number) {
        // coerce to 32-bit signed
        let v = n | 0;
        let zz = (v << 1) ^ (v >> 31); // ZigZag
        // encode as unsigned varuint
        while (zz >= 0x80) {
            this.u8((zz & 0x7f) | 0x80);
            zz >>>= 7;
        }
        this.u8(zz);
    }

    /** Encode UTF-8 string with length prefix (varuint). */
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

    /** Write a binary buffer with length prefix (varuint). */
    finish(): Uint8Array { return this.buf.subarray(0, this.pos); }

    /** Unified numeric writer choosing Int32 / F32 / F64. */
    private writeNumber(v: number) {
        if (Number.isSafeInteger(v) && v >= -0x80000000 && v <= 0x7fffffff) {
            this.u8(Tag.Int);
            this.varintSigned(v);
            return;
        }
        const f32 = Math.fround(v);
        if (f32 === v) {
            this.u8(Tag.F32);
            this.f32(v);
            return;
        }
        this.u8(Tag.F64);
        this.f64(v);
    }

    /** Generic writer (no propTable) — left for completeness; not used by encodeBinary. */
    write(val: any): void {
        switch (typeof val) {
            case "undefined":
                this.u8(Tag.Null); return;
            case "boolean":
                this.u8(val ? Tag.True : Tag.False); return;
            case "number":
                this.writeNumber(val); return;
            case "string":
                this.u8(Tag.Str); this.str(val); return;
            case "object":
                if (val === null) { this.u8(Tag.Null); return; }
                if (Array.isArray(val)) {
                    this.u8(Tag.Arr);
                    this.varuint(val.length);
                    for (let i = 0; i < val.length; i++) this.write(val[i]);
                    return;
                }
                if (val instanceof Uint8Array) {
                    this.u8(Tag.Bin);
                    this.varuint(val.length);
                    this.ensure(val.length);
                    this.buf.set(val, this.pos);
                    this.pos += val.length;
                    return;
                }
                if (ArrayBuffer.isView(val)) {
                    const view = new Uint8Array(val.buffer, val.byteOffset, val.byteLength);
                    this.u8(Tag.Bin);
                    this.varuint(view.length);
                    this.ensure(view.length);
                    this.buf.set(view, this.pos);
                    this.pos += view.length;
                    return;
                }
                const keys = Object.keys(val);
                if (keys.length === 1 && keys[0] === "r") {
                    this.u8(Tag.Ref);
                    this.varuint(val.r >>> 0);
                    return;
                }
                this.u8(Tag.Obj);
                this.varuint(keys.length);
                for (let i = 0; i < keys.length; i++) {
                    const k = keys[i];
                    this.str(k);
                    this.write(val[k]);
                }
                return;
            default:
                throw new Error(`encodeBinary.write: Unsupported type ${typeof val}`);
        }
    }

    /** Writer that uses the property name table (ID varuints). */
    writeWithPropTable(val: any, propNameToId: Map<string, number>): void {
        switch (typeof val) {
            case "undefined":
                this.u8(Tag.Null); return;
            case "boolean":
                this.u8(val ? Tag.True : Tag.False); return;
            case "number":
                this.writeNumber(val); return;
            case "string":
                this.u8(Tag.Str); this.str(val); return;
            case "object":
                if (val === null) { this.u8(Tag.Null); return; }
                if (Array.isArray(val)) {
                    this.u8(Tag.Arr);
                    this.varuint(val.length);
                    for (let i = 0; i < val.length; i++) this.writeWithPropTable(val[i], propNameToId);
                    return;
                }
                const keys = Object.keys(val);
                if (keys.length === 1 && keys[0] === "r") {
                    this.u8(Tag.Ref);
                    this.varuint(val.r >>> 0);
                    return;
                }
                if (val instanceof Uint8Array) {
                    // NB: you won't normally hit this path because {r:...} check comes first.
                    this.u8(Tag.Bin);
                    this.varuint(val.length);
                    this.ensure(val.length);
                    this.buf.set(val, this.pos);
                    this.pos += val.length;
                    return;
                }
                if (ArrayBuffer.isView(val)) {
                    const view = new Uint8Array(val.buffer, val.byteOffset, val.byteLength);
                    this.u8(Tag.Bin);
                    this.varuint(view.length);
                    this.ensure(view.length);
                    this.buf.set(view, this.pos);
                    this.pos += view.length;
                    return;
                }
                if (val instanceof Set) {
                    this.u8(Tag.Set);
                    this.varuint(val.size);
                    for (const item of val) this.writeWithPropTable(item, propNameToId);
                    return;
                }
                this.u8(Tag.Obj);
                this.varuint(keys.length);
                for (let i = 0; i < keys.length; i++) {
                    const k = keys[i];
                    const id = propNameToId.get(k);
                    if (id === undefined) throw new Error(`Unknown property name '${k}' in prop table`);
                    this.varuint(id);
                    this.writeWithPropTable(val[k], propNameToId);
                }
                return;
            case 'function':
                return; // Functions are not serializable
            default:
                throw new Error(`encodeBinary.writeWithPropTable: Unsupported type '${typeof val}'`);
        }
    }
}

/** Decode a buffer produced by this module (BREAKING vs legacy A1 semantics). */
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
        return val >>> 0;
    }
    function readVarIntSigned(): number {
        // read unsigned first
        let val = 0, shift = 0, b: number;
        do {
            b = buf[offset++];
            val |= (b & 0x7F) << shift;
            shift += 7;
        } while (b & 0x80);
        // ZigZag decode
        const zz = val >>> 0;
        const signed = (zz >>> 1) ^ -(zz & 1);
        return signed | 0;
    }
    function readString(): string {
        const len = readVarUint();
        const arr = buf.subarray(offset, offset + len);
        offset += len;
        return textDecoder.decode(arr);
    }

    // --- Read property table ---
    const version = readUint8();
    if (version !== VERSION) throw new Error(`decodeBinary: unknown version 0x${version.toString(16)} (expected 0x${VERSION.toString(16)})`);
    const propCount = readVarUint();
    const propNames: string[] = [];
    for (let i = 0; i < propCount; ++i) propNames.push(readString());

    function read(): any {
        const tag = readUint8();
        switch (tag) {
            case Tag.Null: return null;
            case Tag.True: return true;
            case Tag.False: return false;
            case Tag.F64: {
                const v = dv.getFloat64(offset, true); offset += 8; return v;
            }
            case Tag.Str: return readString();
            case Tag.Arr: {
                const len = readVarUint();
                const arr = new Array(len);
                for (let i = 0; i < len; ++i) arr[i] = read();
                return arr;
            }
            case Tag.Ref: {
                const ref = readVarUint();
                return { r: ref };
            }
            case Tag.Obj: {
                const len = readVarUint();
                const obj: Record<string, any> = {};
                for (let i = 0; i < len; ++i) {
                    const propId = readVarUint();
                    const k = propNames[propId];
                    obj[k] = read();
                }
                return obj;
            }
            case Tag.Bin: {
                const len = readVarUint();
                const arr = new Uint8Array(len);
                arr.set(buf.subarray(offset, offset + len));
                offset += len;
                return arr;
            }
            case Tag.Int: {
                return readVarIntSigned();
            }
            case Tag.F32: {
                const v = dv.getFloat32(offset, true); offset += 4; return v;
            }
            case Tag.Set: {
                const len = readVarUint();
                const s = new Set<any>();
                for (let i = 0; i < len; ++i) s.add(read());
                return s;
            }
            default:
                throw new Error(`Unknown tag in decodeBinary: ${tag}`);
        }
    }
    return read();
}

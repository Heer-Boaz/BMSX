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

export interface EncodeOptions {
	sortProps?: boolean;
	capacityHint?: number;
}

/**
 * Encode an object to a binary format with property-name interning.
 * The output is a Uint8Array that can be decoded with decodeBinary.
 *
 * FORMAT (big picture)
 *   u8 VERSION (0xA1)
 *   varuint property-count N
 *   N * (str property-name)
 *   value payload using interned property IDs
 */
export function encodeBinary(obj: any, opts: EncodeOptions = {}): Uint8Array {
	const { sortProps = true, capacityHint } = opts;
	const propNameToId = new Map<string, number>();
	const propNames: string[] = [];
	const seen = new WeakSet<object>();
	const stack: unknown[] = [obj];

	while (stack.length) {
		const val = stack.pop();
		if (!val || typeof val !== 'object') continue;
		if (seen.has(val as object)) continue;
		seen.add(val as object);
		if (val instanceof Map) throw new Error('encodeBinary: Map unsupported (add Tag.Map or pre-normalize)');
		if (val instanceof Date || val instanceof RegExp) throw new Error('encodeBinary: type unsupported');
		if (Array.isArray(val)) {
			for (let i = 0; i < val.length; i++) stack.push(val[i]);
			continue;
		}
		if (val instanceof Set) {
			for (const item of val) stack.push(item);
			continue;
		}
		if (ArrayBuffer.isView(val) && !(val instanceof DataView)) continue;

		const record = val as Record<string, unknown>;
		const keys = Object.keys(record);
		if (keys.length === 1 && keys[0] === 'r') continue; // ref objects handled specially
		for (let i = 0; i < keys.length; i++) {
			const k = keys[i];
			const nextVal = record[k];
			if (typeof nextVal === 'function' || nextVal === undefined) continue;
			if (nextVal instanceof Map) throw new Error('encodeBinary: Map unsupported (add Tag.Map or pre-normalize)');
			if (nextVal instanceof Date || nextVal instanceof RegExp) throw new Error('encodeBinary: type unsupported');
			if (!propNameToId.has(k)) {
				propNameToId.set(k, propNames.length);
				propNames.push(k);
			}
			stack.push(nextVal);
		}
	}

	if (sortProps && propNames.length > 1) {
		propNames.sort();
		propNameToId.clear();
		for (let i = 0; i < propNames.length; i++) propNameToId.set(propNames[i], i);
	}

	const writer = new BinWriter(capacityHint);
	writer.u8(VERSION);
	writer.varuint(propNames.length);
	for (let i = 0; i < propNames.length; i++) writer.str(propNames[i]);
	writer.writeWithPropTable(obj, propNameToId);
	return writer.finish();
}

export function decodeuint8arr(to_decode: Uint8Array): string {
	const decoder = new TextDecoder('utf-8', { fatal: true });
	return decoder.decode(to_decode);
}

export function typedArrayFromBytes<T extends ArrayBufferView>(u8: Uint8Array, ctor: { new(buffer: ArrayBufferLike, byteOffset: number, length?: number): T; BYTES_PER_ELEMENT: number; }): T {
	function ensureAlignedView(u8: Uint8Array, alignment: number): Uint8Array {
		if ((u8.byteLength % alignment) !== 0) {
			throw new Error(`loadModelFromBuffer: byteLength ${u8.byteLength} not divisible by ${alignment}`);
		}
		if ((u8.byteOffset % alignment) === 0) return u8;
		const copy = u8.slice();
		if ((copy.byteOffset % alignment) !== 0) {
			throw new Error('loadModelFromBuffer: unable to align view');
		}
		return copy;
	}

	const alignment = ctor.BYTES_PER_ELEMENT;
	const aligned = ensureAlignedView(u8, alignment);
	return new ctor(aligned.buffer, aligned.byteOffset, aligned.byteLength / alignment);
}

export function toF32(v: any): Float32Array {
	if (v === undefined || v === null) return undefined;
	if (ArrayBuffer.isView(v)) {
		const u8 = new Uint8Array(v.buffer, v.byteOffset, v.byteLength);
		return typedArrayFromBytes(u8, Float32Array);
	}
	if (Array.isArray(v)) return new Float32Array(v);
	return undefined;
}

class BinWriter {
	private static readonly CACHE_MAX = 8192;
	private static readonly textEncoder = new TextEncoder();
	private static stringEncodeCache: Map<string, Uint8Array> = new Map();

	private buf: Uint8Array;
	private pos = 0;
	private dv: DataView;

	constructor(capacityHint?: number) {
		const initialCapacity = Math.max(capacityHint ?? 64 * 1024, 64);
		this.buf = new Uint8Array(initialCapacity);
		this.dv = new DataView(this.buf.buffer);
	}

	static cachePut(key: string, bytes: Uint8Array) {
		const cache = BinWriter.stringEncodeCache;
		if (cache.size >= BinWriter.CACHE_MAX) {
			const first = cache.keys().next().value as string;
			if (first !== undefined) cache.delete(first);
		}
		cache.set(key, bytes);
	}

	private ensure(n: number) {
		if (this.pos + n <= this.buf.length) return;
		let len = this.buf.length << 1;
		while (len < this.pos + n) len <<= 1;
		const next = new Uint8Array(len);
		next.set(this.buf);
		this.buf = next;
		this.dv = new DataView(this.buf.buffer);
	}

	u8(v: number) {
		this.ensure(1);
		this.buf[this.pos++] = v & 0xFF;
	}

	f32(v: number) {
		this.ensure(4);
		this.dv.setFloat32(this.pos, v, true);
		this.pos += 4;
	}

	f64(v: number) {
		this.ensure(8);
		this.dv.setFloat64(this.pos, v, true);
		this.pos += 8;
	}

	varuint(v: number) {
		if (!Number.isFinite(v) || v < 0 || !Number.isInteger(v) || v > 0xFFFFFFFF) {
			throw new Error('varuint: invalid');
		}
		let x = v >>> 0;
		if (x < 0x80) {
			this.u8(x);
			return;
		}
		while (x >= 0x80) {
			this.u8((x & 0x7F) | 0x80);
			x >>>= 7;
		}
		this.u8(x);
	}

	varintSigned(v: number) {
		let zz = ((v | 0) << 1) ^ ((v | 0) >> 31);
		while (zz >= 0x80) {
			this.u8((zz & 0x7F) | 0x80);
			zz >>>= 7;
		}
		this.u8(zz);
	}

	str(s: string) {
		if (s.length === 0) {
			this.varuint(0);
			return;
		}
		let bytes = BinWriter.stringEncodeCache.get(s);
		if (!bytes) {
			bytes = BinWriter.textEncoder.encode(s);
			BinWriter.cachePut(s, bytes);
		}
		this.varuint(bytes.length);
		this.ensure(bytes.length);
		this.buf.set(bytes, this.pos);
		this.pos += bytes.length;
	}

	finish(): Uint8Array {
		return this.buf.subarray(0, this.pos);
	}

	private writeNumber(v: number) {
		if (Number.isNaN(v)) {
			this.u8(Tag.F32);
			this.f32(v);
			return;
		}
		if (Object.is(v, -0)) {
			this.u8(Tag.F32);
			this.f32(v);
			return;
		}
		if (Number.isSafeInteger(v) && v >= -0x80000000 && v <= 0x7FFFFFFF) {
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

	writeWithPropTable(val: any, propNameToId: Map<string, number>) {
		switch (typeof val) {
			case 'undefined':
				this.u8(Tag.Null);
				return;
			case 'boolean':
				this.u8(val ? Tag.True : Tag.False);
				return;
			case 'number':
				this.writeNumber(val);
				return;
			case 'string':
				this.u8(Tag.Str);
				this.str(val);
				return;
			case 'object':
				if (val === null) {
					this.u8(Tag.Null);
					return;
				}
				if (Array.isArray(val)) {
					this.u8(Tag.Arr);
					this.varuint(val.length);
					for (let i = 0; i < val.length; i++) this.writeWithPropTable(val[i], propNameToId);
					return;
				}
				if (val instanceof Set) {
					this.u8(Tag.Set);
					this.varuint(val.size);
					for (const item of val) this.writeWithPropTable(item, propNameToId);
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
				if (val instanceof Map) throw new Error('encodeBinary: Map unsupported (add Tag.Map or pre-normalize)');
				if (val instanceof Date || val instanceof RegExp) throw new Error('encodeBinary: type unsupported');
				const rawKeys = Object.keys(val);
				if (rawKeys.length === 1 && rawKeys[0] === 'r') {
					this.u8(Tag.Ref);
					this.varuint((val as { r: number }).r >>> 0);
					return;
				}
				const serKeys: string[] = [];
				for (let i = 0; i < rawKeys.length; i++) {
					const k = rawKeys[i];
					const member = val[k];
					if (typeof member === 'function' || member === undefined) continue;
					if (member instanceof Map) throw new Error('encodeBinary: Map unsupported (add Tag.Map or pre-normalize)');
					if (member instanceof Date || member instanceof RegExp) throw new Error('encodeBinary: type unsupported');
					serKeys.push(k);
				}
				this.u8(Tag.Obj);
				this.varuint(serKeys.length);
				for (let i = 0; i < serKeys.length; i++) {
					const k = serKeys[i];
					const id = propNameToId.get(k);
					if (id === undefined) throw new Error(`Unknown property name '${k}' in prop table`);
					this.varuint(id);
					this.writeWithPropTable(val[k], propNameToId);
				}
				return;
			default:
				throw new Error(`encodeBinary.writeWithPropTable: Unsupported type '${typeof val}'`);
		}
	}
}

export interface DecodeOptions {
	zeroCopyBin?: boolean;
	maxProps?: number;
	maxContainerEntries?: number;
	maxDepth?: number;
}

/** Decode a buffer produced by this module (BREAKING vs legacy A1 semantics). */
export function decodeBinary(buf: Uint8Array, opts: DecodeOptions = {}) {
	const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
	let offset = 0;
	const textDecoder = new TextDecoder('utf-8', { fatal: true });
	const {
		zeroCopyBin = false,
		maxProps = 1_000_000,
		maxContainerEntries = 1_000_000,
		maxDepth = 1 << 15,
	} = opts;

	const need = (n: number) => {
		if (offset + n > buf.length) throw new Error('decodeBinary: truncated');
	};
	const readUint8 = () => { need(1); return dv.getUint8(offset++); };
	const readVarUint = () => {
		let val = 0;
		let shift = 0;
		let b = 0;
		let i = 0;
		do {
			if (offset >= buf.length) throw new Error('decodeBinary: truncated varuint');
			b = buf[offset++];
			val |= (b & 0x7F) << shift;
			shift += 7;
			if (++i > 5) throw new Error('decodeBinary: varuint overflow (>32 bits)');
		} while (b & 0x80);
		return val >>> 0;
	};
	const readVarIntSigned = () => {
		let zz = 0;
		let shift = 0;
		let b = 0;
		let i = 0;
		do {
			if (offset >= buf.length) throw new Error('decodeBinary: truncated varint');
			b = buf[offset++];
			zz |= (b & 0x7F) << shift;
			shift += 7;
			if (++i > 5) throw new Error('decodeBinary: varint overflow (>32 bits)');
		} while (b & 0x80);
		return ((zz >>> 1) ^ -(zz & 1)) | 0;
	};
	const readString = () => {
		const len = readVarUint();
		need(len);
		const arr = buf.subarray(offset, offset + len);
		offset += len;
		return textDecoder.decode(arr);
	};

	const version = readUint8();
	if (version !== VERSION) {
		throw new Error(`decodeBinary: unknown version 0x${version.toString(16)} (expected 0x${VERSION.toString(16)})`);
	}
	const propCount = readVarUint();
	if (propCount > maxProps) {
		throw new Error(`decodeBinary: prop table too large (${propCount}/${maxProps})`);
	}
	const propNames = new Array<string>(propCount);
	for (let i = 0; i < propCount; i++) propNames[i] = readString();

	let depth = 0;
	function read(): any {
		if (++depth > maxDepth) throw new Error('decodeBinary: nesting too deep');
		try {
			const tag = readUint8();
			switch (tag) {
				case Tag.Null: return null;
				case Tag.True: return true;
				case Tag.False: return false;
				case Tag.F64: { need(8); const v = dv.getFloat64(offset, true); offset += 8; return v; }
				case Tag.Str: return readString();
				case Tag.Arr: {
					const len = readVarUint();
					if (len > maxContainerEntries) throw new Error(`decodeBinary: array too large (${len}/${maxContainerEntries})`);
					const arr = new Array(len);
					for (let i = 0; i < len; i++) arr[i] = read();
					return arr;
				}
				case Tag.Ref: { const ref = readVarUint(); return { r: ref }; }
				case Tag.Obj: {
					const len = readVarUint();
					if (len > maxContainerEntries) throw new Error(`decodeBinary: object too large (${len}/${maxContainerEntries})`);
					const obj: Record<string, any> = {};
					for (let i = 0; i < len; i++) {
						const propId = readVarUint();
						if (propId >= propNames.length) throw new Error(`decodeBinary: bad prop id ${propId}/${propNames.length}`);
						obj[propNames[propId]] = read();
					}
					return obj;
				}
				case Tag.Bin: {
					const len = readVarUint();
					need(len);
					const start = offset;
					offset += len;
					const view = buf.subarray(start, offset);
					return zeroCopyBin ? view : view.slice();
				}
				case Tag.Int: return readVarIntSigned();
				case Tag.F32: { need(4); const v = dv.getFloat32(offset, true); offset += 4; return v; }
				case Tag.Set: {
					const len = readVarUint();
					if (len > maxContainerEntries) throw new Error(`decodeBinary: set too large (${len}/${maxContainerEntries})`);
					const set = new Set<any>();
					for (let i = 0; i < len; i++) set.add(read());
					return set;
				}
				default:
					throw new Error(`Unknown tag in decodeBinary: ${tag}`);
			}
		} finally {
			depth--;
		}
	}

	const value = read();
	if (offset !== buf.length) {
		throw new Error(`decodeBinary: trailing ${buf.length - offset} bytes`);
	}
	return value;
}

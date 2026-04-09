export const VERSION = 0xA1;
const utf8FatalDecoder = new TextDecoder('utf-8', { fatal: true });

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

function collectPropNamesFromValues(values: readonly unknown[], sortProps: boolean): string[] {
	const propNameToId = new Map<string, number>();
	const propNames: string[] = [];
	const seen = new WeakSet<object>();
	const stack: unknown[] = values.slice() as unknown[];

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
	}
	return propNames;
}

function buildPropNameToIdMap(propNames: readonly string[]): Map<string, number> {
	const propNameToId = new Map<string, number>();
	for (let i = 0; i < propNames.length; i++) propNameToId.set(propNames[i], i);
	return propNameToId;
}

export function buildBinaryPropTable(values: readonly unknown[], opts: Pick<EncodeOptions, 'sortProps'> = {}): string[] {
	return collectPropNamesFromValues(values, opts.sortProps ?? true);
}

export function encodeBinaryWithPropTable(obj: any, propNames: readonly string[], opts: Pick<EncodeOptions, 'capacityHint'> = {}): Uint8Array {
	const writer = new BinWriter(opts.capacityHint);
	writer.writeWithPropTable(obj, buildPropNameToIdMap(propNames));
	return writer.finish();
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
	const propNames = collectPropNamesFromValues([obj], sortProps);
	const propNameToId = buildPropNameToIdMap(propNames);

	const writer = new BinWriter(capacityHint);
	writer.u8(VERSION);
	writer.varuint(propNames.length);
	for (let i = 0; i < propNames.length; i++) writer.str(propNames[i]);
	writer.writeWithPropTable(obj, propNameToId);
	return writer.finish();
}

export function decodeuint8arr(to_decode: Uint8Array): string {
	return utf8FatalDecoder.decode(to_decode);
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
		const v32 = v | 0;
		let zz = ((v32 << 1) ^ (v32 >> 31)) >>> 0;
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

class BinReader {
	private readonly dv: DataView;
	private readonly zeroCopyBin: boolean;
	private readonly maxProps: number;
	private readonly maxContainerEntries: number;
	private readonly maxDepth: number;
	private offset = 0;
	private depth = 0;
	private propNames: readonly string[] = [];

	constructor(private readonly buf: Uint8Array, opts: DecodeOptions) {
		this.dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
		this.zeroCopyBin = opts.zeroCopyBin ?? false;
		this.maxProps = opts.maxProps ?? 1_000_000;
		this.maxContainerEntries = opts.maxContainerEntries ?? 1_000_000;
		this.maxDepth = opts.maxDepth ?? (1 << 15);
	}

	getOffset(): number {
		return this.offset;
	}

	setPropNames(propNames: readonly string[]): void {
		this.propNames = propNames;
	}

	readVersion(): number {
		return this.readUint8();
	}

	readPropNames(): string[] {
		const propCount = this.readVarUint();
		if (propCount > this.maxProps) {
			throw new Error(`decodeBinary: prop table too large (${propCount}/${this.maxProps})`);
		}
		const propNames = new Array<string>(propCount);
		for (let i = 0; i < propCount; i++) propNames[i] = this.readString();
		return propNames;
	}

	readValue(): any {
		if (++this.depth > this.maxDepth) throw new Error('decodeBinary: nesting too deep');
		try {
			const tag = this.readUint8();
			switch (tag) {
				case Tag.Null: return null;
				case Tag.True: return true;
				case Tag.False: return false;
				case Tag.F64: {
					this.need(8);
					const v = this.dv.getFloat64(this.offset, true);
					this.offset += 8;
					return v;
				}
				case Tag.Str: return this.readString();
				case Tag.Arr: {
					const len = this.readVarUint();
					if (len > this.maxContainerEntries) throw new Error(`decodeBinary: array too large (${len}/${this.maxContainerEntries})`);
					const arr = new Array(len);
					for (let i = 0; i < len; i++) arr[i] = this.readValue();
					return arr;
				}
				case Tag.Ref: {
					const ref = this.readVarUint();
					return { r: ref };
				}
				case Tag.Obj: {
					const len = this.readVarUint();
					if (len > this.maxContainerEntries) throw new Error(`decodeBinary: object too large (${len}/${this.maxContainerEntries})`);
					const obj: Record<string, any> = {};
					for (let i = 0; i < len; i++) {
						const propId = this.readVarUint();
						if (propId >= this.propNames.length) throw new Error(`decodeBinary: bad prop id ${propId}/${this.propNames.length}`);
						obj[this.propNames[propId]] = this.readValue();
					}
					return obj;
				}
				case Tag.Bin: {
					const len = this.readVarUint();
					this.need(len);
					const start = this.offset;
					this.offset += len;
					const view = this.buf.subarray(start, this.offset);
					return this.zeroCopyBin ? view : view.slice();
				}
				case Tag.Int: return this.readVarIntSigned();
				case Tag.F32: {
					this.need(4);
					const v = this.dv.getFloat32(this.offset, true);
					this.offset += 4;
					return v;
				}
				case Tag.Set: {
					const len = this.readVarUint();
					if (len > this.maxContainerEntries) throw new Error(`decodeBinary: set too large (${len}/${this.maxContainerEntries})`);
					const set = new Set<any>();
					for (let i = 0; i < len; i++) set.add(this.readValue());
					return set;
				}
				default:
					throw new Error(`Unknown tag in decodeBinary: ${tag}`);
			}
		} finally {
			this.depth--;
		}
	}

	private need(n: number): void {
		if (this.offset + n > this.buf.length) throw new Error('decodeBinary: truncated');
	}

	private readUint8(): number {
		this.need(1);
		return this.dv.getUint8(this.offset++);
	}

	private readVarUint(): number {
		let val = 0;
		let shift = 0;
		let b = 0;
		let i = 0;
		do {
			if (this.offset >= this.buf.length) throw new Error('decodeBinary: truncated varuint');
			b = this.buf[this.offset++];
			val |= (b & 0x7F) << shift;
			shift += 7;
			if (++i > 5) throw new Error('decodeBinary: varuint overflow (>32 bits)');
		} while (b & 0x80);
		return val >>> 0;
	}

	private readVarIntSigned(): number {
		let zz = 0;
		let shift = 0;
		let b = 0;
		let i = 0;
		do {
			if (this.offset >= this.buf.length) throw new Error('decodeBinary: truncated varint');
			b = this.buf[this.offset++];
			zz |= (b & 0x7F) << shift;
			shift += 7;
			if (++i > 5) throw new Error('decodeBinary: varint overflow (>32 bits)');
		} while (b & 0x80);
		return ((zz >>> 1) ^ -(zz & 1)) | 0;
	}

	private readString(): string {
		const len = this.readVarUint();
		this.need(len);
		const arr = this.buf.subarray(this.offset, this.offset + len);
		this.offset += len;
		return utf8FatalDecoder.decode(arr);
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
	const reader = new BinReader(buf, opts);
	const version = reader.readVersion();
	if (version !== VERSION) {
		throw new Error(`decodeBinary: unknown version 0x${version.toString(16)} (expected 0x${VERSION.toString(16)})`);
	}
	const propNames = reader.readPropNames();
	reader.setPropNames(propNames);
	const value = reader.readValue();
	if (reader.getOffset() !== buf.length) {
		throw new Error(`decodeBinary: trailing ${buf.length - reader.getOffset()} bytes`);
	}
	return value;
}

export function decodeBinaryWithPropTable(buf: Uint8Array, propNames: readonly string[], opts: DecodeOptions = {}) {
	const reader = new BinReader(buf, opts);
	reader.setPropNames(propNames);
	const value = reader.readValue();
	if (reader.getOffset() !== buf.length) {
		throw new Error(`decodeBinary: trailing ${buf.length - reader.getOffset()} bytes`);
	}
	return value;
}

export function requireObject(value: unknown, label: string): Record<string, unknown> {
	if (value === null || typeof value !== 'object' || Array.isArray(value)) {
		throw new Error(`${label} must be an object.`);
	}
	return value as Record<string, unknown>;
}

export function requireObjectKey(value: unknown, key: string, label: string): unknown {
	const obj = requireObject(value, label);
	if (!(key in obj)) {
		throw new Error(`${label}.${key} is required.`);
	}
	return obj[key];
}

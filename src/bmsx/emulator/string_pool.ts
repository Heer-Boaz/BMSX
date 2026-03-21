import {
	HeapObjectType,
	type ObjectHandleTable,
	STRING_OBJECT_BYTE_LENGTH_OFFSET,
	STRING_OBJECT_CODEPOINT_COUNT_OFFSET,
	STRING_OBJECT_DATA_OFFSET,
	STRING_OBJECT_HASH_HI_OFFSET,
	STRING_OBJECT_HASH_LO_OFFSET,
	STRING_OBJECT_HEADER_SIZE,
} from './object_memory';

const TEXT_ENCODER = new TextEncoder();
const TEXT_DECODER = new TextDecoder();

export type StringId = number;

type StringMetadata = {
	bytes: Uint8Array;
	byteLength: number;
	codepointCount: number;
	hashLo: number;
	hashHi: number;
};

export class StringValue {
	public readonly id: StringId;
	public readonly text: string;
	public readonly byteLength: number;
	public readonly codepointCount: number;
	public readonly hashLo: number;
	public readonly hashHi: number;
	public readonly hash32: number;

	private constructor(id: StringId, text: string, byteLength: number, codepointCount: number, hashLo: number, hashHi: number) {
		this.id = id;
		this.text = text;
		this.byteLength = byteLength;
		this.codepointCount = codepointCount;
		this.hashLo = hashLo;
		this.hashHi = hashHi;
		this.hash32 = (hashLo ^ hashHi) >>> 0;
	}

	public static create(id: StringId, text: string): StringValue {
		const metadata = analyzeString(text);
		return new StringValue(id, text, metadata.byteLength, metadata.codepointCount, metadata.hashLo, metadata.hashHi);
	}

	public static createFromMetadata(id: StringId, text: string, metadata: StringMetadata): StringValue {
		return new StringValue(
			id,
			text,
			metadata.byteLength,
			metadata.codepointCount,
			metadata.hashLo,
			metadata.hashHi,
		);
	}
}

export class CompileTimeStringPool {
	private readonly byText = new Map<string, StringValue>();
	private readonly byId: Array<StringValue | null> = [];
	private nextId = 0;

	public intern(text: string): StringValue {
		const existing = this.byText.get(text);
		if (existing !== undefined) {
			return existing;
		}
		const id = this.nextId;
		const entry = StringValue.create(id, text);
		this.byId[id] = entry;
		this.byText.set(text, entry);
		this.nextId = id + 1;
		return entry;
	}

	public getById(id: StringId): StringValue {
		const existing = this.byId[id];
		if (!existing) {
			throw new Error(`[StringPool] Unknown string id ${id}.`);
		}
		return existing;
	}

	public codepointCount(value: StringValue): number {
		return value.codepointCount;
	}
}

export class RuntimeStringPool {
	private readonly byId: Array<StringValue | null> = [];
	private nextId = 1;

	constructor(private readonly handleTable: ObjectHandleTable) {
	}

	public intern(text: string): StringValue {
		const metadata = analyzeString(text);
		const allocation = this.handleTable.allocateObject(HeapObjectType.String, STRING_OBJECT_HEADER_SIZE + metadata.byteLength);
		this.handleTable.writeU32(allocation.addr + STRING_OBJECT_HASH_LO_OFFSET, metadata.hashLo);
		this.handleTable.writeU32(allocation.addr + STRING_OBJECT_HASH_HI_OFFSET, metadata.hashHi);
		this.handleTable.writeU32(allocation.addr + STRING_OBJECT_BYTE_LENGTH_OFFSET, metadata.byteLength);
		this.handleTable.writeU32(allocation.addr + STRING_OBJECT_CODEPOINT_COUNT_OFFSET, metadata.codepointCount);
		this.handleTable.writeBytes(allocation.addr + STRING_OBJECT_DATA_OFFSET, metadata.bytes);
		const entry = StringValue.createFromMetadata(allocation.id, text, metadata);
		this.byId[allocation.id] = entry;
		if (allocation.id >= this.nextId) {
			this.nextId = allocation.id + 1;
		}
		return entry;
	}

	public getById(id: StringId): StringValue {
		const existing = this.byId[id];
		if (existing) {
			return existing;
		}
		const restored = this.readFromHeap(id);
		this.byId[id] = restored;
		if (id >= this.nextId) {
			this.nextId = id + 1;
		}
		return restored;
	}

	public codepointCount(value: StringValue): number {
		return value.codepointCount;
	}

	public reserveHandles(minHandle: number): void {
		this.handleTable.reserveHandles(minHandle);
		if (minHandle > this.nextId) {
			for (let index = this.byId.length; index < minHandle; index += 1) {
				this.byId[index] = null;
			}
			this.nextId = minHandle;
		}
	}

	public clearRuntimeCache(): void {
		for (let index = 0; index < this.byId.length; index += 1) {
			this.byId[index] = null;
		}
	}

	private readFromHeap(id: StringId): StringValue {
		const entry = this.handleTable.readEntry(id);
		if (entry.type !== HeapObjectType.String) {
			throw new Error(`[StringPool] Handle ${id} is not a string object.`);
		}
		const hashLo = this.handleTable.readU32(entry.addr + STRING_OBJECT_HASH_LO_OFFSET);
		const hashHi = this.handleTable.readU32(entry.addr + STRING_OBJECT_HASH_HI_OFFSET);
		const byteLength = this.handleTable.readU32(entry.addr + STRING_OBJECT_BYTE_LENGTH_OFFSET);
		const codepointCount = this.handleTable.readU32(entry.addr + STRING_OBJECT_CODEPOINT_COUNT_OFFSET);
		const bytes = this.handleTable.readBytes(entry.addr + STRING_OBJECT_DATA_OFFSET, byteLength);
		const text = TEXT_DECODER.decode(bytes);
		return StringValue.createFromMetadata(id, text, { bytes, byteLength, codepointCount, hashLo, hashHi });
	}
}

export type StringPool = CompileTimeStringPool | RuntimeStringPool;

export function isStringValue(value: unknown): value is StringValue {
	return value instanceof StringValue;
}

export function stringValueToString(value: StringValue): string {
	return value.text;
}

export function stringValueHash32(value: StringValue): number {
	return value.hash32;
}

export function stringValuesEqual(left: StringValue, right: StringValue): boolean {
	if (left === right) {
		return true;
	}
	if (left.hashLo !== right.hashLo || left.hashHi !== right.hashHi) {
		return false;
	}
	if (left.byteLength !== right.byteLength) {
		return false;
	}
	return left.text === right.text;
}

function analyzeString(text: string): StringMetadata {
	const bytes = TEXT_ENCODER.encode(text);
	let count = 0;
	let hashLo = 0x84222325;
	let hashHi = 0xcbf29ce4;

	for (let index = 0; index < bytes.length; index += 1) {
		const value = bytes[index];
		hashLo = (hashLo ^ value) >>> 0;
		const previousLo = hashLo;
		const loMul = previousLo * 0x1b3;
		const carry = Math.floor(loMul / 0x100000000);
		hashLo = loMul >>> 0;
		hashHi = ((hashHi * 0x1b3) + carry + ((previousLo << 8) >>> 0)) >>> 0;
		if ((value & 0xc0) !== 0x80) {
			count += 1;
		}
	}
	return { bytes, byteLength: bytes.length, codepointCount: count, hashLo, hashHi };
}

import type { StringHandleTable } from './string_memory';

export type StringId = number;

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
}

export class StringPool {
	private readonly byText = new Map<string, StringValue>();
	private readonly byId: Array<StringValue | null> = [];
	private nextId = 0;
	private readonly handleTable: StringHandleTable | null;

	constructor(handleTable: StringHandleTable | null = null) {
		this.handleTable = handleTable;
	}

	public intern(text: string): StringValue {
		if (this.handleTable === null) {
			const existing = this.byText.get(text);
			if (existing !== undefined) {
				return existing;
			}
		}
		let id = this.nextId;
		if (this.handleTable) {
			id = this.handleTable.allocateHandle(text).id;
		}
		const entry = StringValue.create(id, text);
		this.byId[id] = entry;
		if (this.handleTable === null) {
			this.byText.set(text, entry);
		}
		if (id >= this.nextId) {
			this.nextId = id + 1;
		}
		return entry;
	}

	public getById(id: StringId): StringValue {
		const entry = this.byId[id];
		if (!entry) {
			throw new Error(`[StringPool] Unknown string id ${id}.`);
		}
		return entry;
	}

	public codepointCount(value: StringValue): number {
		return value.codepointCount;
	}

	public reserveHandles(minHandle: number): void {
		if (this.handleTable) {
			this.handleTable.reserveHandles(minHandle);
		}
		if (minHandle > this.nextId) {
			for (let index = this.byId.length; index < minHandle; index += 1) {
				this.byId[index] = null;
			}
			this.nextId = minHandle;
		}
	}
}

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

function analyzeString(text: string): { byteLength: number; codepointCount: number; hashLo: number; hashHi: number } {
	let byteLength = 0;
	let count = 0;
	let hashLo = 0x84222325;
	let hashHi = 0xcbf29ce4;

	const hashByte = (value: number): void => {
		hashLo = (hashLo ^ value) >>> 0;
		const loMul = hashLo * 0x1b3;
		const carry = Math.floor(loMul / 0x100000000);
		hashLo = loMul >>> 0;
		hashHi = ((hashHi * 0x1b3) + carry) >>> 0;
	};

	for (const char of text) {
		count += 1;
		const codepoint = char.codePointAt(0)!;
		if (codepoint <= 0x7f) {
			byteLength += 1;
			hashByte(codepoint);
			continue;
		}
		if (codepoint <= 0x7ff) {
			byteLength += 2;
			hashByte(0xc0 | (codepoint >> 6));
			hashByte(0x80 | (codepoint & 0x3f));
			continue;
		}
		if (codepoint <= 0xffff) {
			byteLength += 3;
			hashByte(0xe0 | (codepoint >> 12));
			hashByte(0x80 | ((codepoint >> 6) & 0x3f));
			hashByte(0x80 | (codepoint & 0x3f));
			continue;
		}
		byteLength += 4;
		hashByte(0xf0 | (codepoint >> 18));
		hashByte(0x80 | ((codepoint >> 12) & 0x3f));
		hashByte(0x80 | ((codepoint >> 6) & 0x3f));
		hashByte(0x80 | (codepoint & 0x3f));
	}
	return { byteLength, codepointCount: count, hashLo, hashHi };
}

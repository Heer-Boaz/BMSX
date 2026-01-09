export type StringId = number;

export class StringValue {
	public readonly id: StringId;
	public readonly text: string;
	public readonly codepointCount: number;

	private constructor(id: StringId, text: string, codepointCount: number) {
		this.id = id;
		this.text = text;
		this.codepointCount = codepointCount;
	}

	public static create(id: StringId, text: string): StringValue {
		return new StringValue(id, text, countCodepoints(text));
	}
}

export class StringPool {
	private readonly byText = new Map<string, StringValue>();
	private readonly byId: StringValue[] = [];

	public intern(text: string): StringValue {
		const existing = this.byText.get(text);
		if (existing !== undefined) {
			return existing;
		}
		const entry = StringValue.create(this.byId.length, text);
		this.byId.push(entry);
		this.byText.set(text, entry);
		return entry;
	}

	public getById(id: StringId): StringValue {
		return this.byId[id];
	}

	public codepointCount(value: StringValue): number {
		return value.codepointCount;
	}
}

export function isStringValue(value: unknown): value is StringValue {
	return value instanceof StringValue;
}

export function stringValueToString(value: StringValue): string {
	return value.text;
}

function countCodepoints(text: string): number {
	let count = 0;
	for (const _char of text) {
		count += 1;
	}
	return count;
}

import {
	printParseErrorCode,
	type Node as JsonNode,
	type ParseError,
} from 'jsonc-parser';

export type JsoncSchemaDiagnosticCode =
	| 'syntax'
	| 'type'
	| 'required_property'
	| 'unknown_property'
	| 'duplicate_property'
	| 'invalid_value';

export type JsoncSchemaDiagnostic<TAdditionalCode extends string = never> = {
	code: JsoncSchemaDiagnosticCode | TAdditionalCode;
	message: string;
	offset: number;
	length: number;
	line: number;
	column: number;
};

export type JsonObjectProperty = {
	keyNode: JsonNode;
	valueNode: JsonNode;
};

/**
 * Source-positioned JSONC schema primitives shared by typed asset producers.
 * Domain readers remain responsible for their own shapes and invariants.
 */
export class JsoncSchemaReader<TAdditionalCode extends string = never> {
	public readonly diagnostics: Array<JsoncSchemaDiagnostic<TAdditionalCode>> = [];
	private readonly lineStarts: number[] = [0];

	public constructor(source: string) {
		for (let offset = 0; offset < source.length; offset += 1) {
			const code = source.charCodeAt(offset);
			if (code === 13) {
				if (source.charCodeAt(offset + 1) === 10) {
					offset += 1;
				}
				this.lineStarts.push(offset + 1);
			} else if (code === 10) {
				this.lineStarts.push(offset + 1);
			}
		}
	}

	public addSyntaxError(error: ParseError): void {
		this.addDiagnostic('syntax', error.offset, error.length, printParseErrorCode(error.error));
	}

	protected readObject(node: JsonNode, label: string): Map<string, JsonObjectProperty> | null {
		if (node.type !== 'object') {
			this.addDiagnostic('type', node.offset, node.length, `${label} must be an object.`);
			return null;
		}
		const properties = new Map<string, JsonObjectProperty>();
		const children = node.children!;
		for (let index = 0; index < children.length; index += 1) {
			const property = children[index];
			const keyNode = property.children![0];
			const valueNode = property.children![1];
			const key = keyNode.value as string;
			if (properties.has(key)) {
				this.addDiagnostic('duplicate_property', keyNode.offset, keyNode.length, `Duplicate property '${key}'.`);
				continue;
			}
			properties.set(key, { keyNode, valueNode });
		}
		return properties;
	}

	protected readArray(node: JsonNode, label: string): readonly JsonNode[] | null {
		if (node.type !== 'array') {
			this.addDiagnostic('type', node.offset, node.length, `${label} must be an array.`);
			return null;
		}
		return node.children!;
	}

	protected checkUnknownProperties(
		properties: ReadonlyMap<string, JsonObjectProperty>,
		allowed: ReadonlySet<string>,
	): void {
		for (const [name, property] of properties) {
			if (!allowed.has(name)) {
				this.addDiagnostic(
					'unknown_property',
					property.keyNode.offset,
					property.keyNode.length,
					`Unknown property '${name}'.`,
				);
			}
		}
	}

	protected requiredProperty(
		properties: ReadonlyMap<string, JsonObjectProperty>,
		owner: JsonNode,
		name: string,
	): JsonNode | undefined {
		const property = properties.get(name);
		if (property === undefined) {
			this.addDiagnostic('required_property', owner.offset, owner.length, `Missing required property '${name}'.`);
			return;
		}
		return property.valueNode;
	}

	protected optionalProperty(
		properties: ReadonlyMap<string, JsonObjectProperty>,
		name: string,
	): JsonNode | undefined {
		return properties.get(name)?.valueNode;
	}

	protected readNonEmptyString(node: JsonNode, label: string): string | undefined {
		if (node.type !== 'string') {
			this.addDiagnostic('type', node.offset, node.length, `${label} must be a string.`);
			return;
		}
		const value = node.value as string;
		if (value.length === 0) {
			this.addDiagnostic('invalid_value', node.offset, node.length, `${label} must not be empty.`);
			return;
		}
		return value;
	}

	protected readBoolean(node: JsonNode, label: string): boolean | undefined {
		if (node.type !== 'boolean') {
			this.addDiagnostic('type', node.offset, node.length, `${label} must be a boolean.`);
			return;
		}
		return node.value as boolean;
	}

	protected readNumber(node: JsonNode, label: string): number | undefined {
		if (node.type !== 'number') {
			this.addDiagnostic('type', node.offset, node.length, `${label} must be a number.`);
			return;
		}
		const value = node.value as number;
		if (value > Number.MAX_VALUE || value < -Number.MAX_VALUE) {
			this.addDiagnostic('invalid_value', node.offset, node.length, `${label} must be finite.`);
			return;
		}
		return value;
	}

	protected readInteger(node: JsonNode, label: string): number | undefined {
		const value = this.readNumber(node, label);
		if (value !== undefined && !Number.isSafeInteger(value)) {
			this.addDiagnostic('invalid_value', node.offset, node.length, `${label} must be an integer.`);
			return;
		}
		return value;
	}

	protected readPositiveInteger(node: JsonNode, label: string): number | undefined {
		const value = this.readInteger(node, label);
		if (value !== undefined && value <= 0) {
			this.addDiagnostic('invalid_value', node.offset, node.length, `${label} must be greater than zero.`);
			return;
		}
		return value;
	}

	protected readNonNegativeInteger(node: JsonNode, label: string): number | undefined {
		const value = this.readInteger(node, label);
		if (value !== undefined && value < 0) {
			this.addDiagnostic('invalid_value', node.offset, node.length, `${label} must not be negative.`);
			return;
		}
		return value;
	}

	protected readEnum<TValue extends string>(
		node: JsonNode,
		label: string,
		values: ReadonlySet<TValue>,
	): TValue | undefined {
		const value = this.readNonEmptyString(node, label);
		if (value === undefined) {
			return;
		}
		if (!values.has(value as TValue)) {
			this.addDiagnostic('invalid_value', node.offset, node.length, `Invalid ${label} '${value}'.`);
			return;
		}
		return value as TValue;
	}

	protected addDiagnostic(
		code: JsoncSchemaDiagnosticCode | TAdditionalCode,
		offset: number,
		length: number,
		message: string,
	): void {
		let low = 0;
		let high = this.lineStarts.length;
		while (low < high) {
			const middle = (low + high) >>> 1;
			if (this.lineStarts[middle] <= offset) {
				low = middle + 1;
			} else {
				high = middle;
			}
		}
		const lineIndex = low - 1;
		this.diagnostics.push({
			code,
			message,
			offset,
			length,
			line: lineIndex + 1,
			column: offset - this.lineStarts[lineIndex] + 1,
		});
	}
}

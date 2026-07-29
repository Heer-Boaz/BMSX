export type PublicSymbolParityEntry = {
	ts: string;
	cpp_headers: string[];
};

export type PublicParameter = {
	type: string;
	optional: boolean;
};

export type PublicSignature = {
	parameters: PublicParameter[];
	returnType: string;
};

export type PublicField = {
	name: string;
	type: string;
	optional: boolean;
};

export type PublicMethod = {
	name: string;
	signatures: PublicSignature[];
};

export type PublicTypeSymbol = {
	kind: 'type';
	shape: string;
	fields: PublicField[];
	methods: PublicMethod[];
};

export type PublicEnumMember = {
	name: string;
	value: number | string;
};

export type PublicEnumSymbol = {
	kind: 'enum';
	semanticLabels: boolean;
	members: PublicEnumMember[];
};

export type PublicFunctionSymbol = {
	kind: 'function';
	signatures: PublicSignature[];
};

export type PublicValueSymbol = {
	kind: 'value';
	readonly: boolean;
	type: string;
	value?: number | string | boolean;
};

export type PublicSymbol =
	| PublicTypeSymbol
	| PublicEnumSymbol
	| PublicFunctionSymbol
	| PublicValueSymbol;

export type PublicSymbols = Map<string, PublicSymbol>;

export function canonicalTypeUnion(members: readonly string[]): string {
	const unique = [...new Set(members)].sort();
	const present = unique.filter((member) => member !== 'null' && member !== 'undefined');
	if (present.length !== unique.length) {
		return `optional(${canonicalTypeUnion(present)})`;
	}
	if (unique.length === 2) {
		const sequence = unique.find((member) => member.startsWith('sequence('));
		const scalar = unique.find((member) => !member.startsWith('sequence('));
		if (sequence && scalar && sequence === `sequence(${scalar})`) {
			return sequence;
		}
	}
	return unique.length === 1 ? unique[0] : `union(${unique.join('|')})`;
}

export function signatureKeys(signature: PublicSignature): string[] {
	const minimum = signature.parameters.findIndex((parameter) => parameter.optional);
	const minimumCount = minimum < 0 ? signature.parameters.length : minimum;
	const keys: string[] = [];
	for (let count = minimumCount; count <= signature.parameters.length; count += 1) {
		const parameterVariants = signature.parameters
			.slice(0, count)
			.map((parameter) => unionMembers(parameter.type));
		for (const parameters of cartesianProduct(parameterVariants)) {
			keys.push(`(${parameters.join(',')})->${signature.returnType}`);
		}
	}
	return keys;
}

function unionMembers(type: string): string[] {
	if (!type.startsWith('union(') || !type.endsWith(')')) {
		return [type];
	}
	return splitCanonicalUnion(type.slice(6, -1));
}

function splitCanonicalUnion(type: string): string[] {
	const members: string[] = [];
	let start = 0;
	let depth = 0;
	for (let index = 0; index < type.length; index += 1) {
		const char = type[index];
		switch (char) {
			case '(':
			case '{':
			case '[':
				depth += 1;
				break;
			case ')':
			case '}':
			case ']':
				depth -= 1;
				break;
			case '|':
				if (depth === 0) {
					members.push(type.slice(start, index));
					start = index + 1;
				}
				break;
		}
	}
	members.push(type.slice(start));
	return members;
}

function cartesianProduct(values: readonly string[][]): string[][] {
	let result: string[][] = [[]];
	for (const variants of values) {
		const next: string[][] = [];
		for (const prefix of result) {
			for (const variant of variants) {
				next.push([...prefix, variant]);
			}
		}
		result = next;
	}
	return result;
}

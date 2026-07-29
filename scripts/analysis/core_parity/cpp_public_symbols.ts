import fs from 'node:fs';
import path from 'node:path';
import {
	normalizeConstantExpression,
	numericExpressionValue,
	readDelimitedBody,
	splitTopLevel,
} from '../source_syntax';
import type {
	PublicField,
	PublicParameter,
	PublicSignature,
	PublicSymbols,
	PublicTypeSymbol,
} from './public_model';
import { canonicalTypeUnion } from './public_model';

type RawField = {
	name: string;
	type: string;
	optional: boolean;
};

type RawSignature = {
	parameters: Array<PublicParameter>;
	returnType: string;
};

type RawRecord = {
	kind: 'struct' | 'class' | 'union';
	fields: RawField[];
	methods: Map<string, RawSignature[]>;
	bases: string[];
};

type RawEnumMember = {
	name: string;
	expression?: string;
};

type CppCatalog = {
	aliases: Map<string, string>;
	records: Map<string, RawRecord>;
	enums: Map<string, RawEnumMember[]>;
	constants: Map<string, string>;
};

type RawPublicSymbol =
	| { kind: 'type'; name: string }
	| { kind: 'enum'; name: string }
	| { kind: 'function'; signatures: RawSignature[] }
	| { kind: 'value'; readonly: boolean; type: string; expression?: string };

type DeclarationKind = 'block' | 'function' | 'record' | 'statement';

type DeclarationVisitor = {
	onAccess?(access: 'public' | 'private' | 'protected'): void;
	onDeclaration(header: string, body: string | null, kind: DeclarationKind): void;
};

export function collectCppPublicSymbols(
	repoRoot: string,
	entryFiles: readonly string[][],
): PublicSymbols[] {
	const cppRoot = path.join(repoRoot, 'machine/cpp');
	const catalogFiles = new Set<string>();
	for (const files of entryFiles) {
		for (const file of files) {
			collectIncludedHeaders(path.join(repoRoot, file), cppRoot, catalogFiles);
		}
	}
	const catalog = createCatalog([...catalogFiles], cppRoot);
	return entryFiles.map((files) => {
		const raw = new Map<string, RawPublicSymbol>();
		for (const file of files) {
			collectHeaderPublicSymbols(path.join(repoRoot, file), cppRoot, catalog, raw);
		}
		return materializePublicSymbols(raw, catalog);
	});
}

function collectIncludedHeaders(file: string, cppRoot: string, files: Set<string>): void {
	if (files.has(file)) return;
	files.add(file);
	const source = fs.readFileSync(file, 'utf8');
	for (const match of source.matchAll(/^[ \t]*#include\s+"([^"]+)"/gm)) {
		const fromRoot = path.join(cppRoot, match[1]);
		const included = fs.existsSync(fromRoot)
			? fromRoot
			: path.join(path.dirname(file), match[1]);
		if (fs.existsSync(included)) {
			collectIncludedHeaders(included, cppRoot, files);
		}
	}
}

function createCatalog(files: readonly string[], cppRoot: string): CppCatalog {
	const catalog: CppCatalog = {
		aliases: new Map(),
		records: new Map(),
		enums: new Map(),
		constants: new Map(),
	};
	for (const file of files) {
		collectNamespaceDeclarations(readCppSource(file, cppRoot), (header, body, kind) => {
			const normalized = stripTemplatePrefix(header);
			const record = recordHeader(normalized);
			if (record && body !== null) {
				catalog.records.set(
					record.name,
					scanRecordBody(
						body,
						record.name,
						record.kind,
						record.bases,
					),
				);
				return;
			}
			const enumName = enumHeaderName(normalized);
			if (enumName && body !== null) {
				catalog.enums.set(enumName, enumMembers(body));
				return;
			}
			const alias = aliasDeclaration(normalized);
			if (alias) {
				catalog.aliases.set(alias.name, alias.target);
				return;
			}
			if (kind === 'statement' || kind === 'block') {
				const value = valueDeclaration(normalized);
				if (value?.expression) {
					catalog.constants.set(value.name, value.expression);
				}
			}
		});
	}
	return catalog;
}

function collectHeaderPublicSymbols(
	file: string,
	cppRoot: string,
	catalog: CppCatalog,
	symbols: Map<string, RawPublicSymbol>,
): void {
	collectNamespaceDeclarations(readCppSource(file, cppRoot), (header, body, kind) => {
		const normalized = stripTemplatePrefix(header);
		const record = recordHeader(normalized);
		if (record) {
			if (body !== null) {
				symbols.set(record.name, { kind: 'type', name: record.name });
			}
			return;
		}
		const enumName = enumHeaderName(normalized);
		if (enumName) {
			if (body !== null) {
				symbols.set(enumName, { kind: 'enum', name: enumName });
			}
			return;
		}
		const alias = aliasDeclaration(normalized);
		if (alias) {
			symbols.set(alias.name, { kind: 'type', name: alias.name });
			return;
		}
		if (kind === 'function') {
			const signature = functionDeclaration(normalized);
			if (signature) {
				const existing = symbols.get(signature.name);
				if (existing?.kind === 'function') {
					existing.signatures.push(signature.signature);
				} else {
					symbols.set(signature.name, { kind: 'function', signatures: [signature.signature] });
				}
			}
			return;
		}
		const value = valueDeclaration(normalized);
		if (value) {
			symbols.set(value.name, {
				kind: 'value',
				readonly: value.readonly,
				type: value.type,
				expression: value.expression ?? catalog.constants.get(value.name),
			});
		}
	});
}

function materializePublicSymbols(
	rawSymbols: ReadonlyMap<string, RawPublicSymbol>,
	catalog: CppCatalog,
): PublicSymbols {
	const symbols: PublicSymbols = new Map();
	for (const [name, raw] of rawSymbols) {
		switch (raw.kind) {
			case 'type':
				symbols.set(name, materializeType(name, catalog, new Set()));
				break;
			case 'enum':
				symbols.set(name, {
					kind: 'enum',
					semanticLabels: false,
					members: materializeEnum(raw.name, catalog),
				});
				break;
			case 'function':
				symbols.set(name, {
					kind: 'function',
					signatures: raw.signatures.map((signature) => materializeSignature(signature, catalog, new Set())),
				});
				break;
			case 'value': {
				const value = raw.expression
					? numericExpressionValue(raw.expression, catalog.constants)
					: undefined;
				symbols.set(name, {
					kind: 'value',
					readonly: raw.readonly,
					type: canonicalCppType(raw.type, catalog, new Set(), false),
					value,
				});
				break;
			}
		}
	}
	return symbols;
}

function materializeType(
	name: string,
	catalog: CppCatalog,
	seen: Set<string>,
): PublicTypeSymbol {
	if (seen.has(name)) {
		return { kind: 'type', shape: `named:${name}`, fields: [], methods: [] };
	}
	const nextSeen = new Set(seen);
	nextSeen.add(name);
	const alias = catalog.aliases.get(name);
	if (alias) {
		const aliasName = simpleTypeName(alias);
		if (aliasName && (catalog.aliases.has(aliasName) || catalog.records.has(aliasName))) {
			return materializeType(aliasName, catalog, nextSeen);
		}
		return {
			kind: 'type',
			shape: canonicalCppType(alias, catalog, nextSeen, false),
			fields: [],
			methods: [],
		};
	}
	const record = catalog.records.get(name);
	if (!record) {
		return { kind: 'type', shape: `named:${name}`, fields: [], methods: [] };
	}
	if (record.kind === 'union') {
		return {
			kind: 'type',
			shape: canonicalTypeUnion(
				record.fields.map((field) => canonicalCppType(field.type, catalog, nextSeen, true)),
			),
			fields: [],
			methods: [],
		};
	}
	const fields: PublicField[] = [];
	const methods = new Map<string, PublicSignature[]>();
	for (const base of record.bases) {
		const baseType = materializeType(base, catalog, nextSeen);
		fields.push(...baseType.fields);
		for (const method of baseType.methods) {
			methods.set(method.name, [...method.signatures]);
		}
	}
	for (const field of record.fields) {
		fields.push({
			name: field.name,
			optional: field.optional,
			type: canonicalCppType(field.type, catalog, nextSeen, field.optional),
		});
	}
	for (const [methodName, signatures] of record.methods) {
		const target = methods.get(methodName);
		const materialized = signatures.map((signature) => materializeSignature(signature, catalog, nextSeen));
		if (target) {
			target.push(...materialized);
		} else {
			methods.set(methodName, materialized);
		}
	}
	return {
		kind: 'type',
		shape: 'record',
		fields,
		methods: [...methods].map(([methodName, signatures]) => ({ name: methodName, signatures })),
	};
}

function materializeSignature(
	signature: RawSignature,
	catalog: CppCatalog,
	seen: Set<string>,
): PublicSignature {
	return {
		parameters: signature.parameters.map((parameter) => ({
			optional: parameter.optional,
			type: canonicalCppType(parameter.type, catalog, seen, false),
		})),
		returnType: signature.returnType === 'constructor'
			? 'constructor'
			: canonicalCppType(signature.returnType, catalog, seen, false),
	};
}

function materializeEnum(name: string, catalog: CppCatalog): Array<{ name: string; value: number | string }> {
	const members = catalog.enums.get(name)!;
	const result: Array<{ name: string; value: number | string }> = [];
	let nextValue = 0;
	for (const member of members) {
		let value: number | string = nextValue;
		if (member.expression) {
			value = numericExpressionValue(member.expression, catalog.constants)
				?? normalizeConstantExpression(member.expression);
		}
		result.push({ name: member.name, value });
		nextValue = typeof value === 'string' ? nextValue + 1 : value + 1;
	}
	return result;
}

function canonicalCppType(
	rawType: string,
	catalog: CppCatalog,
	seen: Set<string>,
	stripOptional: boolean,
): string {
	let type = rawType
		.replace(/\[\[[\s\S]*?\]\]/g, '')
		.replace(/\b(?:inline|constexpr|consteval|constinit|extern|static|virtual|explicit|friend|mutable|typename)\b/g, ' ')
		.replace(/\s+/g, ' ')
		.trim();
	type = type.replace(/\s*&&?\s*$/, '').trim();
	type = type.replace(/^const\s+/, '').replace(/\s+const$/, '').trim();
	if (/^(?:void|auto)$/.test(type)) return type;
	if (type === 'std::monostate') return 'null';
	if (/^(?:bool)$/.test(type)) return 'boolean';
	if (/^(?:char|signed char|unsigned char|short|unsigned short|int|unsigned|unsigned int|long|unsigned long|long long|unsigned long long|size_t|ptrdiff_t|i\d+|u\d+|f\d+|float|double|uint\d+_t|int\d+_t)$/.test(type)) {
		return 'number';
	}
	if (/^(?:std::)?string(?:_view)?$/.test(type)) return 'string';
	if (/^(?:const\s+)?char\s*\*$/.test(type)) return 'string';
	const template = templateType(type);
	if (template) {
		const args = splitTopLevel(template.arguments);
		switch (template.name) {
			case 'std::optional':
				return stripOptional
					? canonicalCppType(args[0], catalog, seen, false)
					: `optional(${canonicalCppType(args[0], catalog, seen, false)})`;
			case 'std::vector':
			case 'std::span':
			case 'std::array': {
				const element = canonicalCppType(args[0], catalog, seen, false);
				if (element === 'number' && /\bu8\b|uint8_t/.test(args[0])) {
					return 'bytes';
				}
				if (template.name !== 'std::array') {
					return `sequence(${element})`;
				}
				const count = numericExpressionValue(args[1], catalog.constants);
				return count === undefined || count > 8
					? `sequence(${element})`
					: `tuple(${Array(count).fill(element).join(',')})`;
			}
			case 'std::variant':
				return canonicalTypeUnion(args.map((argument) => canonicalCppType(argument, catalog, seen, false)));
			case 'std::unordered_map':
			case 'std::map':
				return `map(${canonicalCppType(args[0], catalog, seen, false)},${canonicalCppType(args[1], catalog, seen, false)})`;
		}
	}
	if (/\*$/.test(type)) {
		const pointee = type.replace(/\s*\*$/, '').trim();
		if (/^(?:u8|uint8_t)$/.test(pointee.replace(/^const\s+/, ''))) return 'bytes';
		if (pointee === 'void' || pointee === 'const void') return 'opaque-ref';
		const inner = canonicalCppType(pointee, catalog, seen, false);
		return stripOptional ? inner : `optional(${inner})`;
	}
	const name = simpleTypeName(type);
	if (!name) return type.replace(/\s+/g, '');
	if (/(?:Fn|Callback)$/.test(name)) return 'callable';
	if (/^(?:T|K|V|Context)$/.test(name)) return 'type-param';
	if (catalog.aliases.has(name)) {
		if (seen.has(name)) return `named:${name.toLowerCase()}`;
		if (/^\s*std::variant\s*</.test(catalog.aliases.get(name)!)) {
			return `named:${name.toLowerCase()}`;
		}
		const targetName = simpleTypeName(catalog.aliases.get(name)!);
		if (targetName && (catalog.records.has(targetName) || aliasResolvesToRecord(targetName, catalog, new Set()))) {
			return `named:${name.toLowerCase()}`;
		}
		const nextSeen = new Set(seen);
		nextSeen.add(name);
		return canonicalCppType(catalog.aliases.get(name)!, catalog, nextSeen, stripOptional);
	}
	if (catalog.enums.has(name)) return `enum:${name.toLowerCase()}`;
	if (catalog.records.has(name)) {
		return `named:${name.toLowerCase()}`;
	}
	return `named:${name.toLowerCase()}`;
}

function aliasResolvesToRecord(name: string, catalog: CppCatalog, seen: Set<string>): boolean {
	if (seen.has(name)) return false;
	if (catalog.records.has(name)) return true;
	const target = catalog.aliases.get(name);
	if (!target) return false;
	const targetName = simpleTypeName(target);
	if (!targetName) return false;
	const nextSeen = new Set(seen);
	nextSeen.add(name);
	return aliasResolvesToRecord(targetName, catalog, nextSeen);
}

function readCppSource(file: string, cppRoot: string): string {
	const source = fs.readFileSync(file, 'utf8').replace(
		/^[ \t]*#include\s+"([^"]+\.inl)"/gm,
		(_include, relativePath: string) => fs.readFileSync(
			path.join(cppRoot, relativePath),
			'utf8',
		),
	);
	return source
		.replace(/\/\*[\s\S]*?\*\//g, '')
		.replace(/\/\/.*$/gm, '')
		.replace(/^[ \t]*#.*$/gm, '');
}

function collectNamespaceDeclarations(
	source: string,
	visit: (header: string, body: string | null, kind: DeclarationKind) => void,
): void {
	scanDeclarations(source, {
		onDeclaration(header, body) {
			const normalized = header.trim();
			if (!/^namespace\s+bmsx\b/.test(normalized) || body === null) {
				return;
			}
			scanDeclarations(body, { onDeclaration: visit });
		},
	});
}

function scanDeclarations(source: string, visitor: DeclarationVisitor): void {
	let start = 0;
	let parenDepth = 0;
	let bracketDepth = 0;
	let quote = '';
	for (let index = 0; index < source.length; index += 1) {
		const char = source[index];
		if (quote) {
			if (char === quote && source[index - 1] !== '\\') quote = '';
			continue;
		}
		switch (char) {
			case '"':
			case '\'':
				quote = char;
				continue;
			case '(':
				parenDepth += 1;
				break;
			case ')':
				parenDepth -= 1;
				break;
			case '[':
				bracketDepth += 1;
				break;
			case ']':
				bracketDepth -= 1;
				break;
		}
		if (parenDepth !== 0 || bracketDepth !== 0) continue;
		if (char === ':') {
			const access = source.slice(start, index).trim();
			switch (access) {
				case 'public':
				case 'private':
				case 'protected':
					visitor.onAccess?.(access);
					start = index + 1;
					break;
			}
			continue;
		}
		if (char !== ';' && char !== '{') continue;
		const header = source.slice(start, index).trim();
		if (char === ';') {
			if (header) {
				visitor.onDeclaration(header, null, functionDeclaration(header) ? 'function' : 'statement');
			}
			start = index + 1;
			continue;
		}
		const body = readDelimitedBody(source, index);
		const closeIndex = index + body.length + 1;
		const normalized = stripTemplatePrefix(header);
		const record = recordHeader(normalized);
		const enumName = enumHeaderName(normalized);
		const namespace = /^namespace\b/.test(normalized);
		const fn = functionDeclaration(normalized);
		if (!record && !enumName && !namespace && !fn) {
			visitor.onDeclaration(header, null, 'statement');
			index = declarationEndIndex(source, closeIndex);
			start = index + 1;
			continue;
		}
		const kind: DeclarationKind = record ? 'record' : fn ? 'function' : 'block';
		visitor.onDeclaration(header, body, kind);
		index = declarationEndIndex(source, closeIndex);
		start = index + 1;
	}
}

function declarationEndIndex(source: string, closeIndex: number): number {
	let index = closeIndex;
	while (index + 1 < source.length && /\s/.test(source[index + 1])) index += 1;
	return source[index + 1] === ';' ? index + 1 : index;
}

function scanRecordBody(
	body: string,
	className: string,
	kind: RawRecord['kind'],
	bases: string[],
): RawRecord {
	const fields: RawField[] = [];
	const methods = new Map<string, RawSignature[]>();
	let publicSection = kind !== 'class';
	scanDeclarations(body, {
		onAccess(access) {
			publicSection = access === 'public';
		},
		onDeclaration(header, nestedBody, kind) {
			if (!publicSection) return;
			if (kind === 'function') {
				const fn = functionDeclaration(stripTemplatePrefix(header), className);
				if (!fn) return;
				const methodName = fn.name === className ? 'constructor' : fn.name;
				const signatures = methods.get(methodName);
				if (signatures) signatures.push(fn.signature);
				else methods.set(methodName, [fn.signature]);
				return;
			}
			if (nestedBody === null) {
				const field = fieldDeclaration(header);
				if (field) fields.push(field);
			}
		},
	});
	return { kind, fields, methods, bases };
}

function stripTemplatePrefix(header: string): string {
	const template = /^\s*template\s*</.exec(header);
	if (!template) return header.trim();
	const openIndex = header.indexOf('<', template.index);
	const argumentsText = readDelimitedBody(header, openIndex);
	return header.slice(openIndex + argumentsText.length + 2).trim();
}

function recordHeader(header: string): { kind: RawRecord['kind']; name: string; bases: string[] } | null {
	const match = /^(struct|class|union)\s+([A-Za-z_]\w*)(?:\s*:\s*([\s\S]+))?$/.exec(header);
	if (!match) return null;
	const bases = match[3]
		? splitTopLevel(match[3]).map((base) => base.replace(/\b(?:public|private|protected|virtual)\b/g, '').trim())
		: [];
	return { kind: match[1] as RawRecord['kind'], name: match[2], bases };
}

function enumHeaderName(header: string): string | undefined {
	return /^enum(?:\s+class)?\s+([A-Za-z_]\w*)\b/.exec(header)?.[1];
}

function enumMembers(body: string): RawEnumMember[] {
	const entries: string[] = [];
	for (const entry of splitTopLevel(body)) {
		const macros = [...entry.matchAll(/[A-Z_]+\(\s*([A-Za-z_]\w*)\s*\)/g)];
		if (macros.length > 1) {
			entries.push(...macros.map((match) => match[0]));
		} else {
			entries.push(entry);
		}
	}
	return entries.map((entry) => {
		const equals = topLevelEquals(entry);
		const rawName = (equals < 0 ? entry : entry.slice(0, equals)).trim();
		const macroName = /^[A-Z_]+\(\s*([A-Za-z_]\w*)\s*\)$/.exec(rawName);
		return {
			name: macroName?.[1] ?? rawName,
			expression: equals < 0 ? undefined : entry.slice(equals + 1).trim(),
		};
	});
}

function aliasDeclaration(header: string): { name: string; target: string } | null {
	const match = /^using\s+([A-Za-z_]\w*)\s*=\s*([\s\S]+)$/.exec(header);
	return match ? { name: match[1], target: match[2].trim() } : null;
}

function fieldDeclaration(header: string): RawField | null {
	if (/^(?:using|typedef|enum|class|struct)\b/.test(header.trim()) || functionDeclaration(header)) {
		return null;
	}
	const declaration = withoutInitializer(header)
		.replace(/\[\[[\s\S]*?\]\]/g, '')
		.trim();
	const match = /([A-Za-z_]\w*)\s*(?:\[[^\]]*\])?$/.exec(declaration);
	if (!match) return null;
	const type = declaration.slice(0, match.index).trim();
	return {
		name: match[1],
		type,
		optional: /^(?:(?:const|constexpr|mutable|static)\s+)*std::optional\s*</.test(type)
			|| /\*\s*$/.test(type),
	};
}

function valueDeclaration(header: string): {
	name: string;
	type: string;
	readonly: boolean;
	expression?: string;
} | null {
	const field = fieldDeclaration(header);
	if (!field) return null;
	const equals = topLevelEquals(header);
	return {
		name: field.name,
		type: field.type,
		readonly: /\b(?:const|constexpr)\b/.test(field.type),
		expression: equals < 0 ? undefined : header.slice(equals + 1).trim(),
	};
}

function functionDeclaration(
	header: string,
	className?: string,
): { name: string; signature: RawSignature } | null {
	const openIndex = header.indexOf('(');
	const assignmentIndex = topLevelEquals(header);
	if (openIndex < 0 || (assignmentIndex >= 0 && assignmentIndex < openIndex)) return null;
	const parametersText = readDelimitedBody(header, openIndex);
	const closeIndex = openIndex + parametersText.length + 1;
	const prefix = header.slice(0, openIndex).trim();
	const nameMatch = /(~?[A-Za-z_]\w*)\s*$/.exec(prefix);
	if (
		!nameMatch
		|| nameMatch[1].startsWith('~')
		|| nameMatch[1] === 'operator'
		|| nameMatch[1] === 'static_assert'
	) {
		return null;
	}
	const name = nameMatch[1];
	let returnType = prefix.slice(0, nameMatch.index)
		.replace(/\b(?:inline|constexpr|consteval|static|virtual|explicit|friend|extern|nodiscard)\b/g, ' ')
		.replace(/\s+/g, ' ')
		.trim();
	if (name === className || !returnType) {
		returnType = 'constructor';
	} else if (returnType === 'auto') {
		const trailing = /->\s*([\s\S]+?)(?:\s+(?:const|noexcept))?$/.exec(header.slice(closeIndex + 1));
		if (trailing) returnType = trailing[1].trim();
	}
	const parameters = splitTopLevel(parametersText);
	return {
		name,
		signature: {
			parameters: parameters.length === 1 && parameters[0] === 'void'
				? []
				: parameters.map(parameterDeclaration),
			returnType,
		},
	};
}

function parameterDeclaration(parameter: string): PublicParameter {
	const equals = topLevelEquals(parameter);
	const declaration = beforeTopLevelAssignment(parameter, equals).trim();
	const cleaned = declaration.replace(/\[\[[\s\S]*?\]\]/g, '').trim();
	const match = /([A-Za-z_]\w*)\s*(?:\[[^\]]*\])?$/.exec(cleaned);
	const type = match ? cleaned.slice(0, match.index).trim() : cleaned;
	return { type, optional: equals >= 0 };
}

function withoutInitializer(header: string): string {
	const equals = topLevelEquals(header);
	const declaration = beforeTopLevelAssignment(header, equals);
	if (declaration !== header) return declaration;
	const brace = header.indexOf('{');
	return brace < 0 ? header : header.slice(0, brace);
}

function beforeTopLevelAssignment(text: string, equals: number): string {
	return equals < 0 ? text : text.slice(0, equals);
}

function topLevelEquals(text: string): number {
	let parenDepth = 0;
	let bracketDepth = 0;
	let braceDepth = 0;
	let angleDepth = 0;
	for (let index = 0; index < text.length; index += 1) {
		const char = text[index];
		if (char === '(') parenDepth += 1;
		else if (char === ')') parenDepth -= 1;
		else if (char === '[') bracketDepth += 1;
		else if (char === ']') bracketDepth -= 1;
		else if (char === '{') braceDepth += 1;
		else if (char === '}') braceDepth -= 1;
		else if (char === '<') angleDepth += 1;
		else if (char === '>') angleDepth -= 1;
		else if (
			char === '='
			&& parenDepth === 0
			&& bracketDepth === 0
			&& braceDepth === 0
			&& angleDepth === 0
		) {
			return index;
		}
	}
	return -1;
}

function templateType(type: string): { name: string; arguments: string } | null {
	const open = type.indexOf('<');
	if (open < 0 || !type.endsWith('>')) return null;
	return {
		name: type.slice(0, open).trim(),
		arguments: type.slice(open + 1, -1),
	};
}

function simpleTypeName(type: string): string | undefined {
	const cleaned = type
		.replace(/\bconst\b/g, '')
		.replace(/[&*]/g, '')
		.trim();
	const match = /^(?:bmsx::)?([A-Za-z_]\w*)$/.exec(cleaned);
	return match?.[1];
}

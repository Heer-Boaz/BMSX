import { LuaSyntaxKind } from '../syntax/ast';
import type { FileSemanticData, SymbolID } from './model';
import { semanticValueSourceKey, type MemberValueEntry, type SemanticValueSource } from './value_graph';

type WrittenDeclarationIndex = {
	members?: ReadonlyMap<string, ReadonlyMap<string, readonly SymbolID[]>>;
	readonly answers: Map<string, readonly SymbolID[]>;
};

const indices = new WeakMap<FileSemanticData, WrittenDeclarationIndex>();
const NO_DECLARATIONS: readonly SymbolID[] = [];

function indexWrittenDeclarations(file: FileSemanticData): ReadonlyMap<string, ReadonlyMap<string, readonly SymbolID[]>> {
	const members = new Map<string, Map<string, SymbolID[]>>();
	const record = (entry: MemberValueEntry): void => {
		// Unknown and literal values are not storage identities. Equal values
		// cannot relate writes through unrelated expressions.
		if (entry.owner.root.kind === 'unknown' || entry.owner.root.kind === 'literal') return;
		const key = semanticValueSourceKey(entry.owner);
		let names = members.get(key);
		if (names === undefined) {
			names = new Map();
			members.set(key, names);
		}
		const declarations = names.get(entry.name);
		if (declarations === undefined) names.set(entry.name, [entry.declId]);
		else declarations.push(entry.declId);
	};
	for (const entry of file.memberValues) record(entry);
	for (const flow of file.functionValueFlows) for (const entry of flow.members) record(entry);
	return members;
}

/**
 * Direct written destinations in this file, not possible values. A member can
 * name an exact raw write or a field of a directly written table constructor.
 * Constructor traversal consumes one member step; aliases and calls never run.
 */
export function getLuaWrittenDeclarations(file: FileSemanticData, source: SemanticValueSource): readonly SymbolID[] {
	let index = indices.get(file);
	if (index === undefined) {
		index = { answers: new Map() };
		indices.set(file, index);
	}
	const key = semanticValueSourceKey(source);
	const retained = index.answers.get(key);
	if (retained !== undefined) return retained;
	if (source.steps.length === 0) {
		const declarations = source.root.kind === 'declaration' ? [source.root.declId] : NO_DECLARATIONS;
		index.answers.set(key, declarations);
		return declarations;
	}
	const step = source.steps[source.steps.length - 1];
	if (step.kind !== 'member') {
		index.answers.set(key, NO_DECLARATIONS);
		return NO_DECLARATIONS;
	}
	for (let position = 0; position < source.steps.length - 1; position += 1) {
		if (source.steps[position].kind !== 'member') {
			index.answers.set(key, NO_DECLARATIONS);
			return NO_DECLARATIONS;
		}
	}
	if (index.members === undefined) index.members = indexWrittenDeclarations(file);
	const owner = { root: source.root, steps: source.steps.slice(0, -1) };
	const direct = index.members.get(semanticValueSourceKey(owner))?.get(step.name);
	const declarations = direct === undefined ? [] : [...direct];
	for (const declaration of getLuaWrittenDeclarations(file, owner)) {
		const writes = file.declarationValuesByDeclaration.get(declaration);
		if (writes === undefined) continue;
		for (const write of writes) {
			const value = write.source;
			if (value.steps.length !== 0 || value.root.kind !== 'owned'
				|| value.root.syntax.kind !== LuaSyntaxKind.TableConstructorExpression) continue;
			const fields = index.members.get(semanticValueSourceKey(value))?.get(step.name);
			if (fields === undefined) continue;
			for (const field of fields) if (!declarations.includes(field)) declarations.push(field);
		}
	}
	index.answers.set(key, declarations);
	return declarations;
}

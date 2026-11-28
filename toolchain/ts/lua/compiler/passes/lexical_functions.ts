import { toLuaModulePath } from '../../module_path';
import type { LuaSemanticFrontendFile } from '../../semantic/frontend';
import type { Decl } from '../../semantic/model';
import {
	LuaAssignmentOperator,
	LuaSyntaxKind,
	type LuaChunk,
	type LuaExpression,
	type LuaFunctionExpression,
	type LuaIdentifierExpression,
} from '../../syntax/ast';
import { walkLuaAst } from '../../syntax/ast/traversal';
import { getBoundDeclaration, getBoundIdentifierReference } from '../bound_reference';

export type LexicalFunction = {
	readonly name: string;
	readonly expression: LuaFunctionExpression;
};

type Definition = LexicalFunction & {
	readonly declaration: Decl;
	readonly write?: LuaIdentifierExpression;
};

function isLiteral(value: LuaExpression): boolean {
	switch (value.kind) {
		case LuaSyntaxKind.NumericLiteralExpression:
		case LuaSyntaxKind.StringLiteralExpression:
		case LuaSyntaxKind.BooleanLiteralExpression:
		case LuaSyntaxKind.NilLiteralExpression:
			return true;
		default:
			return false;
	}
}

function isStaticModuleImport(value: LuaExpression, file: LuaSemanticFrontendFile, modules: ReadonlySet<string>): boolean {
	if (value.kind !== LuaSyntaxKind.CallExpression || value.method !== null || value.arguments.length !== 1) return false;
	const { callee, arguments: [path] } = value;
	return callee.kind === LuaSyntaxKind.IdentifierExpression && callee.name === 'require'
		&& getBoundIdentifierReference(file, callee).kind !== 'lexical'
		&& path.kind === LuaSyntaxKind.StringLiteralExpression && modules.has(toLuaModulePath(path.value));
}

/**
 * Prove that a lexical binding is only a call target, and that its code
 * does not depend on the identity of any activation. The initial proof
 * covers flat chunk declarations and an initialization prefix ending at
 * the first operation that could publish or invoke one of those functions.
 */
export function collectLexicalFunctions(
	chunk: LuaChunk,
	file: LuaSemanticFrontendFile,
	staticModules: ReadonlySet<string>,
	retainsClosure?: (definition: { readonly declaration: Decl; readonly expression: LuaFunctionExpression }) => boolean,
): ReadonlyMap<string, LexicalFunction> {
	const definitions = new Map<string, Definition>();
	if (chunk.body.hasJumps) return definitions;
	const forward = new Map<string, Decl>();
	const constants = new Set<string>();
	const imports = new Set<string>();
	let started = false;
	for (const cursor = chunk.body.cursor(); cursor.statement !== undefined; cursor.advance()) {
		const statement = cursor.statement;
		if (statement.kind === LuaSyntaxKind.LocalFunctionStatement && statement.attribute === null) {
			const declaration = getBoundDeclaration(file, statement.name);
			definitions.set(declaration.id, { declaration, name: declaration.name, expression: statement.functionExpression });
			started = true;
			continue;
		}
		if (statement.kind === LuaSyntaxKind.LocalAssignmentStatement) {
			if (statement.names.length === 1 && statement.values.length <= 1) {
				const declaration = getBoundDeclaration(file, statement.names[0]);
				const value = statement.values[0];
				if (value?.kind === LuaSyntaxKind.FunctionExpression && statement.pointerTypeRefs[0] === null) {
					definitions.set(declaration.id, { declaration, name: declaration.name, expression: value });
					started = true;
					continue;
				}
				if (value === undefined && statement.attributes[0] === null && statement.pointerTypeRefs[0] === null) {
					forward.set(declaration.id, declaration);
					started = true;
					continue;
				}
				if (value !== undefined && statement.attributes[0] === 'const') {
					if (isLiteral(value)) {
						constants.add(declaration.id);
						continue;
					}
					if (isStaticModuleImport(value, file, staticModules)) {
						imports.add(declaration.id);
						continue;
					}
				}
			}
		} else if (statement.kind === LuaSyntaxKind.AssignmentStatement && statement.operator === LuaAssignmentOperator.Assign
			&& statement.left.length === 1 && statement.right.length === 1) {
			const [write] = statement.left, [value] = statement.right;
			if (write.kind === LuaSyntaxKind.IdentifierExpression && value.kind === LuaSyntaxKind.FunctionExpression) {
				const reference = getBoundIdentifierReference(file, write);
				const declaration = reference.kind === 'lexical' ? forward.get(reference.decl.id) : undefined;
				if (declaration !== undefined) {
					definitions.set(declaration.id, { declaration, name: declaration.name, expression: value, write });
					forward.delete(declaration.id);
					continue;
				}
			}
		}
		if (started) break;
	}
	if (definitions.size === 0) return definitions;

	// A definition is shared only when no authored use observes its value
	// or mutates its binding. Use exact identifier occurrences, not names.
	const callees = new Set<LuaIdentifierExpression>();
	const namespaceBases = new Set<LuaIdentifierExpression>();
	const rejected = new Set<string>();
	if (retainsClosure !== undefined) {
		for (const [id, definition] of definitions) if (retainsClosure(definition)) rejected.add(id);
	}
	walkLuaAst(chunk, node => {
		if (node.kind === LuaSyntaxKind.CallExpression && node.method === null
			&& node.callee.kind === LuaSyntaxKind.IdentifierExpression) {
			callees.add(node.callee);
		} else if ((node.kind === LuaSyntaxKind.MemberExpression
			|| (node.kind === LuaSyntaxKind.IndexExpression && node.index.kind === LuaSyntaxKind.StringLiteralExpression))
			&& node.base.kind === LuaSyntaxKind.IdentifierExpression) {
			namespaceBases.add(node.base);
		} else if (node.kind === LuaSyntaxKind.IdentifierExpression) {
			const reference = file.getReference(node);
			if (reference?.kind !== 'lexical') return;
			const definition = definitions.get(reference.decl.id);
			if (definition !== undefined && node !== definition.write && !callees.has(node))
				rejected.add(reference.decl.id);
		}
	});

	// Collect the reverse edges of the candidate graph. A dependency on
	// a runtime value disqualifies its users, including recursive groups.
	const callers = new Map<string, Set<string>>();
	for (const [id, definition] of definitions) {
		if (rejected.has(id)) continue;
		const chunkScope = definition.declaration.scope;
		walkLuaAst(definition.expression.body, node => {
			if (node.kind !== LuaSyntaxKind.IdentifierExpression) return;
			const reference = file.getReference(node);
			if (reference?.kind !== 'lexical' || reference.decl.scope !== chunkScope) return;
			const dependency = reference.decl.id;
			if (constants.has(dependency)
				|| (imports.has(dependency) && (namespaceBases.has(node) || callees.has(node)))) return;
			if (!definitions.has(dependency)) {
				rejected.add(id);
			} else if (dependency !== id) {
				let incoming = callers.get(dependency);
				if (incoming === undefined) callers.set(dependency, incoming = new Set());
				incoming.add(id);
			}
		});
	}
	for (const id of rejected) {
		definitions.delete(id);
		const incoming = callers.get(id);
		if (incoming === undefined) continue;
		for (const caller of incoming) rejected.add(caller);
	}
	return definitions;
}

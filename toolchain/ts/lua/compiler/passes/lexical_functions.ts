import { toLuaModulePath } from '../../module_path';
import type { LuaBoundReference, LuaSemanticFrontendFile } from '../../semantic/frontend';
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
	readonly environment: readonly LuaBoundReference[];
};

type Definition = LexicalFunction & {
	readonly declaration: Decl;
	readonly write?: LuaIdentifierExpression;
	readonly environment: LuaBoundReference[];
	readonly calls: Set<string>;
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
	const runtimeConstants = new Set<string>();
	const owners = new Map<LuaFunctionExpression, string>();
	const define = (declaration: Decl, expression: LuaFunctionExpression, write?: LuaIdentifierExpression) => {
		definitions.set(declaration.id, { declaration, name: declaration.name, expression, write, environment: [], calls: new Set() });
		owners.set(expression, declaration.id);
	};
	let started = false;
	for (const cursor = chunk.body.cursor(); cursor.statement !== undefined; cursor.advance()) {
		const statement = cursor.statement;
		if (statement.kind === LuaSyntaxKind.LocalFunctionStatement && statement.attribute === null) {
			const declaration = getBoundDeclaration(file, statement.name);
			define(declaration, statement.functionExpression);
			started = true;
			continue;
		}
		if (statement.kind === LuaSyntaxKind.LocalAssignmentStatement) {
			if (statement.names.length === 1 && statement.values.length <= 1) {
				const declaration = getBoundDeclaration(file, statement.names[0]);
				const value = statement.values[0];
				if (value?.kind === LuaSyntaxKind.FunctionExpression && statement.pointerTypeRefs[0] === null) {
					define(declaration, value);
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
					// Plain computed Values already exist before any of the
					// known callees can run. Do not lift a typed address view,
					// or a compile-time module alias that has no Value slot.
					if (!started && statement.pointerTypeRefs[0] === null
						&& (value.kind === LuaSyntaxKind.TableConstructorExpression
							|| (value.kind === LuaSyntaxKind.CallExpression && (value.callee.kind !== LuaSyntaxKind.IdentifierExpression
								|| value.callee.name !== 'require')))) runtimeConstants.add(declaration.id);
				}
			}
		} else if (statement.kind === LuaSyntaxKind.AssignmentStatement && statement.operator === LuaAssignmentOperator.Assign
			&& statement.left.length === 1 && statement.right.length === 1) {
			const [write] = statement.left, [value] = statement.right;
			if (write.kind === LuaSyntaxKind.IdentifierExpression && value.kind === LuaSyntaxKind.FunctionExpression) {
				const reference = getBoundIdentifierReference(file, write);
				const declaration = reference.kind === 'lexical' ? forward.get(reference.decl.id) : undefined;
				if (declaration !== undefined) {
					define(declaration, value, write);
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
	const calledFromClosure = new Set<string>();
	if (retainsClosure !== undefined) {
		for (const [id, definition] of definitions) if (retainsClosure(definition)) rejected.add(id);
	}
	const scan = (body: LuaChunk | LuaFunctionExpression['body'], owner: string | null | undefined) => walkLuaAst(body, node => {
		if (node.kind === LuaSyntaxKind.FunctionExpression) {
			scan(node.body, owners.get(node));
			return false;
		}
		if (node.kind === LuaSyntaxKind.CallExpression && node.method === null
			&& node.callee.kind === LuaSyntaxKind.IdentifierExpression) {
			callees.add(node.callee);
			const reference = file.getReference(node.callee);
			if (owner === undefined && reference?.kind === 'lexical' && definitions.has(reference.decl.id))
				calledFromClosure.add(reference.decl.id);
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
	scan(chunk, null);

	// A statically called function can receive immutable free Values in
	// registers instead of allocating a Closure. Propagate that environment
	// along known calls so the code never reads it from a physical frame.
	const callers = new Map<string, Set<string>>();
	const observesActivation = new Set<string>();
	const environments: { owner: string; binding: LuaBoundReference }[] = [];
	for (const [id, definition] of definitions) {
		const chunkScope = definition.declaration.scope;
		if (definition.expression.hasVararg) observesActivation.add(id);
		walkLuaAst(definition.expression.body, node => {
			if (node.kind === LuaSyntaxKind.FunctionExpression || (node.kind === LuaSyntaxKind.MemberExpression
				&& node.member.name === 'argument_count' && node.base.kind === LuaSyntaxKind.IdentifierExpression
				&& node.base.name === 'blua32' && file.getReference(node.base)?.kind === 'reserved_intrinsic')) observesActivation.add(id);
			if (node.kind !== LuaSyntaxKind.IdentifierExpression) return;
			const reference = file.getReference(node);
			if (reference?.kind !== 'lexical' || reference.decl.scope !== chunkScope) return;
			const dependency = reference.decl.id;
			if (constants.has(dependency)
				|| (imports.has(dependency) && (namespaceBases.has(node) || callees.has(node)))) return;
			if (runtimeConstants.has(dependency)) {
				if (definition.environment.some(capture => capture.decl.id === dependency)) return;
				definition.environment.push(reference);
				environments.push({ owner: id, binding: reference });
			} else if (!definitions.has(dependency)) {
				rejected.add(id);
			} else if (dependency !== id) {
				definition.calls.add(dependency);
				let incoming = callers.get(dependency);
				if (incoming === undefined) callers.set(dependency, incoming = new Set());
				incoming.add(id);
			}
		});
	}
	for (const { owner, binding } of environments) {
		for (const caller of callers.get(owner) ?? []) {
			const environment = definitions.get(caller)!.environment;
			if (!environment.some(capture => capture.decl.id === binding.decl.id)) {
				environment.push(binding);
				environments.push({ owner: caller, binding });
			}
		}
	}
	for (const [id, definition] of definitions) {
		if (definition.environment.length !== 0 && (observesActivation.has(id) || calledFromClosure.has(id))) rejected.add(id);
	}
	for (const id of rejected) {
		for (const callee of definitions.get(id)!.calls) {
			if (definitions.get(callee)!.environment.length !== 0) rejected.add(callee);
		}
		const incoming = callers.get(id);
		if (incoming === undefined) continue;
		for (const caller of incoming) rejected.add(caller);
	}
	for (const id of rejected) definitions.delete(id);
	return definitions;
}

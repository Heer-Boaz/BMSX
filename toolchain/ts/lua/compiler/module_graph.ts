import {
	LuaSyntaxKind,
	type LuaCallExpression,
	type LuaChunk,
	type LuaIdentifierExpression,
	type LuaStringLiteralExpression,
} from '../syntax/ast';
import { visitCallExpressionsInStatements } from '../syntax/calls';
import { toLuaModulePath } from '../module_path';

export function collectLuaModuleDependencies(
	chunk: LuaChunk,
	modulePaths: ReadonlySet<string>,
): string[] {
	const dependencies: string[] = [];
	const seen = new Set<string>();
	visitCallExpressionsInStatements(chunk.body, (call: LuaCallExpression) => {
		if (call.method !== null
			|| call.arguments.length !== 1
			|| call.callee.kind !== LuaSyntaxKind.IdentifierExpression
			|| (call.callee as LuaIdentifierExpression).name !== 'require'
			|| call.arguments[0].kind !== LuaSyntaxKind.StringLiteralExpression) {
			return;
		}
		const literalPath = (call.arguments[0] as LuaStringLiteralExpression).value;
		const modulePath = toLuaModulePath(literalPath);
		if (!modulePaths.has(modulePath) || seen.has(modulePath)) {
			return;
		}
		seen.add(modulePath);
		dependencies.push(modulePath);
	});
	return dependencies;
}

export function collectLuaModuleDependencyClosure(
	rootChunks: ReadonlyArray<LuaChunk>,
	modulePaths: ReadonlySet<string>,
	loadModuleChunk: (path: string) => LuaChunk,
): string[] {
	const queuedModules: string[] = [];
	const seenModules = new Set<string>();
	const enqueueDependencies = (chunk: LuaChunk): void => {
		const dependencies = collectLuaModuleDependencies(chunk, modulePaths);
		for (let index = 0; index < dependencies.length; index += 1) {
			const modulePath = dependencies[index];
			if (!seenModules.has(modulePath)) {
				seenModules.add(modulePath);
				queuedModules.push(modulePath);
			}
		}
	};
	for (let index = 0; index < rootChunks.length; index += 1) {
		enqueueDependencies(rootChunks[index]);
	}
	for (let index = 0; index < queuedModules.length; index += 1) {
		enqueueDependencies(loadModuleChunk(queuedModules[index]));
	}
	return queuedModules;
}

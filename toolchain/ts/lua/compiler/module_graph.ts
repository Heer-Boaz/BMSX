import { stronglyConnectedComponents, type StronglyConnectedNode } from '../../collections/strongly_connected_components';
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

/** Visit bodies after their dependencies, preserving input order within a cycle. */
export function orderLuaModuleBodies<T extends { path: string }>(
	modules: readonly T[], dependenciesByPath: ReadonlyMap<string, readonly string[]>,
): T[] {
	type Node = StronglyConnectedNode<Node> & { module: T; order: number; dependencies: Node[] };
	const nodes = new Map<string, Node>();
	for (let order = 0; order < modules.length; ++order) {
		const module = modules[order];
		nodes.set(module.path, { module, order, dependencies: [], index: -1, lowlink: 0, component: -1, active: false });
	}
	for (const [path, node] of nodes) {
		for (const dependency of dependenciesByPath.get(path)!) {
			const target = nodes.get(dependency);
			if (target !== undefined) node.dependencies.push(target);
		}
	}
	const ordered: T[] = [];
	for (const component of stronglyConnectedComponents(nodes.values())) {
		if (component.length > 1) component.sort((left, right) => left.order - right.order);
		for (const node of component) ordered.push(node.module);
	}
	return ordered;
}

/** A workspace can contain several programs; only the selected roots form this executable. */
export function selectLuaProgramModules<T extends { path: string; chunk: LuaChunk }>(
	entry: LuaChunk,
	modules: readonly T[],
	moduleRoots: readonly string[],
): T[] {
	const byPath = new Map(modules.map(module => [module.path, module]));
	const paths = new Set(byPath.keys());
	const roots = [entry];
	for (const path of moduleRoots) {
		const module = byPath.get(path);
		if (module === undefined) {
			throw new Error(`Program module root '${path}' is not available as a dependency of entry '${entry.locations.path}'.`);
		}
		roots.push(module.chunk);
	}
	const included = new Set(collectLuaModuleDependencyClosure(roots, paths, path => byPath.get(path)!.chunk));
	for (const path of moduleRoots) included.add(path);
	return modules.filter(module => included.has(module.path));
}

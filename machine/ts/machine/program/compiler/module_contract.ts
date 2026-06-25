import {
	LuaSyntaxKind,
	type LuaChunk,
	type LuaExpression,
	type LuaReturnStatement,
} from '../../../lua/syntax/ast';
import type { LuaSemanticFrontend, LuaSemanticFrontendFile } from '../../../lua/semantic/frontend';
import {
	assertConstModuleExportsAreStatic,
	collectConstModuleExportValues,
	type ConstExportValue,
} from './const_module_exports';
import {
	collectStaticFunctionExportSymbolsByPathKey,
	type StaticFunctionExportSymbol,
} from './static_functions';
import { collectStaticStorageDeclarations } from './static_storage';
import { buildModuleExportPathKey, buildModuleExportSlotName } from './module_names';
import {
	buildModuleShapeFromExpression,
	buildTopLevelLocalModuleShapes,
	createModuleExportNode,
	type ModuleExportNode,
} from './module_shape';

export type { ConstExportValue } from './const_module_exports';
export type { ModuleExportNode } from './module_shape';

export type ProgramModule = {
	path: string;
	chunk: LuaChunk;
	source?: string;
};

export type ModuleCompileInfo = {
	path: string;
	external: boolean;
	constModule: boolean;
	returnExpression: LuaExpression;
	exportRoot: ModuleExportNode;
	exportSlotsByPathKey: Map<string, string>;
	exportConstValueByPathKey: Map<string, ConstExportValue>;
	staticFunctionExportByPathKey: Map<string, StaticFunctionExportSymbol>;
	staticFunctionExportSlotBySymbolHandle: Map<string, string>;
	staticStorage: boolean;
};

export type ModuleCompileContext = {
	modulesByPath: Map<string, ModuleCompileInfo>;
};

const buildModuleExportSlots = (
	modulePath: string,
	exportRoot: ModuleExportNode,
	includeRootExport: boolean,
): Map<string, string> => {
	const exportSlotsByPathKey = new Map<string, string>();
	if (includeRootExport) {
		exportSlotsByPathKey.set('', buildModuleExportSlotName(modulePath, []));
	}
	const assignSlots = (node: ModuleExportNode, path: string[], visiting: WeakSet<ModuleExportNode>): void => {
		if (visiting.has(node)) {
			return;
		}
		visiting.add(node);
		for (const [key, child] of node.children) {
			path.push(key);
			exportSlotsByPathKey.set(buildModuleExportPathKey(path), buildModuleExportSlotName(modulePath, path));
			assignSlots(child, path, visiting);
			path.pop();
		}
		visiting.delete(node);
	};
	assignSlots(exportRoot, [], new WeakSet());
	return exportSlotsByPathKey;
};

const buildConstModuleExportValues = (
	modulePath: string,
	chunk: LuaChunk,
	returnExpression: LuaExpression,
	staticStorage: boolean,
	semantics: LuaSemanticFrontendFile,
): Map<string, ConstExportValue> => {
	if (!staticStorage) {
		const declarations = collectStaticStorageDeclarations(chunk, semantics);
		for (let index = 0; index < declarations.length; index += 1) {
			const declaration = declarations[index];
			if (declaration.kind !== 'struct') {
				throw new Error(`[Compiler] Const module '${modulePath}' declares .${declaration.kind} storage but is not compiled as a source module.`);
			}
		}
	}
	return collectConstModuleExportValues(chunk, returnExpression, semantics, staticStorage);
};

const buildStaticFunctionExportSlotBySymbolHandle = (
	staticFunctionExportByPathKey: ReadonlyMap<string, StaticFunctionExportSymbol>,
): Map<string, string> => {
	const out = new Map<string, string>();
	for (const value of staticFunctionExportByPathKey.values()) {
		if (!out.has(value.symbolHandle)) {
			out.set(value.symbolHandle, value.slotName);
		}
	}
	return out;
};

const buildModuleCompileInfo = (
	modulePath: string,
	chunk: LuaChunk,
	external: boolean,
	constModule: boolean,
	staticStorage: boolean,
	semantics: LuaSemanticFrontendFile,
): ModuleCompileInfo | null => {
	if (chunk.body.length === 0) {
		return null;
	}
	const lastStatement = chunk.body[chunk.body.length - 1];
	if (lastStatement.kind !== LuaSyntaxKind.ReturnStatement) {
		return null;
	}
	const returnStatement = lastStatement as LuaReturnStatement;
	if (returnStatement.expressions.length !== 1) {
		return null;
	}
	const returnExpression = returnStatement.expressions[0];
	const staticFunctionExportByPathKey = collectStaticFunctionExportSymbolsByPathKey(modulePath, chunk, returnExpression, semantics, constModule);
	const rootStaticFunctionExport = staticFunctionExportByPathKey.has('');
	const compileTimeModule = constModule || rootStaticFunctionExport;
	const shapedExportRoot = buildModuleShapeFromExpression(returnExpression, buildTopLevelLocalModuleShapes(chunk));
	if ((!shapedExportRoot || shapedExportRoot.children.size === 0) && !rootStaticFunctionExport) {
		return null;
	}
	const exportRoot = shapedExportRoot ?? createModuleExportNode();
	if (constModule && !staticStorage && staticFunctionExportByPathKey.size !== 0) {
		throw new Error(`[Compiler] Const module '${modulePath}' exports function call targets but is not compiled as a source module.`);
	}
	const exportConstValueByPathKey = compileTimeModule
		? buildConstModuleExportValues(modulePath, chunk, returnExpression, staticStorage, semantics)
		: new Map<string, ConstExportValue>();
	if (compileTimeModule) {
		assertConstModuleExportsAreStatic(modulePath, exportRoot, exportConstValueByPathKey, staticFunctionExportByPathKey);
	}
	return {
		path: modulePath,
		external,
		constModule: compileTimeModule,
		returnExpression,
		exportRoot,
		exportSlotsByPathKey: buildModuleExportSlots(modulePath, exportRoot, rootStaticFunctionExport),
		exportConstValueByPathKey,
		staticFunctionExportByPathKey,
		staticFunctionExportSlotBySymbolHandle: buildStaticFunctionExportSlotBySymbolHandle(staticFunctionExportByPathKey),
		staticStorage,
	};
};

export const buildModuleCompileContext = (
	modules: ReadonlyArray<ProgramModule>,
	externalModules: ReadonlyArray<ProgramModule>,
	constModulePaths: ReadonlySet<string>,
	frontend: LuaSemanticFrontend,
): ModuleCompileContext => {
	const modulesByPath = new Map<string, ModuleCompileInfo>();
	for (let index = 0; index < modules.length; index += 1) {
		const module = modules[index];
		const constModule = constModulePaths.has(module.path);
		const info = buildModuleCompileInfo(module.path, module.chunk, constModule, constModule, constModule, frontend.getFile(module.path));
		if (info) {
			modulesByPath.set(module.path, info);
			continue;
		}
	}
	for (let index = 0; index < externalModules.length; index += 1) {
		const module = externalModules[index];
		if (modulesByPath.has(module.path)) {
			continue;
		}
		const info = buildModuleCompileInfo(module.path, module.chunk, true, constModulePaths.has(module.path), false, frontend.getFile(module.path));
		if (info) {
			modulesByPath.set(module.path, info);
			continue;
		}
	}
	return { modulesByPath };
};

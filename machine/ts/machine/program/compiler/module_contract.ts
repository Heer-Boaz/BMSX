import {
	LuaSyntaxKind,
	type LuaChunk,
	type LuaExpression,
	type LuaReturnStatement,
} from '../../../lua/syntax/ast';
import type { LuaSemanticFrontend, LuaSemanticFrontendFile } from '../../../lua/semantic/frontend';
import {
	assertConstModuleExportsAreConstant,
	collectConstModuleExportValues,
	type ConstExportValue,
} from './const_module_exports';
import { hasStaticBssDeclaration } from './static_storage';
import { buildModuleExportPathKey, buildModuleExportSlotName } from './module_names';
import {
	buildModuleShapeFromExpression,
	buildTopLevelLocalModuleShapes,
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
	staticStorage: boolean;
};

export type ModuleCompileContext = {
	modulesByPath: Map<string, ModuleCompileInfo>;
};

const buildModuleExportSlots = (
	modulePath: string,
	exportRoot: ModuleExportNode,
): Map<string, string> => {
	const exportSlotsByPathKey = new Map<string, string>();
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
	exportRoot: ModuleExportNode,
	staticStorage: boolean,
	semantics: LuaSemanticFrontendFile,
): Map<string, ConstExportValue> => {
	if (!staticStorage && hasStaticBssDeclaration(chunk)) {
		throw new Error(`[Compiler] Const module '${modulePath}' declares .bss storage but is not compiled as a source module.`);
	}
	const values = collectConstModuleExportValues(modulePath, chunk, returnExpression, semantics, staticStorage);
	if (!staticStorage) {
		for (const value of values.values()) {
			if (value.kind === 'function') {
				throw new Error(`[Compiler] Const module '${modulePath}' exports static functions but is not compiled as a source module.`);
			}
		}
	}
	assertConstModuleExportsAreConstant(modulePath, exportRoot, values);
	return values;
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
	const exportRoot = buildModuleShapeFromExpression(returnExpression, buildTopLevelLocalModuleShapes(chunk));
	if (!exportRoot || exportRoot.children.size === 0) {
		return null;
	}
	return {
		path: modulePath,
		external,
		constModule,
		returnExpression,
		exportRoot,
		exportSlotsByPathKey: buildModuleExportSlots(modulePath, exportRoot),
		exportConstValueByPathKey: constModule
			? buildConstModuleExportValues(modulePath, chunk, returnExpression, exportRoot, staticStorage, semantics)
			: new Map<string, ConstExportValue>(),
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
		}
	}
	return { modulesByPath };
};

import {
	LuaSyntaxKind,
	type LuaCallExpression,
	type LuaChunk,
	type LuaExpression,
	type LuaIdentifierExpression,
	type LuaReturnStatement,
	type LuaStringLiteralExpression,
} from '../../syntax/ast';
import { visitCallExpressionsInStatements } from '../../syntax/calls';
import type { LuaSemanticFrontend, LuaSemanticFrontendFile } from '../../semantic/frontend';
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
	type ModuleExportShape,
} from './module_shape';

export type { ConstExportValue } from './const_module_exports';

export type ProgramModule = {
	path: string;
	chunk: LuaChunk;
	source?: string;
	linkValues?: ReadonlyMap<string, number>;
};

export type ModuleCompileInfo = {
	path: string;
	constModule: boolean;
	returnExpression: LuaExpression;
	exportSlotsByPathKey: Map<string, string>;
	exportConstValueByPathKey: Map<string, ConstExportValue>;
	staticFunctionExportByPathKey: Map<string, StaticFunctionExportSymbol>;
	staticFunctionExportPathBySymbolHandle: Map<string, string>;
	staticStorage: boolean;
};

export type ModuleCompileContext = {
	modulePaths: ReadonlySet<string>;
	moduleDependenciesByPath: ReadonlyMap<string, ReadonlyArray<string>>;
	modulesByPath: Map<string, ModuleCompileInfo>;
};

const buildModuleExportSlots = (
	modulePath: string,
	exportRoot: ModuleExportShape,
	includeRootExport: boolean,
): Map<string, string> => {
	const exportSlotsByPathKey = new Map<string, string>();
	if (includeRootExport) {
		exportSlotsByPathKey.set('', buildModuleExportSlotName(modulePath, []));
	}
	const assignSlots = (shape: ModuleExportShape, path: string[], visiting: WeakSet<ModuleExportShape>): void => {
		if (visiting.has(shape)) {
			return;
		}
		visiting.add(shape);
		for (const [key, child] of shape) {
			path.push(key);
			exportSlotsByPathKey.set(buildModuleExportPathKey(path), buildModuleExportSlotName(modulePath, path));
			assignSlots(child, path, visiting);
			path.pop();
		}
		visiting.delete(shape);
	};
	assignSlots(exportRoot, [], new WeakSet());
	return exportSlotsByPathKey;
};

const buildConstModuleExportValues = (
	chunk: LuaChunk,
	returnExpression: LuaExpression,
	staticStorage: boolean,
	semantics: LuaSemanticFrontendFile,
): Map<string, ConstExportValue> =>
	collectConstModuleExportValues(chunk, returnExpression, semantics, staticStorage);

const buildStaticFunctionExportPathBySymbolHandle = (
	staticFunctionExportByPathKey: ReadonlyMap<string, StaticFunctionExportSymbol>,
): Map<string, string> => {
	const out = new Map<string, string>();
	for (const [path, value] of staticFunctionExportByPathKey) {
		if (!out.has(value.symbolHandle)) {
			out.set(value.symbolHandle, path);
		}
	}
	return out;
};

const collectModuleDependencies = (
	chunk: LuaChunk,
	knownModulePaths: ReadonlySet<string>,
): string[] => {
	const dependencies: string[] = [];
	const seen = new Set<string>();
	visitCallExpressionsInStatements(chunk.body, (call: LuaCallExpression) => {
		if (call.methodName !== null || call.arguments.length !== 1 || call.callee.kind !== LuaSyntaxKind.IdentifierExpression) {
			return;
		}
		if ((call.callee as LuaIdentifierExpression).name !== 'require') {
			return;
		}
		if (call.arguments[0].kind !== LuaSyntaxKind.StringLiteralExpression) {
			return;
		}
		const modulePath = (call.arguments[0] as LuaStringLiteralExpression).value;
		if (!knownModulePaths.has(modulePath) || seen.has(modulePath)) {
			return;
		}
		seen.add(modulePath);
		dependencies.push(modulePath);
	});
	return dependencies;
};

const buildModuleCompileInfo = (
	module: ProgramModule,
	constModule: boolean,
	staticStorage: boolean,
	semantics: LuaSemanticFrontendFile,
): ModuleCompileInfo | null => {
	const modulePath = module.path;
	const chunk = module.chunk;
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
	const staticStorageDeclarations = collectStaticStorageDeclarations(chunk, semantics);
	let hasStaticStorageDeclaration = false;
	for (let index = 0; index < staticStorageDeclarations.length; index += 1) {
		if (staticStorageDeclarations[index].kind !== 'struct') {
			hasStaticStorageDeclaration = true;
			break;
		}
	}
	const moduleOwnsStaticStorage = staticStorage || hasStaticStorageDeclaration;
	const staticFunctionExportByPathKey = constModule || returnExpression.kind === LuaSyntaxKind.FunctionExpression
		? collectStaticFunctionExportSymbolsByPathKey(modulePath, chunk, returnExpression, semantics, constModule)
		: new Map<string, StaticFunctionExportSymbol>();
	const rootStaticFunctionExport = staticFunctionExportByPathKey.has('');
	const compileTimeModule = constModule || rootStaticFunctionExport;
	let exportRoot: ModuleExportShape | undefined;
	if (compileTimeModule) {
		exportRoot = buildModuleShapeFromExpression(returnExpression, buildTopLevelLocalModuleShapes(chunk)) ?? new Map<string, ModuleExportShape>();
		if (!rootStaticFunctionExport && exportRoot.size === 0) {
			return null;
		}
	}
	const exportConstValueByPathKey = compileTimeModule
		? buildConstModuleExportValues(chunk, returnExpression, moduleOwnsStaticStorage, semantics)
		: new Map<string, ConstExportValue>();
	if (module.linkValues) {
		for (const [exportPath, value] of module.linkValues) {
			exportConstValueByPathKey.set(exportPath, {
				kind: 'link_value',
				modulePath,
				exportPath,
				value,
			});
		}
	}
	if (exportRoot) {
		assertConstModuleExportsAreStatic(modulePath, exportRoot, exportConstValueByPathKey, staticFunctionExportByPathKey);
	}
	const exportSlotsByPathKey = exportRoot
		? buildModuleExportSlots(modulePath, exportRoot, rootStaticFunctionExport)
		: new Map<string, string>([['', buildModuleExportSlotName(modulePath, [])]]);
	return {
		path: modulePath,
		constModule: compileTimeModule,
		returnExpression,
		exportSlotsByPathKey,
		exportConstValueByPathKey,
		staticFunctionExportByPathKey,
		staticFunctionExportPathBySymbolHandle: buildStaticFunctionExportPathBySymbolHandle(staticFunctionExportByPathKey),
		staticStorage: moduleOwnsStaticStorage,
	};
};

export const buildModuleCompileContext = (
	modules: ReadonlyArray<ProgramModule>,
	frontend: LuaSemanticFrontend,
): ModuleCompileContext => {
	const modulesByPath = new Map<string, ModuleCompileInfo>();
	const modulePaths = new Set<string>();
	for (let index = 0; index < modules.length; index += 1) {
		modulePaths.add(modules[index].path);
	}
	const moduleDependenciesByPath = new Map<string, ReadonlyArray<string>>();
	for (let index = 0; index < modules.length; index += 1) {
		const module = modules[index];
		moduleDependenciesByPath.set(module.path, collectModuleDependencies(module.chunk, modulePaths));
		const constModule = module.chunk.constModule;
		const info = buildModuleCompileInfo(
			module,
			constModule,
			constModule,
			frontend.getFile(module.path),
		);
		if (info) {
			modulesByPath.set(module.path, info);
			continue;
		}
	}
	return { modulePaths, moduleDependenciesByPath, modulesByPath };
};

import { buildModuleExportPathKey } from '../module_path';
import type { FileSemanticData, LuaSemanticWorkspaceSnapshot } from '../semantic/model';
import { getLuaModuleAliasTarget } from '../semantic/module_bindings';
import { readLuaExpressionSource } from '../semantic/value_graph';
import type { StaticBindings } from '../static/constants';
import type { LuaExpression } from '../syntax/ast';
import type { ConstExportValue, ModuleCompileContext } from './passes/module_contract';

/** Compiler layouts admit external values only from the validated const-export catalog. */
export function createCompilerStaticBindings(snapshot: LuaSemanticWorkspaceSnapshot, modules: ModuleCompileContext): StaticBindings {
	const value = (file: FileSemanticData, expression: LuaExpression): ConstExportValue | undefined => {
		const target = getLuaModuleAliasTarget(file, readLuaExpressionSource(file, expression));
		if (target === null || target.memberPath.length === 0) return undefined;
		const path = snapshot.resolveModule(target.referrer, target.module);
		if (path === undefined) return undefined;
		const module = modules.modulesByPath.get(path);
		return module?.constModule ? module.exportConstValueByPathKey.get(buildModuleExportPathKey(target.memberPath)) : undefined;
	};
	return {
		value,
		storage(file, expression) {
			const constant = value(file, expression);
			return constant?.kind === 'bss_addr' || constant?.kind === 'data_addr' || constant?.kind === 'rodata_addr'
				? snapshot.symbolResolver.getDeclaration(constant.symbolHandle) : undefined;
		},
	};
}

import { LuaSyntaxKind } from '../../../../toolchain/ts/lua/syntax/ast';
import { getLuaModuleAliasTarget, type LuaModuleImportTarget } from '../../../../toolchain/ts/lua/semantic/module_bindings';
import type { LuaWrittenExpression } from '../../../../toolchain/ts/lua/semantic/written_sources';
import { LuaSourceReader } from '../../../language/lua/source_reader';

const PREFAB_DEFINE: LuaModuleImportTarget = { module: 'cartlib/world/prefab', memberPath: ['define'] };

/** One source-generation index shared by spatial and visual admission. Duplicate
 * registrations have no statically chosen execution order and stay unresolved. */
export class ScenePrefabSources {
	private definitions: ReadonlyMap<string, LuaWrittenExpression | undefined> | undefined;
	public constructor(public readonly reader: LuaSourceReader) {}
	public get all(): ReadonlyMap<string, LuaWrittenExpression | undefined> {
		if (this.definitions !== undefined) return this.definitions;
		const definitions = new Map<string, LuaWrittenExpression | undefined>(), reader = this.reader;
		for (const file of reader.snapshot.files) for (const call of file.callSites) {
			if (call.expression.method !== null) continue;
			const target = getLuaModuleAliasTarget(file, call.call.callee);
			if (target === null || !reader.snapshot.symbolResolver.moduleImports.matchesImport(target, PREFAB_DEFINE)) continue;
			const module = reader.module(file, PREFAB_DEFINE.module);
			const constructor = module === undefined ? undefined : reader.member(module.file, module.expression, 'define');
			if (constructor?.expression.kind !== LuaSyntaxKind.FunctionExpression || reader.callable(file, call.expression.callee) !== constructor) continue;
			const argument = call.expression.arguments[0], definition = argument === undefined ? undefined : reader.expression(file, argument);
			if (definition?.expression.kind !== LuaSyntaxKind.TableConstructorExpression) continue;
			const identity = reader.member(definition.file, definition.expression, 'def_id');
			const id = identity === undefined ? undefined : reader.stringValue(identity.file, identity.expression);
			if (id !== undefined) definitions.set(id, definitions.has(id) ? undefined : definition);
		}
		this.definitions = definitions;
		return definitions;
	}
}

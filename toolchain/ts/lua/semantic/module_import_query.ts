import type { FileSemanticData } from './model';
import type { ModuleAliasTarget } from './module_bindings';
import { toLuaModulePath } from '../module_path';

type Resolution = boolean | 'resolving';
type ModuleResolutions = Map<string, Map<number, Resolution>>;

/**
 * Written import paths through explicit module reexports. The requested public
 * module is an anchor, not something to normalize to its private implementation.
 * This snapshot-owned query never activates value/call inference or executes Lua.
 */
export class LuaModuleImportQuery {
	private readonly exports = new Map<string, ModuleAliasTarget | null>();
	private readonly resolutions = new Map<ModuleAliasTarget, ModuleResolutions>();

	public constructor(files: readonly FileSemanticData[]) {
		for (const file of files) {
			const module = toLuaModulePath(file.file);
			const entry = file.moduleValues[0];
			this.exports.set(module, this.exports.has(module) || file.syntaxError !== null
				|| entry === undefined || entry.bypassingReturns.length !== 0 ? null : entry.moduleTarget);
		}
	}

	/** Target objects are retained API descriptors; results live with this snapshot. */
	public matchesImport(source: ModuleAliasTarget, target: ModuleAliasTarget): boolean {
		const remaining = this.removeSuffix(target.memberPath, target.memberPath.length, source.memberPath);
		if (remaining < 0) return false;
		if (source.module === target.module) return remaining === 0;
		// A terminal module already has its answer in the export index. Do not
		// allocate a second negative cache for it under every requested API.
		if (!this.exports.get(source.module)) return false;
		let resolutions = this.resolutions.get(target);
		if (resolutions === undefined) {
			resolutions = new Map();
			this.resolutions.set(target, resolutions);
		}
		const retained = resolutions.get(source.module)?.get(remaining);
		if (retained !== undefined) return retained === true;
		return this.resolve(source.module, remaining, target, resolutions);
	}

	private resolve(module: string, remaining: number, target: ModuleAliasTarget, resolutions: ModuleResolutions): boolean {
		const pending: { readonly entries: Map<number, Resolution>; readonly remaining: number }[] = [];
		let result: boolean;
		for (;;) {
			if (module === target.module) {
				result = remaining === 0;
				break;
			}
			let entries = resolutions.get(module);
			if (entries === undefined) {
				entries = new Map();
				resolutions.set(module, entries);
			}
			const retained = entries.get(remaining);
			if (retained !== undefined) {
				result = retained === true; // A resolving state closes an alias cycle.
				break;
			}
			entries.set(remaining, 'resolving');
			pending.push({ entries, remaining });
			const alias = this.exports.get(module);
			if (alias === undefined || alias === null) {
				result = false;
				break;
			}
			remaining = this.removeSuffix(target.memberPath, remaining, alias.memberPath);
			if (remaining < 0) {
				result = false;
				break;
			}
			module = alias.module;
		}
		for (const entry of pending) entry.entries.set(entry.remaining, result);
		return result;
	}

	// Reexports prepend their members to the caller's path. Match that composition
	// backwards against the requested path instead of allocating expanded paths at
	// every link (quadratic on deep member chains). Zero-member cycles are cached;
	// member-growing cycles consume this finite path, without an arbitrary depth cap.
	private removeSuffix(path: readonly string[], end: number, suffix: readonly string[]): number {
		const start = end - suffix.length;
		if (start < 0) return -1;
		for (let index = 0; index < suffix.length; index += 1) {
			if (path[start + index] !== suffix[index]) return -1;
		}
		return start;
	}
}

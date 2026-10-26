import type { FileSemanticData } from './model';
import { getLuaModuleAliasTarget, type LuaModuleImportTarget, type ModuleAliasTarget } from './module_bindings';
import type { LuaProjectModuleBindings } from './module_resolution';

type Resolution = boolean | 'resolving';
type ModuleResolutions = Map<string, Map<number, Resolution>>;

/**
 * Written import paths through explicit module reexports. The requested public
 * module is an anchor, not something to normalize to its private implementation.
 * This snapshot-owned query never activates value/call inference or executes Lua.
 */
export class LuaModuleImportQuery {
	private readonly exports = new Map<string, ModuleAliasTarget | null>();
	private readonly resolutions = new Map<LuaModuleImportTarget, Map<string, ModuleResolutions>>();

	public constructor(files: readonly FileSemanticData[], private readonly moduleBindings: LuaProjectModuleBindings) {
		for (const file of files) {
			const entry = file.moduleValues[0];
			this.exports.set(file.file, file.syntaxError !== null
				|| entry === undefined || entry.bypassingReturns.length !== 0 ? null : getLuaModuleAliasTarget(file, entry.source));
		}
	}

	/** Target objects are retained API descriptors; results live with this snapshot. */
	public matchesImport(source: ModuleAliasTarget, target: LuaModuleImportTarget): boolean {
		const remaining = this.removeSuffix(target.memberPath, target.memberPath.length, source.memberPath);
		if (remaining < 0) return false;
		const bindings = this.moduleBindings.get(source.referrer)!;
		const sourceFile = bindings.get(source.module);
		const targetFile = bindings.get(target.module);
		if (sourceFile === undefined || targetFile === undefined) return false;
		if (sourceFile === targetFile) return remaining === 0;
		// A terminal module already has its answer in the export index. Do not
		// allocate a second negative cache for it under every requested API.
		if (!this.exports.get(sourceFile)) return false;
		let targets = this.resolutions.get(target);
		if (targets === undefined) {
			targets = new Map();
			this.resolutions.set(target, targets);
		}
		let resolutions = targets.get(targetFile);
		if (resolutions === undefined) {
			resolutions = new Map();
			targets.set(targetFile, resolutions);
		}
		const retained = resolutions.get(sourceFile)?.get(remaining);
		if (retained !== undefined) return retained === true;
		return this.resolve(sourceFile, remaining, targetFile, target.memberPath, resolutions);
	}

	private resolve(file: string, remaining: number, targetFile: string, targetPath: readonly string[], resolutions: ModuleResolutions): boolean {
		const pending: { readonly entries: Map<number, Resolution>; readonly remaining: number }[] = [];
		let result: boolean;
		for (;;) {
			if (file === targetFile) {
				result = remaining === 0;
				break;
			}
			let entries = resolutions.get(file);
			if (entries === undefined) {
				entries = new Map();
				resolutions.set(file, entries);
			}
			const retained = entries.get(remaining);
			if (retained !== undefined) {
				result = retained === true; // A resolving state closes an alias cycle.
				break;
			}
			entries.set(remaining, 'resolving');
			pending.push({ entries, remaining });
			const alias = this.exports.get(file);
			if (alias === undefined || alias === null) {
				result = false;
				break;
			}
			remaining = this.removeSuffix(targetPath, remaining, alias.memberPath);
			if (remaining < 0) {
				result = false;
				break;
			}
			const next = this.moduleBindings.get(alias.referrer)!.get(alias.module);
			if (next === undefined) {
				result = false;
				break;
			}
			file = next;
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

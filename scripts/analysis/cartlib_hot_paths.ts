import fs from 'node:fs';
import path from 'node:path';

import type { LuaFunctionExpression } from '../../toolchain/ts/lua/syntax/ast';
import { LuaSyntaxKind } from '../../toolchain/ts/lua/syntax/ast';
import { parseLuaChunk } from '../../toolchain/ts/lua/analysis/parse';
import {
	indexLuaModuleFunctions,
	luaFunctionCallTargetCounts,
	luaFunctionSyntaxCount,
} from './lua_hot_paths';

type CompleteDispatchBoundary = {
	id: string;
	caller: string;
	call: string;
	count: number;
	coverage: 'complete';
	targets: string[];
};

type BlockedDispatchBoundary = {
	id: string;
	caller: string;
	call: string;
	count: number;
	coverage: 'blocked';
	known_targets: string[];
	reason: string;
};

type HotPathBlocker = {
	id: string;
	function: string;
	evidence:
		| { kind: 'call'; value: string; count: number }
		| { kind: 'table_literal'; count: number };
	reason: string;
};

type PipelineGap = {
	id: string;
	function: string;
	reason: string;
};

export type CartlibHotPathManifest = {
	version: number;
	state: string;
	closure: {
		status: 'blocked';
		reason: string;
	};
	audited_carts: string[];
	roots: string[];
	cartlib_functions: string[];
	cart_functions: string[];
	dispatch_boundaries: Array<CompleteDispatchBoundary | BlockedDispatchBoundary>;
	known_blockers: HotPathBlocker[];
	pipeline_gaps: PipelineGap[];
};

type CartlibSurfaceInventory = {
	cart_projects: string[];
	modules: Array<{
		current_path: string;
		hot_functions: Array<{ name: string }>;
	}>;
};

const MANIFEST_PATH = 'scripts/cartlib_hot_paths.json';
const SURFACE_INVENTORY_PATH = 'scripts/cartlib_surface_inventory.json';

function auditSortedUnique(label: string, values: readonly string[]): string[] {
	const errors: string[] = [];
	for (let index = 0; index < values.length; index += 1) {
		if (index > 0 && values[index - 1] >= values[index]) {
			errors.push(`${label}: entries must be sorted and unique (${values[index]})`);
		}
	}
	return errors;
}

function functionIdentity(id: string): { file: string; name: string } | null {
	const separator = id.lastIndexOf('::');
	if (separator <= 0 || separator === id.length - 2) {
		return null;
	}
	return { file: id.slice(0, separator), name: id.slice(separator + 2) };
}

export function readCartlibHotPathManifest(repoRoot: string): CartlibHotPathManifest {
	return JSON.parse(fs.readFileSync(path.join(repoRoot, MANIFEST_PATH), 'utf8')) as CartlibHotPathManifest;
}

export function auditCartlibHotPaths(repoRoot: string, manifest: CartlibHotPathManifest): string[] {
	const errors: string[] = [];
	if (manifest.version !== 1) {
		errors.push(`${MANIFEST_PATH}: expected version 1`);
	}
	if (manifest.state !== 'pre_core_baseline') {
		errors.push(`${MANIFEST_PATH}: expected pre_core_baseline state`);
	}
	if (manifest.closure.reason.length === 0) {
		errors.push(`${MANIFEST_PATH}: blocked closure needs a reason`);
	}

	errors.push(...auditSortedUnique('roots', manifest.roots));
	errors.push(...auditSortedUnique('audited_carts', manifest.audited_carts));
	errors.push(...auditSortedUnique('cartlib_functions', manifest.cartlib_functions));
	errors.push(...auditSortedUnique('cart_functions', manifest.cart_functions));
	errors.push(...auditSortedUnique('dispatch_boundaries', manifest.dispatch_boundaries.map(entry => entry.id)));
	errors.push(...auditSortedUnique('known_blockers', manifest.known_blockers.map(entry => entry.id)));
	errors.push(...auditSortedUnique('pipeline_gaps', manifest.pipeline_gaps.map(entry => entry.id)));

	const functionIds = [...manifest.cartlib_functions, ...manifest.cart_functions];
	const inventoriedFunctions = new Set(functionIds);
	if (inventoriedFunctions.size !== functionIds.length) {
		errors.push(`${MANIFEST_PATH}: function inventory contains duplicates`);
	}
	for (const id of manifest.cartlib_functions) {
		if (!id.startsWith('cartlib/')) {
			errors.push(`${MANIFEST_PATH}: cartlib function is outside cartlib (${id})`);
		}
	}
	for (const id of manifest.cart_functions) {
		if (!id.startsWith('carts/')) {
			errors.push(`${MANIFEST_PATH}: cart function is outside carts (${id})`);
		}
	}
	for (const root of manifest.roots) {
		if (!inventoriedFunctions.has(root)) {
			errors.push(`${MANIFEST_PATH}: root is not inventoried (${root})`);
		}
	}

	const surfaceInventory = JSON.parse(
		fs.readFileSync(path.join(repoRoot, SURFACE_INVENTORY_PATH), 'utf8'),
	) as CartlibSurfaceInventory;
	for (const cart of manifest.audited_carts) {
		if (!surfaceInventory.cart_projects.includes(cart)) {
			errors.push(`${MANIFEST_PATH}: audited cart is not a live cartlib consumer (${cart})`);
		}
	}
	for (const module of surfaceInventory.modules) {
		for (const hotFunction of module.hot_functions) {
			const id = `${module.current_path}::${hotFunction.name}`;
			if (!inventoriedFunctions.has(id)) {
				errors.push(`${MANIFEST_PATH}: missing surface hot function ${id}`);
			}
		}
	}

	const identities = new Map<string, { file: string; name: string }>();
	const files = new Set<string>();
	for (const id of functionIds) {
		const identity = functionIdentity(id);
		if (identity === null) {
			errors.push(`${MANIFEST_PATH}: invalid function identity ${id}`);
			continue;
		}
		identities.set(id, identity);
		files.add(identity.file);
	}

	const functionsByFile = new Map<string, Map<string, LuaFunctionExpression>>();
	for (const file of files) {
		const source = fs.readFileSync(path.join(repoRoot, file), 'utf8');
		const parsed = parseLuaChunk(source, file, source.split('\n'));
		functionsByFile.set(file, indexLuaModuleFunctions(parsed.chunk, path.basename(file, '.lua')));
	}
	for (const [id, identity] of identities) {
		if (!functionsByFile.get(identity.file)?.has(identity.name)) {
			errors.push(`${id}: named top-level function is missing`);
		}
	}

	const expressionFor = (id: string): LuaFunctionExpression | undefined => {
		const identity = identities.get(id);
		return identity === undefined ? undefined : functionsByFile.get(identity.file)?.get(identity.name);
	};
	const callCountsByFunction = new Map<string, Map<string, number>>();
	const callCountsFor = (id: string): Map<string, number> | undefined => {
		let counts = callCountsByFunction.get(id);
		if (counts === undefined) {
			const expression = expressionFor(id);
			if (expression === undefined) {
				return undefined;
			}
			counts = luaFunctionCallTargetCounts(expression);
			callCountsByFunction.set(id, counts);
		}
		return counts;
	};

	const dispatchTargets = new Set<string>();
	for (const boundary of manifest.dispatch_boundaries) {
		if (!inventoriedFunctions.has(boundary.caller)) {
			errors.push(`${boundary.id}: caller is not inventoried (${boundary.caller})`);
		}
		const actualCount = callCountsFor(boundary.caller)?.get(boundary.call) ?? 0;
		if (actualCount !== boundary.count) {
			errors.push(`${boundary.id}: call ${boundary.call} expected ${boundary.count}, found ${actualCount}`);
		}
		const targets = boundary.coverage === 'complete' ? boundary.targets : boundary.known_targets;
		errors.push(...auditSortedUnique(`${boundary.id} targets`, targets));
		if (boundary.coverage === 'complete' && targets.length === 0) {
			errors.push(`${boundary.id}: complete dispatch has no targets`);
		}
		if (boundary.coverage === 'blocked' && boundary.reason.length === 0) {
			errors.push(`${boundary.id}: blocked dispatch needs a reason`);
		}
		for (const target of targets) {
			dispatchTargets.add(target);
			if (!inventoriedFunctions.has(target)) {
				errors.push(`${boundary.id}: target is not inventoried (${target})`);
			}
		}
	}

	for (const blocker of manifest.known_blockers) {
		if (!inventoriedFunctions.has(blocker.function)) {
			errors.push(`${blocker.id}: blocker function is not inventoried (${blocker.function})`);
			continue;
		}
		const expression = expressionFor(blocker.function);
		if (expression === undefined) {
			continue;
		}
		const actualCount = blocker.evidence.kind === 'call'
			? callCountsFor(blocker.function)?.get(blocker.evidence.value) ?? 0
			: luaFunctionSyntaxCount(expression, LuaSyntaxKind.TableConstructorExpression);
		if (actualCount !== blocker.evidence.count) {
			errors.push(`${blocker.id}: blocker evidence expected ${blocker.evidence.count}, found ${actualCount}`);
		}
		if (blocker.reason.length === 0) {
			errors.push(`${blocker.id}: blocker needs a reason`);
		}
	}

	for (const gap of manifest.pipeline_gaps) {
		if (!inventoriedFunctions.has(gap.function)) {
			errors.push(`${gap.id}: pipeline gap function is not inventoried (${gap.function})`);
		}
		if (dispatchTargets.has(gap.function)) {
			errors.push(`${gap.id}: pipeline gap is also a declared dispatch target (${gap.function})`);
		}
		if (gap.reason.length === 0) {
			errors.push(`${gap.id}: pipeline gap needs a reason`);
		}
	}

	return errors;
}

import type { Decl } from './model';
import type { ScopeID } from './scope_facts';
import { appendValueElement, appendValueMember, appendValueMetatable, type CallValueEntry, type DeclarationValueEntry, type FunctionValueFlowEntry, type SemanticValueSource, type ValueAssignmentEntry } from './value_graph';

/** Raw sites; no decision depends on the order in which bodies were visited. */
export type LuaBuiltinOperationSite =
	| { readonly kind: 'setmetatable' | 'getmetatable'; readonly call: CallValueEntry; readonly flow: ScopeID | undefined }
	| { readonly kind: 'iterator'; readonly name: string; readonly table: SemanticValueSource; readonly declaration: DeclarationValueEntry };

/**
 * The existing file-local standard-library projection contract. A lexical
 * shadow never produces a site; any authored global publication in this file
 * disables its named operation, before or after the use. This is not runtime
 * global-value inference, or proof of arbitrary BIOS wrapper implementations.
 * Raw body contributions remain untouched; projection belongs to composition.
 */
export function composeLuaBuiltinOperations(
	sites: readonly LuaBuiltinOperationSite[],
	globals: readonly Decl[],
	declarations: readonly DeclarationValueEntry[],
	flows: readonly FunctionValueFlowEntry[],
	assignments: readonly ValueAssignmentEntry[],
): {
	readonly declarationValues: readonly DeclarationValueEntry[];
	readonly declarationValuesByDeclaration: ReadonlyMap<DeclarationValueEntry['declId'], readonly DeclarationValueEntry[]>;
	readonly functionValueFlows: readonly FunctionValueFlowEntry[];
	readonly valueAssignments: readonly ValueAssignmentEntry[];
} {
	const disabled = sites.length === 0 ? undefined : new Set<string>();
	if (disabled !== undefined) for (const declaration of globals) disabled.add(declaration.name);
	let projectedDeclarations: Map<DeclarationValueEntry, DeclarationValueEntry> | undefined;
	let projectedAssignments: Map<ScopeID | undefined, ValueAssignmentEntry[]> | undefined;
	let hasBodyWrites = false;
	for (const site of sites) {
		if (disabled!.has(site.kind === 'iterator' ? site.name : site.kind)) continue;
		if (site.kind === 'iterator') {
			if (projectedDeclarations === undefined) projectedDeclarations = new Map();
			projectedDeclarations.set(site.declaration, { ...site.declaration, source: appendValueElement(site.table), relation: 'projection' });
			continue;
		}
		if (projectedAssignments === undefined) projectedAssignments = new Map();
		if (site.flow !== undefined) hasBodyWrites = true;
		let writes = projectedAssignments.get(site.flow);
		if (writes === undefined) projectedAssignments.set(site.flow, writes = []);
		const { call } = site;
		const target = call.arguments[0];
		if (site.kind === 'getmetatable') {
			writes.push({ target: call.result, source: appendValueMetatable(target), relation: 'value', syntax: call.expression, index: 0 });
		} else {
			const metatable = call.arguments[1];
			writes.push(
				{ target: call.result, source: target, relation: 'value', syntax: call.expression, index: 0 },
				{ target, source: metatable, relation: 'metatable', syntax: call.expression, index: 1 },
				{ target, source: appendValueMember(metatable, '__index'), relation: 'prototype', syntax: call.expression, index: 1 },
			);
		}
	}
	const values = projectedDeclarations === undefined ? declarations
		: declarations.map(value => projectedDeclarations!.get(value) ?? value);
	const valuesByDeclaration = new Map<DeclarationValueEntry['declId'], DeclarationValueEntry[]>();
	for (const value of values) {
		const retained = valuesByDeclaration.get(value.declId);
		if (retained === undefined) valuesByDeclaration.set(value.declId, [value]);
		else retained.push(value);
	}
	const moduleWrites = projectedAssignments?.get(undefined);
	return {
		declarationValues: values,
		declarationValuesByDeclaration: valuesByDeclaration,
		functionValueFlows: !hasBodyWrites ? flows : flows.map(flow => {
			const writes = projectedAssignments!.get(flow.id);
			return writes === undefined ? flow : { ...flow, assignments: [...flow.assignments, ...writes] };
		}),
		valueAssignments: moduleWrites === undefined ? assignments : [...assignments, ...moduleWrites],
	};
}

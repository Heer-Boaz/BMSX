import type { AbilityId } from '../gas/gastypes';
import type { Identifier } from '../rompack/rompack';

export type TagId = string;
export type AbilityIdentifier = AbilityId;
export type ProgramIdentifier = Identifier;

export interface TagPredicate {
	all?: TagId[];
	any?: TagId[];
	not?: TagId[];
}

export interface ModePredicate {
	path?: string;
	not?: boolean;
}

export interface WhenClause {
	tags?: TagPredicate;
	mode?: ModePredicate | ModePredicate[];
}

export interface OnClause {
	press?: string;
	hold?: string;
	release?: string;
	custom?: Array<{ name: string; pattern: string }>;
}

export interface AbilityRequestDescriptor {
	id: AbilityIdentifier;
	payload?: Record<string, unknown>;
	source?: string;
}

export interface EmitGameplayDescriptor {
	event: string;
	payload?: Record<string, unknown>;
}

export type Effect =
	| { 'ability.request': AbilityIdentifier | AbilityRequestDescriptor }
	| { 'input.consume': string | string[] }
	| { 'emit.gameplay': EmitGameplayDescriptor }
	| { commands: Effect[] };

export interface EffectTable {
	press?: Effect | Effect[];
	hold?: Effect | Effect[];
	release?: Effect | Effect[];
	[key: string]: Effect | Effect[] | undefined;
}

export interface Binding {
	name?: string;
	priority?: number;
	when?: WhenClause;
	on: OnClause;
	do: EffectTable;
}

export interface InputAbilityProgram {
	schema: 1;
	eval?: 'first' | 'all';
	priority?: number;
	bindings: Binding[];
}

export function isInputAbilityProgram(value: unknown): value is InputAbilityProgram {
	if (!value || typeof value !== 'object') return false;
	const prog = value as Partial<InputAbilityProgram>;
	if (prog.schema !== 1) return false;
	if (!Array.isArray(prog.bindings)) return false;
	return true;
}

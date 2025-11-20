import type { EventPayload } from '../core/eventemitter';
import type { Identifier } from '../rompack/rompack';
import type { ActionEffectId, ActionEffectPayloadFor, ActionEffectTableKeys } from './effect_types';

export type ActionEffectIdentifier = ActionEffectId;
export type ProgramIdentifier = Identifier;

export interface ModePredicate {
	path?: string;
	not?: boolean;
}

export interface WhenClause {
	mode?: ModePredicate | ModePredicate[];
}

export interface OnClause {
	press?: string;
	hold?: string;
	release?: string;
	custom?: Array<{ name: string; pattern: string }>;
}

type KnownEffectTriggerDescriptor = ActionEffectTableKeys extends never
	? never
	: {
		[Id in ActionEffectTableKeys]: {
			id: Id;
		} & { payload?: ActionEffectPayloadFor<Id> };
	}[ActionEffectTableKeys];

type FallbackEffectTriggerDescriptor = ActionEffectTableKeys extends never
	? { id: ActionEffectIdentifier; payload?: unknown }
	: never;

export type ActionEffectTriggerDescriptor = KnownEffectTriggerDescriptor | FallbackEffectTriggerDescriptor;

export interface EmitGameplayDescriptor {
	event: string;
	payload?: EventPayload;
}

export type Effect =
	| { 'effect.trigger': ActionEffectIdentifier | ActionEffectTriggerDescriptor }
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

export interface InputActionEffectProgram {
	eval?: 'first' | 'all';
	priority?: number;
	bindings: Binding[];
}

export function isInputActionEffectProgram(value: unknown): value is InputActionEffectProgram {
	if (!value || typeof value !== 'object') return false;
	const prog = value as Partial<InputActionEffectProgram>;
	if (!Array.isArray(prog.bindings)) return false;
	return true;
}

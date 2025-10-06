import type { EventPayload } from '../core/eventemitter';
import type { Identifier } from '../rompack/rompack';

export type TagId = string;
export type AttributeId = string;
export type EffectId = string;

export interface AbilityPayloadTable {
	// Games and engine modules augment this interface with ability ids and their payload contracts.
}

export type AbilityTableKeys = Extract<keyof AbilityPayloadTable, string>;

export type AbilityId = [AbilityTableKeys] extends [never] ? string : AbilityTableKeys;

export type AbilityPayloadFor<Id extends AbilityId> = Id extends AbilityTableKeys
	? AbilityPayloadTable[Id]
	: EventPayload;

export type AbilityRequestOptions<Id extends AbilityId> = Id extends AbilityTableKeys
	? (AbilityPayloadFor<Id> extends undefined ? { source?: string; payload?: undefined } : { source?: string; payload: AbilityPayloadFor<Id> })
	: { source?: string; payload?: EventPayload };

export interface Attribute {
  base: number;
  current: number;
  min?: number;
  max?: number;
}
export type AttributeSet = Record<AttributeId, Attribute>;

export type ModifierOp = 'add' | 'mul' | 'override';
export interface AttributeModifier {
	attr: AttributeId;
	op: ModifierOp;
	value: number;
}

export interface GameplayEffect {
  id: EffectId;
  durationMs?: number;           // undefined = infinite
  periodMs?: number;             // periodic tick; undefined = no tick
  modifiers?: ReadonlyArray<AttributeModifier>;
  grantedTags?: ReadonlyArray<TagId>;
  onTick?: (asc: AbilitySystemRef) => void;
}

export interface ActiveEffect {
	effect: GameplayEffect;
	remainingMs: number;           // Infinity if durationMs undefined
	elapsedSinceTickMs: number;    // for period
}

export interface AbilityCost {
	attr: AttributeId;
	amount: number;
}

export interface AbilitySpec {
  id: AbilityId;
  unique?: 'ignore' | 'restart' | 'stack';
  requiredTags?: ReadonlyArray<TagId>;
  blockedTags?: ReadonlyArray<TagId>;
  cost?: ReadonlyArray<AbilityCost>;
  cooldownMs?: number;
}

// Minimal surface so we avoid a circular type import
export interface AbilitySystemRef {
	parentid: Identifier;
	hasTag(tag: TagId): boolean;
	requestAbility<Id extends AbilityId>(id: Id, opts?: AbilityRequestOptions<Id>): AbilityRequestResult;
	tryActivate<Id extends AbilityId>(id: Id, payload?: AbilityPayloadFor<Id>): boolean;
}

export type AbilityRequestResult = { ok: true; note?: string } | { ok: false; reason: string };

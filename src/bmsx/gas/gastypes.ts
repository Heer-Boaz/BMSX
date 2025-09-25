import type { EventPayload, EventScope } from '../core/eventemitter';
import type { Identifier } from '../rompack/rompack';
import { GameplayCommandBuffer } from '../ecs/gameplay_command_buffer';

export type TagId = string;
export type AttributeId = string;
export type AbilityId = string;
export type EffectId = string;

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

export type AbilityYield =
	| { type: 'waitTime'; ms: number }
	| { type: 'waitTag'; tag: TagId; present: boolean }
	| { type: 'waitEvent'; name: string; scope?: EventScope }
	| { type: 'finish' };

export type AbilityCoroutine = Generator<AbilityYield, void, void>;

export interface AbilityContext {
  parentid: Identifier;
  asc: AbilitySystemRef;
  emit?: (name: string, payload?: any) => void;
  intent?: { id: AbilityId; payload?: Record<string, unknown> };
}

// Minimal surface so we avoid a circular type import
export interface AbilitySystemRef {
  parentid: Identifier;
  hasTag(tag: TagId): boolean;
  requestAbility(id: AbilityId, opts?: { source?: string; payload?: Record<string, unknown> }): AbilityRequestResult;
  tryActivate(id: AbilityId, payload?: Record<string, unknown>): boolean;
}

export type AbilityRequestResult = { ok: true; note?: string } | { ok: false; reason: string };

export abstract class Ability {
	readonly id: AbilityId;
	readonly unique: 'ignore' | 'restart' | 'stack' | undefined;

	constructor(id: AbilityId, unique?: 'ignore' | 'restart' | 'stack') {
		this.id = id;
		this.unique = unique;
	}

	protected dispatchModeEvent(ctx: AbilityContext, event: string, payload?: EventPayload, target?: Identifier): void {
		GameplayCommandBuffer.instance.push({
			kind: 'dispatchEvent',
			event,
			target_id: target ?? ctx.parentid,
			emitter_id: ctx.parentid,
			payload,
		});
	}

	canActivate(_ctx: AbilityContext): boolean {
		return true;
	}

	protected finish(): AbilityYield {
		return { type: 'finish' };
	}

	abstract activate(ctx: AbilityContext): AbilityCoroutine;
}

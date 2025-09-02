import type { BaseModel } from '../core/basemodel';
import type { EventScope } from '../core/eventemitter';

export type TagId = string;
export type AttributeId = string;
export type AbilityId = string;
export type EffectId = string;
export type ObjectId = string;

export interface Attribute {
	base: number;
	current: number;
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
	ownerId: ObjectId;
	model: BaseModel;
}

export interface Ability {
	readonly id: AbilityId;
	canActivate(ctx: AbilityContext): boolean;
	activate(ctx: AbilityContext): AbilityCoroutine;
}

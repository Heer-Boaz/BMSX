import type { EventPayload } from '../core/eventemitter';
import type { WorldObject } from '../core/object/worldobject';

export interface ActionEffectPayloadTable {
	// Games and engine modules augment this interface with effect ids and their payload contracts.
}

export type ActionEffectTableKeys = Extract<keyof ActionEffectPayloadTable, string>;

export type ActionEffectId = [ActionEffectTableKeys] extends [never] ? string : ActionEffectTableKeys;

export type ActionEffectPayloadFor<Id extends ActionEffectId> = Id extends ActionEffectTableKeys
	? ActionEffectPayloadTable[Id]
	: EventPayload;

export type ActionEffectTriggerOptions<Id extends ActionEffectId> = Id extends ActionEffectTableKeys
	? (ActionEffectPayloadFor<Id> extends undefined ? { payload?: undefined } : { payload: ActionEffectPayloadFor<Id> })
	: { payload?: EventPayload };

export type ActionEffectTriggerResult = 'ok' | 'on_cooldown' | 'failed';
export type ActionEffectHandlerResult = { event?: string; payload?: EventPayload } | undefined;

export type ScriptHandler<TArgs extends unknown[] = unknown[], TResult = unknown> =
	((...args: TArgs) => TResult) | import('../lua/handler_cache').LuaHandlerFn;

export interface ActionEffectHandlerContext<Id extends ActionEffectId = ActionEffectId> {
	owner: WorldObject;
	payload?: ActionEffectPayloadFor<Id>;
}

export type ActionEffectHandler<Id extends ActionEffectId = ActionEffectId> =
	(ctx: ActionEffectHandlerContext<Id>) => ActionEffectHandlerResult;

export interface ActionEffectDefinition<Id extends ActionEffectId = ActionEffectId> {
	id: Id;
	event?: string;
	cooldown_ms?: number;
	handler?: ActionEffectHandler<Id>;
}

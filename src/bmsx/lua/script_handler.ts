import type { LuaHandlerFn } from './handler_cache';

export type ScriptHandler<TArgs extends unknown[] = unknown[], TResult = unknown> =
	((...args: TArgs) => TResult) | LuaHandlerFn;

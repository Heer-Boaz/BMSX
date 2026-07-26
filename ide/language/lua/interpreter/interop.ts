import type { LuaValue } from './value';

export type LuaMarshalContext = {
	moduleId: string;
	path: string[];
};

export interface LuaInteropAdapter {
	convertFromLua(value: LuaValue, context?: LuaMarshalContext): unknown;
	toLua(value: unknown): LuaValue;
}

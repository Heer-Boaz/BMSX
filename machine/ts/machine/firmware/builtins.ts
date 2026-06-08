import { LuaEnvironment } from '../../lua/environment';
import { LuaInterpreter, LuaNativeFunction } from '../../lua/runtime';
import { isLuaCallSignal, LuaFunctionValue, type LuaCallResult } from '../../lua/value';
import { createLuaTable, isLuaTable, LuaTable, LuaValue } from '../../lua/value';
import { createInterpreterDevtoolsTable } from './devtools';
import {
	DEFAULT_LUA_BUILTIN_FUNCTIONS,
	SYSTEM_LUA_BUILTIN_FUNCTIONS,
} from './builtin_descriptors';
import { bmsxCivilTimeFromTimestamp, bmsxTimestampFromLuaCivilTime, formatBmsxCivilTime, requireLuaCivilTimeField, requireLuaTimeValue } from './civil_time';
import type { Runtime } from '../runtime/runtime';
import type { LuaBuiltinDescriptor } from '../../lua/semantic_contracts';

export function registerFirmwareBuiltins(runtime: Runtime, interpreter: LuaInterpreter): void {
	runtime.apiFunctionNames.clear();

	const env = interpreter.globalEnvironment;
	registerLuaGlobal(runtime, env, 'devtools', createInterpreterDevtoolsTable(runtime, interpreter));

	registerInterpreterMachineTimeBuiltins(runtime, interpreter);
	registerSystemBuiltins(runtime, interpreter);
}

const EMPTY_LUA_RESULT: LuaCallResult = Object.freeze([]) as unknown as LuaCallResult;

function populateLuaDateTable(table: LuaTable, timestamp: number): void {
	const time = bmsxCivilTimeFromTimestamp(timestamp);
	table.set('year', time.year);
	table.set('month', time.month);
	table.set('day', time.day);
	table.set('hour', time.hour);
	table.set('min', time.min);
	table.set('sec', time.sec);
	table.set('wday', time.wday);
	table.set('yday', time.yday);
	table.set('isdst', time.isdst);
}

function registerInterpreterMachineTimeBuiltins(runtime: Runtime, interpreter: LuaInterpreter): void {
	const mathTable = interpreter.getGlobal('math') as LuaTable;
	mathTable.set('randomseed', new LuaNativeFunction('math.randomseed', (args) => {
		const seedValue = args.length > 0 ? (args[0] as number) : runtime.machineElapsedMs();
		interpreter.randomSeed = Math.floor(seedValue) >>> 0;
		return EMPTY_LUA_RESULT;
	}));

	const osTable = createLuaTable();
	osTable.set('clock', new LuaNativeFunction('os.clock', () => {
		return [runtime.machineElapsedMs() / 1000];
	}));
	osTable.set('time', new LuaNativeFunction('os.time', (args) => {
		if (args.length === 0 || args[0] === null) {
			return [Math.trunc(runtime.machineElapsedMs() / 1000)];
		}
		const table = args[0];
		if (!isLuaTable(table)) {
			throw interpreter.runtimeError('os.time expects a table or nil.');
		}
		const timestamp = bmsxTimestampFromLuaCivilTime(
			requireLuaCivilTimeField(table.get('year'), 'year', -1, 1900),
			requireLuaCivilTimeField(table.get('month'), 'month', -1, 1),
			requireLuaCivilTimeField(table.get('day'), 'day', -1, 0),
			requireLuaCivilTimeField(table.get('hour'), 'hour', 12, 0),
			requireLuaCivilTimeField(table.get('min'), 'min', 0, 0),
			requireLuaCivilTimeField(table.get('sec'), 'sec', 0, 0)
		);
		populateLuaDateTable(table, timestamp);
		return [timestamp];
	}));
	osTable.set('difftime', new LuaNativeFunction('os.difftime', (args) => {
		return [requireLuaTimeValue(args[0]) - requireLuaTimeValue(args[1])];
	}));
	osTable.set('date', new LuaNativeFunction('os.date', (args) => {
		const formatValue = args.length > 0 ? args[0] : null;
		if (formatValue !== null && typeof formatValue !== 'string') {
			throw interpreter.runtimeError('os.date expects a format string.');
		}
		const format = formatValue === null ? '%c' : (formatValue as string);
		const bmsxFormat = format.charCodeAt(0) === 33 ? format.slice(1) : format;
		const timestamp = args.length > 1 && args[1] !== null ? requireLuaTimeValue(args[1]) : Math.trunc(runtime.machineElapsedMs() / 1000);
		if (bmsxFormat === '*t') {
			const table = createLuaTable();
			populateLuaDateTable(table, timestamp);
			return [table];
		}
		return [formatBmsxCivilTime(bmsxFormat, bmsxCivilTimeFromTimestamp(timestamp))];
	}));
	registerLuaGlobal(runtime, interpreter.globalEnvironment, 'os', osTable);
}

function registerSystemBuiltins(runtime: Runtime, interpreter: LuaInterpreter): void {
	const env = interpreter.globalEnvironment;
	const callSystemMember = (name: string, args: ReadonlyArray<LuaValue>): LuaCallResult => {
		const requireFn = interpreter.getGlobal('require') as LuaFunctionValue;
		const systemValue = requireFn.call(['system']);
		if (isLuaCallSignal(systemValue)) {
			return systemValue;
		}
		const systemTable = systemValue[0] as LuaTable;
		return (systemTable.get(name) as LuaFunctionValue).call(args);
	};
	for (let index = 0; index < SYSTEM_LUA_BUILTIN_FUNCTIONS.length; index += 1) {
		const name = SYSTEM_LUA_BUILTIN_FUNCTIONS[index].name;
		const native = new LuaNativeFunction(name, (args) => callSystemMember(name, args));
		registerLuaGlobal(runtime, env, name, native);
	}
}

export function registerLuaBuiltin(runtime: Runtime, metadata: LuaBuiltinDescriptor): void {
	const name = metadata.name.trim();
	if (name.length === 0) {
		throw new Error(`Invalid Lua builtin name for '${name}'.`);
	}
	const params: string[] = [];
	const optionalSet: Set<string> = new Set();
	const normalizedDescriptions: (string)[] = [];
	const sourceParams = Array.isArray(metadata.params) ? metadata.params : [];
	const sourceDescriptions = Array.isArray(metadata.parameterDescriptions) ? metadata.parameterDescriptions : [];
	for (let index = 0; index < sourceParams.length; index += 1) {
		const raw = sourceParams[index];
		const description = index < sourceDescriptions.length ? sourceDescriptions[index] : null;
		if (typeof raw !== 'string' || raw.trim().length === 0) {
			throw new Error(`Invalid Lua builtin parameter at index ${index} for '${name}'.`);
		}
		if (raw === '...' || raw.endsWith('...')) {
			params.push(raw);
			normalizedDescriptions.push(description);
			continue;
		}
		if (raw.endsWith('?')) {
			const base = raw.slice(0, -1);
			if (base.length > 0) {
				params.push(base);
				normalizedDescriptions.push(description);
				optionalSet.add(base);
			}
			continue;
		}
		params.push(raw);
		normalizedDescriptions.push(description);
	}
	if (Array.isArray(metadata.optionalParams)) {
		for (let index = 0; index < metadata.optionalParams.length; index += 1) {
			const optionalName = metadata.optionalParams[index];
			if (typeof optionalName !== 'string' || optionalName.length === 0) {
				throw new Error(`Invalid Lua optional parameter at index ${index} for '${name}'.`);
			}
			optionalSet.add(optionalName);
		}
	}
	const signature = typeof metadata.signature === 'string' ? metadata.signature : name;
	const optionalParams = optionalSet.size > 0 ? Array.from(optionalSet) : undefined;
	const descriptor: LuaBuiltinDescriptor = {
		name,
		params,
		signature,
		optionalParams,
		parameterDescriptions: normalizedDescriptions,
		description: metadata.description,
	};
	runtime.luaBuiltinMetadata.set(name, descriptor);
}

export function seedDefaultLuaBuiltins(runtime: Runtime): void {
	for (let index = 0; index < DEFAULT_LUA_BUILTIN_FUNCTIONS.length; index += 1) {
		registerLuaBuiltin(runtime, DEFAULT_LUA_BUILTIN_FUNCTIONS[index]);
	}
}

export function registerLuaGlobal(runtime: Runtime, env: LuaEnvironment, name: string, value: LuaValue): void {
	env.set(name, value);
	runtime.apiFunctionNames.add(name);
}

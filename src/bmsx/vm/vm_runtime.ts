import { $ } from '../core/engine_core';
import { taskGate } from '../core/taskgate';
import { Input } from '../input/input';
import type { InputMap } from '../input/inputtypes';
import type { BmsxCartridgeBlob } from '../rompack/rompack';
import { AssetSourceStack } from '../rompack/asset_source';
import { applyRuntimeAssetLayer, buildRuntimeAssetLayer } from '../rompack/romloader';
import { createIdentifierCanonicalizer } from '../utils/identifier_canonicalizer';
import type { StorageService } from '../platform/platform';
import { VMCPU, Table, type Closure, type Program, type Value, RunResult, createNativeFunction, createNativeObject, isNativeFunction, isNativeObject, type NativeFunction, type NativeObject } from './cpu';
import { BmsxVMApi } from './vm_api';
import { BmsxVMStorage } from './storage';
import { VMFont } from './font';
import { IO_ARG0_OFFSET, IO_BUFFER_BASE, IO_COMMAND_STRIDE, IO_CMD_PRINT, IO_WRITE_PTR_ADDR, VM_IO_MEMORY_SIZE } from './vm_io';
import { VmHandlerCache } from './vm_handler_cache';
import { VM_PROGRAM_ASSET_ID, inflateProgram, type VmProgramAsset } from './vm_program_asset';
import { reindexProgram } from './program_reindex';
import type { VmRuntimeOptions, VmMarshalContext, VmRuntimeError } from './vm_core_types';

export const VM_BUTTON_ACTIONS: ReadonlyArray<string> = [
	'left',
	'right',
	'up',
	'down',
	'b',
	'a',
	'x',
	'y',
	'start',
	'select',
	'rt',
	'lt',
	'rb',
	'lb',
];

const UPDATE_INSTRUCTION_BUDGET = 10_000;

export type VmFrameState = {
	updateExecuted: boolean;
	deltaSeconds: number;
};

export type VmRuntimeState = {
	playerIndex: number;
	storageService: StorageService;
	storage: BmsxVMStorage;
	cpuMemory: Value[];
	cpu: VMCPU;
	canonicalization: VmRuntimeOptions['canonicalization'];
	canonicalizeIdentifier: (value: string) => string;
	vmInitClosure: Closure | null;
	vmNewGameClosure: Closure | null;
	vmUpdateClosure: Closure | null;
	vmDrawClosure: Closure | null;
	pendingVmCall: 'update' | 'draw' | null;
	currentFrameState: VmFrameState | null;
	pendingProgramReload: { runInit?: boolean } | null;
	vmModuleAliases: Map<string, string>;
	vmModuleProtos: Map<string, number>;
	vmModuleCache: Map<string, Value>;
	vmHandlerCache: VmHandlerCache;
	nativeObjectCache: WeakMap<object, NativeObject>;
	nativeFunctionCache: WeakMap<Function, NativeFunction>;
	nativeMemberCache: WeakMap<object, Map<string, NativeFunction>>;
	vmTableIds: WeakMap<Table, number>;
	nextVmTableId: number;
	printHandler: (text: string) => void;
	tickEnabled: boolean;
	vmInitialized: boolean;
};

export let vmRuntime: VmRuntimeState = null;
export let api: BmsxVMApi;

const vmGate = taskGate.group('console:vm');

const toError = (error: unknown): Error =>
	error instanceof Error ? error : new Error(String(error));

export function createVmRuntime(options: VmRuntimeOptions): VmRuntimeState {
	if (vmRuntime) {
		throw new Error('[VMRuntime] Instance already exists.');
	}
	const storageService = $.platform.storage;
	const storage = new BmsxVMStorage(storageService, options.namespace);
	const resolvedCanonicalization = options.canonicalization ?? 'none';
	const canonicalizeIdentifier = createIdentifierCanonicalizer(resolvedCanonicalization);
	const cpuMemory = new Array<Value>(VM_IO_MEMORY_SIZE);
	for (let index = 0; index < cpuMemory.length; index += 1) {
		cpuMemory[index] = null;
	}
	cpuMemory[IO_WRITE_PTR_ADDR] = 0;
	const cpu = new VMCPU(cpuMemory);

	api = new BmsxVMApi({
		playerindex: options.playerIndex,
		storage,
		runtime: {
			getRuntime: () => vmRuntime,
			reboot: () => {
				void reloadProgramAndResetWorld();
			},
		},
	});

	vmRuntime = {
		playerIndex: options.playerIndex,
		storageService,
		storage,
		cpuMemory,
		cpu,
		canonicalization: resolvedCanonicalization,
		canonicalizeIdentifier,
		vmInitClosure: null,
		vmNewGameClosure: null,
		vmUpdateClosure: null,
		vmDrawClosure: null,
		pendingVmCall: null,
		currentFrameState: null,
		pendingProgramReload: null,
		vmModuleAliases: new Map(),
		vmModuleProtos: new Map(),
		vmModuleCache: new Map(),
		vmHandlerCache: null,
		nativeObjectCache: new WeakMap(),
		nativeFunctionCache: new WeakMap(),
		nativeMemberCache: new WeakMap(),
		vmTableIds: new WeakMap(),
		nextVmTableId: 1,
		printHandler: (text: string) => console.log(text),
		tickEnabled: true,
		vmInitialized: false,
	};

	vmRuntime.vmHandlerCache = new VmHandlerCache(invokeVmHandler, handleVmHandlerError);
	resetVmState();
	return vmRuntime;
}

export function destroyVmRuntime(): void {
	vmRuntime = null;
	api = null;
}

export function setVmPrintHandler(handler: (text: string) => void): void {
	vmRuntime.printHandler = handler;
}

export async function initVmRuntime(cartridge?: BmsxCartridgeBlob): Promise<void> {
	const engineLayer = $.engineLayer;
	const playerIndex = Input.instance.startupGamepadIndex ?? 1;
	$.view.default_font = new VMFont();

	if (!cartridge) {
		createVmRuntime({
			playerIndex,
			canonicalization: engineLayer.index.manifest.vm.canonicalization,
			viewport: engineLayer.index.manifest.vm.viewport,
			namespace: engineLayer.index.manifest.vm.namespace,
		});
		await bootVmRuntime();
		$.start();
		return;
	}

	const cartLayer = await buildRuntimeAssetLayer({ blob: cartridge, id: 'cart' });
	applyRuntimeAssetLayer($.assets, cartLayer);
	const overlayBlob = $.workspaceOverlay;
	const overlayLayer = overlayBlob ? await buildRuntimeAssetLayer({ blob: overlayBlob, id: 'overlay' }) : null;
	if (overlayLayer) {
		applyRuntimeAssetLayer($.assets, overlayLayer);
	}
	const layers = [];
	if (overlayLayer) {
		layers.push({ id: overlayLayer.id, index: overlayLayer.index, payload: overlayLayer.payload });
	}
	layers.push({ id: cartLayer.id, index: cartLayer.index, payload: cartLayer.payload });
	layers.push({ id: engineLayer.id, index: engineLayer.index, payload: engineLayer.payload });
	const assetSource = new AssetSourceStack(layers);
	$.setAssetSource(assetSource);
	await $.refreshAudioAssets();
	$.view.primaryAtlas = 0;

	const inputMappingPerPlayer = cartLayer.index.manifest.input ?? { 1: { keyboard: null, gamepad: null, pointer: null } as InputMap };
	for (const playerIndexStr of Object.keys(inputMappingPerPlayer)) {
		const mappedIndex = parseInt(playerIndexStr, 10);
		const inputMapping = inputMappingPerPlayer[mappedIndex];
		$.set_inputmap(mappedIndex, inputMapping);
	}

	createVmRuntime({
		playerIndex,
		canonicalization: cartLayer.index.manifest.vm.canonicalization,
		viewport: cartLayer.index.manifest.vm.viewport,
		namespace: cartLayer.index.manifest.vm.namespace,
	});
	await bootVmRuntime();
	$.start();
}

const bootVmProgram = (options?: { runInit?: boolean }): void => {
	vmRuntime.vmInitialized = false;
	resetVmState();
	const entryProtoIndex = loadProgramFromAsset();
	vmRuntime.cpu.start(entryProtoIndex);
	vmRuntime.pendingVmCall = null;
	vmRuntime.cpu.instructionBudgetRemaining = null;
	vmRuntime.cpu.run(null);
	processVmIo();
	vmRuntime.vmInitialized = true;
	bindLifecycleHandlers();
	if (options?.runInit !== false) {
		runVmLifecycleHandler('init');
		runVmLifecycleHandler('new_game');
	}
};

export async function bootVmRuntime(options?: { runInit?: boolean }): Promise<void> {
	const vmToken = vmGate.begin({ blocking: true, tag: 'boot' });
	try {
		bootVmProgram(options);
	} finally {
		vmGate.end(vmToken);
	}
}

const beginFrameState = (): VmFrameState => {
	if (vmRuntime.currentFrameState) {
		throw new Error('[VMRuntime] Attempted to begin a new frame while another frame is active.');
	}
	const deltaSeconds = $.deltatime_seconds;
	const state: VmFrameState = {
		updateExecuted: false,
		deltaSeconds,
	};
	vmRuntime.currentFrameState = state;
	return state;
};

export const tickUpdate = (): void => {
	if (!vmRuntime.tickEnabled) {
		return;
	}
	processPendingProgramReload();
	if (vmRuntime.currentFrameState !== null) {
		return;
	}
	const state = beginFrameState();
	try {
		runUpdatePhase(state);
	} catch (error) {
		vmRuntime.currentFrameState = null;
		throw error;
	}
};

export const tickDraw = (): void => {
	if (!vmRuntime.tickEnabled) {
		return;
	}
	processPendingProgramReload();
	if (!vmRuntime.currentFrameState) {
		return;
	}
	try {
		runDrawPhase();
	} finally {
		abandonFrameState();
	}
};

const runUpdatePhase = (state: VmFrameState): void => {
	if (state.updateExecuted) {
		return;
	}
	if (!vmGate.ready) {
		state.updateExecuted = true;
		return;
	}
	if (vmRuntime.pendingVmCall && vmRuntime.pendingVmCall !== 'update') {
		state.updateExecuted = true;
		return;
	}
	if (vmRuntime.vmUpdateClosure) {
		if (!vmRuntime.pendingVmCall) {
			vmRuntime.cpu.call(vmRuntime.vmUpdateClosure, [state.deltaSeconds], 0);
			vmRuntime.pendingVmCall = 'update';
		}
		const result = vmRuntime.cpu.run(UPDATE_INSTRUCTION_BUDGET);
		processVmIo();
		if (result === RunResult.Halted) {
			vmRuntime.pendingVmCall = null;
		}
	}
	state.updateExecuted = true;
};

const runDrawPhase = (): void => {
	if (!vmGate.ready) {
		return;
	}
	if (vmRuntime.pendingVmCall && vmRuntime.pendingVmCall !== 'draw') {
		return;
	}
	if (vmRuntime.vmDrawClosure) {
		if (!vmRuntime.pendingVmCall) {
			vmRuntime.cpu.call(vmRuntime.vmDrawClosure, [], 0);
			vmRuntime.pendingVmCall = 'draw';
		}
		const result = vmRuntime.cpu.run(UPDATE_INSTRUCTION_BUDGET);
		processVmIo();
		if (result === RunResult.Halted) {
			vmRuntime.pendingVmCall = null;
		}
	}
};

export const abandonFrameState = (): void => {
	vmRuntime.currentFrameState = null;
};

const mapModuleProtoIndices = (asset: VmProgramAsset, incomingProtoIds: ReadonlyArray<string>, protoIdToIndex: Map<string, number>): void => {
	vmRuntime.vmModuleProtos.clear();
	for (const entry of asset.moduleProtos) {
		const protoId = incomingProtoIds[entry.protoIndex];
		const mappedIndex = protoIdToIndex.get(protoId);
		if (mappedIndex === undefined) {
			throw new Error(`[VMRuntime] Module proto '${protoId}' missing after reindex.`);
		}
		vmRuntime.vmModuleProtos.set(entry.path, mappedIndex);
	}
};

const loadProgramFromAsset = (baseProgram?: Program): number => {
	const programAsset = $.assets.data[VM_PROGRAM_ASSET_ID] as VmProgramAsset;
	if (!programAsset) {
		throw new Error(`[VMRuntime] Program asset '${VM_PROGRAM_ASSET_ID}' missing.`);
	}
	const incomingProgram = inflateProgram(programAsset.program);
	if (baseProgram) {
		const reindexed = reindexProgram(incomingProgram, baseProgram.protoIds);
		const program = reindexed.program;
		const entryProtoId = incomingProgram.protoIds[programAsset.entryProtoIndex];
		const entryProtoIndex = reindexed.protoIdToIndex.get(entryProtoId);
		if (entryProtoIndex === undefined) {
			throw new Error(`[VMRuntime] Entry proto '${entryProtoId}' missing after reindex.`);
		}
		vmRuntime.cpu.setProgram(program);
		mapModuleProtoIndices(programAsset, incomingProgram.protoIds, reindexed.protoIdToIndex);
		vmRuntime.vmModuleAliases.clear();
		for (const entry of programAsset.moduleAliases) {
			vmRuntime.vmModuleAliases.set(entry.alias, entry.path);
		}
		vmRuntime.vmModuleCache.clear();
		return entryProtoIndex;
	}
	const program = incomingProgram;
	loadProgram(programAsset, program);
	return programAsset.entryProtoIndex;
};

const applyProgramReload = (options?: { runInit?: boolean }): void => {
	vmRuntime.vmInitialized = false;
	const entryProtoIndex = loadProgramFromAsset(vmRuntime.cpu.getProgram());
	vmRuntime.cpu.start(entryProtoIndex);
	vmRuntime.pendingVmCall = null;
	vmRuntime.cpu.instructionBudgetRemaining = null;
	vmRuntime.cpu.run(null);
	processVmIo();
	vmRuntime.vmInitialized = true;
	bindLifecycleHandlers();
	if (options?.runInit !== false) {
		runVmLifecycleHandler('init');
		runVmLifecycleHandler('new_game');
	}
};

const processPendingProgramReload = (): void => {
	if (!vmRuntime.pendingProgramReload) {
		return;
	}
	if (vmRuntime.currentFrameState || vmRuntime.pendingVmCall) {
		return;
	}
	const options = vmRuntime.pendingProgramReload;
	vmRuntime.pendingProgramReload = null;
	const vmToken = vmGate.begin({ blocking: true, tag: 'reload_program' });
	try {
		applyProgramReload(options);
	} finally {
		vmGate.end(vmToken);
	}
};

export const loadProgram = (asset: VmProgramAsset, program = inflateProgram(asset.program)): void => {
	vmRuntime.cpu.setProgram(program);
	vmRuntime.vmModuleProtos.clear();
	for (const entry of asset.moduleProtos) {
		vmRuntime.vmModuleProtos.set(entry.path, entry.protoIndex);
	}
	vmRuntime.vmModuleAliases.clear();
	for (const entry of asset.moduleAliases) {
		vmRuntime.vmModuleAliases.set(entry.alias, entry.path);
	}
	vmRuntime.vmModuleCache.clear();
};

const bindLifecycleHandlers = (): void => {
	const globals = vmRuntime.cpu.globals;
	vmRuntime.vmNewGameClosure = globals.get(vmRuntime.canonicalizeIdentifier('new_game')) as Closure;
	vmRuntime.vmInitClosure = globals.get(vmRuntime.canonicalizeIdentifier('init')) as Closure;
	vmRuntime.vmUpdateClosure = globals.get(vmRuntime.canonicalizeIdentifier('update')) as Closure;
	vmRuntime.vmDrawClosure = globals.get(vmRuntime.canonicalizeIdentifier('draw')) as Closure;
};

const runVmLifecycleHandler = (kind: 'init' | 'new_game'): void => {
	const fn = kind === 'init' ? vmRuntime.vmInitClosure : vmRuntime.vmNewGameClosure;
	if (!fn) {
		throw new Error(`VM lifecycle handler '${kind}' is not defined.`);
	}
	vmRuntime.cpu.call(fn, [], 0);
	vmRuntime.cpu.instructionBudgetRemaining = null;
	vmRuntime.cpu.run(null);
	processVmIo();
};

const resetVmState = (): void => {
	vmRuntime.pendingVmCall = null;
	vmRuntime.pendingProgramReload = null;
	vmRuntime.vmInitClosure = null;
	vmRuntime.vmNewGameClosure = null;
	vmRuntime.vmUpdateClosure = null;
	vmRuntime.vmDrawClosure = null;
	vmRuntime.cpu.instructionBudgetRemaining = null;
	vmRuntime.cpu.globals.clear();
	vmRuntime.vmModuleCache.clear();
	vmRuntime.vmModuleAliases.clear();
	vmRuntime.vmModuleProtos.clear();
	for (let index = 0; index < vmRuntime.cpuMemory.length; index += 1) {
		vmRuntime.cpuMemory[index] = null;
	}
	vmRuntime.cpuMemory[IO_WRITE_PTR_ADDR] = 0;
	seedVmGlobals();
};

const registerVmGlobal = (name: string, value: Value): void => {
	const key = vmRuntime.canonicalizeIdentifier(name);
	vmRuntime.cpu.globals.set(key, value);
};

const seedVmGlobals = (): void => {
	const mathTable = new Table(0, 0);
	mathTable.set('abs', createNativeFunction('math.abs', (args) => {
		const value = args[0] as number;
		return [Math.abs(value)];
	}));
	mathTable.set('ceil', createNativeFunction('math.ceil', (args) => {
		const value = args[0] as number;
		return [Math.ceil(value)];
	}));
	mathTable.set('floor', createNativeFunction('math.floor', (args) => {
		const value = args[0] as number;
		return [Math.floor(value)];
	}));
	mathTable.set('max', createNativeFunction('math.max', (args) => {
		let result = args[0] as number;
		for (let index = 1; index < args.length; index += 1) {
			const value = args[index] as number;
			if (value > result) {
				result = value;
			}
		}
		return [result];
	}));
	mathTable.set('min', createNativeFunction('math.min', (args) => {
		let result = args[0] as number;
		for (let index = 1; index < args.length; index += 1) {
			const value = args[index] as number;
			if (value < result) {
				result = value;
			}
		}
		return [result];
	}));
	mathTable.set('pi', Math.PI);

	registerVmGlobal('math', mathTable);
	registerVmGlobal('type', createNativeFunction('type', (args) => {
		const value = args.length > 0 ? args[0] : null;
		return [vmTypeOf(value)];
	}));
	registerVmGlobal('tostring', createNativeFunction('tostring', (args) => {
		const value = args.length > 0 ? args[0] : null;
		return [vmToString(value)];
	}));
	registerVmGlobal('tonumber', createNativeFunction('tonumber', (args) => {
		if (args.length === 0) {
			return [null];
		}
		const value = args[0];
		if (typeof value === 'number') {
			return [value];
		}
		if (typeof value === 'string') {
			if (args.length >= 2) {
				const baseValue = Math.floor(args[1] as number);
				if (baseValue >= 2 && baseValue <= 36) {
					const parsed = parseInt(value.trim(), baseValue);
					return Number.isFinite(parsed) ? [parsed] : [null];
				}
			}
			const converted = Number(value);
			return Number.isFinite(converted) ? [converted] : [null];
		}
		return [null];
	}));
	registerVmGlobal('require', createNativeFunction('require', (args) => {
		const moduleName = (args[0] as string).trim();
		return [requireVmModule(moduleName)];
	}));
	registerVmGlobal('array', createNativeFunction('array', (args) => {
		const ctx = buildVmContext();
		let result: unknown[] = [];
		if (args.length === 1 && args[0] instanceof Table) {
			result = createNativeArrayFromTable(args[0], ctx);
		} else {
			result = new Array(args.length);
			for (let index = 0; index < args.length; index += 1) {
				result[index] = toNativeValue(args[index], ctx, new WeakMap());
			}
		}
		return [getOrCreateNativeObject(result)];
	}));
	registerVmGlobal('print', createNativeFunction('print', (args) => {
		const parts: string[] = [];
		for (let index = 0; index < args.length; index += 1) {
			parts.push(formatVmValue(args[index]));
		}
		vmRuntime.printHandler(parts.length === 0 ? '' : parts.join('\t'));
		return [];
	}));

	const stringTable = new Table(0, 0);
	stringTable.set('len', createNativeFunction('string.len', (args) => {
		const text = args[0] as string;
		return [text.length];
	}));
	stringTable.set('upper', createNativeFunction('string.upper', (args) => {
		const text = args[0] as string;
		return [text.toUpperCase()];
	}));
	stringTable.set('lower', createNativeFunction('string.lower', (args) => {
		const text = args[0] as string;
		return [text.toLowerCase()];
	}));
	stringTable.set('sub', createNativeFunction('string.sub', (args) => {
		const text = args[0] as string;
		const length = text.length;
		const normalizeIndex = (value: number): number => {
			const integer = Math.floor(value);
			if (integer > 0) {
				return integer;
			}
			if (integer < 0) {
				return length + integer + 1;
			}
			return 1;
		};
		const startArg = args.length > 1 ? (args[1] as number) : 1;
		const endArg = args.length > 2 ? (args[2] as number) : length;
		let startIndex = normalizeIndex(startArg);
		let endIndex = normalizeIndex(endArg);
		if (startIndex < 1) {
			startIndex = 1;
		}
		if (endIndex > length) {
			endIndex = length;
		}
		if (endIndex < startIndex) {
			return [''];
		}
		return [text.substring(startIndex - 1, endIndex)];
	}));
	stringTable.set('find', createNativeFunction('string.find', (args) => {
		const source = args[0] as string;
		const pattern = args.length > 1 ? (args[1] as string) : '';
		const startIndex = args.length > 2 ? Math.max(1, Math.floor(args[2] as number)) - 1 : 0;
		const position = source.indexOf(pattern, startIndex);
		if (position === -1) {
			return [null];
		}
		const first = position + 1;
		const last = first + pattern.length - 1;
		return [first, last];
	}));
	stringTable.set('byte', createNativeFunction('string.byte', (args) => {
		const source = args[0] as string;
		const positionArg = args.length > 1 ? (args[1] as number) : 1;
		const position = Math.floor(positionArg) - 1;
		if (position < 0 || position >= source.length) {
			return [null];
		}
		return [source.charCodeAt(position)];
	}));
	stringTable.set('char', createNativeFunction('string.char', (args) => {
		if (args.length === 0) {
			return [''];
		}
		let result = '';
		for (let index = 0; index < args.length; index += 1) {
			const code = args[index] as number;
			result += String.fromCharCode(Math.floor(code));
		}
		return [result];
	}));
	stringTable.set('format', createNativeFunction('string.format', (args) => {
		const template = args[0] as string;
		const formatted = formatVmString(template, args, 1);
		return [formatted];
	}));
	registerVmGlobal('string', stringTable);

	const members = collectApiMembers();
	for (const { name, kind, descriptor } of members) {
		if (kind === 'method') {
			const callable = descriptor.value as (...args: unknown[]) => unknown;
			const native = createNativeFunction(`api.${name}`, (args) => {
				const ctx = buildVmContext();
				const visited = new WeakMap<Table, unknown>();
				const jsArgs: unknown[] = [];
				for (let index = 0; index < args.length; index += 1) {
					const nextCtx = extendMarshalContext(ctx, `arg${index}`);
					jsArgs.push(toNativeValue(args[index], nextCtx, visited));
				}
				try {
					const result = callable.apply(api, jsArgs);
					return wrapNativeResult(result);
				} catch (error) {
					const message = toError(error).message;
					throw createVmRuntimeError(`[api.${name}] ${message}`);
				}
			});
			registerVmGlobal(name, native);
			continue;
		}
		if (descriptor.get) {
			const getter = descriptor.get;
			const native = createNativeFunction(`api.${name}`, () => {
				try {
					const result = getter.call(api);
					return wrapNativeResult(result);
				} catch (error) {
					const message = toError(error).message;
					throw createVmRuntimeError(`[api.${name}] ${message}`);
				}
			});
			registerVmGlobal(name, native);
		}
	}

	exposeVmObjects();
};

const collectApiMembers = (): Array<{ name: string; kind: 'method' | 'getter'; descriptor: PropertyDescriptor }> => {
	const map = new Map<string, { kind: 'method' | 'getter'; descriptor: PropertyDescriptor }>();
	let prototype: object = Object.getPrototypeOf(api);
	while (prototype && prototype !== Object.prototype) {
		for (const name of Object.getOwnPropertyNames(prototype)) {
			if (name === 'constructor') continue;
			const descriptor = Object.getOwnPropertyDescriptor(prototype, name);
			if (!descriptor || map.has(name)) continue;
			if (typeof descriptor.value === 'function') {
				map.set(name, { kind: 'method', descriptor });
			} else if (descriptor.get) {
				map.set(name, { kind: 'getter', descriptor });
			}
		}
		prototype = Object.getPrototypeOf(prototype);
	}
	return Array.from(map.entries(), ([name, value]) => ({ name, kind: value.kind, descriptor: value.descriptor }));
};

const exposeVmObjects = (): void => {
	const entries: Array<[string, object]> = [
		['world', $.world],
		['game', $],
		['$', $],
		['registry', $.registry],
		['assets', $.assets],
	];
	for (const [name, object] of entries) {
		registerVmGlobal(name, getOrCreateNativeObject(object));
	}
};

const vmTypeOf = (value: Value): string => {
	if (value === null) {
		return 'nil';
	}
	if (typeof value === 'boolean') {
		return 'boolean';
	}
	if (typeof value === 'number') {
		return 'number';
	}
	if (typeof value === 'string') {
		return 'string';
	}
	if (value instanceof Table) {
		return 'table';
	}
	if (isNativeFunction(value)) {
		return 'function';
	}
	if (isNativeObject(value)) {
		return 'native';
	}
	return 'function';
};

const vmToString = (value: Value): string => {
	if (value === null) {
		return 'nil';
	}
	if (typeof value === 'boolean') {
		return value ? 'true' : 'false';
	}
	if (typeof value === 'number') {
		return Number.isFinite(value) ? value.toString() : 'nan';
	}
	if (typeof value === 'string') {
		return value;
	}
	if (value instanceof Table) {
		return 'table';
	}
	if (isNativeFunction(value)) {
		return 'function';
	}
	if (isNativeObject(value)) {
		return 'native';
	}
	return 'function';
};

export const formatVmValue = (value: Value): string => vmToString(value);

const formatVmString = (template: string, args: ReadonlyArray<Value>, argStart: number): string => {
	let argumentIndex = argStart;
	let output = '';

	const takeArgument = (): Value => {
		const value = argumentIndex < args.length ? args[argumentIndex] : null;
		argumentIndex += 1;
		return value;
	};

	const readInteger = (startIndex: number): { found: boolean; value: number; nextIndex: number } => {
		let cursor = startIndex;
		while (cursor < template.length) {
			const code = template.charCodeAt(cursor);
			if (code < 48 || code > 57) {
				break;
			}
			cursor += 1;
		}
		if (cursor === startIndex) {
			return { found: false, value: 0, nextIndex: startIndex };
		}
		return { found: true, value: parseInt(template.slice(startIndex, cursor), 10), nextIndex: cursor };
	};

	for (let index = 0; index < template.length; index += 1) {
		const current = template.charAt(index);
		if (current !== '%') {
			output += current;
			continue;
		}
		if (index === template.length - 1) {
			throw createVmRuntimeError('string.format incomplete format specifier.');
		}
		if (template.charAt(index + 1) === '%') {
			output += '%';
			index += 1;
			continue;
		}

		let cursor = index + 1;
		const flags = { leftAlign: false, plus: false, space: false, zeroPad: false, alternate: false };
		while (true) {
			const flag = template.charAt(cursor);
			if (flag === '-') {
				flags.leftAlign = true;
				cursor += 1;
				continue;
			}
			if (flag === '+') {
				flags.plus = true;
				cursor += 1;
				continue;
			}
			if (flag === ' ') {
				flags.space = true;
				cursor += 1;
				continue;
			}
			if (flag === '0') {
				flags.zeroPad = true;
				cursor += 1;
				continue;
			}
			if (flag === '#') {
				flags.alternate = true;
				cursor += 1;
				continue;
			}
			break;
		}

		let width: number = null;
		if (template.charAt(cursor) === '*') {
			const widthArg = Math.trunc(takeArgument() as number);
			if (widthArg < 0) {
				flags.leftAlign = true;
				width = -widthArg;
			} else {
				width = widthArg;
			}
			cursor += 1;
		} else {
			const parsedWidth = readInteger(cursor);
			if (parsedWidth.found) {
				width = parsedWidth.value;
				cursor = parsedWidth.nextIndex;
			}
		}

		let precision: number = null;
		if (template.charAt(cursor) === '.') {
			cursor += 1;
			if (template.charAt(cursor) === '*') {
				const precisionArg = Math.trunc(takeArgument() as number);
				precision = precisionArg >= 0 ? precisionArg : null;
				cursor += 1;
			} else {
				const parsedPrecision = readInteger(cursor);
				precision = parsedPrecision.found ? parsedPrecision.value : 0;
				cursor = parsedPrecision.nextIndex;
			}
		}

		while (template.charAt(cursor) === 'l' || template.charAt(cursor) === 'L' || template.charAt(cursor) === 'h') {
			cursor += 1;
		}

		const specifier = template.charAt(cursor);
		if (specifier.length === 0) {
			throw createVmRuntimeError('string.format incomplete format specifier.');
		}

		const signPrefix = (value: number): string => {
			if (value < 0) {
				return '-';
			}
			if (flags.plus) {
				return '+';
			}
			if (flags.space) {
				return ' ';
			}
			return '';
		};

		const applyPadding = (content: string, sign: string, prefix: string, allowZeroPadding: boolean): string => {
			const totalLength = sign.length + prefix.length + content.length;
			if (width !== null && totalLength < width) {
				const paddingLength = width - totalLength;
				if (flags.leftAlign) {
					return `${sign}${prefix}${content}${' '.repeat(paddingLength)}`;
				}
				const padChar = allowZeroPadding ? '0' : ' ';
				if (padChar === '0') {
					return `${sign}${prefix}${'0'.repeat(paddingLength)}${content}`;
				}
				return `${' '.repeat(paddingLength)}${sign}${prefix}${content}`;
			}
			return `${sign}${prefix}${content}`;
		};

		switch (specifier) {
			case 's': {
				const value = takeArgument();
				let text = value === null ? 'nil' : vmToString(value);
				if (precision !== null) {
					text = text.substring(0, precision);
				}
				output += applyPadding(text, '', '', false);
				break;
			}
			case 'c': {
				const value = takeArgument() as number;
				const character = String.fromCharCode(Math.trunc(value));
				output += applyPadding(character, '', '', false);
				break;
			}
			case 'd':
			case 'i':
			case 'u':
			case 'o':
			case 'x':
			case 'X': {
				let number = takeArgument() as number;
				let integerValue = Math.trunc(number);
				const unsigned = specifier === 'u' || specifier === 'o' || specifier === 'x' || specifier === 'X';
				if (unsigned) {
					integerValue = integerValue >>> 0;
				}
				const negative = !unsigned && integerValue < 0;
				const sign = negative ? '-' : (specifier === 'd' || specifier === 'i') ? signPrefix(integerValue) : '';
				const magnitude = negative ? -integerValue : integerValue;
				let base = 10;
				if (specifier === 'o') {
					base = 8;
				}
				if (specifier === 'x' || specifier === 'X') {
					base = 16;
				}
				let digits = Math.trunc(magnitude).toString(base);
				if (specifier === 'X') {
					digits = digits.toUpperCase();
				}
				if (precision !== null) {
					const required = Math.max(precision, 0);
					if (digits.length < required) {
						digits = '0'.repeat(required - digits.length) + digits;
					}
					if (precision === 0 && magnitude === 0) {
						digits = '';
					}
				}
				let prefix = '';
				if (flags.alternate) {
					if ((specifier === 'x' || specifier === 'X') && magnitude !== 0) {
						prefix = specifier === 'x' ? '0x' : '0X';
					}
					if (specifier === 'o') {
						if (digits.length === 0) {
							digits = '0';
						} else if (digits.charAt(0) !== '0') {
							digits = `0${digits}`;
						}
					}
				}
				const allowZeroPad = flags.zeroPad && !flags.leftAlign && precision === null;
				output += applyPadding(digits, sign, prefix, allowZeroPad);
				break;
			}
			case 'f':
			case 'F': {
				const number = takeArgument() as number;
				const sign = signPrefix(number);
				const fractionDigits = precision !== null ? Math.max(0, precision) : 6;
				const text = Math.abs(number).toFixed(fractionDigits);
				const formatted = flags.alternate && fractionDigits === 0 && text.indexOf('.') === -1 ? `${text}.` : text;
				const allowZeroPad = flags.zeroPad && !flags.leftAlign;
				output += applyPadding(formatted, sign, '', allowZeroPad);
				break;
			}
			case 'e':
			case 'E': {
				const number = takeArgument() as number;
				const sign = signPrefix(number);
				const fractionDigits = precision !== null ? Math.max(0, precision) : 6;
				let text = Math.abs(number).toExponential(fractionDigits);
				if (specifier === 'E') {
					text = text.toUpperCase();
				}
				const allowZeroPad = flags.zeroPad && !flags.leftAlign;
				output += applyPadding(text, sign, '', allowZeroPad);
				break;
			}
			case 'g':
			case 'G': {
				const number = takeArgument() as number;
				const sign = signPrefix(number);
				const precisionValue = precision !== null ? Math.max(1, precision) : 6;
				const absValue = Math.abs(number);
				let text: string;
				if (absValue === 0) {
					text = '0';
				} else {
					const exponent = Math.floor(Math.log10(absValue));
					const useExponential = exponent < -4 || exponent >= precisionValue;
					if (useExponential) {
						text = absValue.toExponential(precisionValue - 1);
					} else {
						const fractionDigits = Math.max(0, precisionValue - exponent - 1);
						text = absValue.toFixed(fractionDigits);
					}
					if (!flags.alternate) {
						text = text.replace(/(?:\.0+|\.(\d*?)0+)$/, '.$1').replace(/\.$/, '');
					}
				}
				if (specifier === 'G') {
					text = text.toUpperCase();
				}
				const allowZeroPad = flags.zeroPad && !flags.leftAlign;
				output += applyPadding(text, sign, '', allowZeroPad);
				break;
			}
			case 'q': {
				const value = takeArgument();
				const raw = value === null ? 'nil' : vmToString(value);
				let escaped = '"';
				for (let charIndex = 0; charIndex < raw.length; charIndex += 1) {
					const code = raw.charCodeAt(charIndex);
					switch (code) {
						case 10:
							escaped += '\\n';
							break;
						case 13:
							escaped += '\\r';
							break;
						case 9:
							escaped += '\\t';
							break;
						case 34:
							escaped += '\\"';
							break;
						case 92:
							escaped += '\\\\';
							break;
						default:
							if (code < 32 || code === 127) {
								const decimal = code.toString(10);
								escaped += `\\${decimal.padStart(3, '0')}`;
							} else {
								escaped += raw.charAt(charIndex);
							}
							break;
					}
				}
				escaped += '"';
				output += applyPadding(escaped, '', '', false);
				break;
			}
			default:
				throw createVmRuntimeError(`string.format unsupported format specifier '%${specifier}'.`);
		}

		index = cursor;
	}

	return output;
};

const processVmIo = (): void => {
	const memory = vmRuntime.cpuMemory;
	const count = memory[IO_WRITE_PTR_ADDR] as number;
	if (!count) {
		return;
	}
	const base = IO_BUFFER_BASE;
	for (let index = 0; index < count; index += 1) {
		const cmdBase = base + index * IO_COMMAND_STRIDE;
		const cmd = memory[cmdBase] as number;
		switch (cmd) {
			case IO_CMD_PRINT: {
				const arg = memory[cmdBase + IO_ARG0_OFFSET];
				const text = formatVmValue(arg);
				vmRuntime.printHandler(text);
				break;
			}
			default:
				throw new Error(`Unknown VM IO command: ${cmd}.`);
		}
	}
	memory[IO_WRITE_PTR_ADDR] = 0;
};

const createVmRuntimeError = (message: string): VmRuntimeError => {
	const error = new Error(message) as VmRuntimeError;
	if (vmRuntime.cpu.hasFrames()) {
		const callStack = vmRuntime.cpu.getCallStack();
		const entry = callStack.length > 0 ? callStack[callStack.length - 1] : null;
		const range = entry ? vmRuntime.cpu.getDebugRange(entry.pc) : null;
		if (range) {
			error.path = range.path;
			error.line = range.start.line;
			error.column = range.start.column;
		}
	}
	return error;
};

const buildVmContext = (): VmMarshalContext => {
	let moduleId = 'vm';
	const callStack = vmRuntime.cpu.getCallStack();
	if (callStack.length > 0) {
		const entry = callStack[callStack.length - 1];
		const range = vmRuntime.cpu.getDebugRange(entry.pc);
		if (range && range.path) {
			moduleId = range.path;
		}
	}
	return { moduleId, path: [] };
};

const extendMarshalContext = (ctx: VmMarshalContext, segment: string): VmMarshalContext => {
	if (!segment) {
		return ctx;
	}
	return {
		moduleId: ctx.moduleId,
		path: ctx.path.concat(segment),
	};
};

const describeMarshalSegment = (key: Value): string => {
	if (typeof key === 'string') {
		return key;
	}
	if (typeof key === 'number') {
		return String(key);
	}
	return null;
};

const getOrAssignVmTableId = (table: Table): number => {
	const existing = vmRuntime.vmTableIds.get(table);
	if (existing !== undefined) {
		return existing;
	}
	const id = vmRuntime.nextVmTableId;
	vmRuntime.vmTableIds.set(table, id);
	vmRuntime.nextVmTableId += 1;
	return id;
};

const isPlainObject = (value: unknown): value is Record<string, unknown> => {
	if (value === null || typeof value !== 'object') {
		return false;
	}
	const proto = Object.getPrototypeOf(value);
	return proto === Object.prototype || proto === null;
};

const resolveNativeTypeName = (value: object | Function): string => {
	if (typeof value === 'function') {
		const name = value.name;
		if (typeof name === 'string' && name.length > 0) {
			return name;
		}
		return 'Function';
	}
	const descriptor = (value as { constructor?: unknown }).constructor;
	if (typeof descriptor === 'function') {
		const constructorFn = descriptor as { name?: unknown };
		if (constructorFn && typeof constructorFn.name === 'string' && constructorFn.name.length > 0) {
			return constructorFn.name;
		}
	}
	return 'Object';
};

const resolveNativeKey = (key: Value): string => {
	if (typeof key === 'string') {
		return key;
	}
	if (typeof key === 'number' && Number.isInteger(key)) {
		return String(key);
	}
	return null;
};

const toVmValue = (value: unknown): Value => {
	if (value === undefined || value === null) {
		return null;
	}
	if (typeof value === 'boolean' || typeof value === 'number' || typeof value === 'string') {
		return value;
	}
	if (isNativeObject(value as Value)) {
		return value as Value;
	}
	if (isNativeFunction(value as Value)) {
		return value as Value;
	}
	if (value instanceof Table) {
		return value;
	}
	if (Array.isArray(value)) {
		return getOrCreateNativeObject(value);
	}
	if (typeof value === 'function') {
		return getOrCreateNativeFunction(value);
	}
	if (isPlainObject(value)) {
		const table = new Table(0, 0);
		for (const [prop, entry] of Object.entries(value)) {
			table.set(prop, toVmValue(entry));
		}
		return table;
	}
	if (value instanceof Map) {
		const table = new Table(0, 0);
		for (const [key, entry] of value.entries()) {
			table.set(toVmValue(key), toVmValue(entry));
		}
		return table;
	}
	return getOrCreateNativeObject(value as object);
};

const toNativeValue = (value: Value, context: VmMarshalContext, visited: WeakMap<Table, unknown>): unknown => {
	if (value === null || typeof value === 'boolean' || typeof value === 'number' || typeof value === 'string') {
		return value;
	}
	if (value instanceof Table) {
		return vmTableToNative(value, context, visited);
	}
	if (isNativeObject(value)) {
		return value.raw;
	}
	if (isNativeFunction(value)) {
		return (...args: unknown[]) => {
			const vmArgs: Value[] = [];
			for (let index = 0; index < args.length; index += 1) {
				vmArgs.push(toVmValue(args[index]));
			}
			const results = value.invoke(vmArgs);
			if (results.length === 0) {
				return undefined;
			}
			return toNativeValue(results[0], context, new WeakMap());
		};
	}
	const handler = vmRuntime.vmHandlerCache.getOrCreate(value as Closure, {
		moduleId: context.moduleId,
		path: context.path,
	});
	return handler;
};

const vmTableToNative = (table: Table, context: VmMarshalContext, visited: WeakMap<Table, unknown>): unknown => {
	const cached = visited.get(table);
	if (cached !== undefined) {
		return cached;
	}
	const tableId = getOrAssignVmTableId(table);
	const tableContext = extendMarshalContext(context, `table${tableId}`);
	const entries = table.entriesArray();
	if (entries.length === 0) {
		const empty: Record<string, unknown> = {};
		visited.set(table, empty);
		return empty;
	}
	const numericEntries: Array<{ key: number; value: Value }> = [];
	const otherEntries: Array<{ key: Value; value: Value }> = [];
	let maxNumericIndex = 0;
	for (let index = 0; index < entries.length; index += 1) {
		const [key, entryValue] = entries[index];
		if (typeof key === 'number' && Number.isInteger(key) && key >= 1) {
			numericEntries.push({ key, value: entryValue });
			if (key > maxNumericIndex) {
				maxNumericIndex = key;
			}
			continue;
		}
		otherEntries.push({ key, value: entryValue });
	}

	const hasOnlyNumeric = otherEntries.length === 0;
	const isSequential = hasOnlyNumeric && maxNumericIndex === numericEntries.length;
	if (isSequential) {
		const result = new Array(maxNumericIndex);
		visited.set(table, result);
		for (let index = 0; index < numericEntries.length; index += 1) {
			const entry = numericEntries[index];
			const nextContext = extendMarshalContext(tableContext, String(entry.key));
			result[entry.key - 1] = toNativeValue(entry.value, nextContext, visited);
		}
		return result;
	}

	const objectResult: Record<string, unknown> = {};
	visited.set(table, objectResult);
	for (let index = 0; index < numericEntries.length; index += 1) {
		const entry = numericEntries[index];
		const segment = describeMarshalSegment(entry.key);
		const nextContext = segment ? extendMarshalContext(tableContext, segment) : tableContext;
		objectResult[String(entry.key)] = toNativeValue(entry.value, nextContext, visited);
	}
	for (let index = 0; index < otherEntries.length; index += 1) {
		const entry = otherEntries[index];
		const segment = describeMarshalSegment(entry.key);
		const nextContext = segment ? extendMarshalContext(tableContext, segment) : tableContext;
		objectResult[String(entry.key)] = toNativeValue(entry.value, nextContext, visited);
	}
	return objectResult;
};

const wrapNativeResult = (result: unknown): Value[] => {
	if (Array.isArray(result)) {
		const values: Value[] = [];
		for (let index = 0; index < result.length; index += 1) {
			values.push(toVmValue(result[index]));
		}
		return values;
	}
	if (result === undefined) {
		return [];
	}
	return [toVmValue(result)];
};

const getOrCreateNativeObject = (value: object): NativeObject => {
	const existing = vmRuntime.nativeObjectCache.get(value);
	if (existing) {
		return existing;
	}

	const wrapper = createNativeObject(value, {
		get: (key) => {
			const prop = resolveNativeKey(key);
			if (!prop) {
				return null;
			}
			const rawValue = (value as Record<string, unknown>)[prop];
			if (typeof rawValue === 'function') {
				return getOrCreateNativeMethod(value, prop);
			}
			return rawValue === undefined ? null : toVmValue(rawValue);
		},
		set: (key, entryValue) => {
			const prop = resolveNativeKey(key);
			if (!prop) {
				return;
			}
			(value as Record<string, unknown>)[prop] = toNativeValue(entryValue, buildVmContext(), new WeakMap());
		},
		len: () => {
			if (Array.isArray(value)) {
				return value.length;
			}
			const rawValue = (value as { length?: unknown }).length;
			if (typeof rawValue === 'number') {
				return rawValue;
			}
			return null;
		},
	});
	vmRuntime.nativeObjectCache.set(value, wrapper);
	return wrapper;
};

const getOrCreateNativeFunction = (fn: Function): NativeFunction => {
	const existing = vmRuntime.nativeFunctionCache.get(fn);
	if (existing) {
		return existing;
	}
	const name = resolveNativeTypeName(fn);
	const wrapper = createNativeFunction(name, (args) => {
		const ctx = buildVmContext();
		const visited = new WeakMap<Table, unknown>();
		const jsArgs: unknown[] = [];
		for (let index = 0; index < args.length; index += 1) {
			jsArgs.push(toNativeValue(args[index], ctx, visited));
		}
		const result = fn.apply(null, jsArgs);
		return wrapNativeResult(result);
	});
	vmRuntime.nativeFunctionCache.set(fn, wrapper);
	return wrapper;
};

const getOrCreateNativeMethod = (target: object, key: string): NativeFunction => {
	let bucket = vmRuntime.nativeMemberCache.get(target);
	if (!bucket) {
		bucket = new Map<string, NativeFunction>();
		vmRuntime.nativeMemberCache.set(target, bucket);
	}
	const existing = bucket.get(key);
	if (existing) {
		return existing;
	}
	const name = `${resolveNativeTypeName(target)}.${key}`;
	const wrapper = createNativeFunction(name, (args) => {
		const ctx = buildVmContext();
		const visited = new WeakMap<Table, unknown>();
		const jsArgs: unknown[] = [];
		let startIndex = 0;
		if (args.length > 0) {
			const first = toNativeValue(args[0], ctx, visited);
			if (first === target) {
				startIndex = 1;
			} else {
				jsArgs.push(first);
			}
		}
		for (let index = startIndex; index < args.length; index += 1) {
			jsArgs.push(toNativeValue(args[index], ctx, visited));
		}
		const member = (target as Record<string, unknown>)[key];
		if (typeof member !== 'function') {
			throw new Error(`Property '${key}' is not callable.`);
		}
		const result = (member as (...inner: unknown[]) => unknown).apply(target, jsArgs);
		return wrapNativeResult(result);
	});
	bucket.set(key, wrapper);
	return wrapper;
};

const callVmFunction = (fn: Closure, args: Value[]): Value[] => {
	const depth = vmRuntime.cpu.getFrameDepth();
	vmRuntime.cpu.callExternal(fn, args);
	const previousBudget = vmRuntime.cpu.instructionBudgetRemaining;
	vmRuntime.cpu.instructionBudgetRemaining = null;
	vmRuntime.cpu.runUntilDepth(depth);
	vmRuntime.cpu.instructionBudgetRemaining = previousBudget;
	return vmRuntime.cpu.lastReturnValues;
};

const invokeVmHandler = (fn: Closure, thisArg: unknown, args: ReadonlyArray<unknown>): unknown => {
	const callArgs: Value[] = [];
	if (thisArg !== undefined) {
		callArgs.push(toVmValue(thisArg));
	}
	for (let index = 0; index < args.length; index += 1) {
		callArgs.push(toVmValue(args[index]));
	}
	const results = callVmFunction(fn, callArgs);
	if (results.length === 0) {
		return undefined;
	}
	const ctx = buildVmContext();
	return toNativeValue(results[0], ctx, new WeakMap());
};

const handleVmHandlerError = (error: unknown, meta?: { hid: string; moduleId: string; path?: string }): void => {
	const wrappedError = toError(error);
	if (meta && meta.hid && !wrappedError.message.startsWith(`[${meta.hid}]`)) {
		wrappedError.message = `[${meta.hid}] ${wrappedError.message}`;
	}
	throw wrappedError;
};

const createNativeArrayFromTable = (table: Table, context: VmMarshalContext): unknown[] => {
	const entries = table.entriesArray();
	const output: unknown[] = [];
	for (let index = 0; index < entries.length; index += 1) {
		const [key, value] = entries[index];
		if (typeof key === 'number' && Number.isInteger(key) && key >= 1) {
			output[key - 1] = toNativeValue(value, extendMarshalContext(context, String(key)), new WeakMap());
			continue;
		}
		output.push(toNativeValue(value, context, new WeakMap()));
	}
	return output;
};

const requireVmModule = (moduleName: string): Value => {
	const path = vmRuntime.vmModuleAliases.get(moduleName);
	if (!path) {
		throw createVmRuntimeError(`require('${moduleName}') failed: module not found.`);
	}
	const cached = vmRuntime.vmModuleCache.get(path);
	if (cached !== undefined) {
		return cached;
	}
	const protoIndex = vmRuntime.vmModuleProtos.get(path);
	if (protoIndex === undefined) {
		throw createVmRuntimeError(`require('${moduleName}') failed: module not compiled.`);
	}
	vmRuntime.vmModuleCache.set(path, true);
	const results = callVmFunction({ protoIndex, upvalues: [] }, []);
	const value = results.length > 0 ? results[0] : null;
	const cachedValue = value === null ? true : value;
	vmRuntime.vmModuleCache.set(path, cachedValue);
	return cachedValue;
};

export const reloadProgramAndResetWorld = async (options?: { runInit?: boolean }): Promise<void> => {
	const vmToken = vmGate.begin({ blocking: true, tag: 'reload_and_reset' });
	try {
		await $.reset_to_fresh_world();
		$.view.primaryAtlas = 0;
		bootVmProgram({ runInit: options?.runInit });
	} finally {
		vmGate.end(vmToken);
	}
};

export const requestProgramReload = (options?: { runInit?: boolean }): void => {
	vmRuntime.pendingProgramReload = { runInit: options?.runInit };
};

export const reloadProgramPreservingState = (options?: { runInit?: boolean }): void => {
	if (vmRuntime.currentFrameState || vmRuntime.pendingVmCall) {
		throw new Error('[VMRuntime] Program reload requested while a frame is active.');
	}
	const vmToken = vmGate.begin({ blocking: true, tag: 'reload_program' });
	try {
		applyProgramReload(options);
	} finally {
		vmGate.end(vmToken);
	}
};

export const BmsxVMRuntime = {
	get instance() {
		return vmRuntime;
	},
	createInstance: createVmRuntime,
	init: initVmRuntime,
	destroy: destroyVmRuntime,
	boot: bootVmRuntime,
	tickUpdate,
	tickDraw,
	abandonFrameState,
	setVmPrintHandler,
	requestProgramReload,
	reloadProgramPreservingState,
	reloadProgramAndResetWorld,
	loadProgram,
};

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CPU, Table, createNativeObject, valuesEqual, type Program } from '../../src/bmsx/emulator/cpu';
import { Memory } from '../../src/bmsx/emulator/memory';
import {
	ARRAY_STORE_OBJECT_CAPACITY_OFFSET,
	ARRAY_STORE_OBJECT_DATA_OFFSET,
	CLOSURE_OBJECT_PROTO_INDEX_OFFSET,
	CLOSURE_OBJECT_UPVALUE_COUNT_OFFSET,
	CLOSURE_OBJECT_UPVALUE_IDS_OFFSET,
	HASH_STORE_OBJECT_CAPACITY_OFFSET,
	HASH_STORE_OBJECT_DATA_OFFSET,
	HASH_STORE_OBJECT_FREE_OFFSET,
	HASH_NODE_KEY_OFFSET,
	HASH_NODE_SIZE,
	HASH_NODE_VALUE_OFFSET,
	HeapObjectType,
	type ObjectHandleTableState,
	NATIVE_OBJECT_METATABLE_ID_OFFSET,
	ObjectHandleTable,
	STRING_OBJECT_BYTE_LENGTH_OFFSET,
	STRING_OBJECT_CODEPOINT_COUNT_OFFSET,
	STRING_OBJECT_DATA_OFFSET,
	STRING_OBJECT_HASH_HI_OFFSET,
	STRING_OBJECT_HASH_LO_OFFSET,
	TAGGED_VALUE_SLOT_PAYLOAD_HI_OFFSET,
	TAGGED_VALUE_SLOT_PAYLOAD_LO_OFFSET,
	TAGGED_VALUE_SLOT_TAG_OFFSET,
	TaggedValueTag,
	TABLE_OBJECT_ARRAY_LENGTH_OFFSET,
	TABLE_OBJECT_ARRAY_STORE_ID_OFFSET,
	TABLE_OBJECT_HASH_STORE_ID_OFFSET,
	TABLE_OBJECT_METATABLE_ID_OFFSET,
	UPVALUE_OBJECT_CLOSED_VALUE_OFFSET,
	UPVALUE_OBJECT_FRAME_DEPTH_OFFSET,
	UPVALUE_OBJECT_REGISTER_INDEX_OFFSET,
	UPVALUE_OBJECT_STATE_OFFSET,
	UPVALUE_OBJECT_STATE_OPEN,
} from '../../src/bmsx/emulator/object_memory';
import { OBJECT_HANDLE_ENTRY_SIZE, OBJECT_HANDLE_TABLE_BASE } from '../../src/bmsx/emulator/memory_map';
import { CompileTimeStringPool, RuntimeStringPool, stringValueToString, type StringPool } from '../../src/bmsx/emulator/string_pool';

function createRuntimeStringPool(): { memory: Memory; handles: ObjectHandleTable; pool: StringPool } {
	const memory = new Memory({ engineRom: new Uint8Array(0) });
	const handles = new ObjectHandleTable(memory);
	return {
		memory,
		handles,
		pool: new RuntimeStringPool(handles),
	};
}

test('compile-time string pool still canonicalizes identical text', () => {
	const pool = new CompileTimeStringPool();
	const left = pool.intern('vlok');
	const right = pool.intern('vlok');
	assert.equal(left, right);
	assert.equal(left.id, right.id);
});

test('runtime string pool allocates distinct ids for identical text', () => {
	const { pool } = createRuntimeStringPool();
	const left = pool.intern('vlok');
	const right = pool.intern('vlok');
	assert.equal(left.id > 0, true);
	assert.notEqual(left.id, right.id);
	assert.notEqual(left, right);
	assert.equal(left.text, right.text);
});

test('runtime string equality stays content-based', () => {
	const { pool } = createRuntimeStringPool();
	const left = pool.intern('vlok');
	const right = pool.intern('vlok');
	assert.equal(valuesEqual(left, right), true);
});

test('table lookup accepts equal runtime strings with different ids', () => {
	const { memory, pool, handles } = createRuntimeStringPool();
	const left = pool.intern('vlok');
	const right = pool.intern('vlok');
	const table = new Table(0, 2, handles);
	table.set(left, 42);
	assert.equal(table.get(right), 42);
	const tableEntry = handles.readEntry(table.objectId);
	const hashStoreId = memory.readU32(tableEntry.addr + TABLE_OBJECT_HASH_STORE_ID_OFFSET);
	const hashStore = handles.readEntry(hashStoreId);
	let found = false;
	for (let index = 0; index < 2; index += 1) {
		const nodeAddr = hashStore.addr + HASH_STORE_OBJECT_DATA_OFFSET + (index * HASH_NODE_SIZE);
		if (memory.readU32(nodeAddr + HASH_NODE_KEY_OFFSET + TAGGED_VALUE_SLOT_TAG_OFFSET) !== TaggedValueTag.String) {
			continue;
		}
		assert.equal(memory.readU32(nodeAddr + HASH_NODE_KEY_OFFSET + TAGGED_VALUE_SLOT_PAYLOAD_LO_OFFSET), left.id);
		assert.equal(memory.readU32(nodeAddr + HASH_NODE_VALUE_OFFSET + TAGGED_VALUE_SLOT_TAG_OFFSET), TaggedValueTag.Number);
		found = true;
		break;
	}
	assert.equal(found, true);
});

test('runtime strings are stored as heap objects in RAM', () => {
	const { memory, handles, pool } = createRuntimeStringPool();
	const value = pool.intern('vlok');
	const entryAddr = OBJECT_HANDLE_TABLE_BASE + value.id * OBJECT_HANDLE_ENTRY_SIZE;
	assert.equal(memory.readU32(entryAddr + 8), HeapObjectType.String);
	const entry = handles.readEntry(value.id);
	assert.equal(entry.type, HeapObjectType.String);
	assert.equal(entry.reserved, 0);
	assert.equal(memory.readU32(entry.addr), HeapObjectType.String);
	assert.equal(memory.readU32(entry.addr + STRING_OBJECT_HASH_LO_OFFSET), value.hashLo);
	assert.equal(memory.readU32(entry.addr + STRING_OBJECT_HASH_HI_OFFSET), value.hashHi);
	assert.equal(memory.readU32(entry.addr + STRING_OBJECT_BYTE_LENGTH_OFFSET), value.byteLength);
	assert.equal(memory.readU32(entry.addr + STRING_OBJECT_CODEPOINT_COUNT_OFFSET), value.codepointCount);
	const bytes = memory.readBytes(entry.addr + STRING_OBJECT_DATA_OFFSET, value.byteLength);
	assert.equal(new TextDecoder().decode(bytes), value.text);
});

test('runtime string cache can be rebuilt from heap objects', () => {
	const { pool } = createRuntimeStringPool();
	const value = pool.intern('cache-rehydrate');
	pool.clearRuntimeCache();
	const restored = pool.getById(value.id);
	assert.notEqual(restored, value);
	assert.equal(restored.id, value.id);
	assert.equal(restored.text, value.text);
	assert.equal(restored.hashLo, value.hashLo);
	assert.equal(restored.hashHi, value.hashHi);
	assert.equal(restored.codepointCount, value.codepointCount);
});

test('object handle table state can be captured and restored', () => {
	const { handles, pool } = createRuntimeStringPool();
	const key = pool.intern('heap-snapshot');
	const table = new Table(1, 1, handles);
	table.set(key, 33);
	const snapshot: ObjectHandleTableState = handles.captureState();
	handles.resetHeap();
	handles.restoreState(snapshot);
	pool.clearRuntimeCache();
	const internal = table as unknown as {
		arrayStore: { clear(): void };
		hashStore: { clear(): void };
		arrayLength: number;
		metatable: Table | null;
		rehydrateStoreViews(pool: StringPool): void;
	};
	internal.arrayStore.clear();
	internal.hashStore.clear();
	internal.arrayLength = 0;
	internal.metatable = null;
	internal.rehydrateStoreViews(pool);
	const restoredKey = pool.getById(key.id);
	assert.equal(restoredKey.text, 'heap-snapshot');
	assert.equal(table.get(restoredKey), 33);
});

test('CPU runtime const pool does not mutate compile-time const pool strings', () => {
	const memory = new Memory({ engineRom: new Uint8Array(0) });
	const handles = new ObjectHandleTable(memory);
	const runtimePool = new RuntimeStringPool(handles);
	const compilePool = new CompileTimeStringPool();
	const compileString = compilePool.intern('const-key');
	const program: Program = {
		code: new Uint8Array(0),
		constPool: [compileString],
		protos: [],
		stringPool: compilePool,
		constPoolStringPool: compilePool,
	};
	const cpu = new CPU(memory, runtimePool, handles);
	cpu.setProgram(program);
	const runtimeConst = cpu.getConst(0);
	assert.equal(program.constPool[0], compileString);
	assert.equal(program.constPoolStringPool, compilePool);
	assert.notEqual(runtimeConst, compileString);
	assert.equal(stringValueToString(runtimeConst as typeof compileString), 'const-key');
	assert.equal((runtimeConst as typeof compileString).id > 0, true);
});

test('runtime tables are stored as heap objects with synced metadata', () => {
	const { memory, handles } = createRuntimeStringPool();
	const table = new Table(4, 3, handles);
	const metatable = new Table(0, 1, handles);
	table.set(1, 99);
	table.setMetatable(metatable);
	const entryAddr = OBJECT_HANDLE_TABLE_BASE + table.objectId * OBJECT_HANDLE_ENTRY_SIZE;
	assert.equal(memory.readU32(entryAddr + 8), HeapObjectType.Table);
	const entry = handles.readEntry(table.objectId);
	assert.equal(entry.type, HeapObjectType.Table);
	assert.equal(memory.readU32(entry.addr), HeapObjectType.Table);
	assert.equal(memory.readU32(entry.addr + TABLE_OBJECT_METATABLE_ID_OFFSET), metatable.objectId);
	const arrayStoreId = memory.readU32(entry.addr + TABLE_OBJECT_ARRAY_STORE_ID_OFFSET);
	const hashStoreId = memory.readU32(entry.addr + TABLE_OBJECT_HASH_STORE_ID_OFFSET);
	assert.equal(memory.readU32(entry.addr + TABLE_OBJECT_ARRAY_LENGTH_OFFSET), 1);
	const arrayStore = handles.readEntry(arrayStoreId);
	const hashStore = handles.readEntry(hashStoreId);
	assert.equal(arrayStore.type, HeapObjectType.ArrayStore);
	assert.equal(hashStore.type, HeapObjectType.HashStore);
	assert.equal(memory.readU32(arrayStore.addr + ARRAY_STORE_OBJECT_CAPACITY_OFFSET), 4);
	assert.equal(memory.readU32(hashStore.addr + HASH_STORE_OBJECT_CAPACITY_OFFSET), 4);
	assert.equal(memory.readU32(hashStore.addr + HASH_STORE_OBJECT_FREE_OFFSET), 3);
	assert.equal(memory.readU32(arrayStore.addr + ARRAY_STORE_OBJECT_DATA_OFFSET + TAGGED_VALUE_SLOT_TAG_OFFSET), TaggedValueTag.Number);
	assert.equal(memory.readU32(arrayStore.addr + ARRAY_STORE_OBJECT_DATA_OFFSET + TAGGED_VALUE_SLOT_PAYLOAD_LO_OFFSET), 0);
	assert.equal(memory.readU32(hashStore.addr + HASH_STORE_OBJECT_DATA_OFFSET + HASH_NODE_KEY_OFFSET + TAGGED_VALUE_SLOT_TAG_OFFSET), TaggedValueTag.Nil);
	assert.equal(memory.readU32(hashStore.addr + HASH_STORE_OBJECT_DATA_OFFSET + HASH_NODE_VALUE_OFFSET + TAGGED_VALUE_SLOT_TAG_OFFSET), TaggedValueTag.Nil);
});

test('table resize allocates new backing store objects and updates table metadata', () => {
	const { memory, handles } = createRuntimeStringPool();
	const table = new Table(1, 1, handles);
	table.set(1, 10);
	const tableEntry = handles.readEntry(table.objectId);
	const initialArrayStoreId = memory.readU32(tableEntry.addr + TABLE_OBJECT_ARRAY_STORE_ID_OFFSET);
	const initialHashStoreId = memory.readU32(tableEntry.addr + TABLE_OBJECT_HASH_STORE_ID_OFFSET);
	table.set(2, 20);
	table.set(3, 30);
	assert.equal(table.get(1), 10);
	assert.equal(table.get(2), 20);
	assert.equal(table.get(3), 30);
	const resizedArrayStoreId = memory.readU32(tableEntry.addr + TABLE_OBJECT_ARRAY_STORE_ID_OFFSET);
	const resizedHashStoreId = memory.readU32(tableEntry.addr + TABLE_OBJECT_HASH_STORE_ID_OFFSET);
	assert.notEqual(resizedArrayStoreId, initialArrayStoreId);
	assert.notEqual(resizedHashStoreId, initialHashStoreId);
	const resizedArrayStore = handles.readEntry(resizedArrayStoreId);
	const resizedHashStore = handles.readEntry(resizedHashStoreId);
	assert.equal(memory.readU32(resizedArrayStore.addr + ARRAY_STORE_OBJECT_CAPACITY_OFFSET), 4);
	assert.equal(memory.readU32(resizedHashStore.addr + HASH_STORE_OBJECT_CAPACITY_OFFSET), 0);
	assert.equal(memory.readU32(tableEntry.addr + TABLE_OBJECT_ARRAY_LENGTH_OFFSET), 3);
	assert.equal(memory.readU32(resizedArrayStore.addr + ARRAY_STORE_OBJECT_DATA_OFFSET + TAGGED_VALUE_SLOT_TAG_OFFSET), TaggedValueTag.Number);
});

test('table host views can be rehydrated from packed RAM stores', () => {
	const { handles, pool } = createRuntimeStringPool();
	const table = new Table(2, 2, handles);
	const metatable = new Table(0, 1, handles);
	const key = pool.intern('rehydrate-key');
	table.set(1, 77);
	table.set(key, metatable);
	table.setMetatable(metatable);
	const internal = table as unknown as {
		arrayStore: { clear(): void };
		hashStore: { clear(): void };
		arrayLength: number;
		metatable: Table | null;
		rehydrateStoreViews(pool: StringPool): void;
	};
	internal.arrayStore.clear();
	internal.hashStore.clear();
	internal.arrayLength = 0;
	internal.metatable = null;
	pool.clearRuntimeCache();
	internal.rehydrateStoreViews(pool);
	assert.equal(table.length(), 1);
	assert.equal(table.get(1), 77);
	assert.equal(table.get(key), metatable);
	assert.equal(table.getMetatable(), metatable);
});

test('native objects get heap handles and synced metatable state', () => {
	const { memory, handles, pool } = createRuntimeStringPool();
	const cpu = new CPU(memory, pool, handles);
	const metatable = cpu.createTable(0, 1);
	const native = createNativeObject({ value: 1 }, {
		get: () => null,
		set: () => {},
	});
	cpu.setNativeObjectMetatable(native, metatable);
	assert.equal(native.objectId > 0, true);
	const entry = handles.readEntry(native.objectId);
	assert.equal(entry.type, HeapObjectType.NativeObject);
	assert.equal(memory.readU32(entry.addr + NATIVE_OBJECT_METATABLE_ID_OFFSET), metatable.objectId);
});

test('closures and upvalues get heap metadata in TS runtime objects', () => {
	const { memory, handles, pool } = createRuntimeStringPool();
	const cpu = new CPU(memory, pool, handles);
	const program: Program = {
		code: new Uint8Array(0),
		constPool: [],
		protos: [
			{
				entryPC: 0,
				codeLen: 0,
				numParams: 0,
				isVararg: false,
				maxStack: 1,
				upvalueDescs: [],
			},
			{
				entryPC: 0,
				codeLen: 0,
				numParams: 0,
				isVararg: false,
				maxStack: 0,
				upvalueDescs: [
					{ inStack: true, index: 0 },
				],
			},
		],
		stringPool: pool,
		constPoolStringPool: pool,
	};
	cpu.setProgram(program);
	cpu.start(0, []);
	const internal = cpu as unknown as {
		frames: Array<{
			depth: number;
			registers: { set(index: number, value: unknown): void };
		}>;
		createClosure(frame: unknown, protoIndex: number): {
			objectId: number;
			upvalues: Array<{ objectId: number }>;
		};
		closeUpvalues(frame: unknown): void;
	};
	const frame = internal.frames[0];
	const closedValue = pool.intern('upvalue-closed');
	frame.registers.set(0, closedValue);
	const closure = internal.createClosure(frame, 1);
	assert.equal(closure.objectId > 0, true);
	const closureEntry = handles.readEntry(closure.objectId);
	assert.equal(closureEntry.type, HeapObjectType.Closure);
	assert.equal(memory.readU32(closureEntry.addr + CLOSURE_OBJECT_PROTO_INDEX_OFFSET), 1);
	assert.equal(memory.readU32(closureEntry.addr + CLOSURE_OBJECT_UPVALUE_COUNT_OFFSET), 1);
	const upvalue = closure.upvalues[0];
	assert.equal(upvalue.objectId > 0, true);
	assert.equal(memory.readU32(closureEntry.addr + CLOSURE_OBJECT_UPVALUE_IDS_OFFSET), upvalue.objectId);
	const upvalueEntry = handles.readEntry(upvalue.objectId);
	assert.equal(upvalueEntry.type, HeapObjectType.Upvalue);
	assert.equal(memory.readU32(upvalueEntry.addr + UPVALUE_OBJECT_STATE_OFFSET), UPVALUE_OBJECT_STATE_OPEN);
	assert.equal(memory.readU32(upvalueEntry.addr + UPVALUE_OBJECT_FRAME_DEPTH_OFFSET), 0);
	assert.equal(memory.readU32(upvalueEntry.addr + UPVALUE_OBJECT_REGISTER_INDEX_OFFSET), 0);
	internal.closeUpvalues(frame);
	assert.equal(memory.readU32(upvalueEntry.addr + UPVALUE_OBJECT_STATE_OFFSET), 0);
	assert.equal(memory.readU32(upvalueEntry.addr + UPVALUE_OBJECT_FRAME_DEPTH_OFFSET), 0xffffffff);
	assert.equal(memory.readU32(upvalueEntry.addr + UPVALUE_OBJECT_CLOSED_VALUE_OFFSET + TAGGED_VALUE_SLOT_TAG_OFFSET), TaggedValueTag.String);
	assert.equal(memory.readU32(upvalueEntry.addr + UPVALUE_OBJECT_CLOSED_VALUE_OFFSET + TAGGED_VALUE_SLOT_PAYLOAD_LO_OFFSET), closedValue.id);
	assert.equal(memory.readU32(upvalueEntry.addr + UPVALUE_OBJECT_CLOSED_VALUE_OFFSET + TAGGED_VALUE_SLOT_PAYLOAD_HI_OFFSET), 0);
});

test('CPU object memory restore rehydrates runtime object views from RAM', () => {
	const { memory, handles, pool } = createRuntimeStringPool();
	const cpu = new CPU(memory, pool, handles);
	const metatable = cpu.createTable(0, 1);
	const native = createNativeObject({ value: 1 }, {
		get: () => null,
		set: () => {},
	});
	cpu.setNativeObjectMetatable(native, metatable);
	const program: Program = {
		code: new Uint8Array(0),
		constPool: [],
		protos: [
			{
				entryPC: 0,
				codeLen: 0,
				numParams: 0,
				isVararg: false,
				maxStack: 1,
				upvalueDescs: [],
			},
			{
				entryPC: 0,
				codeLen: 0,
				numParams: 0,
				isVararg: false,
				maxStack: 0,
				upvalueDescs: [
					{ inStack: true, index: 0 },
				],
			},
		],
		stringPool: pool,
		constPoolStringPool: pool,
	};
	cpu.setProgram(program);
	cpu.start(0, []);
	const key = pool.intern('restore-key');
	const value = pool.intern('restore-value');
	const table = cpu.createTable(0, 2);
	table.set(key, value);
	table.setMetatable(metatable);
	const internal = cpu as unknown as {
		frames: Array<{
			depth: number;
			registers: { set(index: number, value: unknown): void };
		}>;
		createClosure(frame: unknown, protoIndex: number): {
			protoIndex: number;
			upvalues: Array<{
				open: boolean;
				frameDepth: number;
				index: number;
				value: unknown;
			}>;
		};
		closeUpvalues(frame: unknown): void;
	};
	const frame = internal.frames[0];
	const closedValue = pool.intern('restore-upvalue');
	frame.registers.set(0, closedValue);
	const closure = internal.createClosure(frame, 1);
	internal.closeUpvalues(frame);
	const upvalue = closure.upvalues[0];
	const snapshot = cpu.captureObjectMemoryState();
	table.clear();
	table.setMetatable(null);
	cpu.setNativeObjectMetatable(native, null);
	closure.protoIndex = 0;
	closure.upvalues.length = 0;
	upvalue.open = true;
	upvalue.frameDepth = 99;
	upvalue.index = 7;
	upvalue.value = null;
	cpu.restoreObjectMemoryState(snapshot);
	const restoredKey = pool.getById(key.id);
	const restoredValue = pool.getById(value.id);
	const restoredClosedValue = pool.getById(closedValue.id);
	assert.equal(table.get(restoredKey), restoredValue);
	assert.equal(table.getMetatable(), metatable);
	assert.equal(native.metatable, metatable);
	assert.equal(closure.protoIndex, 1);
	assert.equal(closure.upvalues[0], upvalue);
	assert.equal(upvalue.open, false);
	assert.equal(upvalue.frameDepth, -1);
	assert.equal(upvalue.index, 0);
	assert.equal(upvalue.value, restoredClosedValue);
});

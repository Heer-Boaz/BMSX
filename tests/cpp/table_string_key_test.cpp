#include "machine/cpu/cpu.h"
#include "machine/devices/irq/controller.h"
#include "machine/execution_address_space.h"
#include "machine/memory/memory.h"
#include "spec/bmsx/model.h"

#include <array>
#include <iostream>
#include <limits>
#include <stdexcept>
#include <string>
#include <vector>

namespace {
using namespace bmsx;

void require(bool condition, const char* message) {
	if (!condition) throw std::runtime_error(message);
}

void alignedStringHomesDisplaceOnlyCollisions(CPU& cpu) {
	auto table = cpu.createTable(0, 8);
	std::array<std::array<StringId, 2>, 8> keys{};
	for (int i = 10; i < 90; ++i) {
		const auto key = cpu.stringPool().intern("table-home-key-" + std::to_string(i));
		const auto home = (key >> BLUA32_STRING_RECORD_ALIGNMENT_SHIFT) & 7u;
		require(table.beginStringProbe(key).node == static_cast<int>(home),
			"an aligned String record supplies its identity bits, not zero byte-offset bits");
		if (!keys[home][0]) keys[home][0] = key;
		else if (!keys[home][1]) keys[home][1] = key;
	}
	for (const auto& group : keys) require(group[0] && group[1], "the interned records exercise all eight homes");
	const auto resident = keys[0][0], collided = keys[0][1];
	require(table.setStringKey(resident, valueInteger(11)) == 0, "the original home is used");
	const int slot = table.setStringKey(collided, valueInteger(22));
	require(slot > 0 && slot < 8, "a genuine same-home collision uses a free node");
	const auto incoming = keys[slot][0];
	require(table.setStringKey(incoming, valueInteger(33)) == slot && table.hashSlots() == 8,
		"an incoming home displaces the chain member without growing the body");
	int prediction = slot;
	require(table.readOwnStringField(collided, prediction) == valueInteger(22) && prediction != slot,
		"a displaced own field repairs its site from the live collision chain");
	require(table.tryAssignCachedStringField(incoming, valueBool(false), prediction, 0) == slot
		&& table.getStringKey(collided) == valueInteger(22),
		"a displaced write hint cannot overwrite a different live key");
	require(table.readOwnStringField(incoming, prediction) == valueBool(false) && prediction == slot,
		"a false field repairs the prediction too");
	const auto absent = keys[1][1];
	require(table.readOwnStringField(absent, prediction) == valueNil() && prediction == slot,
		"plain absence resolves to nil without poisoning the prediction");
	table.setMetatableAddress(cpu.createTable().address());
	require(!table.readOwnStringField(absent, prediction) && prediction == slot,
		"absence with a metatable leaves the lookup to __index resolution");
	require(table.readOwnStringField(collided, prediction) == valueInteger(22) && prediction != slot,
		"a cold own field on a metatable-backed receiver resolves without traversing __index");
	auto probe = table.beginStringProbe(collided);
	require(table.advanceStringProbe(collided, probe, 8) == 2 && probe.value == valueInteger(22)
		&& table.getStringKey(resident) == valueInteger(11) && table.getStringKey(incoming) == valueBool(false),
		"displacement preserves the original chain and each full String identity");
	table.setStringKey(collided, valueNil());
	StringId missing;
	for (int i = 0;; ++i) {
		missing = cpu.stringPool().intern("missing-table-home-" + std::to_string(i));
		if (table.beginStringProbe(missing).node == 0) break;
	}
	for (const auto key : {collided, missing}) {
		auto cursor = table.beginStringProbe(key);
		require(table.advanceStringProbe(key, cursor, 0) == 0 && cursor.node == 0 && cursor.remaining == 8,
			"a zero allowance leaves the home for the next grant");
		require(table.advanceStringProbe(key, cursor, 1) == 1 && cursor.node == prediction && cursor.remaining == 7,
			"after rejecting home the next grant starts at the displaced node");
		require(table.advanceStringProbe(key, cursor, 1) == 1 && cursor.node < 0 && cursor.remaining == 6
			&& isNil(cursor.value) && cursor.slot == (key == collided ? prediction : -1),
			"the sliced result distinguishes a retained nil key from an exhausted search");
		int hint = -1; u32 cost = 0;
		require(isNil(table.getStringKeyCached(key, hint, &cost)) && hint == -1 && cost == (key == collided ? 0u : 1u),
			"the unsliced read prices that same nil match differently from absence");
	}
}

void collisionAndMutationParity(CPU& cpu) {
	std::array<StringId, 16> keys{};
	size_t count = 0;
	for (size_t n = 0; count < keys.size(); ++n) {
		const auto key = cpu.stringPool().intern("collision_" + std::to_string(n));
		if ((hashCanonicalTableKey(valueString(key)) & 31u) == 0u) keys[count++] = key;
	}
	auto generic = cpu.createTable(0, 4);
	auto strings = cpu.createTable(0, 4);
	auto object = cpu.createTable();

	const std::array<Value, 8> values {
		valueBool(false), valueFloatBits(0x80000000u), valueFloat(5.25f),
		valueFloatBits(0xffc01234u),
		valueFloatBits(0x7f800000u),
		valueTable(object.address()), valueString(keys[0]), valueNil()
	};
	int prediction = 0;
	auto compare = [&]() {
		const auto bytes = strings.trackedHeapBytes();
		for (const auto key : keys) {
			const Value expected = generic.get(valueString(key));
			require(strings.getStringKey(key) == expected, "known string search matches general value search");
			require(strings.getStringKeyCached(key, prediction) == expected, "stale slot predictions cannot change lookup");
		}
		require(strings.trackedHeapBytes() == bytes, "lookups allocate no guest storage");
		// Physical iteration order is serialized state, not an incidental layout.
		require(strings.storedSlotCount() == generic.storedSlotCount(), "lookup specialization preserves table storage");
		for (size_t slot = 0; slot < generic.storedSlotCount(); ++slot) {
			Value ak, av, bk, bv;
			const bool a = generic.loadStoredEntry(slot, ak, av);
			const bool b = strings.loadStoredEntry(slot, bk, bv);
			require(a == b && (!a || (ak == bk && av == bv)), "mutations preserve raw values and physical iteration order");
		}
	};
	compare();
	for (const auto key : {valueInteger(0), valueBool(false), valueTable(object.address())}) {
		generic.set(key, valueInteger(19));
		strings.set(key, valueInteger(19));
	}
	for (size_t n = 0; n < 256; ++n) {
		const auto key = keys[(n * 7u) & 15u];
		const Value value = values[(n >> 4u) & 7u];
		generic.set(valueString(key), value);
		if ((n & 1u) == 0u || !strings.storePredictedStringKey(key, value, prediction))
			prediction = strings.setStringKey(key, value);
		if ((n & 15u) == 0u) {
			generic.setInteger(static_cast<int>(n / 16u) + 1, valueInteger(n));
			strings.setInteger(static_cast<int>(n / 16u) + 1, valueInteger(n));
		}
		compare();
	}
	// A dead collectable key shares the string chain's zero hash bucket.
	generic.set(valueTable(object.address()), valueNil());
	strings.set(valueTable(object.address()), valueNil());
	compare();
	generic.clear();
	strings.clear();
	compare();

	// All three names have the same home. The deleted head is reusable,
	// but the live tail must still be found before inserting into the head.
	auto chain = cpu.createTable(0, 2);
	const int head = chain.setStringKey(keys[0], valueInteger(11));
	const int tail = chain.setStringKey(keys[1], valueInteger(22));
	chain.setStringKey(keys[0], valueNil());
	require(head != tail && chain.setStringKey(keys[1], valueInteger(33)) == tail,
		"a tombstoned home must not hide a live colliding key");
	require(chain.setStringKey(keys[2], valueInteger(44)) == head && chain.hashSlots() == 2u
		&& chain.getStringKey(keys[1]) == valueInteger(33) && isNil(chain.getStringKey(keys[0])),
		"a real miss can reuse the home without breaking its live link");

	const auto newIndex = cpu.stringPool().intern("__newindex");
	auto source = cpu.createTable(0, 2), holder = cpu.createTable(1, 2);
	auto sourceMeta = cpu.createTable(0, 1), holderMeta = cpu.createTable(0, 2);
	const int sourceSlot = source.setStringKey(keys[0], valueInteger(11));
	source.setStringKey(keys[0], valueNil());
	holder.setInteger(1, valueInteger(53));
	holder.setStringKey(keys[1], valueInteger(22));
	sourceMeta.setStringKey(newIndex, valueTable(holder.address()));
	holderMeta.setStringKey(keys[3], valueBool(true));
	source.setMetatableAddress(sourceMeta.address());
	holder.setMetatableAddress(holderMeta.address());

	TableLookupResult assignment;
	source.resolveStringAssignment(keys[0], assignment);
	require(assignment.status == TableLookupStatus::Store && assignment.receiver == holder.address()
		&& assignment.extraVisits == 1 && assignment.slot == TABLE_HASH_UNPROBED,
		"a terminal with no method leaves the sole probe to the mutator");
	const int holderSlot = holder.setStringKey(keys[0], valueBool(false), assignment.slot);
	require(holderSlot >= 0 && holderSlot != sourceSlot && holder.hashSlots() == 2
		&& holder.getStringKey(keys[1]) == valueInteger(22) && isNil(source.getStringKey(keys[0])),
		"the absent proof inserts at the actual terminal collision slot");

	holderMeta.setStringKey(newIndex, valueTable(source.address()));
	source.resolveStringAssignment(keys[0], assignment);
	require(assignment.status == TableLookupStatus::Store && assignment.receiver == holder.address()
		&& assignment.extraVisits == 1 && assignment.slot == holderSlot,
		"the live false terminal slot wins before its own forwarding method");
	require(holder.storePredictedStringKey(keys[0], valueFloatBits(0x80000000u), assignment.slot)
		&& holder.getStringKey(keys[0]) == valueFloatBits(0x80000000u),
		"a warmed owned slot accepts an exact tagged overwrite");
	require(holder.tryAssignCachedStringField(keys[0], valueNil(), assignment.slot, 0) == -1
		&& holder.tryAssignCachedStringField(keys[0], valueInteger(47), holderSlot, 0) == TableRecord::HASH_STORE_DECLINED
		&& isNil(holder.getStringKey(keys[0])), "deletion makes a matching hint defer to the live __newindex");
	holderMeta.setStringKey(newIndex, valueNil());
	source.resolveStringAssignment(keys[0], assignment);
	require(assignment.status == TableLookupStatus::Store && assignment.receiver == holder.address()
		&& assignment.extraVisits == 1 && assignment.slot == TABLE_HASH_UNPROBED
		&& !holder.storePredictedStringKey(keys[0], valueInteger(47), holderSlot) && isNil(holder.getStringKey(keys[0])),
		"the removed method leaves reactivation to the mutator without a premature probe");
	require(holder.setStringKey(keys[0], valueInteger(47), assignment.slot) == holderSlot
		&& holder.getStringKey(keys[0]) == valueInteger(47) && holder.getInteger(1) == valueInteger(53),
		"a terminal tombstone can be reactivated without displacing a colliding key or array value");

	holder.setMetatableAddress(0);
	source.resolveStringAssignment(keys[0], assignment);
	require(assignment.status == TableLookupStatus::Store && assignment.receiver == holder.address()
		&& assignment.extraVisits == 1 && assignment.slot == TABLE_HASH_UNPROBED,
		"a metatable-free terminal does not claim to have probed its hash");
}

void preparedLayoutMatchesAllMasks(CPU& cpu, Memory& memory) {
	// These opaque ROM addresses hash to five home-0 keys followed by
	// a home-4 key. In the full record, the latter displaces a chain node.
	constexpr auto step = BLUA32_STRING_RECORD_ALIGNMENT;
	constexpr std::array<StringId, 6> keys{CART_ROM_BASE, CART_ROM_BASE + 8 * step, CART_ROM_BASE + 16 * step,
		CART_ROM_BASE + 24 * step, CART_ROM_BASE + 32 * step, CART_ROM_BASE + 4 * step};
	for (u32 mask = 0; mask < (1u << keys.size()); ++mask) {
		auto scalar = cpu.createTable(0, keys.size());
		auto prepared = cpu.createTable(0, keys.size());
		std::array<Value, keys.size()> values{};
		for (u32 i = 0; i < keys.size(); ++i) {
			values[i] = (mask & (1u << i)) != 0u ? valueInteger(i) : valueNil();
			scalar.setStringKey(keys[i], values[i]);
		}
		const auto layout = TableRecord::planStringRecord(keys, mask);
		if (mask) prepared.fillStringRecord(layout, keys, values);
		require(scalar.hashFree() == prepared.hashFree(), "the prepared placement preserves the free cursor");
		for (u32 at = 0; at < TableRecord::storageBytes(0, 8); ++at)
			require(memory.readRamRecordByte(scalar.hashAddress() + at)
				== memory.readRamRecordByte(prepared.hashAddress() + at),
				"prepared and scalar constructor layouts agree under collisions and absent values");
	}
}

void newIndexAbsenceFollowsTheOwnMapping(CPU& cpu) {
	const auto newIndex = cpu.stringPool().intern("__newindex");
	const auto field = cpu.stringPool().intern("unwritten");
	auto target = cpu.createTable();
	auto meta = cpu.createTable(0, 1);
	target.setMetatableAddress(meta.address());
	TableLookupResult assignment;
	target.resolveStringAssignment(field, assignment);
	require(assignment.status == TableLookupStatus::Store && assignment.receiver == target.address(),
		"an empty metatable leaves the write on the receiver");
	const std::array keys{newIndex};
	const std::array values{valueBool(false)};
	meta.fillStringRecord(TableRecord::planStringRecord(keys, 1), keys, values);
	target.resolveStringAssignment(field, assignment);
	require(assignment.status == TableLookupStatus::Forward && assignment.value == valueBool(false),
		"bulk construction must not hide a non-nil false method");
	auto copy = meta.copyOwn();
	target.setMetatableAddress(copy.address());
	meta.clear();
	target.resolveStringAssignment(field, assignment);
	require(assignment.status == TableLookupStatus::Forward && assignment.value == valueBool(false),
		"the copy owns its copied method after the original is cleared");
	target.setMetatableAddress(meta.address());
	target.resolveStringAssignment(field, assignment);
	require(assignment.status == TableLookupStatus::Store && assignment.receiver == target.address(),
		"clearing the metatable removes the method");
	target.setMetatableAddress(copy.address());
	copy.setStringKey(newIndex, valueNil());
	target.resolveIntegerAssignment(1, assignment);
	require(assignment.status == TableLookupStatus::Store && assignment.receiver == target.address(),
		"raw nil deletion removes the method for integer assignments as well");

	auto weakMode = cpu.createTable(0, 1);
	weakMode.setStringKey(cpu.stringPool().intern("__mode"), valueString(cpu.stringPool().intern("v")));
	copy.setMetatableAddress(weakMode.address());
	auto forwarding = cpu.createTable();
	copy.set(valueString(newIndex), valueTable(forwarding.address()));
	target.resolveAssignment(valueString(field), assignment);
	require(assignment.status == TableLookupStatus::Store && assignment.receiver == forwarding.address()
		&& assignment.extraVisits == 1, "reactivation forwards through the inserted weak value");
	cpu.gcHeap().collect(valueTable(target.address()));
	target.resolveAssignment(valueString(field), assignment);
	require(isNil(copy.getStringKey(newIndex)) && assignment.status == TableLookupStatus::Store
		&& assignment.receiver == target.address() && assignment.extraVisits == 0,
		"collector deletion clears the forwarding method without changing the receiver's metatable");
}

void rebuildFullCollisionChain(CPU& cpu) {
	for (const int capacity : {128, 256}) {
		auto table = cpu.createTable(4, capacity);
		table.setInteger(1, valueBool(false));
		std::vector<int> keys;
		for (int i = -1; keys.size() < static_cast<size_t>(capacity + 2); --i) {
			if ((hashCanonicalTableKey(valueInteger(i)) & (capacity * 2 - 1)) == 0) keys.push_back(i);
		}
		for (int i = 0; i < capacity; ++i) table.setInteger(keys[i], valueInteger(i));
		table.setInteger(keys[1], valueNil());
		table.setInteger(keys[capacity], valueInteger(capacity));
		require(table.hashSlots() == static_cast<u32>(capacity), "reclaim the dead collision without growing");
		table.setInteger(keys.back(), valueInteger(capacity + 1));
		require(table.hashSlots() == static_cast<u32>(2 * capacity), "grow a full chain");
		for (int i = 0; i <= capacity + 1; ++i)
			require(table.getInteger(keys[i]) == (i == 1 ? valueNil() : valueInteger(i)), "retain every live collision");
		require(table.getInteger(1) == valueBool(false), "preserve the independent array");
	}
}

void rebuildRoutesStoredIntegerByItsCurrentWord(CPU& cpu, Memory& memory) {
	auto table = cpu.createTable(4, 128);
	for (int k = -1; k >= -128; --k) table.setInteger(k, valueInteger(-k));
	const auto words = table.hashAddress();
	const Value prior = valueInteger(static_cast<i32>(memory.readRamRecordWord(words + 4 * 128)));
	memory.writeRamRecordWord(words, 4);
	table.setInteger(-129, valueBool(false));
	require(table.getInteger(4) == prior, "the stored key word selects the reserved array slot during rebuild");
}

void fullHashGrowsAndRetainsMappings(CPU& cpu) {
	auto table = cpu.createTable(0, 1);
	const auto present = cpu.stringPool().intern("full"), missing = cpu.stringPool().intern("new");
	table.setStringKey(present, valueInteger(73));
	require(table.hashFree() == 0,
		"a direct main-bucket insertion has not searched the only free-slot candidate");
	auto reuse = cpu.createTable(0, 1);
	reuse.setStringKey(present, valueInteger(73));
	reuse.setStringKey(present, valueNil());
	require(reuse.setStringKey(missing, valueInteger(19)) == 0 && reuse.hashSlots() == 1u,
		"deleting the only key permits reuse without growing storage");
	int prediction = table.setStringKey(missing, valueInteger(19));
	require(table.hashSlots() == 2u && table.getStringKey(present) == valueInteger(73)
		&& table.getStringKey(missing) == valueInteger(19), "a full hash grows once and preserves both raw mappings");
	require(table.storePredictedStringKey(missing, valueInteger(97), prediction), "the full hash has the live predicted field");
	require(table.hashSlots() == 2u && table.getStringKey(missing) == valueInteger(97),
		"an existing mapping is replaced without growing the full hash again");
}

void inheritedAndFullWordKeys(CPU& cpu, Memory& memory) {
	const auto key = cpu.stringPool().intern("field");
	const auto indexKey = cpu.stringPool().intern("__index");
	auto parent = cpu.createTable(0, 2);
	parent.setStringKey(key, valueBool(false));
	auto metatable = cpu.createTable(0, 1);
	metatable.setStringKey(indexKey, valueTable(parent.address()));
	auto child = cpu.createTable();
	child.setMetatableAddress(metatable.address());
	TableLookupResult result;
	child.resolveStringIndex(key, result);
	require(result.status == TableLookupStatus::Resolved && result.value == valueBool(false), "inherited false is present");
	child.resolveStringIndexCached(key, -1, result);
	require(result.slot >= 0 && result.value == valueBool(false) && result.extraVisits == 1, "inherited cached search returns the same value and semantic work");
	int receiverHint = -1;
	require(!child.readOwnStringField(key, receiverHint), "an inherited field is not an own slot");
	child.resolveMissingStringIndex(key, result);
	require(result.value == valueBool(false) && result.extraVisits == 1 && receiverHint == -1,
		"continuing after an own miss preserves the inherited false value and charges one visit");
	parent.setStringKey(key, valueNil());
	child.resolveStringIndexCached(key, result.slot, result);
	require(result.slot == -1 && isNil(result.value), "deletion invalidates inherited predictions");
	parent.setStringKey(key, valueFloatBits(0x80000000u));
	child.resolveStringIndex(key, result);
	require(result.status == TableLookupStatus::Resolved && result.value == valueFloatBits(0x80000000u), "reinsertion preserves negative zero");

	child.setStringKey(key, valueBool(false));
	child.resolveStringIndexCached(key, result.slot, result);
	require(result.value == valueBool(false) && result.extraVisits == 0,
		"an own field stops traversal even when its value is false");

	auto raw = cpu.createTable(0, 8);
	const Value integerKey = valueInteger(BLUA32_FLOAT_NAN);
	raw.set(integerKey, valueInteger(14));
	require(isNil(raw.get(valueFloatBits(0x7fa12345u))) && isNil(raw.get(valueNil())) && raw.get(integerKey) == valueInteger(14),
		"raw nil and NaN reads miss without confusing a legal Integer of the same payload");
	for (const bool nan : {false, true}) {
		bool rejected = false;
		try { raw.set(nan ? valueFloatBits(0xffc01234u) : valueNil(), valueNil()); }
		catch (const LuaExecutionError& error) { rejected = error.reason == (nan ? LUA_FAULT_REASON_INDEX_NAN : LUA_FAULT_REASON_INDEX_NIL); }
		require(rejected, "raw mutation rejects invalid insertion keys even for a nil source");
	}
	const Value highBitKey = valueFromTag(ValueTag::String, key ^ 0x80000000u);
	raw.set(highBitKey, valueInteger(21));
	require(isNil(raw.getStringKey(key)), "a known StringId does not match a different high payload bit during chain search");
	raw.setStringKey(key, valueInteger(42));
	require(raw.get(highBitKey) == valueInteger(21) && raw.getStringKey(key) == valueInteger(42), "known string updates preserve distinct raw payloads");
	memory.writeRamRecordWord(raw.address() + static_cast<u32>(TableHeader::HashStorage), raw.hashAddress() + MAIN_RAM_SIZE);
	int predicted = -1;
	require(raw.get(highBitKey) == valueInteger(21) && raw.getStringKeyCached(key, predicted) == valueInteger(42)
		&& predicted >= 0 && raw.getStringKeyCached(key, predicted) == valueInteger(42),
		"generic, cold string and predicted string probes consume a mirrored hash body");
}
}

int main() {
	try {
		Memory memory(MemoryInit{}, PSX_MACHINE_SPEC.ramBytes);
		IrqController irq(memory);
		ExecutionAddressSpace addresses(memory);
		CPU cpu(memory, irq, addresses);
		newIndexAbsenceFollowsTheOwnMapping(cpu);
		alignedStringHomesDisplaceOnlyCollisions(cpu);
		collisionAndMutationParity(cpu);
		preparedLayoutMatchesAllMasks(cpu, memory);
		inheritedAndFullWordKeys(cpu, memory);
		fullHashGrowsAndRetainsMappings(cpu);
		rebuildFullCollisionChain(cpu);
		rebuildRoutesStoredIntegerByItsCurrentWord(cpu, memory);
		std::cout << "String-key table tests passed\n";
		return 0;
	} catch (const std::exception& error) {
		std::cerr << error.what() << '\n';
		return 1;
	}
}

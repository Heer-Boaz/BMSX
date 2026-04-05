#include "cpu.h"
#include "lua_heap_usage.h"
#include "memory.h"
#include "number_format.h"
#include "vdp_packet_schema.h"
#include <algorithm>
#include <array>
#include <cctype>
#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <limits>
#include <stdexcept>

namespace bmsx {

namespace {
int g_vdpPacketWriteLogRemaining = 0;

static inline uint32_t readInstructionWord(const std::vector<uint8_t>& code, int pc) {
	size_t offset = static_cast<size_t>(pc) * INSTRUCTION_BYTES;
	return (static_cast<uint32_t>(code[offset]) << 24)
		| (static_cast<uint32_t>(code[offset + 1]) << 16)
		| (static_cast<uint32_t>(code[offset + 2]) << 8)
		| static_cast<uint32_t>(code[offset + 3]);
}

static inline int signExtend(uint32_t value, int bits) {
	int shift = 32 - bits;
	return static_cast<int>(value << shift) >> shift;
}

static inline uint32_t toU32(double value) {
	const double truncated = std::trunc(value);
	const double mod = std::fmod(truncated, 4294967296.0);
	const double normalized = mod < 0.0 ? (mod + 4294967296.0) : mod;
	return static_cast<uint32_t>(normalized);
}

static inline int32_t toI32(double value) {
	return static_cast<int32_t>(toU32(value));
}

static inline size_t nextPowerOfTwo(size_t value) {
	if (value == 0) {
		return 0;
	}
	size_t power = 1;
	while (power < value) {
		power <<= 1;
	}
	return power;
}

static inline size_t ceilLog2(size_t value) {
	size_t log = 0;
	size_t power = 1;
	while (power < value) {
		power <<= 1;
		++log;
	}
	return log;
}

static inline int ceilDiv4(int value) {
	return (value + 3) >> 2;
}

static inline bool isVdpPacketSequenceWrite(uint32_t baseAddr, int wordCount) {
	const uint32_t byteLength = static_cast<uint32_t>(wordCount) * IO_WORD_SIZE;
	return baseAddr >= VDP_STREAM_BUFFER_BASE && (baseAddr + byteLength) <= (VDP_STREAM_BUFFER_BASE + VDP_STREAM_BUFFER_SIZE);
}

static inline uint32_t encodeVdpPacketU32Word(Value value, const char* label) {
	if (valueIsNumber(value)) {
		return static_cast<uint32_t>(asNumber(value));
	}
	if (valueIsString(value)) {
		return asStringId(value);
	}
	if (value == valueBool(true)) {
		return 1u;
	}
	if (value == valueBool(false) || value == valueNil()) {
		return 0u;
	}
	throw std::runtime_error(std::string("[VDP] ") + label + " expects a numeric or string word.");
}

static inline uint32_t encodeVdpPacketF32Word(Value value, const char* label) {
	if (!valueIsNumber(value)) {
		throw std::runtime_error(std::string("[VDP] ") + label + " expects a numeric word.");
	}
	const float f32 = static_cast<float>(asNumber(value));
	uint32_t bits = 0;
	std::memcpy(&bits, &f32, sizeof(bits));
	return bits;
}

static inline uint32_t encodeVdpPacketArgWord(uint32_t cmd, int index, Value value) {
	return getVdpPacketArgKind(cmd, static_cast<uint32_t>(index)) == VdpPacketWordKind::F32
		? encodeVdpPacketF32Word(value, "packet arg")
		: encodeVdpPacketU32Word(value, "packet arg");
}

static inline bool tryGetVdpPacketPrefixWordCounts(const std::vector<Value>& registers, int valueBase, uint32_t& outCmd, uint32_t& outArgWords, uint32_t& outPayloadWords) {
	outCmd = encodeVdpPacketU32Word(registers[static_cast<size_t>(valueBase)], "packet cmd");
	const VdpPacketSchema* schema = findVdpPacketSchema(outCmd);
	if (!schema) {
		return false;
	}
	outArgWords = encodeVdpPacketU32Word(registers[static_cast<size_t>(valueBase + 1)], "packet arg_words");
	if (outArgWords != schema->argWords) {
		return false;
	}
	outPayloadWords = encodeVdpPacketU32Word(registers[static_cast<size_t>(valueBase + 2)], "packet payload_words");
	return true;
}

static constexpr NativeFnCost kNativeCostTier0 { 0, 0, 0 };
static constexpr NativeFnCost kNativeCostTier1 { 1, 0, 0 };
static constexpr NativeFnCost kNativeCostTier2 { 2, 0, 0 };
static constexpr NativeFnCost kNativeCostTier4 { 4, 0, 0 };
static constexpr NativeFnCost kDefaultNativeCost = kNativeCostTier1;

static inline NativeFnCost resolveNativeFunctionCost(std::string_view name) {
	if (name == "sys_cpu_cycles_used"
		|| name == "sys_cpu_cycles_granted"
		|| name == "sys_cpu_active_cycles_used"
		|| name == "sys_cpu_active_cycles_granted"
		|| name == "sys_ram_used"
		|| name == "sys_vram_used"
		|| name == "sys_vdp_work_units_per_sec"
		|| name == "sys_vdp_work_units_last"
		|| name == "sys_vdp_frame_held"
		|| name == "clock_now"
		|| name == "display_width"
		|| name == "display_height"
		|| name == "get_cpu_freq_hz"
		|| name == "get_default_font"
		|| name == "get_lua_entry_path"
		|| name == "platform.clock.now"
		|| name == "platform.clock.perf_now"
		|| name == "game.get_frame_delta_ms") {
		return kNativeCostTier0;
	}
	if (name == "math.abs"
		|| name == "math.acos"
		|| name == "math.asin"
		|| name == "math.atan"
		|| name == "math.ceil"
		|| name == "math.cos"
		|| name == "math.deg"
		|| name == "math.exp"
		|| name == "math.floor"
		|| name == "math.fmod"
		|| name == "math.log"
		|| name == "math.max"
		|| name == "math.min"
		|| name == "math.rad"
		|| name == "math.sin"
		|| name == "math.sign"
		|| name == "math.sqrt"
		|| name == "math.tan"
		|| name == "math.tointeger"
		|| name == "math.type"
		|| name == "math.ult"
		|| name == "math.random"
		|| name == "easing.linear"
		|| name == "easing.ease_in_quad"
		|| name == "easing.ease_out_quad"
		|| name == "easing.ease_in_out_quad"
		|| name == "easing.ease_out_back"
		|| name == "easing.smoothstep"
		|| name == "easing.pingpong01"
		|| name == "easing.arc01"
		|| name == "type"
		|| name == "tonumber"
		|| name == "tostring"
		|| name == "rawequal"
		|| name == "rawget"
		|| name == "rawset"
		|| name == "select"
		|| name == "next"
		|| name == "sys_palette_color"
		|| name == "resolve_cart_rom_asset_range"
		|| name == "resolve_sys_rom_asset_range"
		|| name == "resolve_rom_asset_range"
		|| name == "u32_to_f32"
		|| name == "u64_to_f64"
		|| name == "os.clock"
		|| name == "os.difftime"
		|| name == "mousebtn"
		|| name == "mousebtnp"
		|| name == "mousebtnr"
		|| name == "action_triggered"
		|| name == "stat"
		|| name == "dget"
		|| name == "get_player_input"
		|| name == "sfx"
		|| name == "stop_sfx"
		|| name == "music"
		|| name == "stop_music"
		|| name == "put_mesh"
		|| name == "put_particle"
		|| name == "skybox"
		|| name == "put_ambient_light"
		|| name == "put_directional_light"
		|| name == "put_point_light"
		|| name == "reboot"
		|| name == "game.get_action_state"
		|| name == "game.emit") {
		return kNativeCostTier1;
	}
	if (name == "pairs"
		|| name == "ipairs"
		|| name == "pairs.iterator"
		|| name == "ipairs.iterator"
		|| name == "string.gmatch.iterator"
		|| name == "getmetatable"
		|| name == "setmetatable"
		|| name == "table.insert"
		|| name == "table.remove"
		|| name == "table.pack"
		|| name == "table.unpack"
		|| name == "string.len"
		|| name == "string.byte"
		|| name == "string.char"
		|| name == "string.sub"
		|| name == "string.upper"
		|| name == "string.lower"
		|| name == "string.rep"
		|| name == "array"
		|| name == "assert"
		|| name == "error"
		|| name == "math.modf"
		|| name == "math.randomseed"
		|| name == "consume_action"
		|| name == "dset"
		|| name == "wait_vblank"
		|| name == "set_cpu_freq_hz"
		|| name == "pointer_screen_position"
		|| name == "pointer_delta"
		|| name == "pointer_viewport_position"
		|| name == "mousepos"
		|| name == "mousewheel"
		|| name == "set_master_volume"
		|| name == "pause_audio"
		|| name == "resume_audio"
		|| name == "os.time"
		|| name == "game.consume_action"
		|| name == "player_input.getModifiersState"
		|| name == "player_input.getButtonState"
		|| name == "player_input.getButtonRepeatState"
		|| name == "player_input.consumeButton") {
		return kNativeCostTier2;
	}
	if (name == "string.find"
		|| name == "string.match"
		|| name == "string.gsub"
		|| name == "string.gmatch"
		|| name == "string.format"
		|| name == "string.pack"
		|| name == "string.packsize"
		|| name == "string.unpack"
		|| name == "table.concat"
		|| name == "table.sort"
		|| name == "wrap_text_lines"
		|| name == "pcall"
		|| name == "xpcall"
		|| name == "loadstring"
		|| name == "load"
		|| name == "require"
		|| name == "print"
		|| name == "set_camera"
		|| name == "set_sprite_parallax_rig"
		|| name == "cartdata"
		|| name == "create_font"
		|| name == "taskgate"
		|| name == "os.date"
		|| name == "list_lua_resources"
		|| name == "get_lua_resource_source"
		|| name == "list_lua_builtins") {
		return kNativeCostTier4;
	}
	return kDefaultNativeCost;
}

static std::string formatNonFunctionCallError(Value callee, const StringPool& stringPool,
													const std::optional<SourceRange>& range) {
	std::string message = "Attempted to call a non-function value.";
	message += " callee=" + std::string(valueTypeName(callee)) + "(" + valueToString(callee, stringPool) + ")";
	if (range.has_value()) {
		message += " at " + range->path + ":" + std::to_string(range->startLine) + ":" + std::to_string(range->startColumn);
	}
	return message;
}

static constexpr void setCycle(std::array<uint8_t, 64>& table, OpCode op, uint8_t cost) {
	table[static_cast<size_t>(op)] = cost;
}

static constexpr std::array<uint8_t, 64> makeBaseCycles() {
	std::array<uint8_t, 64> table{};
	table.fill(1);
	setCycle(table, OpCode::WIDE, 0);

	setCycle(table, OpCode::MOV, 1);
	setCycle(table, OpCode::LOADK, 1);
	setCycle(table, OpCode::LOADBOOL, 1);
	setCycle(table, OpCode::LOADNIL, 1);
	setCycle(table, OpCode::KNIL, 1);
	setCycle(table, OpCode::KFALSE, 1);
	setCycle(table, OpCode::KTRUE, 1);
	setCycle(table, OpCode::K0, 1);
	setCycle(table, OpCode::K1, 1);
	setCycle(table, OpCode::KM1, 1);
	setCycle(table, OpCode::KSMI, 1);

	setCycle(table, OpCode::GETG, 1);
	setCycle(table, OpCode::SETG, 2);
	setCycle(table, OpCode::GETT, 1);
	setCycle(table, OpCode::SETT, 2);
	setCycle(table, OpCode::NEWT, 1);

	setCycle(table, OpCode::CONCATN, 2);

	setCycle(table, OpCode::TESTSET, 2);

	setCycle(table, OpCode::CLOSURE, 1);
	setCycle(table, OpCode::GETUP, 1);
	setCycle(table, OpCode::SETUP, 2);
	setCycle(table, OpCode::VARARG, 2);

	setCycle(table, OpCode::CALL, 2);
	setCycle(table, OpCode::RET, 2);

	setCycle(table, OpCode::LOAD_MEM, 1);
	setCycle(table, OpCode::STORE_MEM, 2);
	setCycle(table, OpCode::STORE_MEM_WORDS, 2);
	setCycle(table, OpCode::GETSYS, 1);
	setCycle(table, OpCode::SETSYS, 2);
	setCycle(table, OpCode::GETGL, 1);
	setCycle(table, OpCode::SETGL, 2);
	setCycle(table, OpCode::GETI, 1);
	setCycle(table, OpCode::SETI, 2);
	setCycle(table, OpCode::GETFIELD, 1);
	setCycle(table, OpCode::SETFIELD, 2);
	setCycle(table, OpCode::SELF, 1);

	return table;
}

static constexpr std::array<uint8_t, 64> kBaseCycles = makeBaseCycles();

static inline size_t trackedClosureBytes(const Closure& closure) {
	return 16 + (closure.upvalues.size() * sizeof(Upvalue*));
}

} // namespace

std::string valueToString(const Value& v, const StringPool& stringPool) {
	if (isNil(v)) return "nil";
	if (valueIsTagged(v)) {
		switch (valueTag(v)) {
			case ValueTag::False: return "false";
			case ValueTag::True: return "true";
			case ValueTag::String: return stringPool.toString(asStringId(v));
			case ValueTag::Table: return "table";
			case ValueTag::Closure: return "function";
			case ValueTag::NativeFunction: return "function";
			case ValueTag::NativeObject: return "native";
			case ValueTag::Upvalue: return "upvalue";
			case ValueTag::Nil: return "nil";
			default: return "unknown";
		}
	}
	double num = valueToNumber(v);
	if (!std::isfinite(num)) {
		return std::isnan(num) ? "nan" : (num < 0 ? "-inf" : "inf");
	}
	return formatNumber(num);
}

const char* valueTypeName(Value v) {
	return valueTypeNameInline(v);
}

Table::Table(int arraySize, int hashSize) {
	if (arraySize > 0) {
		m_array.resize(static_cast<size_t>(arraySize), valueNil());
	}
	if (hashSize > 0) {
		size_t size = nextPowerOfTwo(static_cast<size_t>(hashSize));
		m_hash.assign(size, HashNode{});
		m_hashFree = static_cast<int>(size) - 1;
	}
	addTrackedLuaHeapBytes(static_cast<ptrdiff_t>(trackedHeapBytes()));
}

bool Table::tryGetArrayIndex(const Value& key, int& outIndex) const {
	if (!valueIsNumber(key)) {
		return false;
	}
	double n = valueToNumber(key);
	if (!std::isfinite(n)) {
		return false;
	}
	if (n < 1.0) {
		return false;
	}
	if (n > static_cast<double>(std::numeric_limits<int>::max())) {
		return false;
	}
	int index = static_cast<int>(n);
	if (static_cast<double>(index) != n) {
		return false;
	}
	outIndex = index - 1;
	return true;
}

bool Table::hasArrayIndex(size_t index) const {
	if (index < m_array.size()) {
		return !isNil(m_array[index]);
	}
	if (m_hash.empty()) {
		return false;
	}
	Value key = valueNumber(static_cast<double>(index + 1));
	return findNodeIndex(key) >= 0;
}

void Table::updateArrayLengthFrom(size_t startIndex) {
	size_t newLength = startIndex;
	while (hasArrayIndex(newLength)) {
		++newLength;
	}
	m_arrayLength = newLength;
}

size_t Table::hashValue(const Value& key) const {
	return ValueHash{}(key);
}

bool Table::keyEquals(const Value& a, const Value& b) const {
	return ValueEq{}(a, b);
}

int Table::findNodeIndex(const Value& key) const {
	if (m_hash.empty()) {
		return -1;
	}
	size_t mask = m_hash.size() - 1;
	int index = static_cast<int>(hashValue(key) & mask);
	while (index >= 0) {
		const HashNode& node = m_hash[static_cast<size_t>(index)];
		if (!isNil(node.key) && keyEquals(node.key, key)) {
			return index;
		}
		index = node.next;
	}
	return -1;
}

Table::HashNode* Table::getNode(const Value& key) {
	int index = findNodeIndex(key);
	if (index < 0) {
		return nullptr;
	}
	return &m_hash[static_cast<size_t>(index)];
}

Table::HashNode* Table::getMainNode(const Value& key) {
	if (m_hash.empty()) {
		return nullptr;
	}
	size_t mask = m_hash.size() - 1;
	size_t index = hashValue(key) & mask;
	return &m_hash[index];
}

int Table::getFreeIndex() {
	int start = m_hashFree >= 0 ? m_hashFree : static_cast<int>(m_hash.size()) - 1;
	for (int i = start; i >= 0; --i) {
		if (isNil(m_hash[static_cast<size_t>(i)].key)) {
			m_hashFree = i - 1;
			return i;
		}
	}
	m_hashFree = -1;
	return -1;
}

void Table::rehash(const Value& key) {
	size_t totalKeys = 0;
	std::vector<size_t> counts;

	auto countIntegerKey = [&counts](size_t index) {
		size_t log = ceilLog2(index);
		if (log >= counts.size()) {
			counts.resize(log + 1, 0);
		}
		counts[log] += 1;
	};

	for (size_t i = 0; i < m_array.size(); ++i) {
		if (!isNil(m_array[i])) {
			totalKeys += 1;
			countIntegerKey(i + 1);
		}
	}
	for (const auto& node : m_hash) {
		if (!isNil(node.key)) {
			totalKeys += 1;
			int index = 0;
			if (tryGetArrayIndex(node.key, index)) {
				countIntegerKey(static_cast<size_t>(index) + 1);
			}
		}
	}
	if (!isNil(key)) {
		totalKeys += 1;
		int index = 0;
		if (tryGetArrayIndex(key, index)) {
			countIntegerKey(static_cast<size_t>(index) + 1);
		}
	}

	size_t arraySize = 0;
	size_t arrayKeys = 0;
	size_t total = 0;
	size_t power = 1;
	for (size_t i = 0; i < counts.size(); ++i) {
		total += counts[i];
		if (total > power / 2) {
			arraySize = power;
			arrayKeys = total;
		}
		power <<= 1;
	}

	size_t hashKeys = totalKeys - arrayKeys;
	size_t hashSize = hashKeys > 0 ? nextPowerOfTwo(hashKeys) : 0;
	resize(arraySize, hashSize);
}

void Table::resize(size_t newArraySize, size_t newHashSize) {
	const size_t previousBytes = trackedHeapBytes();
	std::vector<Value> oldArray = std::move(m_array);
	std::vector<HashNode> oldHash = std::move(m_hash);

	m_array.assign(newArraySize, valueNil());
	m_arrayLength = 0;
	m_hash.assign(newHashSize, HashNode{});
	m_hashFree = newHashSize > 0 ? static_cast<int>(newHashSize) - 1 : -1;

	for (size_t i = 0; i < oldArray.size(); ++i) {
		if (!isNil(oldArray[i])) {
			rawSet(valueNumber(static_cast<double>(i + 1)), oldArray[i]);
		}
	}
	for (const auto& node : oldHash) {
		if (!isNil(node.key)) {
			rawSet(node.key, node.value);
		}
	}
	replaceTrackedLuaHeapBytes(previousBytes, trackedHeapBytes());
}

void Table::rawSet(const Value& key, const Value& value) {
	int index = 0;
	bool isArrayKey = tryGetArrayIndex(key, index);
	if (isArrayKey) {
		size_t idx = static_cast<size_t>(index);
		if (idx < m_array.size()) {
			m_array[idx] = value;
			if (isNil(value)) {
				if (idx < m_arrayLength) {
					m_arrayLength = idx;
				}
			} else if (idx == m_arrayLength) {
				size_t newLength = m_arrayLength;
				while (newLength < m_array.size() && !isNil(m_array[newLength])) {
					++newLength;
				}
				m_arrayLength = newLength;
			}
			return;
		}
	}
	insertHash(key, value);
	if (isArrayKey && static_cast<size_t>(index) == m_arrayLength) {
		updateArrayLengthFrom(m_arrayLength);
	}
}

void Table::insertHash(const Value& key, const Value& value) {
	if (m_hash.empty()) {
		rehash(key);
		rawSet(key, value);
		return;
	}
	size_t mask = m_hash.size() - 1;
	int mainIndex = static_cast<int>(hashValue(key) & mask);
	HashNode& mainNode = m_hash[static_cast<size_t>(mainIndex)];
	if (isNil(mainNode.key)) {
		mainNode.key = key;
		mainNode.value = value;
		mainNode.next = -1;
		return;
	}
	int freeIndex = getFreeIndex();
	if (freeIndex < 0) {
		rehash(key);
		rawSet(key, value);
		return;
	}
	HashNode& freeNode = m_hash[static_cast<size_t>(freeIndex)];
	int mainIndexOfOccupied = static_cast<int>(hashValue(mainNode.key) & mask);
	if (mainIndexOfOccupied != mainIndex) {
		freeNode = mainNode;
		int prev = mainIndexOfOccupied;
		while (m_hash[static_cast<size_t>(prev)].next != mainIndex) {
			prev = m_hash[static_cast<size_t>(prev)].next;
		}
		m_hash[static_cast<size_t>(prev)].next = freeIndex;
		mainNode.key = key;
		mainNode.value = value;
		mainNode.next = -1;
		return;
	}
	freeNode.key = key;
	freeNode.value = value;
	freeNode.next = mainNode.next;
	mainNode.next = freeIndex;
}

void Table::removeFromHash(const Value& key) {
	if (m_hash.empty()) {
		return;
	}
	size_t mask = m_hash.size() - 1;
	int mainIndex = static_cast<int>(hashValue(key) & mask);
	int prev = -1;
	int index = mainIndex;
	while (index >= 0) {
		HashNode& node = m_hash[static_cast<size_t>(index)];
		if (!isNil(node.key) && keyEquals(node.key, key)) {
			int next = node.next;
			if (prev >= 0) {
				m_hash[static_cast<size_t>(prev)].next = next;
				node.key = valueNil();
				node.value = valueNil();
				node.next = -1;
				if (index > m_hashFree) {
					m_hashFree = index;
				}
				return;
			}
			if (next >= 0) {
				HashNode& nextNode = m_hash[static_cast<size_t>(next)];
				node = nextNode;
				nextNode.key = valueNil();
				nextNode.value = valueNil();
				nextNode.next = -1;
				if (next > m_hashFree) {
					m_hashFree = next;
				}
				return;
			}
			node.key = valueNil();
			node.value = valueNil();
			node.next = -1;
			if (index > m_hashFree) {
				m_hashFree = index;
			}
			return;
		}
		prev = index;
		index = node.next;
	}
}

Value Table::get(const Value& key) const {
	if (isNil(key)) {
		throw BMSX_RUNTIME_ERROR("Table index is nil.");
	}
	int index = 0;
	if (tryGetArrayIndex(key, index)) {
		if (index < static_cast<int>(m_array.size())) {
			return m_array[static_cast<size_t>(index)];
		}
	}

	int nodeIndex = findNodeIndex(key);
	if (nodeIndex >= 0) {
		return m_hash[static_cast<size_t>(nodeIndex)].value;
	}
	return valueNil();
}

void Table::set(const Value& key, const Value& value) {
	if (isNil(key)) {
		throw BMSX_RUNTIME_ERROR("Table index is nil.");
	}
	int index = 0;
	bool isArrayKey = tryGetArrayIndex(key, index);
	if (isArrayKey) {
		const size_t idx = static_cast<size_t>(index);
		if (isNil(value)) {
			if (idx < m_array.size()) {
				m_array[idx] = value;
				if (idx < m_arrayLength) {
					m_arrayLength = idx;
				}
				return;
			}
		} else if (idx < m_array.size()) {
			m_array[idx] = value;
			if (idx == m_arrayLength) {
				size_t newLength = m_arrayLength;
				while (newLength < m_array.size() && !isNil(m_array[newLength])) {
					++newLength;
				}
				m_arrayLength = newLength;
			}
			return;
		}
	}

	if (isNil(value)) {
		removeFromHash(key);
		if (isArrayKey && static_cast<size_t>(index) < m_arrayLength) {
			m_arrayLength = static_cast<size_t>(index);
		}
		return;
	}
	int nodeIndex = findNodeIndex(key);
	if (nodeIndex >= 0) {
		m_hash[static_cast<size_t>(nodeIndex)].value = value;
		return;
	}
	if (m_hash.empty() || m_hashFree < 0) {
		rehash(key);
	}
	rawSet(key, value);
}

Value Table::getInteger(int indexValue) const {
	const int index = indexValue - 1;
	if (index >= 0 && index < static_cast<int>(m_array.size())) {
		return m_array[static_cast<size_t>(index)];
	}
	const int nodeIndex = findNodeIndex(valueNumber(static_cast<double>(indexValue)));
	if (nodeIndex >= 0) {
		return m_hash[static_cast<size_t>(nodeIndex)].value;
	}
	return valueNil();
}

void Table::setInteger(int indexValue, const Value& value) {
	const int index = indexValue - 1;
	if (index >= 0 && index < static_cast<int>(m_array.size())) {
		const size_t idx = static_cast<size_t>(index);
		if (isNil(value)) {
			m_array[idx] = value;
			if (idx < m_arrayLength) {
				m_arrayLength = idx;
			}
			return;
		}
		m_array[idx] = value;
		if (idx == m_arrayLength) {
			updateArrayLengthFrom(m_arrayLength);
		}
		return;
	}
	const Value key = valueNumber(static_cast<double>(indexValue));
	if (isNil(value)) {
		removeFromHash(key);
		if (index >= 0 && static_cast<size_t>(index) < m_arrayLength) {
			m_arrayLength = static_cast<size_t>(index);
		}
		return;
	}
	const int nodeIndex = findNodeIndex(key);
	if (nodeIndex >= 0) {
		m_hash[static_cast<size_t>(nodeIndex)].value = value;
		return;
	}
	if (m_hash.empty() || m_hashFree < 0) {
		rehash(key);
	}
	rawSet(key, value);
}

Value Table::getStringKey(StringId key) const {
	const int nodeIndex = findNodeIndex(valueString(key));
	if (nodeIndex >= 0) {
		return m_hash[static_cast<size_t>(nodeIndex)].value;
	}
	return valueNil();
}

void Table::setStringKey(StringId key, const Value& value) {
	const Value keyValue = valueString(key);
	if (isNil(value)) {
		removeFromHash(keyValue);
		return;
	}
	const int nodeIndex = findNodeIndex(keyValue);
	if (nodeIndex >= 0) {
		m_hash[static_cast<size_t>(nodeIndex)].value = value;
		return;
	}
	if (m_hash.empty() || m_hashFree < 0) {
		rehash(keyValue);
	}
	rawSet(keyValue, value);
}

int Table::length() const {
	return static_cast<int>(m_arrayLength);
}

void Table::clear() {
	const size_t previousBytes = trackedHeapBytes();
	m_array.clear();
	m_arrayLength = 0;
	m_hash.clear();
	m_hashFree = -1;
	replaceTrackedLuaHeapBytes(previousBytes, trackedHeapBytes());
}

std::vector<std::pair<Value, Value>> Table::entries() const {
	std::vector<std::pair<Value, Value>> result;
	forEachEntry([&result](Value key, Value value) {
		result.emplace_back(key, value);
	});
	return result;
}

std::optional<std::pair<Value, Value>> Table::nextEntry(const Value& after) const {
	if (isNil(after)) {
		for (size_t i = 0; i < m_array.size(); ++i) {
			if (!isNil(m_array[i])) {
				return std::make_pair(valueNumber(static_cast<double>(i + 1)), m_array[i]);
			}
		}
		for (const auto& node : m_hash) {
			if (!isNil(node.key)) {
				return std::make_pair(node.key, node.value);
			}
		}
		return std::nullopt;
	}
	int index = 0;
	if (tryGetArrayIndex(after, index)) {
		if (index < static_cast<int>(m_array.size())) {
			if (isNil(m_array[static_cast<size_t>(index)])) {
				return std::nullopt;
			}
			int startIndex = index + 1;
			for (int i = startIndex; i < static_cast<int>(m_array.size()); ++i) {
				if (!isNil(m_array[static_cast<size_t>(i)])) {
					return std::make_pair(valueNumber(static_cast<double>(i + 1)), m_array[static_cast<size_t>(i)]);
				}
			}
			for (const auto& node : m_hash) {
				if (!isNil(node.key)) {
					return std::make_pair(node.key, node.value);
				}
			}
			return std::nullopt;
		}
	}
	int nodeIndex = findNodeIndex(after);
	if (nodeIndex < 0) {
		return std::nullopt;
	}
	for (size_t i = static_cast<size_t>(nodeIndex + 1); i < m_hash.size(); ++i) {
		const auto& node = m_hash[i];
		if (!isNil(node.key)) {
			return std::make_pair(node.key, node.value);
		}
	}
	return std::nullopt;
}

std::optional<std::tuple<size_t, size_t, Value, Value>> Table::nextEntryFromCursor(size_t arrayCursor, size_t hashCursor, const Value& previousHashKey) const {
	for (size_t index = arrayCursor; index < m_array.size(); ++index) {
		const Value value = m_array[index];
		if (!isNil(value)) {
			return std::make_tuple(index + 1, 0, valueNumber(static_cast<double>(index + 1)), value);
		}
	}
	const size_t hashStart = hashCursor > 0 ? hashCursor - 1 : 0;
	for (size_t index = hashStart; index < m_hash.size(); ++index) {
		const auto& node = m_hash[index];
		if (!isNil(node.key)) {
			if (hashCursor > 0 && index == hashCursor - 1 && !isNil(previousHashKey) && keyEquals(node.key, previousHashKey)) {
				continue;
			}
			return std::make_tuple(m_array.size(), index + 1, node.key, node.value);
		}
	}
	return std::nullopt;
}

TableRuntimeState Table::captureRuntimeState() const {
	TableRuntimeState state;
	state.array = m_array;
	state.arrayLength = m_arrayLength;
	state.hash.reserve(m_hash.size());
	for (const auto& node : m_hash) {
		state.hash.push_back(TableHashNodeState{ node.key, node.value, node.next });
	}
	state.hashFree = m_hashFree;
	state.metatable = m_metatable;
	return state;
}

void Table::restoreRuntimeState(const TableRuntimeState& state) {
	const size_t previousBytes = trackedHeapBytes();
	m_array = state.array;
	m_arrayLength = state.arrayLength;
	m_hash.clear();
	m_hash.reserve(state.hash.size());
	for (const auto& node : state.hash) {
		m_hash.push_back(HashNode{ node.key, node.value, node.next });
	}
	m_hashFree = state.hashFree;
	m_metatable = state.metatable;
	replaceTrackedLuaHeapBytes(previousBytes, trackedHeapBytes());
}

size_t Table::trackedHeapBytes() const {
	return 32
		+ (m_array.size() * sizeof(Value))
		+ (m_hash.size() * (sizeof(Value) * 2 + sizeof(int)));
}

void GcHeap::markValue(Value v) {
	if (!valueIsTagged(v)) {
		return;
	}
	switch (valueTag(v)) {
		case ValueTag::Table:
			markObject(asTable(v));
			break;
		case ValueTag::Closure:
			markObject(asClosure(v));
			break;
		case ValueTag::NativeFunction:
			markObject(asNativeFunction(v));
			break;
		case ValueTag::NativeObject:
			markObject(asNativeObject(v));
			break;
		case ValueTag::Upvalue:
			markObject(asUpvalue(v));
			break;
		default:
			break;
	}
}

void GcHeap::markObject(GCObject* obj) {
	if (!obj || obj->marked) {
		return;
	}
	obj->marked = true;
	m_grayStack.push_back(obj);
}

void GcHeap::trace() {
	while (!m_grayStack.empty()) {
		GCObject* obj = m_grayStack.back();
		m_grayStack.pop_back();
		switch (obj->type) {
			case ObjType::Table: {
				auto* table = static_cast<Table*>(obj);
				if (table->getMetatable()) {
					markObject(table->getMetatable());
				}
				table->forEachEntry([this](Value key, Value value) {
					markValue(key);
					markValue(value);
				});
				break;
			}
			case ObjType::Closure: {
				auto* closure = static_cast<Closure*>(obj);
				for (auto* upvalue : closure->upvalues) {
					markObject(upvalue);
				}
				break;
			}
			case ObjType::NativeFunction:
				break;
			case ObjType::NativeObject: {
				auto* native = static_cast<NativeObject*>(obj);
				if (native->metatable) {
					markObject(native->metatable);
				}
				if (native->mark) {
					native->mark(*this);
				}
				break;
			}
			case ObjType::Upvalue: {
				auto* upvalue = static_cast<Upvalue*>(obj);
				if (!upvalue->open) {
					markValue(upvalue->value);
				}
				break;
			}
		}
	}
}

void GcHeap::sweep() {
	GCObject** current = &m_objects;
	while (*current) {
		GCObject* obj = *current;
		if (obj->marked) {
			obj->marked = false;
			current = &obj->next;
			continue;
		}
		GCObject* next = obj->next;
		switch (obj->type) {
			case ObjType::Table:
				m_bytesAllocated -= sizeof(Table);
				addTrackedLuaHeapBytes(-static_cast<ptrdiff_t>(static_cast<Table*>(obj)->trackedHeapBytes()));
				delete static_cast<Table*>(obj);
				break;
			case ObjType::Closure:
				m_bytesAllocated -= sizeof(Closure);
				addTrackedLuaHeapBytes(-static_cast<ptrdiff_t>(trackedClosureBytes(*static_cast<Closure*>(obj))));
				delete static_cast<Closure*>(obj);
				break;
			case ObjType::NativeFunction:
				m_bytesAllocated -= sizeof(NativeFunction);
				addTrackedLuaHeapBytes(-16);
				delete static_cast<NativeFunction*>(obj);
				break;
			case ObjType::NativeObject:
				m_bytesAllocated -= sizeof(NativeObject);
				addTrackedLuaHeapBytes(-24);
				delete static_cast<NativeObject*>(obj);
				break;
			case ObjType::Upvalue:
				m_bytesAllocated -= sizeof(Upvalue);
				addTrackedLuaHeapBytes(-24);
				delete static_cast<Upvalue*>(obj);
				break;
		}
		*current = next;
	}
}

void GcHeap::collect() {
	if (m_collectionSuspendDepth > 0) {
		m_collectRequested = true;
		return;
	}
	if (!m_collectRequested) {
		return;
	}
	m_collectRequested = false;
	if (m_rootMarker) {
		m_rootMarker(*this);
	}
	trace();
	sweep();
	m_nextGC = m_bytesAllocated * 2;
}

CPU::CPU(Memory& memory, StringHandleTable* handleTable)
	: m_memory(memory)
	, m_stringPool(handleTable) {
	m_heap.setRootMarker([this](GcHeap& heap) { markRoots(heap); });
	m_externalRootMarker = [](GcHeap&) {};
	globals = m_heap.allocate<Table>(ObjType::Table, 0, 0);
	m_indexKey = valueString(m_stringPool.intern("__index"));
}

Value CPU::createNativeFunction(std::string_view name, NativeFunctionInvoke fn, std::optional<NativeFnCost> cost) {
	const NativeFnCost resolvedCost = cost.value_or(resolveNativeFunctionCost(name));
	auto* native = m_heap.allocate<NativeFunction>(ObjType::NativeFunction);
	addTrackedLuaHeapBytes(16);
	native->name = std::string(name);
	native->cycleBase = resolvedCost.base;
	native->cyclePerArg = resolvedCost.perArg;
	native->cyclePerRet = resolvedCost.perRet;
	native->invoke = [invoke = std::move(fn)](const std::vector<Value>& args, std::vector<Value>& out) {
		out.clear();
		invoke(args, out);
	};
	return valueNativeFunction(native);
}

Value CPU::createNativeObject(
	void* raw,
	std::function<Value(const Value&)> get,
	std::function<void(const Value&, const Value&)> set,
	std::function<int()> len,
	std::function<std::optional<std::pair<Value, Value>>(const Value&)> nextEntry,
	std::function<void(GcHeap&)> mark
) {
	auto* native = m_heap.allocate<NativeObject>(ObjType::NativeObject);
	addTrackedLuaHeapBytes(24);
	native->raw = raw;
	native->get = std::move(get);
	native->set = std::move(set);
	native->len = std::move(len);
	native->nextEntry = std::move(nextEntry);
	native->mark = std::move(mark);
	return valueNativeObject(native);
}

Table* CPU::createTable(int arraySize, int hashSize) {
	return m_heap.allocate<Table>(ObjType::Table, arraySize, hashSize);
}

Closure* CPU::createRootClosure(int protoIndex) {
	auto* closure = m_heap.allocate<Closure>(ObjType::Closure);
	closure->protoIndex = protoIndex;
	closure->upvalues.clear();
	addTrackedLuaHeapBytes(static_cast<ptrdiff_t>(trackedClosureBytes(*closure)));
	return closure;
}

void CPU::setProgram(Program* program, ProgramMetadata* metadata) {
	m_program = program;
	m_metadata = metadata;
	if (!m_program) {
		initializeGlobalSlots(metadata);
		m_decoded.clear();
		return;
	}
	if (!m_program->constPoolCanonicalized) {
		const StringPool& programPool = *m_program->constPoolStringPool;
		auto& constPool = m_program->constPool;
		for (size_t index = 0; index < constPool.size(); ++index) {
			Value value = constPool[index];
			if (valueIsString(value)) {
				StringId oldId = asStringId(value);
				StringId newId = m_stringPool.intern(programPool.toString(oldId));
				constPool[index] = valueString(newId);
			}
		}
		m_program->constPoolCanonicalized = true;
		m_program->constPoolStringPool = &m_stringPool;
	} else if (m_program->constPoolStringPool != &m_stringPool) {
		throw BMSX_RUNTIME_ERROR("[CPU] Program const pool is canonicalized for a different string pool.");
	}
	m_indexKey = valueString(m_stringPool.intern("__index"));
	initializeGlobalSlots(metadata);
	decodeProgram();
}

void CPU::initializeGlobalSlots(ProgramMetadata* metadata) {
	const std::vector<std::string>* systemNames = metadata ? &metadata->systemGlobalNames : nullptr;
	const std::vector<std::string>* globalNames = metadata ? &metadata->globalNames : nullptr;
	const size_t systemCount = systemNames ? systemNames->size() : 0;
	const size_t globalCount = globalNames ? globalNames->size() : 0;

	m_systemGlobalNames.resize(systemCount);
	m_systemGlobalValues.resize(systemCount);
	m_systemGlobalSlotByKey.clear();
	for (size_t index = 0; index < systemCount; ++index) {
		const StringId key = m_stringPool.intern((*systemNames)[index]);
		m_systemGlobalNames[index] = key;
		m_systemGlobalSlotByKey.emplace(key, index);
		m_systemGlobalValues[index] = globals->get(valueString(key));
	}

	m_globalNames.resize(globalCount);
	m_globalValues.resize(globalCount);
	m_globalSlotByKey.clear();
	for (size_t index = 0; index < globalCount; ++index) {
		const StringId key = m_stringPool.intern((*globalNames)[index]);
		m_globalNames[index] = key;
		m_globalSlotByKey.emplace(key, index);
		m_globalValues[index] = globals->get(valueString(key));
	}
}

void CPU::clearGlobalSlots() {
	m_systemGlobalNames.clear();
	m_systemGlobalValues.clear();
	m_systemGlobalSlotByKey.clear();
	m_globalNames.clear();
	m_globalValues.clear();
	m_globalSlotByKey.clear();
}

void CPU::setGlobalByKey(const Value& key, const Value& value) {
	globals->set(key, value);
	const StringId keyId = asStringId(key);
	const auto systemIt = m_systemGlobalSlotByKey.find(keyId);
	if (systemIt != m_systemGlobalSlotByKey.end()) {
		m_systemGlobalValues[systemIt->second] = value;
		return;
	}
	const auto globalIt = m_globalSlotByKey.find(keyId);
	if (globalIt != m_globalSlotByKey.end()) {
		m_globalValues[globalIt->second] = value;
	}
}

Value CPU::getGlobalByKey(const Value& key) const {
	const StringId keyId = asStringId(key);
	const auto systemIt = m_systemGlobalSlotByKey.find(keyId);
	if (systemIt != m_systemGlobalSlotByKey.end()) {
		return m_systemGlobalValues[systemIt->second];
	}
	const auto globalIt = m_globalSlotByKey.find(keyId);
	if (globalIt != m_globalSlotByKey.end()) {
		return m_globalValues[globalIt->second];
	}
	return globals->get(key);
}

void CPU::syncGlobalSlotsToTable() {
	for (size_t index = 0; index < m_systemGlobalNames.size(); ++index) {
		globals->set(valueString(m_systemGlobalNames[index]), m_systemGlobalValues[index]);
	}
	for (size_t index = 0; index < m_globalNames.size(); ++index) {
		globals->set(valueString(m_globalNames[index]), m_globalValues[index]);
	}
}

void CPU::reserveStringHandles(StringId minHandle) {
	m_stringPool.reserveHandles(minHandle);
}

void CPU::decodeProgram() {
	m_decoded.clear();
	if (!m_program) {
		return;
	}
	size_t instructionCount = m_program->code.size() / INSTRUCTION_BYTES;
	m_decoded.resize(instructionCount);
	for (size_t pc = 0; pc < instructionCount; ++pc) {
		uint32_t instr = readInstructionWord(m_program->code, static_cast<int>(pc));
		DecodedInstruction decoded;
		decoded.word = instr;
		decoded.ext = static_cast<uint8_t>(instr >> 24);
		decoded.op = static_cast<uint8_t>((instr >> 18) & 0x3f);
		decoded.a = static_cast<uint8_t>((instr >> 12) & 0x3f);
		decoded.b = static_cast<uint8_t>((instr >> 6) & 0x3f);
		decoded.c = static_cast<uint8_t>(instr & 0x3f);
		m_decoded[pc] = decoded;
	}
}

void CPU::start(int entryProtoIndex, const std::vector<Value>& args) {
	m_frames.clear();
	m_yieldRequested = false;
	auto* closure = createRootClosure(entryProtoIndex);
	pushFrame(closure, args, 0, 0, false, m_program->protos[entryProtoIndex].entryPC);
}

void CPU::call(Closure* closure, const std::vector<Value>& args, int returnCount) {
	if (!closure) {
		throw BMSX_RUNTIME_ERROR("Attempted to call a nil value.");
	}
	m_yieldRequested = false;
	pushFrame(closure, args, 0, returnCount, false, m_program->protos[closure->protoIndex].entryPC);
}

void CPU::callExternal(Closure* closure, const std::vector<Value>& args) {
	if (!closure) {
		throw BMSX_RUNTIME_ERROR("Attempted to call a nil value.");
	}
	m_yieldRequested = false;
	pushFrame(closure, args, 0, 0, true, m_program->protos[closure->protoIndex].entryPC);
}

void CPU::requestYield() {
	m_yieldRequested = true;
}

void CPU::clearYieldRequest() {
	m_yieldRequested = false;
}

RunResult CPU::run(int instructionBudget) {
	instructionBudgetRemaining = instructionBudget;
	RunResult result = RunResult::Halted;
	while (!m_frames.empty()) {
		if (m_yieldRequested) {
			m_yieldRequested = false;
			result = RunResult::Yielded;
			break;
		}
		enforceLuaHeapBudget();
		if (instructionBudgetRemaining <= 0) {
			result = RunResult::Yielded;
			break;
		}
		step();
	}
	return result;
}

RunResult CPU::runUntilDepth(int targetDepth, int instructionBudget) {
	instructionBudgetRemaining = instructionBudget;
	RunResult result = RunResult::Halted;
	while (static_cast<int>(m_frames.size()) > targetDepth) {
		if (m_yieldRequested) {
			m_yieldRequested = false;
			result = RunResult::Yielded;
			break;
		}
		enforceLuaHeapBudget();
		if (instructionBudgetRemaining <= 0) {
			result = RunResult::Yielded;
			break;
		}
		step();
	}
	return result;
}

void CPU::unwindToDepth(int targetDepth) {
	while (static_cast<int>(m_frames.size()) > targetDepth) {
		auto finished = std::move(m_frames.back());
		m_frames.pop_back();
		closeUpvalues(*finished);
		releaseFrame(std::move(finished));
	}
}

void CPU::collectHeap() {
	m_heap.requestCollection();
	m_heap.collect();
}

void CPU::step() {
	if (m_frames.empty()) return;
	enforceLuaHeapBudget();
	if (m_heap.needsCollection()) {
		m_heap.collect();
	}
	CallFrame& frame = *m_frames.back();
	int pc = frame.pc;
	int wordIndex = pc / INSTRUCTION_BYTES;
	const DecodedInstruction* decoded = &m_decoded[static_cast<size_t>(wordIndex)];
	uint8_t op = decoded->op;
	uint8_t ext = decoded->ext;
	uint8_t wideA = 0;
	uint8_t wideB = 0;
	uint8_t wideC = 0;
	bool hasWide = false;
	if (static_cast<OpCode>(op) == OpCode::WIDE) {
		hasWide = true;
		wideA = decoded->a;
		wideB = decoded->b;
		wideC = decoded->c;
		pc += INSTRUCTION_BYTES;
		wordIndex += 1;
		decoded = &m_decoded[static_cast<size_t>(wordIndex)];
		op = decoded->op;
		ext = decoded->ext;
	}
	frame.pc = pc + INSTRUCTION_BYTES;
	lastPc = pc;
	lastInstruction = decoded->word;
	instructionBudgetRemaining -= static_cast<int>(kBaseCycles[op]);
	executeInstruction(frame, static_cast<OpCode>(op), decoded->a, decoded->b, decoded->c, ext, wideA, wideB, wideC, hasWide);
}

std::optional<SourceRange> CPU::getDebugRange(int pc) const {
	int wordIndex = pc / INSTRUCTION_BYTES;
	if (!m_metadata || wordIndex < 0 || wordIndex >= static_cast<int>(m_metadata->debugRanges.size())) {
		return std::nullopt;
	}
	return m_metadata->debugRanges[static_cast<size_t>(wordIndex)];
}

std::vector<std::pair<int, int>> CPU::getCallStack() const {
	std::vector<std::pair<int, int>> stack;
	int topIndex = static_cast<int>(m_frames.size()) - 1;
	for (int i = 0; i < static_cast<int>(m_frames.size()); ++i) {
		const auto& frame = m_frames[i];
		int pc = (i == topIndex) ? lastPc : frame->callSitePc;
		stack.emplace_back(frame->protoIndex, pc);
	}
	return stack;
}

int CPU::getFrameRegisterCount(int frameIndex) const {
	if (frameIndex < 0 || frameIndex >= static_cast<int>(m_frames.size())) {
		throw BMSX_RUNTIME_ERROR("[CPU] Frame index out of range: " + std::to_string(frameIndex) + ".");
	}
	return m_frames[static_cast<size_t>(frameIndex)]->top;
}

Value CPU::readFrameRegister(int frameIndex, int registerIndex) const {
	if (frameIndex < 0 || frameIndex >= static_cast<int>(m_frames.size())) {
		throw BMSX_RUNTIME_ERROR("[CPU] Frame index out of range: " + std::to_string(frameIndex) + ".");
	}
	const CallFrame& frame = *m_frames[static_cast<size_t>(frameIndex)];
	if (registerIndex < 0 || registerIndex >= static_cast<int>(frame.registers.size())) {
		throw BMSX_RUNTIME_ERROR("[CPU] Register index out of range: " + std::to_string(registerIndex) + ".");
	}
	return frame.registers[static_cast<size_t>(registerIndex)];
}

void CPU::skipNextInstruction(CallFrame& frame) {
	int pc = frame.pc;
	int wordIndex = pc / INSTRUCTION_BYTES;
	if (wordIndex < 0 || wordIndex >= static_cast<int>(m_decoded.size())) {
		throw BMSX_RUNTIME_ERROR("Attempted to skip beyond end of program.");
	}
	if (static_cast<OpCode>(m_decoded[static_cast<size_t>(wordIndex)].op) == OpCode::WIDE) {
		if (wordIndex + 1 >= static_cast<int>(m_decoded.size())) {
			throw BMSX_RUNTIME_ERROR("Malformed program: WIDE instruction at end of program.");
		}
		frame.pc += INSTRUCTION_BYTES * 2;
		return;
	}
	frame.pc += INSTRUCTION_BYTES;
}

void CPU::executeInstruction(
	CallFrame& frame,
	OpCode op,
	uint8_t aLow,
	uint8_t bLow,
	uint8_t cLow,
	uint8_t ext,
	uint8_t wideA,
	uint8_t wideB,
	uint8_t wideC,
	bool hasWide
) {
	bool usesBx = op == OpCode::LOADK
		|| op == OpCode::KSMI
		|| op == OpCode::GETG
		|| op == OpCode::SETG
		|| op == OpCode::GETSYS
		|| op == OpCode::SETSYS
		|| op == OpCode::GETGL
		|| op == OpCode::SETGL
		|| op == OpCode::CLOSURE
		|| op == OpCode::JMP
		|| op == OpCode::JMPIF
		|| op == OpCode::JMPIFNOT
		|| op == OpCode::BR_TRUE
		|| op == OpCode::BR_FALSE;
	uint8_t extA = usesBx ? 0 : static_cast<uint8_t>((ext >> 6) & 0x3);
	uint8_t extB = usesBx ? 0 : static_cast<uint8_t>((ext >> 3) & 0x7);
	uint8_t extC = usesBx ? 0 : static_cast<uint8_t>(ext & 0x7);
	int aShift = MAX_OPERAND_BITS + (usesBx ? 0 : EXT_A_BITS);
	int a = (static_cast<int>(wideA) << aShift) | (static_cast<int>(extA) << MAX_OPERAND_BITS) | aLow;
	int b = (static_cast<int>(wideB) << (MAX_OPERAND_BITS + EXT_B_BITS)) | (static_cast<int>(extB) << MAX_OPERAND_BITS) | bLow;
	int c = (static_cast<int>(wideC) << (MAX_OPERAND_BITS + EXT_C_BITS)) | (static_cast<int>(extC) << MAX_OPERAND_BITS) | cLow;
	uint32_t bxLow = (static_cast<uint32_t>(bLow) << MAX_OPERAND_BITS) | static_cast<uint32_t>(cLow);
	uint32_t bx = (static_cast<uint32_t>(wideB) << (MAX_BX_BITS + EXT_BX_BITS))
		| (static_cast<uint32_t>(usesBx ? ext : 0) << MAX_BX_BITS)
		| bxLow;
	int sbxBits = MAX_BX_BITS + EXT_BX_BITS + (hasWide ? MAX_OPERAND_BITS : 0);
	int sbx = signExtend(bx, sbxBits);
	int rkBitsB = MAX_OPERAND_BITS + EXT_B_BITS + (hasWide ? MAX_OPERAND_BITS : 0);
	int rkBitsC = MAX_OPERAND_BITS + EXT_C_BITS + (hasWide ? MAX_OPERAND_BITS : 0);
	uint32_t rkRawB = (static_cast<uint32_t>(wideB) << (MAX_OPERAND_BITS + EXT_B_BITS))
		| (static_cast<uint32_t>(extB) << MAX_OPERAND_BITS)
		| bLow;
	uint32_t rkRawC = (static_cast<uint32_t>(wideC) << (MAX_OPERAND_BITS + EXT_C_BITS))
		| (static_cast<uint32_t>(extC) << MAX_OPERAND_BITS)
		| cLow;

#define CYCLES_ADD(n) do { instructionBudgetRemaining -= (n); } while (0)

	switch (op) {
		case OpCode::WIDE:
			throw BMSX_RUNTIME_ERROR("Unexpected WIDE opcode.");

		case OpCode::MOV:
			setRegister(frame, a, frame.registers[b]);
			return;

		case OpCode::LOADK:
			setRegister(frame, a, m_program->constPool[bx]);
			return;

		case OpCode::LOADNIL:
			for (int i = 0; i < b; ++i) {
				setRegister(frame, a + i, valueNil());
			}
			return;

		case OpCode::LOADBOOL:
			setRegister(frame, a, valueBool(b != 0));
			if (c != 0) {
				skipNextInstruction(frame);
			}
			return;

		case OpCode::KNIL:
			setRegister(frame, a, valueNil());
			return;

		case OpCode::KFALSE:
			setRegister(frame, a, valueBool(false));
			return;

		case OpCode::KTRUE:
			setRegister(frame, a, valueBool(true));
			return;

		case OpCode::K0:
			setRegister(frame, a, valueNumber(0.0));
			return;

		case OpCode::K1:
			setRegister(frame, a, valueNumber(1.0));
			return;

		case OpCode::KM1:
			setRegister(frame, a, valueNumber(-1.0));
			return;

		case OpCode::KSMI:
			setRegister(frame, a, valueNumber(static_cast<double>(sbx)));
			return;

		case OpCode::GETG: {
			const Value& key = m_program->constPool[bx];
			setRegister(frame, a, globals->get(key));
			return;
		}

		case OpCode::SETG: {
			const Value& key = m_program->constPool[bx];
			globals->set(key, frame.registers[a]);
			return;
		}

		case OpCode::GETSYS:
			setRegister(frame, a, m_systemGlobalValues[static_cast<size_t>(bx)]);
			return;

		case OpCode::SETSYS:
			m_systemGlobalValues[static_cast<size_t>(bx)] = frame.registers[a];
			return;

		case OpCode::GETGL:
			setRegister(frame, a, m_globalValues[static_cast<size_t>(bx)]);
			return;

		case OpCode::SETGL:
			m_globalValues[static_cast<size_t>(bx)] = frame.registers[a];
			return;

		case OpCode::GETI:
			setRegister(frame, a, loadTableIntegerIndex(frame.registers[static_cast<size_t>(b)], c));
			return;

		case OpCode::SETI:
			storeTableIntegerIndex(frame.registers[static_cast<size_t>(a)], b, readRK(frame, rkRawC, rkBitsC));
			return;

		case OpCode::GETFIELD:
			setRegister(frame, a, loadTableFieldIndex(frame.registers[static_cast<size_t>(b)], asStringId(m_program->constPool[static_cast<size_t>(c)])));
			return;

		case OpCode::SETFIELD:
			storeTableFieldIndex(frame.registers[static_cast<size_t>(a)], asStringId(m_program->constPool[static_cast<size_t>(b)]), readRK(frame, rkRawC, rkBitsC));
			return;

		case OpCode::SELF: {
			const Value base = frame.registers[static_cast<size_t>(b)];
			const StringId key = asStringId(m_program->constPool[static_cast<size_t>(c)]);
			setRegister(frame, a + 1, base);
			setRegister(frame, a, loadTableFieldIndex(base, key));
			return;
		}

		case OpCode::GETT: {
			const Value& tableValue = frame.registers[static_cast<size_t>(b)];
			const Value& key = readRK(frame, rkRawC, rkBitsC);
			setRegister(frame, a, loadTableIndex(tableValue, key));
			return;
		}

		case OpCode::SETT:
			storeTableIndex(frame.registers[static_cast<size_t>(a)], readRK(frame, rkRawB, rkBitsB), readRK(frame, rkRawC, rkBitsC));
			return;

		case OpCode::NEWT: {
			auto* table = m_heap.allocate<Table>(ObjType::Table, b, c);
			setRegister(frame, a, valueTable(table));
			return;
		}

		case OpCode::ADD: {
			double left = asNumber(readRK(frame, rkRawB, rkBitsB));
			double right = asNumber(readRK(frame, rkRawC, rkBitsC));
			setRegister(frame, a, valueNumber(left + right));
			return;
		}

		case OpCode::SUB: {
			double left = asNumber(readRK(frame, rkRawB, rkBitsB));
			double right = asNumber(readRK(frame, rkRawC, rkBitsC));
			setRegister(frame, a, valueNumber(left - right));
			return;
		}

		case OpCode::MUL: {
			double left = asNumber(readRK(frame, rkRawB, rkBitsB));
			double right = asNumber(readRK(frame, rkRawC, rkBitsC));
			setRegister(frame, a, valueNumber(left * right));
			return;
		}

		case OpCode::DIV: {
			double left = asNumber(readRK(frame, rkRawB, rkBitsB));
			double right = asNumber(readRK(frame, rkRawC, rkBitsC));
			setRegister(frame, a, valueNumber(left / right));
			return;
		}

		case OpCode::MOD: {
			double left = asNumber(readRK(frame, rkRawB, rkBitsB));
			double right = asNumber(readRK(frame, rkRawC, rkBitsC));
			setRegister(frame, a, valueNumber(std::fmod(left, right)));
			return;
		}

		case OpCode::FLOORDIV: {
			double left = asNumber(readRK(frame, rkRawB, rkBitsB));
			double right = asNumber(readRK(frame, rkRawC, rkBitsC));
			setRegister(frame, a, valueNumber(std::floor(left / right)));
			return;
		}

		case OpCode::POW: {
			double left = asNumber(readRK(frame, rkRawB, rkBitsB));
			double right = asNumber(readRK(frame, rkRawC, rkBitsC));
			setRegister(frame, a, valueNumber(std::pow(left, right)));
			return;
		}

		case OpCode::BAND: {
			const uint32_t left = toU32(asNumber(readRK(frame, rkRawB, rkBitsB)));
			const uint32_t right = toU32(asNumber(readRK(frame, rkRawC, rkBitsC)));
			const int32_t result = static_cast<int32_t>(left & right);
			setRegister(frame, a, valueNumber(static_cast<double>(result)));
			return;
		}

		case OpCode::BOR: {
			const uint32_t left = toU32(asNumber(readRK(frame, rkRawB, rkBitsB)));
			const uint32_t right = toU32(asNumber(readRK(frame, rkRawC, rkBitsC)));
			const int32_t result = static_cast<int32_t>(left | right);
			setRegister(frame, a, valueNumber(static_cast<double>(result)));
			return;
		}

		case OpCode::BXOR: {
			const uint32_t left = toU32(asNumber(readRK(frame, rkRawB, rkBitsB)));
			const uint32_t right = toU32(asNumber(readRK(frame, rkRawC, rkBitsC)));
			const int32_t result = static_cast<int32_t>(left ^ right);
			setRegister(frame, a, valueNumber(static_cast<double>(result)));
			return;
		}

		case OpCode::SHL: {
			const uint32_t left = toU32(asNumber(readRK(frame, rkRawB, rkBitsB)));
			const uint32_t right = toU32(asNumber(readRK(frame, rkRawC, rkBitsC))) & 31u;
			const uint32_t result = left << right;
			setRegister(frame, a, valueNumber(static_cast<double>(static_cast<int32_t>(result))));
			return;
		}

		case OpCode::SHR: {
			const int32_t left = toI32(asNumber(readRK(frame, rkRawB, rkBitsB)));
			const uint32_t right = toU32(asNumber(readRK(frame, rkRawC, rkBitsC))) & 31u;
			setRegister(frame, a, valueNumber(static_cast<double>(left >> right)));
			return;
		}

		case OpCode::CONCAT: {
			std::string text = valueToString(readRK(frame, rkRawB, rkBitsB), m_stringPool);
			text += valueToString(readRK(frame, rkRawC, rkBitsC), m_stringPool);
			const StringId textId = m_stringPool.intern(text);
			setRegister(frame, a, valueString(textId));
			return;
		}

		case OpCode::CONCATN: {
			std::string text;
			for (int index = 0; index < c; ++index) {
				text += valueToString(frame.registers[static_cast<size_t>(b + index)], m_stringPool);
			}
			const StringId textId = m_stringPool.intern(text);
			setRegister(frame, a, valueString(textId));
			return;
		}

		case OpCode::UNM: {
			double val = asNumber(frame.registers[b]);
			setRegister(frame, a, valueNumber(-val));
			return;
		}

		case OpCode::NOT:
			setRegister(frame, a, valueBool(!isTruthy(frame.registers[b])));
			return;

		case OpCode::LEN: {
			const Value& val = frame.registers[b];
			if (valueIsString(val)) {
				int cp = static_cast<int>(m_stringPool.codepointCount(asStringId(val)));
				setRegister(frame, a, valueNumber(static_cast<double>(cp)));
				return;
			}
			if (valueIsTable(val)) {
				setRegister(frame, a, valueNumber(static_cast<double>(asTable(val)->length())));
				return;
			}
			if (valueIsNativeObject(val)) {
				auto* obj = asNativeObject(val);
				if (!obj->len) {
					std::string stack;
					auto callStack = getCallStack();
					for (auto it = callStack.rbegin(); it != callStack.rend(); ++it) {
						const auto& entry = *it;
						const auto range = getDebugRange(entry.second);
						if (!stack.empty()) {
							stack += " <- ";
						}
						if (range.has_value()) {
							stack += range->path + ":" + std::to_string(range->startLine) + ":" + std::to_string(range->startColumn);
						} else {
							stack += "<unknown>";
						}
					}
					throw BMSX_RUNTIME_ERROR("Length operator expects a native object with a length. stack=" + stack);
				}
				setRegister(frame, a, valueNumber(static_cast<double>(obj->len())));
				return;
			}
			std::string stack;
			auto callStack = getCallStack();
			for (auto it = callStack.rbegin(); it != callStack.rend(); ++it) {
				const auto& entry = *it;
				const auto range = getDebugRange(entry.second);
				if (!stack.empty()) {
					stack += " <- ";
				}
				if (range.has_value()) {
					stack += range->path + ":" + std::to_string(range->startLine) + ":" + std::to_string(range->startColumn);
				} else {
					stack += "<unknown>";
				}
			}
			throw BMSX_RUNTIME_ERROR("Length operator expects a string or table. stack=" + stack);
		}

		case OpCode::BNOT: {
			const uint32_t val = toU32(asNumber(frame.registers[b]));
			const int32_t result = static_cast<int32_t>(~val);
			setRegister(frame, a, valueNumber(static_cast<double>(result)));
			return;
		}

		case OpCode::EQ: {
			const Value& left = readRK(frame, rkRawB, rkBitsB);
			const Value& right = readRK(frame, rkRawC, rkBitsC);
			bool eq = false;
			if (valueIsNumber(left) && valueIsNumber(right)) {
				eq = valueToNumber(left) == valueToNumber(right);
			} else if (valueIsTagged(left) && valueIsTagged(right)) {
				eq = left == right;
			}
			if (eq != (a != 0)) {
				skipNextInstruction(frame);
			}
			return;
		}

		case OpCode::LT: {
			const Value& leftValue = readRK(frame, rkRawB, rkBitsB);
			const Value& rightValue = readRK(frame, rkRawC, rkBitsC);
			bool ok = false;
			if (valueIsString(leftValue) && valueIsString(rightValue)) {
				ok = m_stringPool.toString(asStringId(leftValue)) < m_stringPool.toString(asStringId(rightValue));
			} else {
				auto toNumber = [this](const Value& value) -> double {
					if (valueIsNumber(value)) {
						return valueToNumber(value);
					}
					if (valueIsTagged(value)) {
						switch (valueTag(value)) {
							case ValueTag::False: return 0.0;
							case ValueTag::True: return 1.0;
							case ValueTag::Nil: return 0.0;
							case ValueTag::String: {
								const std::string& text = m_stringPool.toString(asStringId(value));
								char* end = nullptr;
								double parsed = std::strtod(text.c_str(), &end);
								if (end == text.c_str()) {
									return std::numeric_limits<double>::quiet_NaN();
								}
								return parsed;
							}
							default:
								return std::numeric_limits<double>::quiet_NaN();
						}
					}
					return std::numeric_limits<double>::quiet_NaN();
				};
				double left = toNumber(leftValue);
				double right = toNumber(rightValue);
				ok = left < right;
			}
			if (ok != (a != 0)) {
				skipNextInstruction(frame);
			}
			return;
		}

		case OpCode::LE: {
			const Value& leftValue = readRK(frame, rkRawB, rkBitsB);
			const Value& rightValue = readRK(frame, rkRawC, rkBitsC);
			bool ok = false;
			if (valueIsString(leftValue) && valueIsString(rightValue)) {
				ok = m_stringPool.toString(asStringId(leftValue)) <= m_stringPool.toString(asStringId(rightValue));
			} else {
				auto toNumber = [this](const Value& value) -> double {
					if (valueIsNumber(value)) {
						return valueToNumber(value);
					}
					if (valueIsTagged(value)) {
						switch (valueTag(value)) {
							case ValueTag::False: return 0.0;
							case ValueTag::True: return 1.0;
							case ValueTag::Nil: return 0.0;
							case ValueTag::String: {
								const std::string& text = m_stringPool.toString(asStringId(value));
								char* end = nullptr;
								double parsed = std::strtod(text.c_str(), &end);
								if (end == text.c_str()) {
									return std::numeric_limits<double>::quiet_NaN();
								}
								return parsed;
							}
							default:
								return std::numeric_limits<double>::quiet_NaN();
						}
					}
					return std::numeric_limits<double>::quiet_NaN();
				};
				double left = toNumber(leftValue);
				double right = toNumber(rightValue);
				ok = left <= right;
			}
			if (ok != (a != 0)) {
				skipNextInstruction(frame);
			}
			return;
		}

		case OpCode::TEST: {
			const Value& val = frame.registers[a];
			if (isTruthy(val) != (c != 0)) {
				skipNextInstruction(frame);
			}
			return;
		}

		case OpCode::TESTSET: {
			const Value& val = frame.registers[b];
			if (isTruthy(val) == (c != 0)) {
				setRegister(frame, a, val);
			} else {
				skipNextInstruction(frame);
			}
			return;
		}

		case OpCode::JMP:
			frame.pc += sbx * INSTRUCTION_BYTES;
			return;

		case OpCode::JMPIF:
			if (isTruthy(frame.registers[static_cast<size_t>(a)])) {
				frame.pc += sbx * INSTRUCTION_BYTES;
			}
			return;

		case OpCode::JMPIFNOT:
			if (!isTruthy(frame.registers[static_cast<size_t>(a)])) {
				frame.pc += sbx * INSTRUCTION_BYTES;
			}
			return;

		case OpCode::BR_TRUE:
			if (isTruthy(frame.registers[static_cast<size_t>(a)])) {
				frame.pc += sbx * INSTRUCTION_BYTES;
			}
			return;

		case OpCode::BR_FALSE:
			if (!isTruthy(frame.registers[static_cast<size_t>(a)])) {
				frame.pc += sbx * INSTRUCTION_BYTES;
			}
			return;

		case OpCode::CLOSURE:
			setRegister(frame, a, valueClosure(createClosure(frame, bx)));
			return;

		case OpCode::GETUP: {
			Upvalue* upvalue = frame.closure->upvalues[b];
			setRegister(frame, a, readUpvalue(upvalue));
			return;
		}

		case OpCode::SETUP: {
			Upvalue* upvalue = frame.closure->upvalues[b];
			writeUpvalue(upvalue, frame.registers[a]);
			return;
		}

		case OpCode::VARARG: {
			int count = b == 0 ? static_cast<int>(frame.varargs.size()) : b;
			for (int i = 0; i < count; ++i) {
				Value value = i < static_cast<int>(frame.varargs.size()) ? frame.varargs[static_cast<size_t>(i)] : valueNil();
				setRegister(frame, a + i, value);
			}
			return;
		}

		case OpCode::CALL: {
			int argCount = b == 0 ? std::max(frame.top - a - 1, 0) : b;
			int retCount = c;
			const Value& callee = frame.registers[a];
			if (valueIsClosure(callee)) {
				Closure* closure = asClosure(callee);
				pushFrame(closure, &frame.registers[a + 1], static_cast<size_t>(argCount), a, retCount, false, frame.pc - INSTRUCTION_BYTES);
				return;
			}
			if (valueIsNativeFunction(callee)) {
				NativeFunction* fn = asNativeFunction(callee);
				CYCLES_ADD(static_cast<int>(fn->cycleBase));
				std::vector<Value> args = acquireArgScratch();
				args.resize(static_cast<size_t>(argCount));
				for (int i = 0; i < argCount; ++i) {
					args[static_cast<size_t>(i)] = frame.registers[a + 1 + i];
				}
				std::vector<Value> out = acquireNativeReturnScratch();
				fn->invoke(args, out);
				writeReturnValues(frame, a, retCount, out);
				releaseNativeReturnScratch(std::move(out));
				releaseArgScratch(std::move(args));
				return;
			}
			throw BMSX_RUNTIME_ERROR(formatNonFunctionCallError(
				callee,
				m_stringPool,
				getDebugRange(frame.pc - INSTRUCTION_BYTES)
			));
		}

		case OpCode::RET: {
			auto& results = m_returnScratch;
			results.clear();
			int count = b == 0 ? std::max(frame.top - a, 0) : b;
			results.reserve(static_cast<size_t>(count));
			for (int i = 0; i < count; ++i) {
				results.push_back(frame.registers[a + i]);
			}
			lastReturnValues.assign(results.begin(), results.end());
			closeUpvalues(frame);
			auto finished = std::move(m_frames.back());
			m_frames.pop_back();
			if (m_frames.empty()) {
				releaseFrame(std::move(finished));
				return;
			}
			if (finished->captureReturns) {
				releaseFrame(std::move(finished));
				return;
			}
			CallFrame& caller = *m_frames.back();
			writeReturnValues(caller, finished->returnBase, finished->returnCount, results);
			releaseFrame(std::move(finished));
			return;
		}

		case OpCode::LOAD_MEM: {
			const uint32_t addr = static_cast<uint32_t>(asNumber(readRK(frame, rkRawB, rkBitsB)));
			setRegister(frame, a, readMappedMemoryValue(addr, static_cast<MemoryAccessKind>(c)));
			return;
		}

		case OpCode::STORE_MEM: {
			const uint32_t addr = static_cast<uint32_t>(asNumber(readRK(frame, rkRawB, rkBitsB)));
			writeMappedMemoryValue(addr, static_cast<MemoryAccessKind>(c), frame.registers[a]);
			return;
		}

		case OpCode::STORE_MEM_WORDS: {
			const uint32_t addr = static_cast<uint32_t>(asNumber(readRK(frame, rkRawB, rkBitsB)));
			CYCLES_ADD(ceilDiv4(c));
			writeMappedWordSequence(frame, addr, a, c);
			return;
		}
	}

#undef CYCLES_ADD
}

Closure* CPU::createClosure(CallFrame& frame, int protoIndex) {
	const Proto& proto = m_program->protos[protoIndex];
	auto* closure = m_heap.allocate<Closure>(ObjType::Closure);
	closure->protoIndex = protoIndex;
	closure->upvalues.resize(proto.upvalues.size());
	addTrackedLuaHeapBytes(static_cast<ptrdiff_t>(trackedClosureBytes(*closure)));
	for (size_t i = 0; i < proto.upvalues.size(); ++i) {
		const UpvalueDesc& uv = proto.upvalues[i];
		if (uv.isLocal) {
			Upvalue* upvalue = nullptr;
			auto it = frame.openUpvalues.find(uv.index);
			if (it != frame.openUpvalues.end()) {
				upvalue = it->second;
			} else {
				upvalue = m_heap.allocate<Upvalue>(ObjType::Upvalue);
				addTrackedLuaHeapBytes(24);
				upvalue->open = true;
				upvalue->index = uv.index;
				upvalue->frame = &frame;
				frame.openUpvalues.emplace(uv.index, upvalue);
			}
			closure->upvalues[i] = upvalue;
		} else {
			closure->upvalues[i] = frame.closure->upvalues[uv.index];
		}
	}
	return closure;
}

void CPU::closeUpvalues(CallFrame& frame) {
	for (auto& entry : frame.openUpvalues) {
		Upvalue* upvalue = entry.second;
		upvalue->value = frame.registers[upvalue->index];
		upvalue->open = false;
		upvalue->frame = nullptr;
	}
	frame.openUpvalues.clear();
}

const Value& CPU::readUpvalue(Upvalue* upvalue) {
	if (upvalue->open) {
		return upvalue->frame->registers[upvalue->index];
	}
	return upvalue->value;
}

void CPU::writeUpvalue(Upvalue* upvalue, const Value& value) {
	if (upvalue->open) {
		upvalue->frame->registers[upvalue->index] = value;
		return;
	}
	upvalue->value = value;
}

void CPU::pushFrame(Closure* closure, const Value* args, size_t argCount,
	int returnBase, int returnCount, bool captureReturns, int callSitePc) {
	const Proto& proto = m_program->protos[closure->protoIndex];
	auto frame = acquireFrame();
	frame->protoIndex = closure->protoIndex;
	frame->pc = proto.entryPC;
	frame->closure = closure;
	frame->returnBase = returnBase;
	frame->returnCount = returnCount;
	frame->captureReturns = captureReturns;
	frame->callSitePc = callSitePc;
	frame->registers = acquireRegisters(static_cast<size_t>(proto.maxStack));
	frame->top = proto.numParams;

	for (int i = 0; i < proto.numParams; ++i) {
		if (i < static_cast<int>(argCount)) {
			frame->registers[static_cast<size_t>(i)] = args[i];
		} else {
			frame->registers[static_cast<size_t>(i)] = valueNil();
		}
	}
	if (proto.isVararg) {
		frame->varargs.clear();
		for (size_t i = static_cast<size_t>(proto.numParams); i < argCount; ++i) {
			frame->varargs.push_back(args[i]);
		}
	}
	m_frames.push_back(std::move(frame));
}

void CPU::pushFrame(Closure* closure, const std::vector<Value>& args,
	int returnBase, int returnCount, bool captureReturns, int callSitePc) {
	pushFrame(closure, args.data(), args.size(), returnBase, returnCount, captureReturns, callSitePc);
}

void CPU::writeReturnValues(CallFrame& frame, int base, int count, const std::vector<Value>& values) {
	if (count == 0) {
		int writeCount = static_cast<int>(values.size());
		for (int i = 0; i < writeCount; ++i) {
			setRegister(frame, base + i, values[static_cast<size_t>(i)]);
		}
		frame.top = base + writeCount;
		return;
	}
	for (int i = 0; i < count; ++i) {
		Value value = i < static_cast<int>(values.size()) ? values[static_cast<size_t>(i)] : valueNil();
		setRegister(frame, base + i, value);
	}
	frame.top = base + count;
}

void CPU::setRegister(CallFrame& frame, int index, Value value) {
	std::vector<Value>& registers = ensureRegisterCapacity(frame, index);
	registers[static_cast<size_t>(index)] = value;
	const int nextTop = index + 1;
	if (nextTop > frame.top) {
		frame.top = nextTop;
	}
}

std::vector<Value>& CPU::ensureRegisterCapacity(CallFrame& frame, int index) {
	std::vector<Value>& registers = frame.registers;
	if (index >= static_cast<int>(registers.size())) {
		const size_t needed = static_cast<size_t>(index) + 1;
		size_t bucket = nextPowerOfTwo(needed);
		if (bucket < 8) {
			bucket = 8;
		}
		const size_t target = bucket > MAX_REGISTER_ARRAY_SIZE ? needed : bucket;
		std::vector<Value> next = target > MAX_REGISTER_ARRAY_SIZE
			? std::vector<Value>(target, valueNil())
			: acquireRegisters(target);
		std::copy_n(registers.begin(), static_cast<size_t>(frame.top), next.begin());
		releaseRegisters(std::move(registers));
		registers = std::move(next);
	}
	return registers;
}

Value CPU::readMappedMemoryValue(uint32_t addr, MemoryAccessKind accessKind) const {
	switch (accessKind) {
		case MemoryAccessKind::Word:
			return m_memory.readMappedValue(addr);
		case MemoryAccessKind::U8:
			return valueNumber(static_cast<double>(m_memory.readMappedU8(addr)));
		case MemoryAccessKind::U16LE:
			return valueNumber(static_cast<double>(m_memory.readMappedU16LE(addr)));
		case MemoryAccessKind::U32LE:
			return valueNumber(static_cast<double>(m_memory.readMappedU32LE(addr)));
		case MemoryAccessKind::F32LE:
			return valueNumber(static_cast<double>(m_memory.readMappedF32LE(addr)));
		case MemoryAccessKind::F64LE:
			return valueNumber(m_memory.readMappedF64LE(addr));
	}
	throw std::runtime_error("Unknown memory access kind.");
}

void CPU::writeMappedMemoryValue(uint32_t addr, MemoryAccessKind accessKind, const Value& value) {
	switch (accessKind) {
		case MemoryAccessKind::Word:
			m_memory.writeMappedValue(addr, value);
			return;
		case MemoryAccessKind::U8:
			if (!valueIsNumber(value)) {
				throw std::runtime_error("[Memory] mem8[addr] expects a number.");
			}
			m_memory.writeMappedU8(addr, static_cast<u8>(static_cast<uint32_t>(asNumber(value))));
			return;
		case MemoryAccessKind::U16LE:
			if (!valueIsNumber(value)) {
				throw std::runtime_error("[Memory] mem16le[addr] expects a number.");
			}
			m_memory.writeMappedU16LE(addr, static_cast<uint32_t>(asNumber(value)));
			return;
		case MemoryAccessKind::U32LE:
			if (!valueIsNumber(value)) {
				throw std::runtime_error("[Memory] mem32le[addr] expects a number.");
			}
			m_memory.writeMappedU32LE(addr, static_cast<uint32_t>(asNumber(value)));
			return;
		case MemoryAccessKind::F32LE:
			if (!valueIsNumber(value)) {
				throw std::runtime_error("[Memory] memf32le[addr] expects a number.");
			}
			m_memory.writeMappedF32LE(addr, static_cast<float>(asNumber(value)));
			return;
		case MemoryAccessKind::F64LE:
			if (!valueIsNumber(value)) {
				throw std::runtime_error("[Memory] memf64le[addr] expects a number.");
			}
			m_memory.writeMappedF64LE(addr, asNumber(value));
			return;
	}
	throw std::runtime_error("Unknown memory access kind.");
}

void CPU::writeMappedWordSequence(CallFrame& frame, uint32_t addr, int valueBase, int valueCount) {
	if (valueCount >= 3 && isVdpPacketSequenceWrite(addr, valueCount)) {
		uint32_t cmd = 0;
		uint32_t argWords = 0;
		uint32_t payloadWords = 0;
		if (tryGetVdpPacketPrefixWordCounts(frame.registers, valueBase, cmd, argWords, payloadWords)) {
			if (g_vdpPacketWriteLogRemaining > 0) {
				g_vdpPacketWriteLogRemaining -= 1;
				std::fprintf(
					stderr,
					"[VDP][WRITE] addr=%u cmd=%u argWords=%u payloadWords=%u valueCount=%d\n",
					addr,
					cmd,
					argWords,
					payloadWords,
					valueCount
				);
			}
			const int packetWordCount = 3 + static_cast<int>(argWords) + static_cast<int>(payloadWords);
			if (valueCount > packetWordCount) {
				throw BMSX_RUNTIME_ERROR("[VDP] Packet prefix overflow (" + std::to_string(valueCount) + " > " + std::to_string(packetWordCount) + ").");
			}
			m_memory.writeMappedU32LE(addr, cmd);
			m_memory.writeMappedU32LE(addr + 4u, argWords);
			m_memory.writeMappedU32LE(addr + 8u, payloadWords);
			uint32_t writeAddr = addr + 12u;
			const uint32_t encodedArgWords = std::min<uint32_t>(argWords, static_cast<uint32_t>(valueCount - 3));
			for (uint32_t index = 0; index < encodedArgWords; ++index) {
				const uint32_t raw = encodeVdpPacketArgWord(cmd, static_cast<int>(index), frame.registers[static_cast<size_t>(valueBase + 3 + static_cast<int>(index))]);
				m_memory.writeMappedU32LE(writeAddr, raw);
				writeAddr += 4u;
			}
			const uint32_t encodedPayloadWords = static_cast<uint32_t>(valueCount - 3) - encodedArgWords;
			for (uint32_t index = 0; index < encodedPayloadWords; ++index) {
				const uint32_t raw = encodeVdpPacketU32Word(frame.registers[static_cast<size_t>(valueBase + 3 + static_cast<int>(argWords + index))], "packet payload");
				m_memory.writeMappedU32LE(writeAddr, raw);
				writeAddr += 4u;
			}
			return;
		}
	}
	uint32_t writeAddr = addr;
	for (int offset = 0; offset < valueCount; ++offset) {
		writeMappedMemoryValue(writeAddr, MemoryAccessKind::Word, frame.registers[static_cast<size_t>(valueBase + offset)]);
		writeAddr += 4;
	}
}

const Value& CPU::readRK(CallFrame& frame, uint32_t raw, int bits) {
	int rk = signExtend(raw, bits);
	if (rk < 0) {
		int index = -1 - rk;
		return m_program->constPool[static_cast<size_t>(index)];
	}
	return frame.registers[static_cast<size_t>(rk)];
}

Value CPU::resolveTableIndex(Table* table, const Value& key) {
	Table* current = table;
	for (int depth = 0; depth < 32; depth += 1) {
		Value value = current->get(key);
		if (!isNil(value)) {
			return value;
		}
		Table* metatable = current->getMetatable();
		if (!metatable) {
			return valueNil();
		}
		Value indexerValue = metatable->getStringKey(asStringId(m_indexKey));
		if (!valueIsTable(indexerValue)) {
			return valueNil();
		}
		current = asTable(indexerValue);
	}
	throw BMSX_RUNTIME_ERROR("Metatable __index loop detected.");
}

Value CPU::resolveTableIntegerIndex(Table* table, int index) {
	Table* current = table;
	for (int depth = 0; depth < 32; depth += 1) {
		Value value = current->getInteger(index);
		if (!isNil(value)) {
			return value;
		}
		Table* metatable = current->getMetatable();
		if (!metatable) {
			return valueNil();
		}
		Value indexerValue = metatable->getStringKey(asStringId(m_indexKey));
		if (!valueIsTable(indexerValue)) {
			return valueNil();
		}
		current = asTable(indexerValue);
	}
	throw BMSX_RUNTIME_ERROR("Metatable __index loop detected.");
}

Value CPU::resolveTableFieldIndex(Table* table, StringId key) {
	Table* current = table;
	for (int depth = 0; depth < 32; depth += 1) {
		Value value = current->getStringKey(key);
		if (!isNil(value)) {
			return value;
		}
		Table* metatable = current->getMetatable();
		if (!metatable) {
			return valueNil();
		}
		Value indexerValue = metatable->getStringKey(asStringId(m_indexKey));
		if (!valueIsTable(indexerValue)) {
			return valueNil();
		}
		current = asTable(indexerValue);
	}
	throw BMSX_RUNTIME_ERROR("Metatable __index loop detected.");
}

Value CPU::loadTableIndex(const Value& base, const Value& key) {
	if (valueIsTable(base)) {
		return resolveTableIndex(asTable(base), key);
	}
	if (valueIsString(base)) {
		return m_stringIndexTable ? resolveTableIndex(m_stringIndexTable, key) : valueNil();
	}
	if (valueIsNativeObject(base)) {
		auto* native = asNativeObject(base);
		Value directValue = native->get ? native->get(key) : valueNil();
		if (!isNil(directValue)) {
			return directValue;
		}
		Table* metatable = native->metatable;
		if (metatable) {
			Value indexerValue = metatable->getStringKey(asStringId(m_indexKey));
			if (valueIsTable(indexerValue)) {
				return resolveTableIndex(asTable(indexerValue), key);
			}
		}
		return directValue;
	}
	throw BMSX_RUNTIME_ERROR("Attempted to index field on a non-table value.");
}

Value CPU::loadTableIntegerIndex(const Value& base, int index) {
	if (valueIsTable(base)) {
		return resolveTableIntegerIndex(asTable(base), index);
	}
	if (valueIsString(base)) {
		return m_stringIndexTable ? resolveTableIntegerIndex(m_stringIndexTable, index) : valueNil();
	}
	if (valueIsNativeObject(base)) {
		auto* native = asNativeObject(base);
		Value directValue = native->get ? native->get(valueNumber(static_cast<double>(index))) : valueNil();
		if (!isNil(directValue)) {
			return directValue;
		}
		Table* metatable = native->metatable;
		if (metatable) {
			Value indexerValue = metatable->getStringKey(asStringId(m_indexKey));
			if (valueIsTable(indexerValue)) {
				return resolveTableIntegerIndex(asTable(indexerValue), index);
			}
		}
		return directValue;
	}
	throw BMSX_RUNTIME_ERROR("Attempted to index field on a non-table value.");
}

Value CPU::loadTableFieldIndex(const Value& base, StringId key) {
	if (valueIsTable(base)) {
		return resolveTableFieldIndex(asTable(base), key);
	}
	if (valueIsString(base)) {
		return m_stringIndexTable ? resolveTableFieldIndex(m_stringIndexTable, key) : valueNil();
	}
	if (valueIsNativeObject(base)) {
		auto* native = asNativeObject(base);
		Value directValue = native->get ? native->get(valueString(key)) : valueNil();
		if (!isNil(directValue)) {
			return directValue;
		}
		Table* metatable = native->metatable;
		if (metatable) {
			Value indexerValue = metatable->getStringKey(asStringId(m_indexKey));
			if (valueIsTable(indexerValue)) {
				return resolveTableFieldIndex(asTable(indexerValue), key);
			}
		}
		return directValue;
	}
	throw BMSX_RUNTIME_ERROR("Attempted to index field on a non-table value.");
}

void CPU::storeTableIndex(const Value& base, const Value& key, const Value& value) {
	if (valueIsTable(base)) {
		asTable(base)->set(key, value);
		return;
	}
	if (valueIsNativeObject(base)) {
		asNativeObject(base)->set(key, value);
		return;
	}
	throw BMSX_RUNTIME_ERROR("Attempted to assign to a non-table value.");
}

void CPU::storeTableIntegerIndex(const Value& base, int index, const Value& value) {
	if (valueIsTable(base)) {
		asTable(base)->setInteger(index, value);
		return;
	}
	if (valueIsNativeObject(base)) {
		asNativeObject(base)->set(valueNumber(static_cast<double>(index)), value);
		return;
	}
	throw BMSX_RUNTIME_ERROR("Attempted to assign to a non-table value.");
}

void CPU::storeTableFieldIndex(const Value& base, StringId key, const Value& value) {
	if (valueIsTable(base)) {
		asTable(base)->setStringKey(key, value);
		return;
	}
	if (valueIsNativeObject(base)) {
		asNativeObject(base)->set(valueString(key), value);
		return;
	}
	throw BMSX_RUNTIME_ERROR("Attempted to assign to a non-table value.");
}

std::unique_ptr<CallFrame> CPU::acquireFrame() {
	if (!m_framePool.empty()) {
		auto frame = std::move(m_framePool.back());
		m_framePool.pop_back();
		return frame;
	}
	return std::make_unique<CallFrame>();
}

void CPU::releaseFrame(std::unique_ptr<CallFrame> frame) {
	releaseRegisters(std::move(frame->registers));
	frame->varargs.clear();
	frame->openUpvalues.clear();
	if (m_framePool.size() < static_cast<size_t>(MAX_POOLED_FRAMES)) {
		m_framePool.push_back(std::move(frame));
	}
}

std::vector<Value> CPU::acquireRegisters(size_t size) {
	size_t bucket = 8;
	while (bucket < size) {
		bucket <<= 1;
	}
	auto& pool = m_registerPool[bucket];
	if (!pool.empty()) {
		std::vector<Value> regs = std::move(pool.back());
		pool.pop_back();
		for (size_t i = 0; i < size; ++i) {
			regs[i] = valueNil();
		}
		return regs;
	}
	std::vector<Value> regs(bucket, valueNil());
	return regs;
}

void CPU::releaseRegisters(std::vector<Value>&& regs) {
	size_t bucket = regs.size();
	if (bucket > MAX_REGISTER_ARRAY_SIZE) {
		return;
	}
	auto& pool = m_registerPool[bucket];
	if (pool.size() < MAX_POOLED_REGISTER_ARRAYS) {
		pool.push_back(std::move(regs));
	}
}

std::vector<Value> CPU::acquireNativeReturnScratch() {
	if (!m_nativeReturnPool.empty()) {
		std::vector<Value> out = std::move(m_nativeReturnPool.back());
		m_nativeReturnPool.pop_back();
		out.clear();
		return out;
	}
	return {};
}

void CPU::releaseNativeReturnScratch(std::vector<Value>&& out) {
	if (m_nativeReturnPool.size() < MAX_POOLED_NATIVE_RETURN_ARRAYS) {
		m_nativeReturnPool.push_back(std::move(out));
	}
}

std::vector<Value> CPU::acquireArgScratch() {
	if (!m_nativeArgPool.empty()) {
		std::vector<Value> args = std::move(m_nativeArgPool.back());
		m_nativeArgPool.pop_back();
		args.clear();
		return args;
	}
	return {};
}

void CPU::releaseArgScratch(std::vector<Value>&& args) {
	if (m_nativeArgPool.size() < MAX_POOLED_NATIVE_ARG_ARRAYS) {
		m_nativeArgPool.push_back(std::move(args));
	}
}

void CPU::markRoots(GcHeap& heap) {
	if (globals) {
		heap.markObject(globals);
	}
	if (m_stringIndexTable) {
		heap.markObject(m_stringIndexTable);
	}
	for (const auto& value : m_memory.ioSlots()) {
		heap.markValue(value);
	}
	for (const auto& value : lastReturnValues) {
		heap.markValue(value);
	}
	for (const auto& value : m_returnScratch) {
		heap.markValue(value);
	}
	for (const auto& value : m_systemGlobalValues) {
		heap.markValue(value);
	}
	for (const auto& value : m_globalValues) {
		heap.markValue(value);
	}
	if (m_program) {
		for (const auto& value : m_program->constPool) {
			heap.markValue(value);
		}
	}
	for (const auto& framePtr : m_frames) {
		CallFrame* frame = framePtr.get();
		heap.markObject(frame->closure);
		for (int i = 0; i < frame->top; ++i) {
			heap.markValue(frame->registers[static_cast<size_t>(i)]);
		}
		for (const auto& value : frame->varargs) {
			heap.markValue(value);
		}
		for (const auto& entry : frame->openUpvalues) {
			heap.markObject(entry.second);
			heap.markValue(frame->registers[static_cast<size_t>(entry.first)]);
		}
	}
	m_externalRootMarker(heap);
}

} // namespace bmsx

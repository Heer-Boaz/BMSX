#include "program_loader.h"
#include <cstring>
#include <iostream>
#include <stdexcept>
#include <unordered_map>

namespace bmsx {

// Binary encoder tags (must match binencoder.ts)
enum class Tag : uint8_t {
	Null = 0,
	True = 1,
	False = 2,
	F64 = 3,
	Str = 4,
	Arr = 5,
	Ref = 6,
	Obj = 7,
	Bin = 8,
	Int = 9,
	F32 = 10,
	Set = 11,
};

constexpr uint8_t BINENCODER_VERSION = 0xA1;

/**
 * BinaryReader - helper for reading binary-encoded data.
 */
class BinaryReader {
public:
	BinaryReader(const uint8_t* data, size_t size)
		: m_data(data)
		, m_size(size)
		, m_pos(0)
	{}

	bool hasMore() const { return m_pos < m_size; }
	size_t position() const { return m_pos; }
	size_t remaining() const { return m_size - m_pos; }

	void need(size_t n) {
		if (m_pos + n > m_size) {
			throw std::runtime_error("BinaryReader: truncated data");
		}
	}

	uint8_t readU8() {
		need(1);
		return m_data[m_pos++];
	}

	uint32_t readVarUint() {
		uint32_t val = 0;
		int shift = 0;
		int i = 0;
		uint8_t b;
		do {
			if (m_pos >= m_size) {
				throw std::runtime_error("BinaryReader: truncated varuint");
			}
			b = m_data[m_pos++];
			val |= (static_cast<uint32_t>(b & 0x7F)) << shift;
			shift += 7;
			if (++i > 5) {
				throw std::runtime_error("BinaryReader: varuint overflow");
			}
		} while (b & 0x80);
		return val;
	}

	int32_t readVarIntSigned() {
		uint32_t zz = 0;
		int shift = 0;
		int i = 0;
		uint8_t b;
		do {
			if (m_pos >= m_size) {
				throw std::runtime_error("BinaryReader: truncated varint");
			}
			b = m_data[m_pos++];
			zz |= (static_cast<uint32_t>(b & 0x7F)) << shift;
			shift += 7;
			if (++i > 5) {
				throw std::runtime_error("BinaryReader: varint overflow");
			}
		} while (b & 0x80);
		// ZigZag decode
		return static_cast<int32_t>((zz >> 1) ^ -(static_cast<int32_t>(zz & 1)));
	}

	double readF64() {
		need(8);
		double val;
		// Little-endian
		std::memcpy(&val, m_data + m_pos, 8);
		m_pos += 8;
		return val;
	}

	float readF32() {
		need(4);
		float val;
		std::memcpy(&val, m_data + m_pos, 4);
		m_pos += 4;
		return val;
	}

	std::string readString() {
		uint32_t len = readVarUint();
		need(len);
		std::string result(reinterpret_cast<const char*>(m_data + m_pos), len);
		m_pos += len;
		return result;
	}

	std::vector<uint8_t> readBinary() {
		uint32_t len = readVarUint();
		need(len);
		std::vector<uint8_t> result(m_data + m_pos, m_data + m_pos + len);
		m_pos += len;
		return result;
	}

	void skip(size_t n) {
		need(n);
		m_pos += n;
	}

private:
	const uint8_t* m_data;
	size_t m_size;
	size_t m_pos;
};

/**
 * BinValue - variant type for decoded binary values.
 */
struct BinValue;

using BinArray = std::vector<BinValue>;
using BinObject = std::unordered_map<std::string, BinValue>;

struct BinValue {
	enum class Type {
		Null,
		Bool,
		Number,
		String,
		Array,
		Object,
		Binary,
	};

	Type type = Type::Null;
	bool boolVal = false;
	double numberVal = 0.0;
	std::string stringVal;
	std::shared_ptr<BinArray> arrayVal;
	std::shared_ptr<BinObject> objectVal;
	std::vector<uint8_t> binaryVal;

	BinValue() = default;

	static BinValue makeNull() {
		BinValue v;
		v.type = Type::Null;
		return v;
	}

	static BinValue makeBool(bool val) {
		BinValue v;
		v.type = Type::Bool;
		v.boolVal = val;
		return v;
	}

	static BinValue makeNumber(double val) {
		BinValue v;
		v.type = Type::Number;
		v.numberVal = val;
		return v;
	}

	static BinValue makeString(std::string val) {
		BinValue v;
		v.type = Type::String;
		v.stringVal = std::move(val);
		return v;
	}

	static BinValue makeArray(std::shared_ptr<BinArray> val) {
		BinValue v;
		v.type = Type::Array;
		v.arrayVal = std::move(val);
		return v;
	}

	static BinValue makeObject(std::shared_ptr<BinObject> val) {
		BinValue v;
		v.type = Type::Object;
		v.objectVal = std::move(val);
		return v;
	}

	static BinValue makeBinary(std::vector<uint8_t> val) {
		BinValue v;
		v.type = Type::Binary;
		v.binaryVal = std::move(val);
		return v;
	}

	// Accessors
	bool isNull() const { return type == Type::Null; }
	bool isBool() const { return type == Type::Bool; }
	bool isNumber() const { return type == Type::Number; }
	bool isString() const { return type == Type::String; }
	bool isArray() const { return type == Type::Array; }
	bool isObject() const { return type == Type::Object; }
	bool isBinary() const { return type == Type::Binary; }

	bool asBool() const { return boolVal; }
	double asNumber() const { return numberVal; }
	int asInt() const { return static_cast<int>(numberVal); }
	const std::string& asString() const { return stringVal; }
	const BinArray& asArray() const { return *arrayVal; }
	const BinObject& asObject() const { return *objectVal; }
	const std::vector<uint8_t>& asBinary() const { return binaryVal; }

	// Object field access
	const BinValue& get(const std::string& key) const {
		static BinValue nullVal;
		if (!isObject()) return nullVal;
		auto it = objectVal->find(key);
		return (it != objectVal->end()) ? it->second : nullVal;
	}

	bool has(const std::string& key) const {
		return isObject() && objectVal->find(key) != objectVal->end();
	}
};

/**
 * Decode binary format recursively.
 */
class BinDecoder {
public:
	BinDecoder(BinaryReader& reader, const std::vector<std::string>& propNames)
		: m_reader(reader)
		, m_propNames(propNames)
		, m_depth(0)
	{}

	BinValue decode() {
		if (++m_depth > MAX_DEPTH) {
			throw std::runtime_error("BinDecoder: nesting too deep");
		}

		auto tag = static_cast<Tag>(m_reader.readU8());
		std::cerr << "[BinDecoder] depth=" << m_depth << " tag=" << (int)tag << std::endl;
		BinValue result;

		switch (tag) {
			case Tag::Null:
				result = BinValue::makeNull();
				break;

			case Tag::True:
				result = BinValue::makeBool(true);
				break;

			case Tag::False:
				result = BinValue::makeBool(false);
				break;

			case Tag::F64:
				result = BinValue::makeNumber(m_reader.readF64());
				break;

			case Tag::F32:
				result = BinValue::makeNumber(m_reader.readF32());
				break;

			case Tag::Int:
				result = BinValue::makeNumber(static_cast<double>(m_reader.readVarIntSigned()));
				break;

			case Tag::Str:
				result = BinValue::makeString(m_reader.readString());
				break;

			case Tag::Arr: {
				uint32_t len = m_reader.readVarUint();
				auto arr = std::make_shared<BinArray>();
				arr->reserve(len);
				for (uint32_t i = 0; i < len; ++i) {
					arr->push_back(decode());
				}
				result = BinValue::makeArray(std::move(arr));
				break;
			}

			case Tag::Obj: {
				uint32_t len = m_reader.readVarUint();
				auto obj = std::make_shared<BinObject>();
				for (uint32_t i = 0; i < len; ++i) {
					uint32_t propId = m_reader.readVarUint();
					if (propId >= m_propNames.size()) {
						throw std::runtime_error("BinDecoder: invalid property id");
					}
					const std::string& key = m_propNames[propId];
					(*obj)[key] = decode();
				}
				result = BinValue::makeObject(std::move(obj));
				break;
			}

			case Tag::Bin:
				result = BinValue::makeBinary(m_reader.readBinary());
				break;

			case Tag::Ref:
				// Reference types not used in program asset
				m_reader.readVarUint();
				result = BinValue::makeNull();
				break;

			case Tag::Set:
				// Sets not used in program asset, decode as array
				{
					uint32_t len = m_reader.readVarUint();
					auto arr = std::make_shared<BinArray>();
					arr->reserve(len);
					for (uint32_t i = 0; i < len; ++i) {
						arr->push_back(decode());
					}
					result = BinValue::makeArray(std::move(arr));
				}
				break;

			default:
				throw std::runtime_error("BinDecoder: unknown tag");
		}

		--m_depth;
		return result;
	}

private:
	static constexpr int MAX_DEPTH = 1000;

	BinaryReader& m_reader;
	const std::vector<std::string>& m_propNames;
	int m_depth;
};

/**
 * Decode binary-encoded data (matches TypeScript decodeBinary).
 */
BinValue decodeBinaryFormat(const uint8_t* data, size_t size) {
	std::cerr << "[decodeBinaryFormat] size=" << size << std::endl;
	BinaryReader reader(data, size);

	// Check version
	uint8_t version = reader.readU8();
	std::cerr << "[decodeBinaryFormat] version=0x" << std::hex << (int)version << std::dec << " (expected 0x" << std::hex << (int)BINENCODER_VERSION << std::dec << ")" << std::endl;
	if (version != BINENCODER_VERSION) {
		throw std::runtime_error("decodeBinaryFormat: version mismatch");
	}

	// Read property name table
	uint32_t propCount = reader.readVarUint();
	std::cerr << "[decodeBinaryFormat] propCount=" << propCount << std::endl;
	std::vector<std::string> propNames;
	propNames.reserve(propCount);
	for (uint32_t i = 0; i < propCount; ++i) {
		propNames.push_back(reader.readString());
	}
	std::cerr << "[decodeBinaryFormat] property names read" << std::endl;

	// Decode root value
	BinDecoder decoder(reader, propNames);
	std::cerr << "[decodeBinaryFormat] decoding root value..." << std::endl;
	BinValue root = decoder.decode();
	std::cerr << "[decodeBinaryFormat] root decoded" << std::endl;

	// Verify all data consumed
	if (reader.hasMore()) {
		throw std::runtime_error("decodeBinaryFormat: trailing bytes");
	}

	return root;
}

/**
 * Convert BinValue to VM Value (for const pool).
 */
Value binValueToVmValue(const BinValue& bv) {
	switch (bv.type) {
		case BinValue::Type::Null:
			return std::monostate{};
		case BinValue::Type::Bool:
			return bv.asBool();
		case BinValue::Type::Number:
			return bv.asNumber();
		case BinValue::Type::String:
			return bv.asString();
		default:
			// Tables/closures not in const pool
			return std::monostate{};
	}
}

/**
 * Extract Program from decoded VmProgramAsset.
 */
std::unique_ptr<Program> extractProgram(const BinValue& programObj) {
	auto program = std::make_unique<Program>();

	// Extract code (Uint32Array stored as binary)
	const auto& codeBytes = programObj.get("code").asBinary();
	size_t codeLen = codeBytes.size() / 4;
	program->code.resize(codeLen);
	std::memcpy(program->code.data(), codeBytes.data(), codeBytes.size());

	// Extract constPool
	const auto& constPoolArr = programObj.get("constPool").asArray();
	program->constPool.reserve(constPoolArr.size());
	for (const auto& cv : constPoolArr) {
		program->constPool.push_back(binValueToVmValue(cv));
	}

	// Extract protos
	const auto& protosArr = programObj.get("protos").asArray();
	program->protos.reserve(protosArr.size());
	for (const auto& protoObj : protosArr) {
		Proto proto;
		proto.maxStack = protoObj.get("maxStack").asInt();
		proto.numParams = protoObj.get("numParams").asInt();
		proto.entryPC = protoObj.get("entryPC").asInt();
		proto.isVararg = protoObj.get("isVararg").asBool();

		// Upvalues
		const auto& upvaluesArr = protoObj.get("upvalues").asArray();
		proto.upvalues.reserve(upvaluesArr.size());
		for (const auto& uvObj : upvaluesArr) {
			UpvalueDesc uv;
			uv.isLocal = uvObj.get("isLocal").asBool();
			uv.index = uvObj.get("index").asInt();
			proto.upvalues.push_back(uv);
		}

		program->protos.push_back(std::move(proto));
	}

	// Extract protoIds
	const auto& protoIdsArr = programObj.get("protoIds").asArray();
	program->protoIds.reserve(protoIdsArr.size());
	for (const auto& idVal : protoIdsArr) {
		program->protoIds.push_back(idVal.asString());
	}

	// Extract debugRanges (optional)
	if (programObj.has("debugRanges")) {
		const auto& rangesArr = programObj.get("debugRanges").asArray();
		program->debugRanges.reserve(rangesArr.size());
		for (const auto& rangeVal : rangesArr) {
			if (rangeVal.isNull()) {
				program->debugRanges.push_back(std::nullopt);
			} else {
				SourceRange range;
				range.path = rangeVal.get("path").asString();
				const auto& startObj = rangeVal.get("start");
				const auto& endObj = rangeVal.get("end");
				range.startLine = startObj.get("line").asInt();
				range.startColumn = startObj.get("column").asInt();
				range.endLine = endObj.get("line").asInt();
				range.endColumn = endObj.get("column").asInt();
				program->debugRanges.push_back(range);
			}
		}
	}

	return program;
}

std::unique_ptr<VmProgramAsset> ProgramLoader::load(const uint8_t* data, size_t size) {
	std::cerr << "[ProgramLoader] Starting load of " << size << " bytes" << std::endl;

	// Decode binary format
	std::cerr << "[ProgramLoader] Decoding binary format..." << std::endl;
	BinValue root = decodeBinaryFormat(data, size);
	std::cerr << "[ProgramLoader] Binary format decoded" << std::endl;

	if (!root.isObject()) {
		throw std::runtime_error("ProgramLoader: expected object at root");
	}

	auto asset = std::make_unique<VmProgramAsset>();
	std::cerr << "[ProgramLoader] Extracting entryProtoIndex..." << std::endl;

	// Extract entryProtoIndex
	asset->entryProtoIndex = root.get("entryProtoIndex").asInt();
	std::cerr << "[ProgramLoader] entryProtoIndex = " << asset->entryProtoIndex << std::endl;

	// Extract program
	std::cerr << "[ProgramLoader] Extracting program..." << std::endl;
	asset->program = extractProgram(root.get("program"));
	std::cerr << "[ProgramLoader] Program extracted" << std::endl;

	// Extract moduleProtos
	std::cerr << "[ProgramLoader] Extracting moduleProtos..." << std::endl;
	const auto& moduleProtosArr = root.get("moduleProtos").asArray();
	asset->moduleProtos.reserve(moduleProtosArr.size());
	for (const auto& mp : moduleProtosArr) {
		std::string path = mp.get("path").asString();
		int protoIndex = mp.get("protoIndex").asInt();
		asset->moduleProtos.emplace_back(std::move(path), protoIndex);
	}

	// Extract moduleAliases
	const auto& moduleAliasesArr = root.get("moduleAliases").asArray();
	asset->moduleAliases.reserve(moduleAliasesArr.size());
	for (const auto& ma : moduleAliasesArr) {
		std::string alias = ma.get("alias").asString();
		std::string path = ma.get("path").asString();
		asset->moduleAliases.emplace_back(std::move(alias), std::move(path));
	}

	return asset;
}

} // namespace bmsx

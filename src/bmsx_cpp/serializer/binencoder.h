/*
 * binencoder.h - Binary encoder/decoder for ROM assets
 *
 * Mirrors TypeScript binencoder.ts format.
 * Used for decoding ROM metadata blobs.
 */

#ifndef BMSX_BINENCODER_H
#define BMSX_BINENCODER_H

#include "../core/types.h"
#include <memory>
#include <string>
#include <vector>
#include <variant>
#include <unordered_map>
#include <optional>

namespace bmsx {

/* ============================================================================
 * Binary encoding format version
 * ============================================================================ */

constexpr u8 BINENC_VERSION = 0xA1;

/* ============================================================================
 * Type tags (matches TypeScript Tag enum)
 * ============================================================================ */

enum class BinTag : u8 {
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

/* ============================================================================
 * Decoded value types
 * ============================================================================ */

struct BinValue;

using BinArray = std::vector<BinValue>;
using BinObject = std::unordered_map<std::string, BinValue>;
using BinBinary = std::vector<u8>;
using BinObjectStorage = std::shared_ptr<BinObject>;

// Variant holding all possible decoded types
struct BinValue {
	std::variant<
		std::nullptr_t,     // Null
		bool,               // True/False
		i64,                // Int
		f32,                // F32
		f64,                // F64
		std::string,        // Str
		BinArray,           // Arr
		BinObjectStorage,   // Obj
		BinBinary           // Bin
	> data;

	BinValue() : data(nullptr) {}
	BinValue(std::nullptr_t) : data(nullptr) {}
	BinValue(bool v) : data(v) {}
	BinValue(i64 v) : data(v) {}
	BinValue(i32 v) : data(static_cast<i64>(v)) {}
	BinValue(f32 v) : data(v) {}
	BinValue(f64 v) : data(v) {}
	BinValue(const std::string& v) : data(v) {}
	BinValue(std::string&& v) : data(std::move(v)) {}
	BinValue(const char* v) : data(std::string(v)) {}
	BinValue(BinArray&& v) : data(std::move(v)) {}
	BinValue(BinObject&& v) : data(std::make_shared<BinObject>(std::move(v))) {}
	BinValue(BinBinary&& v) : data(std::move(v)) {}

	// Type checks
	bool isNull() const { return std::holds_alternative<std::nullptr_t>(data); }
	bool isBool() const { return std::holds_alternative<bool>(data); }
	bool isInt() const { return std::holds_alternative<i64>(data); }
	bool isF32() const { return std::holds_alternative<f32>(data); }
	bool isF64() const { return std::holds_alternative<f64>(data); }
	bool isNumber() const { return isInt() || isF32() || isF64(); }
	bool isString() const { return std::holds_alternative<std::string>(data); }
	bool isArray() const { return std::holds_alternative<BinArray>(data); }
	bool isObject() const { return std::holds_alternative<BinObjectStorage>(data); }
	bool isBinary() const { return std::holds_alternative<BinBinary>(data); }

	// Value accessors (throw if wrong type)
	bool asBool() const { return std::get<bool>(data); }
	i64 asInt() const { return std::get<i64>(data); }
	f32 asF32() const { return std::get<f32>(data); }
	f64 asF64() const { return std::get<f64>(data); }
	const std::string& asString() const { return std::get<std::string>(data); }
	const BinArray& asArray() const { return std::get<BinArray>(data); }
	const BinObject& asObject() const { return *std::get<BinObjectStorage>(data); }
	const BinBinary& asBinary() const { return std::get<BinBinary>(data); }

	// Number conversion (works for int, f32, f64)
	f64 toNumber() const;
	i32 toI32() const;

	// Object field access (returns null BinValue if not found)
	const BinValue& operator[](const std::string& key) const;
	const BinValue& operator[](size_t index) const;

	// Check if object has key
	bool has(const std::string& key) const;
	const BinValue& require(const std::string& key) const;
};

/* ============================================================================
 * Binary decoder
 * ============================================================================ */

class BinDecoder {
public:
	BinDecoder(const u8* data, size_t size);

	// Decode entire buffer
	BinValue decode();

private:
	// Primitives
	u8 readU8();
	u32 readVarUint();
	i64 readVarInt();
	f32 readF32();
	f64 readF64();
	std::string readString();

	// Value reading
	BinValue readValue();

	const u8* m_data;
	size_t m_size;
	size_t m_pos = 0;

	// Property name table (interned strings)
	std::vector<std::string> m_propNames;
};

/* ============================================================================
 * Convenience functions
 * ============================================================================ */

// Decode a binary buffer
BinValue decodeBinary(const u8* data, size_t size);
BinValue decodeBinary(const std::vector<u8>& data);

} // namespace bmsx

#endif // BMSX_BINENCODER_H

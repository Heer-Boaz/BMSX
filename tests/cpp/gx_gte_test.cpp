#include "machine/devices/gx/gte.h"
#include "machine/bus/io.h"
#include "machine/cpu/cpu.h"
#include "machine/memory/memory.h"

#include <array>
#include <cstdint>
#include <stdexcept>

namespace {

constexpr uint32_t GTE_SF = 1u << 19u;


struct GteHarness {
	std::array<uint8_t, 1> emptyRom{{0}};
	bmsx::Memory memory;
	bmsx::GxGte gte;

	GteHarness()
		: memory(bmsx::MemoryInit{ { emptyRom.data(), 0u }, { emptyRom.data(), 0u } })
		, gte(memory) {
	}
};

uint32_t pack16(uint32_t low, uint32_t high) {
	return (low & 0xffffu) | ((high & 0xffffu) << 16u);
}

uint32_t packRgb(uint32_t r, uint32_t g, uint32_t b, uint32_t code) {
	return r | (g << 8u) | (b << 16u) | (code << 24u);
}

void require(bool condition, const char* message) {
	if (!condition) {
		throw std::runtime_error(message);
	}
}

void setupIdentityProjection(bmsx::GxGte& gte) {
	gte.writeControlRegister(0u, pack16(0x1000u, 0u));
	gte.writeControlRegister(1u, pack16(0u, 0u));
	gte.writeControlRegister(2u, pack16(0x1000u, 0u));
	gte.writeControlRegister(3u, pack16(0u, 0u));
	gte.writeControlRegister(4u, 0x1000u);
	gte.writeControlRegister(24u, 160u << 16u);
	gte.writeControlRegister(25u, 120u << 16u);
	gte.writeControlRegister(26u, 256u);
}

void testRtpsIdentityProjection() {
	GteHarness harness;
	bmsx::GxGte& gte = harness.gte;
	setupIdentityProjection(gte);
	gte.writeDataRegister(0u, pack16(1u, 2u));
	gte.writeDataRegister(1u, 256u);

	require(gte.execute(GTE_SF | bmsx::GX_GTE_FN_RTPS) == bmsx::GX_GTE_CYCLES_RTPS, "RTPS cycles");

	require(gte.readDataRegister(9u) == 1u, "RTPS IR1");
	require(gte.readDataRegister(10u) == 2u, "RTPS IR2");
	require(gte.readDataRegister(11u) == 256u, "RTPS IR3");
	require(gte.readDataRegister(19u) == 256u, "RTPS SZ3");
	require(gte.readDataRegister(14u) == pack16(161u, 122u), "RTPS SXY2");
	require(gte.readControlRegister(31u) == 0u, "RTPS FLAG");
}


void testMmioExecution() {
	GteHarness harness;
	bmsx::Memory& memory = harness.memory;
	memory.writeMappedU32LE(bmsx::IO_GX_GTE_CONTROL0 + 0u * bmsx::IO_WORD_SIZE, pack16(0x1000u, 0u));
	memory.writeMappedU32LE(bmsx::IO_GX_GTE_CONTROL0 + 1u * bmsx::IO_WORD_SIZE, pack16(0u, 0u));
	memory.writeMappedU32LE(bmsx::IO_GX_GTE_CONTROL0 + 2u * bmsx::IO_WORD_SIZE, pack16(0x1000u, 0u));
	memory.writeMappedU32LE(bmsx::IO_GX_GTE_CONTROL0 + 3u * bmsx::IO_WORD_SIZE, pack16(0u, 0u));
	memory.writeMappedU32LE(bmsx::IO_GX_GTE_CONTROL0 + 4u * bmsx::IO_WORD_SIZE, 0x1000u);
	memory.writeMappedU32LE(bmsx::IO_GX_GTE_CONTROL0 + 24u * bmsx::IO_WORD_SIZE, 160u << 16u);
	memory.writeMappedU32LE(bmsx::IO_GX_GTE_CONTROL0 + 25u * bmsx::IO_WORD_SIZE, 120u << 16u);
	memory.writeMappedU32LE(bmsx::IO_GX_GTE_CONTROL0 + 26u * bmsx::IO_WORD_SIZE, 256u);
	memory.writeMappedU32LE(bmsx::IO_GX_GTE_DATA0 + 0u * bmsx::IO_WORD_SIZE, pack16(1u, 2u));
	memory.writeMappedU32LE(bmsx::IO_GX_GTE_DATA0 + 1u * bmsx::IO_WORD_SIZE, 256u);

	memory.writeMappedU32LE(bmsx::IO_GX_GTE_COMMAND, GTE_SF | bmsx::GX_GTE_FN_RTPS);

	require(memory.readMappedU32LE(bmsx::IO_GX_GTE_CYCLES) == bmsx::GX_GTE_CYCLES_RTPS, "MMIO GTE cycles");
	require(memory.readMappedU32LE(bmsx::IO_GX_GTE_DATA0 + 9u * bmsx::IO_WORD_SIZE) == 1u, "MMIO GTE IR1");
	require(memory.readMappedU32LE(bmsx::IO_GX_GTE_DATA0 + 10u * bmsx::IO_WORD_SIZE) == 2u, "MMIO GTE IR2");
	require(memory.readMappedU32LE(bmsx::IO_GX_GTE_DATA0 + 11u * bmsx::IO_WORD_SIZE) == 256u, "MMIO GTE IR3");
	require(memory.readMappedU32LE(bmsx::IO_GX_GTE_DATA0 + 14u * bmsx::IO_WORD_SIZE) == pack16(161u, 122u), "MMIO GTE SXY2");
	require(memory.readMappedU32LE(bmsx::IO_GX_GTE_CONTROL0 + 31u * bmsx::IO_WORD_SIZE) == 0u, "MMIO GTE FLAG");
}

void testNclip() {
	GteHarness harness;
	bmsx::GxGte& gte = harness.gte;
	gte.writeDataRegister(12u, pack16(0u, 0u));
	gte.writeDataRegister(13u, pack16(10u, 0u));
	gte.writeDataRegister(14u, pack16(0u, 10u));

	require(gte.execute(bmsx::GX_GTE_FN_NCLIP) == bmsx::GX_GTE_CYCLES_NCLIP, "NCLIP cycles");

	require(gte.readDataRegister(24u) == 100u, "NCLIP MAC0");
	require(gte.readControlRegister(31u) == 0u, "NCLIP FLAG");
}


void testOp() {
	GteHarness harness;
	bmsx::GxGte& gte = harness.gte;
	gte.writeControlRegister(0u, pack16(2u, 0u));
	gte.writeControlRegister(2u, pack16(3u, 0u));
	gte.writeControlRegister(4u, 4u);
	gte.writeDataRegister(9u, 5u);
	gte.writeDataRegister(10u, 7u);
	gte.writeDataRegister(11u, 11u);

	require(gte.execute(bmsx::GX_GTE_FN_OP) == bmsx::GX_GTE_CYCLES_OP, "OP cycles");

	require(gte.readDataRegister(9u) == 5u, "OP IR1");
	require(gte.readDataRegister(10u) == 0xfffffffeu, "OP IR2");
	require(gte.readDataRegister(11u) == 0xffffffffu, "OP IR3");
	require(gte.readDataRegister(25u) == 5u, "OP MAC1");
	require(gte.readDataRegister(26u) == 0xfffffffeu, "OP MAC2");
	require(gte.readDataRegister(27u) == 0xffffffffu, "OP MAC3");
	require(gte.readControlRegister(31u) == 0u, "OP FLAG");
}

void testMvmva() {
	GteHarness harness;
	bmsx::GxGte& gte = harness.gte;
	gte.writeControlRegister(0u, pack16(0x1000u, 0u));
	gte.writeControlRegister(1u, pack16(0u, 0u));
	gte.writeControlRegister(2u, pack16(0x1000u, 0u));
	gte.writeControlRegister(3u, pack16(0u, 0u));
	gte.writeControlRegister(4u, 0x1000u);
	gte.writeControlRegister(5u, 10u);
	gte.writeControlRegister(6u, 20u);
	gte.writeControlRegister(7u, 30u);
	gte.writeDataRegister(0u, pack16(1u, 2u));
	gte.writeDataRegister(1u, 3u);

	require(gte.execute(GTE_SF | (3u << 13u) | bmsx::GX_GTE_FN_MVMVA) == bmsx::GX_GTE_CYCLES_MVMVA, "MVMVA no-translation cycles");
	require(gte.readDataRegister(9u) == 1u, "MVMVA no-translation IR1");
	require(gte.readDataRegister(10u) == 2u, "MVMVA no-translation IR2");
	require(gte.readDataRegister(11u) == 3u, "MVMVA no-translation IR3");

	require(gte.execute(GTE_SF | bmsx::GX_GTE_FN_MVMVA) == bmsx::GX_GTE_CYCLES_MVMVA, "MVMVA translation cycles");
	require(gte.readDataRegister(9u) == 11u, "MVMVA translation IR1");
	require(gte.readDataRegister(10u) == 22u, "MVMVA translation IR2");
	require(gte.readDataRegister(11u) == 33u, "MVMVA translation IR3");
	require(gte.readControlRegister(31u) == 0u, "MVMVA FLAG");
}

void testSqr() {
	GteHarness harness;
	bmsx::GxGte& gte = harness.gte;
	gte.writeDataRegister(9u, 3u);
	gte.writeDataRegister(10u, 0xfffcu);
	gte.writeDataRegister(11u, 5u);

	require(gte.execute(bmsx::GX_GTE_FN_SQR) == bmsx::GX_GTE_CYCLES_SQR, "SQR cycles");

	require(gte.readDataRegister(9u) == 9u, "SQR IR1");
	require(gte.readDataRegister(10u) == 16u, "SQR IR2");
	require(gte.readDataRegister(11u) == 25u, "SQR IR3");
	require(gte.readControlRegister(31u) == 0u, "SQR FLAG");
}

void testDpcs() {
	GteHarness harness;
	bmsx::GxGte& gte = harness.gte;
	gte.writeDataRegister(6u, packRgb(10u, 20u, 30u, 0x44u));

	require(gte.execute(GTE_SF | bmsx::GX_GTE_FN_DPCS) == bmsx::GX_GTE_CYCLES_DPCS, "DPCS cycles");

	require(gte.readDataRegister(9u) == 160u, "DPCS IR1");
	require(gte.readDataRegister(10u) == 320u, "DPCS IR2");
	require(gte.readDataRegister(11u) == 480u, "DPCS IR3");
	require(gte.readDataRegister(25u) == 160u, "DPCS MAC1");
	require(gte.readDataRegister(26u) == 320u, "DPCS MAC2");
	require(gte.readDataRegister(27u) == 480u, "DPCS MAC3");
	require(gte.readDataRegister(22u) == packRgb(10u, 20u, 30u, 0x44u), "DPCS RGB2");
	require(gte.readControlRegister(31u) == 0u, "DPCS FLAG");
}

void testIntpl() {
	GteHarness harness;
	bmsx::GxGte& gte = harness.gte;
	gte.writeDataRegister(6u, packRgb(0u, 0u, 0u, 0x55u));
	gte.writeDataRegister(9u, 100u);
	gte.writeDataRegister(10u, 200u);
	gte.writeDataRegister(11u, 300u);

	require(gte.execute(GTE_SF | bmsx::GX_GTE_FN_INTPL) == bmsx::GX_GTE_CYCLES_INTPL, "INTPL cycles");

	require(gte.readDataRegister(9u) == 100u, "INTPL IR1");
	require(gte.readDataRegister(10u) == 200u, "INTPL IR2");
	require(gte.readDataRegister(11u) == 300u, "INTPL IR3");
	require(gte.readDataRegister(22u) == packRgb(6u, 12u, 18u, 0x55u), "INTPL RGB2");
	require(gte.readControlRegister(31u) == 0u, "INTPL FLAG");
}

void testDcpl() {
	GteHarness harness;
	bmsx::GxGte& gte = harness.gte;
	gte.writeDataRegister(6u, packRgb(2u, 3u, 4u, 0x66u));
	gte.writeDataRegister(9u, 10u);
	gte.writeDataRegister(10u, 20u);
	gte.writeDataRegister(11u, 30u);

	require(gte.execute(bmsx::GX_GTE_FN_DCPL) == bmsx::GX_GTE_CYCLES_DCPL, "DCPL cycles");

	require(gte.readDataRegister(9u) == 320u, "DCPL IR1");
	require(gte.readDataRegister(10u) == 960u, "DCPL IR2");
	require(gte.readDataRegister(11u) == 1920u, "DCPL IR3");
	require(gte.readDataRegister(22u) == packRgb(20u, 60u, 120u, 0x66u), "DCPL RGB2");
	require(gte.readControlRegister(31u) == 0u, "DCPL FLAG");
}

void testDpct() {
	GteHarness harness;
	bmsx::GxGte& gte = harness.gte;
	gte.writeDataRegister(6u, packRgb(0u, 0u, 0u, 0xaau));
	gte.writeDataRegister(20u, packRgb(1u, 2u, 3u, 0x10u));
	gte.writeDataRegister(21u, packRgb(4u, 5u, 6u, 0x20u));
	gte.writeDataRegister(22u, packRgb(7u, 8u, 9u, 0x30u));

	require(gte.execute(GTE_SF | bmsx::GX_GTE_FN_DPCT) == bmsx::GX_GTE_CYCLES_DPCT, "DPCT cycles");

	require(gte.readDataRegister(20u) == packRgb(1u, 2u, 3u, 0xaau), "DPCT RGB0");
	require(gte.readDataRegister(21u) == packRgb(4u, 5u, 6u, 0xaau), "DPCT RGB1");
	require(gte.readDataRegister(22u) == packRgb(7u, 8u, 9u, 0xaau), "DPCT RGB2");
	require(gte.readControlRegister(31u) == 0u, "DPCT FLAG");
}

void testGpfGpl() {
	GteHarness harness;
	bmsx::GxGte& gte = harness.gte;
	gte.writeDataRegister(6u, packRgb(0u, 0u, 0u, 0x77u));
	gte.writeDataRegister(8u, 16u);
	gte.writeDataRegister(9u, 32u);
	gte.writeDataRegister(10u, 64u);
	gte.writeDataRegister(11u, 96u);

	require(gte.execute(bmsx::GX_GTE_FN_GPF) == bmsx::GX_GTE_CYCLES_GPF, "GPF cycles");
	require(gte.readDataRegister(9u) == 512u, "GPF IR1");
	require(gte.readDataRegister(10u) == 1024u, "GPF IR2");
	require(gte.readDataRegister(11u) == 1536u, "GPF IR3");
	require(gte.readDataRegister(22u) == packRgb(32u, 64u, 96u, 0x77u), "GPF RGB2");

	gte.writeDataRegister(25u, 100u);
	gte.writeDataRegister(26u, 200u);
	gte.writeDataRegister(27u, 300u);
	gte.writeDataRegister(9u, 2u);
	gte.writeDataRegister(10u, 3u);
	gte.writeDataRegister(11u, 4u);

	require(gte.execute(bmsx::GX_GTE_FN_GPL) == bmsx::GX_GTE_CYCLES_GPL, "GPL cycles");
	require(gte.readDataRegister(9u) == 132u, "GPL IR1");
	require(gte.readDataRegister(10u) == 248u, "GPL IR2");
	require(gte.readDataRegister(11u) == 364u, "GPL IR3");
	require(gte.readDataRegister(22u) == packRgb(8u, 15u, 22u, 0x77u), "GPL RGB2");
	require(gte.readControlRegister(31u) == 0u, "GPL FLAG");
}

void testRgbColorSaturationFlags() {
	GteHarness harness;
	bmsx::GxGte& gte = harness.gte;
	gte.writeDataRegister(6u, packRgb(0u, 0u, 0u, 0x12u));
	gte.writeDataRegister(8u, 0x1000u);
	gte.writeDataRegister(9u, 2u);
	gte.writeDataRegister(10u, 0u);
	gte.writeDataRegister(11u, 0u);

	require(gte.execute(bmsx::GX_GTE_FN_GPF) == bmsx::GX_GTE_CYCLES_GPF, "GPF color saturation cycles");

	require(gte.readDataRegister(22u) == packRgb(255u, 0u, 0u, 0x12u), "GPF color saturation RGB2");
	require(gte.readControlRegister(31u) == bmsx::GX_GTE_FLAG_COLOR_R_SAT, "GPF color saturation FLAG");
}

void testAvsz3() {
	GteHarness harness;
	bmsx::GxGte& gte = harness.gte;
	gte.writeDataRegister(17u, 100u);
	gte.writeDataRegister(18u, 200u);
	gte.writeDataRegister(19u, 300u);
	gte.writeControlRegister(29u, 0x1000u);

	require(gte.execute(bmsx::GX_GTE_FN_AVSZ3) == bmsx::GX_GTE_CYCLES_AVSZ3, "AVSZ3 cycles");

	require(gte.readDataRegister(7u) == 600u, "AVSZ3 OTZ");
	require(gte.readDataRegister(24u) == 0x258000u, "AVSZ3 MAC0");
	require(gte.readControlRegister(31u) == 0u, "AVSZ3 FLAG");
}

void testRtpsNarrowsMacResultToRegisterDatapath() {
	GteHarness harness;
	bmsx::GxGte& gte = harness.gte;
	gte.writeControlRegister(5u, 0x7fffffffu);
	gte.writeControlRegister(26u, 256u);

	gte.execute(bmsx::GX_GTE_FN_RTPS);

	require(gte.readDataRegister(9u) == 0xfffff000u, "RTPS IR1 32-bit MAC narrowing");
}

void testUnknownFunctionCodeIsDeterministicNoop() {
	GteHarness harness;
	bmsx::GxGte& gte = harness.gte;

	require(gte.execute(0x02u) == 0u, "unknown GTE opcode cycles");
	require(gte.readControlRegister(31u) == 0u, "unknown GTE opcode FLAG");
}

void testSaveStatePreservesRawRegisterWords() {
	GteHarness harness;
	bmsx::GxGte& gte = harness.gte;
	gte.execute(bmsx::GX_GTE_FN_RTPS);
	gte.writeDataRegister(30u, 0x80000000u);
	gte.writeControlRegister(24u, 160u << 16u);
	gte.writeControlRegister(31u, bmsx::GX_GTE_FLAG_DIV_OVERFLOW);
	const bmsx::GxGteState state = gte.captureState();

	gte.reset();
	gte.restoreState(state);

	require(gte.readDataRegister(30u) == 0x80000000u, "GTE save LZCS");
	require(gte.readDataRegister(31u) == 1u, "GTE save LZCR");
	require(gte.readControlRegister(24u) == (160u << 16u), "GTE save OFX");
	require(gte.readControlRegister(31u) == (bmsx::GX_GTE_FLAG_ERROR | bmsx::GX_GTE_FLAG_DIV_OVERFLOW), "GTE save FLAG");
	require(gte.captureState().mac3 == state.mac3, "GTE save hidden MAC3");
}

void testRtpsDivideOverflow() {
	GteHarness harness;
	bmsx::GxGte& gte = harness.gte;
	setupIdentityProjection(gte);
	gte.writeDataRegister(0u, pack16(1u, 1u));
	gte.writeDataRegister(1u, 1u);

	gte.execute(GTE_SF | bmsx::GX_GTE_FN_RTPS);

	require(gte.readDataRegister(19u) == 1u, "RTPS overflow SZ3");
	require((gte.readControlRegister(31u) & (bmsx::GX_GTE_FLAG_ERROR | bmsx::GX_GTE_FLAG_DIV_OVERFLOW)) == (bmsx::GX_GTE_FLAG_ERROR | bmsx::GX_GTE_FLAG_DIV_OVERFLOW), "RTPS overflow FLAG");
}

} // namespace

int main() {
	testRtpsIdentityProjection();
	testMmioExecution();
	testNclip();
	testOp();
	testMvmva();
	testSqr();
	testDpcs();
	testIntpl();
	testDcpl();
	testDpct();
	testGpfGpl();
	testRgbColorSaturationFlags();
	testAvsz3();
	testRtpsNarrowsMacResultToRegisterDatapath();
	testUnknownFunctionCodeIsDeterministicNoop();
	testSaveStatePreservesRawRegisterWords();
	testRtpsDivideOverflow();
	return 0;
}

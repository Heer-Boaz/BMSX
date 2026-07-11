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

void setupIdentityLighting(bmsx::GxGte& gte) {
	gte.writeControlRegister(8u, pack16(0x1000u, 0u));
	gte.writeControlRegister(9u, pack16(0u, 0u));
	gte.writeControlRegister(10u, pack16(0x1000u, 0u));
	gte.writeControlRegister(11u, pack16(0u, 0u));
	gte.writeControlRegister(12u, 0x1000u);
	gte.writeControlRegister(13u, 0u);
	gte.writeControlRegister(14u, 0u);
	gte.writeControlRegister(15u, 0u);
	gte.writeControlRegister(16u, pack16(0x1000u, 0u));
	gte.writeControlRegister(17u, pack16(0u, 0u));
	gte.writeControlRegister(18u, pack16(0x1000u, 0u));
	gte.writeControlRegister(19u, pack16(0u, 0u));
	gte.writeControlRegister(20u, 0x1000u);
}

void setupUnitLighting(bmsx::GxGte& gte) {
	gte.writeControlRegister(8u, pack16(1u, 0u));
	gte.writeControlRegister(9u, pack16(0u, 0u));
	gte.writeControlRegister(10u, pack16(1u, 0u));
	gte.writeControlRegister(11u, pack16(0u, 0u));
	gte.writeControlRegister(12u, 1u);
	gte.writeControlRegister(13u, 0u);
	gte.writeControlRegister(14u, 0u);
	gte.writeControlRegister(15u, 0u);
	gte.writeControlRegister(16u, pack16(1u, 0u));
	gte.writeControlRegister(17u, pack16(0u, 0u));
	gte.writeControlRegister(18u, pack16(1u, 0u));
	gte.writeControlRegister(19u, pack16(0u, 0u));
	gte.writeControlRegister(20u, 1u);
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

void testMvmvaReadsVectorOnce() {
	GteHarness harness;
	bmsx::GxGte& gte = harness.gte;
	gte.writeControlRegister(0u, pack16(1u, 2u));
	gte.writeControlRegister(1u, pack16(3u, 4u));
	gte.writeControlRegister(2u, pack16(5u, 6u));
	gte.writeControlRegister(3u, pack16(7u, 8u));
	gte.writeControlRegister(4u, pack16(9u, 0u));
	gte.writeDataRegister(9u, 1u);
	gte.writeDataRegister(10u, 2u);
	gte.writeDataRegister(11u, 3u);

	require(gte.execute((3u << 15u) | bmsx::GX_GTE_FN_MVMVA) == bmsx::GX_GTE_CYCLES_MVMVA, "MVMVA IR vector read-once cycles");
	require(gte.readDataRegister(9u) == 14u, "MVMVA IR vector IR1");
	require(gte.readDataRegister(10u) == 32u, "MVMVA IR vector IR2");
	require(gte.readDataRegister(11u) == 50u, "MVMVA IR vector IR3");
}

void testMvmvaReservedMatrixQuirk() {
	GteHarness harness;
	bmsx::GxGte& gte = harness.gte;
	gte.writeDataRegister(0u, pack16(2u, 4u));
	gte.writeDataRegister(1u, 6u);
	gte.writeDataRegister(6u, packRgb(3u, 0u, 0u, 0u));
	gte.writeDataRegister(8u, 5u);
	gte.writeControlRegister(1u, 7u);
	gte.writeControlRegister(2u, 11u);

	require(gte.execute((3u << 17u) | (3u << 13u) | bmsx::GX_GTE_FN_MVMVA) == bmsx::GX_GTE_CYCLES_MVMVA, "MVMVA reserved matrix cycles");

	require(gte.readDataRegister(9u) == 126u, "MVMVA reserved matrix IR1");
	require(gte.readDataRegister(10u) == 84u, "MVMVA reserved matrix IR2");
	require(gte.readDataRegister(11u) == 132u, "MVMVA reserved matrix IR3");
	require(gte.readDataRegister(25u) == 126u, "MVMVA reserved matrix MAC1");
	require(gte.readDataRegister(26u) == 84u, "MVMVA reserved matrix MAC2");
	require(gte.readDataRegister(27u) == 132u, "MVMVA reserved matrix MAC3");
	require(gte.readControlRegister(31u) == 0u, "MVMVA reserved matrix FLAG");
}

void testMvmvaFarColorTranslationBug() {
	GteHarness harness;
	bmsx::GxGte& gte = harness.gte;
	gte.writeControlRegister(0u, pack16(100u, 2u));
	gte.writeControlRegister(1u, pack16(3u, 200u));
	gte.writeControlRegister(2u, pack16(5u, 7u));
	gte.writeControlRegister(3u, pack16(300u, 11u));
	gte.writeControlRegister(4u, 13u);
	gte.writeControlRegister(21u, 1u);
	gte.writeControlRegister(22u, 2u);
	gte.writeControlRegister(23u, 3u);
	gte.writeDataRegister(0u, pack16(17u, 19u));
	gte.writeDataRegister(1u, 23u);

	require(gte.execute((2u << 13u) | bmsx::GX_GTE_FN_MVMVA) == bmsx::GX_GTE_CYCLES_MVMVA, "MVMVA far-color bug cycles");

	require(gte.readDataRegister(9u) == 107u, "MVMVA far-color bug IR1");
	require(gte.readDataRegister(10u) == 256u, "MVMVA far-color bug IR2");
	require(gte.readDataRegister(11u) == 508u, "MVMVA far-color bug IR3");
	require(gte.readDataRegister(25u) == 107u, "MVMVA far-color bug MAC1");
	require(gte.readDataRegister(26u) == 256u, "MVMVA far-color bug MAC2");
	require(gte.readDataRegister(27u) == 508u, "MVMVA far-color bug MAC3");
	require(gte.readControlRegister(31u) == 0u, "MVMVA far-color bug FLAG");
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

	gte.writeDataRegister(9u, 0xff9cu);
	gte.writeDataRegister(10u, 0xff38u);
	gte.writeDataRegister(11u, 0xfed4u);
	require(gte.execute(GTE_SF | bmsx::GX_GTE_FN_INTPL) == bmsx::GX_GTE_CYCLES_INTPL, "INTPL negative cycles");
	require(gte.readDataRegister(25u) == 0xffffff9cu, "INTPL negative MAC1");
	require(gte.readDataRegister(26u) == 0xffffff38u, "INTPL negative MAC2");
	require(gte.readDataRegister(27u) == 0xfffffed4u, "INTPL negative MAC3");
	require(gte.readDataRegister(9u) == 0xffffff9cu, "INTPL negative IR1");
	require(gte.readDataRegister(10u) == 0xffffff38u, "INTPL negative IR2");
	require(gte.readDataRegister(11u) == 0xfffffed4u, "INTPL negative IR3");
	require(gte.readDataRegister(22u) == packRgb(0u, 0u, 0u, 0x55u), "INTPL negative RGB2");
	require(gte.readControlRegister(31u) == (bmsx::GX_GTE_FLAG_COLOR_R_SAT | bmsx::GX_GTE_FLAG_COLOR_G_SAT | bmsx::GX_GTE_FLAG_COLOR_B_SAT), "INTPL negative FLAG");
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

void testNcsNct() {
	GteHarness harness;
	bmsx::GxGte& gte = harness.gte;
	setupIdentityLighting(gte);
	gte.writeDataRegister(6u, packRgb(0u, 0u, 0u, 0x31u));
	gte.writeDataRegister(0u, pack16(256u, 512u));
	gte.writeDataRegister(1u, 768u);

	require(gte.execute(GTE_SF | bmsx::GX_GTE_FN_NCS) == bmsx::GX_GTE_CYCLES_NCS, "NCS cycles");

	require(gte.readDataRegister(9u) == 256u, "NCS IR1");
	require(gte.readDataRegister(10u) == 512u, "NCS IR2");
	require(gte.readDataRegister(11u) == 768u, "NCS IR3");
	require(gte.readDataRegister(22u) == packRgb(16u, 32u, 48u, 0x31u), "NCS RGB2");
	require(gte.readControlRegister(31u) == 0u, "NCS FLAG");

	GteHarness nextHarness;
	bmsx::GxGte& next = nextHarness.gte;
	setupIdentityLighting(next);
	next.writeDataRegister(6u, packRgb(0u, 0u, 0u, 0x32u));
	next.writeDataRegister(0u, pack16(160u, 320u));
	next.writeDataRegister(1u, 480u);
	next.writeDataRegister(2u, pack16(320u, 480u));
	next.writeDataRegister(3u, 640u);
	next.writeDataRegister(4u, pack16(480u, 640u));
	next.writeDataRegister(5u, 800u);

	require(next.execute(GTE_SF | bmsx::GX_GTE_FN_NCT) == bmsx::GX_GTE_CYCLES_NCT, "NCT cycles");

	require(next.readDataRegister(20u) == packRgb(10u, 20u, 30u, 0x32u), "NCT RGB0");
	require(next.readDataRegister(21u) == packRgb(20u, 30u, 40u, 0x32u), "NCT RGB1");
	require(next.readDataRegister(22u) == packRgb(30u, 40u, 50u, 0x32u), "NCT RGB2");
	require(next.readControlRegister(31u) == 0u, "NCT FLAG");
}

void testNccsCc() {
	GteHarness harness;
	bmsx::GxGte& gte = harness.gte;
	setupUnitLighting(gte);
	gte.writeDataRegister(6u, packRgb(2u, 3u, 4u, 0x71u));
	gte.writeDataRegister(0u, pack16(10u, 20u));
	gte.writeDataRegister(1u, 30u);

	require(gte.execute(bmsx::GX_GTE_FN_NCCS) == bmsx::GX_GTE_CYCLES_NCCS, "NCCS cycles");

	require(gte.readDataRegister(9u) == 320u, "NCCS IR1");
	require(gte.readDataRegister(10u) == 960u, "NCCS IR2");
	require(gte.readDataRegister(11u) == 1920u, "NCCS IR3");
	require(gte.readDataRegister(22u) == packRgb(20u, 60u, 120u, 0x71u), "NCCS RGB2");
	require(gte.readControlRegister(31u) == 0u, "NCCS FLAG");

	GteHarness nextHarness;
	bmsx::GxGte& next = nextHarness.gte;
	setupUnitLighting(next);
	next.writeDataRegister(6u, packRgb(2u, 3u, 4u, 0x72u));
	next.writeDataRegister(9u, 10u);
	next.writeDataRegister(10u, 20u);
	next.writeDataRegister(11u, 30u);

	require(next.execute(bmsx::GX_GTE_FN_CC) == bmsx::GX_GTE_CYCLES_CC, "CC cycles");

	require(next.readDataRegister(9u) == 320u, "CC IR1");
	require(next.readDataRegister(10u) == 960u, "CC IR2");
	require(next.readDataRegister(11u) == 1920u, "CC IR3");
	require(next.readDataRegister(22u) == packRgb(20u, 60u, 120u, 0x72u), "CC RGB2");
	require(next.readControlRegister(31u) == 0u, "CC FLAG");

	GteHarness shuffledHarness;
	bmsx::GxGte& shuffled = shuffledHarness.gte;
	setupUnitLighting(shuffled);
	shuffled.writeControlRegister(16u, pack16(0u, 1u));
	shuffled.writeControlRegister(17u, pack16(0u, 0u));
	shuffled.writeControlRegister(18u, pack16(0u, 1u));
	shuffled.writeControlRegister(19u, pack16(1u, 0u));
	shuffled.writeControlRegister(20u, 0u);
	shuffled.writeDataRegister(6u, packRgb(1u, 1u, 1u, 0x79u));
	shuffled.writeDataRegister(9u, 10u);
	shuffled.writeDataRegister(10u, 20u);
	shuffled.writeDataRegister(11u, 30u);

	require(shuffled.execute(bmsx::GX_GTE_FN_CC) == bmsx::GX_GTE_CYCLES_CC, "CC shuffled cycles");

	require(shuffled.readDataRegister(9u) == 320u, "CC shuffled IR1");
	require(shuffled.readDataRegister(10u) == 480u, "CC shuffled IR2");
	require(shuffled.readDataRegister(11u) == 160u, "CC shuffled IR3");
	require(shuffled.readDataRegister(22u) == packRgb(20u, 30u, 10u, 0x79u), "CC shuffled RGB2");
	require(shuffled.readControlRegister(31u) == 0u, "CC shuffled FLAG");
}

void testNcdsCdp() {
	GteHarness harness;
	bmsx::GxGte& gte = harness.gte;
	setupUnitLighting(gte);
	gte.writeDataRegister(6u, packRgb(2u, 3u, 4u, 0x73u));
	gte.writeDataRegister(0u, pack16(10u, 20u));
	gte.writeDataRegister(1u, 30u);

	require(gte.execute(bmsx::GX_GTE_FN_NCDS) == bmsx::GX_GTE_CYCLES_NCDS, "NCDS cycles");

	require(gte.readDataRegister(9u) == 320u, "NCDS IR1");
	require(gte.readDataRegister(10u) == 960u, "NCDS IR2");
	require(gte.readDataRegister(11u) == 1920u, "NCDS IR3");
	require(gte.readDataRegister(22u) == packRgb(20u, 60u, 120u, 0x73u), "NCDS RGB2");
	require(gte.readControlRegister(31u) == 0u, "NCDS FLAG");

	GteHarness nextHarness;
	bmsx::GxGte& next = nextHarness.gte;
	setupUnitLighting(next);
	next.writeDataRegister(6u, packRgb(2u, 3u, 4u, 0x74u));
	next.writeDataRegister(9u, 10u);
	next.writeDataRegister(10u, 20u);
	next.writeDataRegister(11u, 30u);

	require(next.execute(bmsx::GX_GTE_FN_CDP) == bmsx::GX_GTE_CYCLES_CDP, "CDP cycles");

	require(next.readDataRegister(9u) == 320u, "CDP IR1");
	require(next.readDataRegister(10u) == 960u, "CDP IR2");
	require(next.readDataRegister(11u) == 1920u, "CDP IR3");
	require(next.readDataRegister(22u) == packRgb(20u, 60u, 120u, 0x74u), "CDP RGB2");
	require(next.readControlRegister(31u) == 0u, "CDP FLAG");
}

void testNcdtNcct() {
	GteHarness harness;
	bmsx::GxGte& gte = harness.gte;
	setupUnitLighting(gte);
	gte.writeDataRegister(6u, packRgb(1u, 1u, 1u, 0x75u));
	gte.writeDataRegister(0u, pack16(1u, 2u));
	gte.writeDataRegister(1u, 3u);
	gte.writeDataRegister(2u, pack16(4u, 5u));
	gte.writeDataRegister(3u, 6u);
	gte.writeDataRegister(4u, pack16(7u, 8u));
	gte.writeDataRegister(5u, 9u);

	require(gte.execute(bmsx::GX_GTE_FN_NCDT) == bmsx::GX_GTE_CYCLES_NCDT, "NCDT cycles");

	require(gte.readDataRegister(20u) == packRgb(1u, 2u, 3u, 0x75u), "NCDT RGB0");
	require(gte.readDataRegister(21u) == packRgb(4u, 5u, 6u, 0x75u), "NCDT RGB1");
	require(gte.readDataRegister(22u) == packRgb(7u, 8u, 9u, 0x75u), "NCDT RGB2");
	require(gte.readControlRegister(31u) == 0u, "NCDT FLAG");

	GteHarness nextHarness;
	bmsx::GxGte& next = nextHarness.gte;
	setupUnitLighting(next);
	next.writeDataRegister(6u, packRgb(1u, 1u, 1u, 0x76u));
	next.writeDataRegister(0u, pack16(1u, 2u));
	next.writeDataRegister(1u, 3u);
	next.writeDataRegister(2u, pack16(4u, 5u));
	next.writeDataRegister(3u, 6u);
	next.writeDataRegister(4u, pack16(7u, 8u));
	next.writeDataRegister(5u, 9u);

	require(next.execute(bmsx::GX_GTE_FN_NCCT) == bmsx::GX_GTE_CYCLES_NCCT, "NCCT cycles");

	require(next.readDataRegister(20u) == packRgb(1u, 2u, 3u, 0x76u), "NCCT RGB0");
	require(next.readDataRegister(21u) == packRgb(4u, 5u, 6u, 0x76u), "NCCT RGB1");
	require(next.readDataRegister(22u) == packRgb(7u, 8u, 9u, 0x76u), "NCCT RGB2");
	require(next.readControlRegister(31u) == 0u, "NCCT FLAG");
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

void testGpfUsesSignedIr0() {
	GteHarness harness;
	bmsx::GxGte& gte = harness.gte;
	gte.writeDataRegister(8u, 0xffffu);
	gte.writeDataRegister(9u, 1u);
	gte.writeDataRegister(10u, 2u);
	gte.writeDataRegister(11u, 3u);

	require(gte.execute(bmsx::GX_GTE_FN_GPF) == bmsx::GX_GTE_CYCLES_GPF, "GPF signed IR0 cycles");

	require(gte.readDataRegister(25u) == 0xffffffffu, "GPF signed IR0 MAC1");
	require(gte.readDataRegister(26u) == 0xfffffffeu, "GPF signed IR0 MAC2");
	require(gte.readDataRegister(27u) == 0xfffffffdu, "GPF signed IR0 MAC3");
	require(gte.readDataRegister(9u) == 0xffffffffu, "GPF signed IR0 IR1");
	require(gte.readDataRegister(10u) == 0xfffffffeu, "GPF signed IR0 IR2");
	require(gte.readDataRegister(11u) == 0xfffffffdu, "GPF signed IR0 IR3");
	require(gte.readDataRegister(22u) == 0u, "GPF signed IR0 RGB2");
	require(gte.readControlRegister(31u) == (bmsx::GX_GTE_FLAG_COLOR_R_SAT | bmsx::GX_GTE_FLAG_COLOR_G_SAT | bmsx::GX_GTE_FLAG_COLOR_B_SAT), "GPF signed IR0 FLAG");
}

void testDepthCueUsesSignedIr0() {
	GteHarness harness;
	bmsx::GxGte& gte = harness.gte;
	gte.writeDataRegister(6u, packRgb(0u, 0u, 0u, 0x5au));
	gte.writeDataRegister(8u, 0xffffu);
	gte.writeControlRegister(21u, 1u);
	gte.writeControlRegister(22u, 1u);
	gte.writeControlRegister(23u, 1u);

	require(gte.execute(bmsx::GX_GTE_FN_DPCS) == bmsx::GX_GTE_CYCLES_DPCS, "DPCS signed IR0 cycles");

	require(gte.readDataRegister(25u) == 0xfffff000u, "DPCS signed IR0 MAC1");
	require(gte.readDataRegister(26u) == 0xfffff000u, "DPCS signed IR0 MAC2");
	require(gte.readDataRegister(27u) == 0xfffff000u, "DPCS signed IR0 MAC3");
	require(gte.readDataRegister(9u) == 0xfffff000u, "DPCS signed IR0 IR1");
	require(gte.readDataRegister(10u) == 0xfffff000u, "DPCS signed IR0 IR2");
	require(gte.readDataRegister(11u) == 0xfffff000u, "DPCS signed IR0 IR3");
	require(gte.readDataRegister(22u) == packRgb(0u, 0u, 0u, 0x5au), "DPCS signed IR0 RGB2");
	require(gte.readControlRegister(31u) == (bmsx::GX_GTE_FLAG_COLOR_R_SAT | bmsx::GX_GTE_FLAG_COLOR_G_SAT | bmsx::GX_GTE_FLAG_COLOR_B_SAT), "DPCS signed IR0 FLAG");
}

void testGplWrapsMac44BeforeShift() {
	GteHarness harness;
	bmsx::GxGte& gte = harness.gte;
	gte.writeDataRegister(6u, packRgb(0u, 0u, 0u, 0x5au));
	gte.writeDataRegister(8u, 0x1000u);
	gte.writeDataRegister(9u, 0x7fffu);
	gte.writeDataRegister(10u, 0x8000u);
	gte.writeDataRegister(11u, 1u);
	gte.writeDataRegister(25u, 0x7fffffffu);
	gte.writeDataRegister(26u, 0x80000000u);
	gte.writeDataRegister(27u, 0u);

	require(gte.execute(GTE_SF | bmsx::GX_GTE_FN_GPL) == bmsx::GX_GTE_CYCLES_GPL, "GPL MAC44 cycles");

	require(gte.readDataRegister(25u) == 0x80007ffeu, "GPL MAC44 positive wrap");
	require(gte.readDataRegister(26u) == 0x7fff8000u, "GPL MAC44 negative wrap");
	require(gte.readDataRegister(27u) == 1u, "GPL MAC44 MAC3");
	require(gte.readDataRegister(9u) == 0xffff8000u, "GPL MAC44 IR1");
	require(gte.readDataRegister(10u) == 0x7fffu, "GPL MAC44 IR2");
	require(gte.readDataRegister(11u) == 1u, "GPL MAC44 IR3");
	require(gte.readDataRegister(22u) == packRgb(0u, 0xffu, 0u, 0x5au), "GPL MAC44 RGB2");
	require(gte.readControlRegister(31u) == (
		bmsx::GX_GTE_FLAG_ERROR
		| bmsx::GX_GTE_FLAG_MAC1_POS
		| bmsx::GX_GTE_FLAG_MAC2_NEG
		| bmsx::GX_GTE_FLAG_IR1_SAT
		| bmsx::GX_GTE_FLAG_IR2_SAT
		| bmsx::GX_GTE_FLAG_COLOR_R_SAT
		| bmsx::GX_GTE_FLAG_COLOR_G_SAT
	), "GPL MAC44 FLAG");
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

void testAvsz4() {
	GteHarness harness;
	bmsx::GxGte& gte = harness.gte;
	gte.writeDataRegister(16u, 50u);
	gte.writeDataRegister(17u, 100u);
	gte.writeDataRegister(18u, 200u);
	gte.writeDataRegister(19u, 300u);
	gte.writeControlRegister(30u, 0x1000u);

	require(gte.execute(bmsx::GX_GTE_FN_AVSZ4) == bmsx::GX_GTE_CYCLES_AVSZ4, "AVSZ4 cycles");

	require(gte.readDataRegister(7u) == 650u, "AVSZ4 OTZ");
	require(gte.readDataRegister(24u) == 0x28a000u, "AVSZ4 MAC0");
	require(gte.readControlRegister(31u) == 0u, "AVSZ4 FLAG");

	gte.writeDataRegister(16u, 0xffffu);
	gte.writeDataRegister(17u, 0xffffu);
	gte.writeDataRegister(18u, 0xffffu);
	gte.writeDataRegister(19u, 0xffffu);
	gte.writeControlRegister(30u, 0x1000u);

	require(gte.execute(bmsx::GX_GTE_FN_AVSZ4) == bmsx::GX_GTE_CYCLES_AVSZ4, "AVSZ4 saturating cycles");

	require(gte.readDataRegister(7u) == 0xffffu, "AVSZ4 saturating OTZ");
	require(gte.readDataRegister(24u) == 0x3fffc000u, "AVSZ4 saturating MAC0");
	require(gte.readControlRegister(31u) == (bmsx::GX_GTE_FLAG_ERROR | bmsx::GX_GTE_FLAG_SZ_OTZ_SAT), "AVSZ4 saturating FLAG");
}

void testRtpsNarrowsMacResultToRegisterDatapath() {
	GteHarness harness;
	bmsx::GxGte& gte = harness.gte;
	gte.writeControlRegister(5u, 0x7fffffffu);
	gte.writeControlRegister(26u, 256u);

	gte.execute(bmsx::GX_GTE_FN_RTPS);

	require(gte.readDataRegister(9u) == 0xfffff000u, "RTPS IR1 32-bit MAC narrowing");
}

void testRtpsIr3ClampsFromMac3RegisterValue() {
	GteHarness harness;
	bmsx::GxGte& gte = harness.gte;
	gte.writeControlRegister(7u, 0x00080000u);

	gte.execute(bmsx::GX_GTE_FN_RTPS);

	require(gte.readDataRegister(27u) == 0x80000000u, "RTPS MAC3 register truncation");
	require(gte.readDataRegister(11u) == 0xffff8000u, "RTPS IR3 clamps from MAC3 register");
}

void testRawCop2RegisterEdges() {
	GteHarness harness;
	bmsx::GxGte& gte = harness.gte;

	gte.writeDataRegister(12u, pack16(1u, 2u));
	gte.writeDataRegister(13u, pack16(3u, 4u));
	gte.writeDataRegister(14u, pack16(5u, 6u));
	gte.writeDataRegister(15u, pack16(7u, 8u));
	require(gte.readDataRegister(12u) == pack16(3u, 4u), "SXYP pushes SXY0");
	require(gte.readDataRegister(13u) == pack16(5u, 6u), "SXYP pushes SXY1");
	require(gte.readDataRegister(14u) == pack16(7u, 8u), "SXYP writes SXY2");
	require(gte.readDataRegister(15u) == pack16(7u, 8u), "SXYP reads SXY2 mirror");

	gte.writeDataRegister(28u, 31u | (1u << 5u) | (16u << 10u));
	require(gte.readDataRegister(9u) == 0x0f80u, "IRGB writes IR1");
	require(gte.readDataRegister(10u) == 0x0080u, "IRGB writes IR2");
	require(gte.readDataRegister(11u) == 0x0800u, "IRGB writes IR3");
	require(gte.readDataRegister(28u) == (31u | (1u << 5u) | (16u << 10u)), "IRGB read packs IR");
	require(gte.readDataRegister(29u) == (31u | (1u << 5u) | (16u << 10u)), "ORGB read packs IR");

	gte.writeDataRegister(9u, 0xf000u);
	gte.writeDataRegister(10u, 0x2000u);
	gte.writeDataRegister(11u, 0x0f80u);
	require(gte.readDataRegister(28u) == ((31u << 5u) | (31u << 10u)), "IRGB read clamps RGB5");
	require(gte.readDataRegister(29u) == ((31u << 5u) | (31u << 10u)), "ORGB read clamps RGB5");

	gte.writeDataRegister(30u, 0x00000000u);
	require(gte.readDataRegister(31u) == 32u, "LZCR counts zero word");
	gte.writeDataRegister(30u, 0xffffffffu);
	require(gte.readDataRegister(31u) == 32u, "LZCR counts one word");
	gte.writeDataRegister(30u, 0x00f00000u);
	require(gte.readDataRegister(31u) == 8u, "LZCR counts leading zero bits");
	gte.writeDataRegister(30u, 0xff0fffffu);
	require(gte.readDataRegister(31u) == 8u, "LZCR counts leading one bits");
	require(gte.readControlRegister(31u) == 0u, "raw register edge FLAG");
}

void testRtpsUsesUnsignedHWithSignExtendedReadback() {
	GteHarness harness;
	bmsx::GxGte& gte = harness.gte;
	setupIdentityProjection(gte);
	gte.writeControlRegister(4u, 0x2000u);
	gte.writeControlRegister(26u, 0xffffu);
	gte.writeDataRegister(0u, pack16(1u, 0u));
	gte.writeDataRegister(1u, 0x4000u);

	require(gte.readControlRegister(26u) == 0xffffffffu, "H reads sign-extended");
	require(gte.execute(GTE_SF | bmsx::GX_GTE_FN_RTPS) == bmsx::GX_GTE_CYCLES_RTPS, "RTPS unsigned H cycles");

	require(gte.readDataRegister(14u) == pack16(161u, 120u), "RTPS unsigned H SXY2");
	require(gte.readDataRegister(19u) == 0x8000u, "RTPS unsigned H SZ3");
	require((gte.readControlRegister(31u) & bmsx::GX_GTE_FLAG_DIV_OVERFLOW) == 0u, "RTPS unsigned H does not divide-overflow");
}

void testRtptDepthCueUsesLastVertex() {
	GteHarness harness;
	bmsx::GxGte& gte = harness.gte;
	setupIdentityProjection(gte);
	gte.writeControlRegister(27u, 0x0080u);
	gte.writeControlRegister(28u, 0u);
	gte.writeDataRegister(0u, pack16(0u, 0u));
	gte.writeDataRegister(1u, 256u);
	gte.writeDataRegister(2u, pack16(0u, 0u));
	gte.writeDataRegister(3u, 512u);
	gte.writeDataRegister(4u, pack16(0u, 0u));
	gte.writeDataRegister(5u, 1024u);

	require(gte.execute(GTE_SF | bmsx::GX_GTE_FN_RTPT) == bmsx::GX_GTE_CYCLES_RTPT, "RTPT DQA/DQB cycles");

	require(gte.readDataRegister(8u) == 0x0200u, "RTPT IR0 from last vertex");
	require(gte.readDataRegister(17u) == 256u, "RTPT SZ1");
	require(gte.readDataRegister(18u) == 512u, "RTPT SZ2");
	require(gte.readDataRegister(19u) == 1024u, "RTPT SZ3");
	require(gte.readControlRegister(31u) == 0u, "RTPT DQA/DQB FLAG");
}

void testUnknownFunctionCodeIsDeterministicNoop() {
	GteHarness harness;
	bmsx::GxGte& gte = harness.gte;
	gte.writeControlRegister(31u, bmsx::GX_GTE_FLAG_DIV_OVERFLOW);

	require(gte.execute(0x02u) == 0u, "unknown GTE opcode cycles");
	require(gte.readControlRegister(31u) == (bmsx::GX_GTE_FLAG_ERROR | bmsx::GX_GTE_FLAG_DIV_OVERFLOW), "unknown GTE opcode FLAG");
}

void testOpcodeZeroIsNotRtpsAlias() {
	GteHarness harness;
	bmsx::GxGte& gte = harness.gte;
	setupIdentityProjection(gte);
	gte.writeDataRegister(0u, pack16(1u, 2u));
	gte.writeDataRegister(1u, 256u);
	gte.writeControlRegister(31u, bmsx::GX_GTE_FLAG_DIV_OVERFLOW);

	require(gte.execute(0u) == 0u, "GTE opcode 0 cycles");

	require(gte.readDataRegister(9u) == 0u, "GTE opcode 0 IR1");
	require(gte.readDataRegister(10u) == 0u, "GTE opcode 0 IR2");
	require(gte.readDataRegister(11u) == 0u, "GTE opcode 0 IR3");
	require(gte.readDataRegister(14u) == 0u, "GTE opcode 0 SXY2");
	require(gte.readControlRegister(31u) == (bmsx::GX_GTE_FLAG_ERROR | bmsx::GX_GTE_FLAG_DIV_OVERFLOW), "GTE opcode 0 FLAG");
}

void testSaveStatePreservesRawRegisterWords() {
	GteHarness harness;
	bmsx::GxGte& gte = harness.gte;
	bmsx::Memory& memory = harness.memory;
	gte.execute(bmsx::GX_GTE_FN_RTPS);
	gte.writeDataRegister(30u, 0x80000000u);
	gte.writeControlRegister(24u, 160u << 16u);
	memory.writeMappedU32LE(bmsx::IO_GX_GTE_COMMAND, bmsx::GX_GTE_FN_DPCS);
	gte.writeControlRegister(31u, bmsx::GX_GTE_FLAG_DIV_OVERFLOW);
	const bmsx::GxGteState state = gte.captureState();

	gte.reset();
	gte.restoreState(state);

	require(gte.readDataRegister(30u) == 0x80000000u, "GTE save LZCS");
	require(gte.readDataRegister(31u) == 1u, "GTE save LZCR");
	require(gte.readControlRegister(24u) == (160u << 16u), "GTE save OFX");
	require(gte.readControlRegister(31u) == (bmsx::GX_GTE_FLAG_ERROR | bmsx::GX_GTE_FLAG_DIV_OVERFLOW), "GTE save FLAG");
	require(gte.captureState().mac3 == state.mac3, "GTE save hidden MAC3");
	require(memory.readMappedU32LE(bmsx::IO_GX_GTE_CYCLES) == bmsx::GX_GTE_CYCLES_DPCS, "GTE save cycles latch");
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

void testRtpsUnrResultSaturatesWithoutDivideOverflow() {
	GteHarness harness;
	bmsx::GxGte& gte = harness.gte;
	setupIdentityProjection(gte);
	gte.writeControlRegister(26u, 0xfe3fu);
	gte.writeDataRegister(0u, 0u);
	gte.writeDataRegister(1u, 0x7f20u);

	gte.execute(GTE_SF | bmsx::GX_GTE_FN_RTPS);

	require(gte.readDataRegister(19u) == 0x7f20u, "RTPS UNR saturating SZ3");
	require(gte.readDataRegister(14u) == pack16(160u, 120u), "RTPS UNR saturating SXY2");
	require(gte.readControlRegister(31u) == 0u, "RTPS UNR saturating FLAG");
}

} // namespace

int main() {
	testRtpsIdentityProjection();
	testMmioExecution();
	testNclip();
	testOp();
	testMvmva();
	testMvmvaReadsVectorOnce();
	testMvmvaReservedMatrixQuirk();
	testMvmvaFarColorTranslationBug();
	testSqr();
	testDpcs();
	testIntpl();
	testDcpl();
	testDpct();
	testNcsNct();
	testNccsCc();
	testNcdsCdp();
	testNcdtNcct();
	testGpfGpl();
	testGpfUsesSignedIr0();
	testDepthCueUsesSignedIr0();
	testGplWrapsMac44BeforeShift();
	testRgbColorSaturationFlags();
	testAvsz3();
	testAvsz4();
	testRtpsNarrowsMacResultToRegisterDatapath();
	testRtpsIr3ClampsFromMac3RegisterValue();
	testRawCop2RegisterEdges();
	testRtpsUsesUnsignedHWithSignExtendedReadback();
	testRtptDepthCueUsesLastVertex();
	testUnknownFunctionCodeIsDeterministicNoop();
	testOpcodeZeroIsNotRtpsAlias();
	testSaveStatePreservesRawRegisterWords();
	testRtpsDivideOverflow();
	testRtpsUnrResultSaturatesWithoutDivideOverflow();
	return 0;
}

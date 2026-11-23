#include "machine/machine.h"
#include "spec/bmsx/model.h"
#include "support/cartridge_fixture.h"
#include <fstream>
#include <iostream>
#include <limits>
#include <stdexcept>

class IdleInput final : public bmsx::InputControllerInputSource {
public:
	void sampleInputControllerSnapshot(bmsx::InputControllerSnapshot&, bmsx::InputControllerSampleContext) override {}
	bool supervisorRequestLineHigh() const override { return false; }
	void applyInputControllerVibrationEffect(bmsx::i32, bmsx::f64, bmsx::f64) override {}
};

int main(int argc, char** argv) {
	if (argc != 2) return 2;
	std::ifstream input(argv[1]);
	bmsx::Memory memory({ {}, bmsx::test::cartridgeSlots() }, bmsx::PSX_MACHINE_SPEC.ramBytes);
	IdleInput idle;
	bmsx::Machine machine(memory, idle, bmsx::PSX_MACHINE_SPEC);
	bmsx::u32 fixtureRamEnd;
	input >> fixtureRamEnd;
	if (!machine.cpu.heapAllocator().setFloor(fixtureRamEnd))
		throw std::runtime_error("GEO vectors must own their mapped fixture RAM");
	unsigned count;
	while (input >> count) {
		machine.scheduler.reset();
		machine.resetDevices();
		auto& geometry = machine.geometryController;
		geometry.setTiming(1, 1);
		for (unsigned i = 0; i < count; i++) {
			bmsx::u32 address, word;
			input >> address >> word;
			memory.writeMappedWord(address, word);
		}
		auto advanceGeometryEdge = [&]() {
			const auto now = machine.scheduler.nowCycles();
			const auto deadline = machine.scheduler.nextDeadline();
			if (deadline < now || deadline == std::numeric_limits<bmsx::i64>::max())
				throw std::runtime_error("busy GEO has no scheduled event");
			const int delta = static_cast<int>(deadline - now);
			if (delta > 0) {
				const auto status = memory.readMappedWord(bmsx::IO_GEO_STATUS);
				const auto processed = memory.readMappedWord(bmsx::IO_GEO_PROCESSED);
				machine.scheduler.advanceTo(machine.scheduler.nowCycles() + delta - 1);
				if (memory.readMappedWord(bmsx::IO_GEO_STATUS) != status || memory.readMappedWord(bmsx::IO_GEO_PROCESSED) != processed)
					throw std::runtime_error("GEO published before its event deadline");
				machine.scheduler.advanceTo(machine.scheduler.nowCycles() + 1);
			}
			while (machine.scheduler.hasDueTimer()) machine.runDeviceService(machine.scheduler.popDueTimer());
		};
		bmsx::u32 firstRecordPairs;
		input >> firstRecordPairs;
		if (firstRecordPairs != 0u)
			geometry.setTiming(bmsx::PSX_MACHINE_SPEC.cpuFreqHz, bmsx::PSX_MACHINE_SPEC.geoWorkUnitsPerSec);
		bmsx::u32 pairCounterSeed;
		input >> pairCounterSeed;
		if (pairCounterSeed != 0u) {
			auto state = geometry.captureState();
			state.activeJob->exactPairCount = pairCounterSeed;
			state.activeJob->broadphasePairCount = pairCounterSeed;
			geometry.restoreState(state, machine.scheduler.nowCycles());
		}
		if (firstRecordPairs != 0u || pairCounterSeed != 0u) {
			if (memory.readMappedWord(bmsx::IO_GEO_PROCESSED) != 0u)
				throw std::runtime_error("GEO progressed before the first event");
			while (memory.readMappedWord(bmsx::IO_GEO_PROCESSED) == 0u && geometry.hasPendingWork()) advanceGeometryEdge();
			if (memory.readMappedWord(bmsx::IO_GEO_PROCESSED) != 1u)
				throw std::runtime_error("first GEO record did not complete");
			if (firstRecordPairs != 0u) {
				std::cout << 0 << ' ' << 1 << ' ' << memory.readMappedWord(memory.readMappedWord(bmsx::IO_GEO_DST1)) << ' ';
			} else {
				const auto progressed = geometry.captureState();
				std::cout << progressed.activeJob->exactPairCount << ' ' << progressed.activeJob->broadphasePairCount << ' ';
			}
		}
		while (geometry.hasPendingWork()) advanceGeometryEdge();
		input >> count;
		for (unsigned i = 0; i < count; i++) {
			bmsx::u32 address;
			input >> address;
			std::cout << memory.readMappedWord(address) << ' ';
		}
		std::cout << '\n';
	}
}

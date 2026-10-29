# Native owners produce real files. Make schedules only changed dependencies;
# there is no parallel status database or automatic whole-project review loop.
CAD_PYTHON ?= .venv/bin/python
KICAD_PYTHON ?= python3
KICAD_CLI ?= kicad-cli
IVERILOG ?= iverilog
IVERILOG_FLAGS ?=
VVP ?= vvp
YOSYS ?= yosys
TSX ?= ../node_modules/.bin/tsx
ESBUILD ?= ../node_modules/.bin/esbuild
NODE ?= node
PYTHON ?= python3
FIRMWARE ?= ../dist/system/bmsx-bios.rom
FIRMWARE_DEBUG ?= ../dist/system/bmsx-bios.debug.rom
CAD = env -u PYTHONPATH $(CAD_PYTHON)
EXPORTS = build/exports
REPORTS = build/reports
MAINBOARD = ecad/mainboard/BMSX
FRONT = ecad/front/BMSX_FRONT
KEYBOARD = ecad/keyboard/BMSX_KEYBOARD
AV = ecad/av/BMSX_AV_BREAKOUT
SCART = ecad/scart/BMSX_SCART_TERM
MAIN_SCH = $(wildcard ecad/mainboard/*.kicad_sch ecad/mainboard/*.kicad_sym) ecad/mainboard/sym-lib-table
MAIN_PCB = $(MAINBOARD).kicad_pcb $(MAINBOARD).kicad_pro $(MAINBOARD).kicad_dru

.DEFAULT_GOAL := help
.DELETE_ON_ERROR:
.PHONY: help all native ecad-exports bareboards schemas check check-erc check-rtl check-pad check-keyboard check-context check-io check-rom check-events check-memory check-gfx check-system-integration check-apu check-apu-memory check-apu-eight check-apu-physical check-apu-synthesis check-resources check-firmware firmware-images drc drc-reports analyses manuscript format lint clean
help:
	@printf '%s\n' 'BMSX hardware reference construction' \
	'  make native       native CAD/EDA exchange files (incremental)' \
	'  make check        geometric checks, ERC and numerical engineering checks' \
	'  make check-rtl    directed bus, U7 ROM/input, CORE events, keyboard and accessory simulations' \
	'  make check-pad    serial pad frames and actual APPLY bus integration' \
	'  make check-memory  DRAM/SRAM waveforms, APU word store and CORE integration' \
	'  make check-cart-physical  CORE/CAD scalar ingress and cartridge SRAM pins' \
	'  make check-cart-reference  real reference card ROM/RAM/mailbox pin paths' \
	'  make check-cart-pin-contract  Book III IRQ rearm conformance (currently fails)' \
	'  make check-dma-block  DMA channels, block datapath and CORE/CAD integration' \
	'  make check-apu    actual TS/C++ mixer workloads, SRAM capacity and bus feasibility' \
	'  make check-apu-square-mix  square source and shared filter/mixer against TS/C++' \
	'  make check-apu-eight  unchanged-runtime source demand and SRAM pin replay' \
	'  make check-apu-physical  stateful BADP, epoch uploads and actual SRAM pins' \
	'  make check-apu-synthesis  native generic Yosys resource screen and netlists' \
	'  make apu-blueprint  service organization, coarse budgets and native SVG/PNG only' \
	'  make board-integration  native harness schedule and shared rail-load arithmetic' \
	'  make check-dc-carrier  isolated carrier and native STEP regression' \
	'  make check-scart   only the new contact-board ERC and raw DRC' \
	'  make firmware-images  complete zero-tailed U33 images from FIRMWARE/FIRMWARE_DEBUG' \
	'  make drc-reports  raw native DRC reports, including incomplete copper' \
	'  make drc          strict mainboard DRC; fails while copper is incomplete' \
	'  make publication  clean CAD illustrations for Book IV' \
	'  make manuscript   technical Markdown document and clean native figures' \
	'  make format/lint  the pinned Python formatter/linter' \
	'  make clean        remove generated hardware output only'

all: native check drc-reports board-integration
native: cad-native ecad-exports
check: check-cad check-erc check-rtl check-apu check-resources check-firmware analyses
bareboards: $(EXPORTS)/BMSX_COMPACT_board_native.step $(EXPORTS)/BMSX_PASSIVE_CANDIDATE_board_native.step $(EXPORTS)/BMSX_FRONT_board_native.step $(EXPORTS)/BMSX_KEYBOARD_board_native.step $(EXPORTS)/BMSX_AV_BREAKOUT_board_native.step $(EXPORTS)/BMSX_SCART_TERM_board_native.step
schemas: $(EXPORTS)/BMSX_schema.pdf $(EXPORTS)/BMSX_FRONT_schema.pdf $(EXPORTS)/BMSX_KEYBOARD_schema.pdf $(EXPORTS)/BMSX_AV_BREAKOUT_schema.pdf $(EXPORTS)/BMSX_SCART_TERM_schema.pdf
ecad-exports: bareboards schemas $(EXPORTS)/BMSX_netlist.xml $(EXPORTS)/BMSX_components.csv $(EXPORTS)/BMSX_SCART_TERM_netlist.xml $(EXPORTS)/BMSX_SCART_TERM_components.csv

$(EXPORTS)/BMSX_SCART_TERM_board_native.step: $(SCART).kicad_pcb $(SCART).kicad_pro
	@mkdir -p $(@D)
	$(KICAD_CLI) pcb export step --board-only --min-distance 0.000001mm --force -o $@ $(SCART).kicad_pcb
$(EXPORTS)/BMSX_SCART_TERM_schema.pdf: $(SCART).kicad_sch ecad/scart/SCART.kicad_sym
	@mkdir -p $(@D)
	$(KICAD_CLI) sch export pdf --exclude-pdf-property-popups -o $@ $(SCART).kicad_sch
$(EXPORTS)/BMSX_SCART_TERM_netlist.xml: $(SCART).kicad_sch ecad/scart/SCART.kicad_sym
	@mkdir -p $(@D)
	$(KICAD_CLI) sch export netlist --format kicadxml -o $@ $(SCART).kicad_sch
$(EXPORTS)/BMSX_SCART_TERM_components.csv: $(SCART).kicad_sch ecad/scart/SCART.kicad_sym
	@mkdir -p $(@D)
	$(KICAD_CLI) sch export bom --fields 'Reference,Value,Footprint,Datasheet,$${QUANTITY},$${DNP}' --labels 'Reference,Value,Footprint,Datasheet,Quantity,DNP' -o $@ $(SCART).kicad_sch

.PHONY: check-scart
$(REPORTS)/scart-erc.json: $(SCART).kicad_sch $(SCART).kicad_pro ecad/scart/SCART.kicad_sym
	@mkdir -p $(@D)
	$(KICAD_CLI) sch erc --severity-all --format json --exit-code-violations -o $@ $(SCART).kicad_sch
$(REPORTS)/scart-drc.json: $(SCART).kicad_pcb $(SCART).kicad_pro $(SCART).kicad_sch
	@mkdir -p $(@D)
	$(KICAD_CLI) pcb drc --schematic-parity --severity-all --format json -o $@ $(SCART).kicad_pcb
check-scart: $(REPORTS)/scart-erc.json $(REPORTS)/scart-drc.json
check-erc: $(REPORTS)/scart-erc.json
drc-reports: $(REPORTS)/scart-drc.json

$(EXPORTS)/BMSX_COMPACT_board_native.step: $(MAIN_PCB)
	@mkdir -p $(@D)
	$(KICAD_CLI) pcb export step --board-only --min-distance 0.000001mm --force -o $@ $(MAINBOARD).kicad_pcb
$(EXPORTS)/BMSX_PASSIVE_CANDIDATE_board_native.step: ecad/mainboard_passive_candidate/BMSX.kicad_pcb ecad/mainboard_passive_candidate/BMSX.kicad_pro
	@mkdir -p $(@D)
	$(KICAD_CLI) pcb export step --board-only --min-distance 0.000001mm --force -o $@ ecad/mainboard_passive_candidate/BMSX.kicad_pcb
$(EXPORTS)/BMSX_FRONT_board_native.step: $(FRONT).kicad_pcb $(FRONT).kicad_pro
	@mkdir -p $(@D)
	$(KICAD_CLI) pcb export step --board-only --min-distance 0.000001mm --force -o $@ $(FRONT).kicad_pcb
$(EXPORTS)/BMSX_KEYBOARD_board_native.step: $(KEYBOARD).kicad_pcb $(KEYBOARD).kicad_pro
	@mkdir -p $(@D)
	$(KICAD_CLI) pcb export step --board-only --min-distance 0.000001mm --force -o $@ $(KEYBOARD).kicad_pcb
$(EXPORTS)/BMSX_AV_BREAKOUT_board_native.step: $(AV).kicad_pcb $(AV).kicad_pro
	@mkdir -p $(@D)
	$(KICAD_CLI) pcb export step --board-only --min-distance 0.000001mm --force -o $@ $(AV).kicad_pcb

$(EXPORTS)/BMSX_schema.pdf: $(MAIN_SCH)
	@mkdir -p $(@D)
	$(KICAD_CLI) sch export pdf --exclude-pdf-property-popups -o $@ $(MAINBOARD).kicad_sch
$(EXPORTS)/BMSX_FRONT_schema.pdf: $(FRONT).kicad_sch ecad/front/Panel.kicad_sym
	@mkdir -p $(@D)
	$(KICAD_CLI) sch export pdf --exclude-pdf-property-popups -o $@ $(FRONT).kicad_sch
$(EXPORTS)/BMSX_KEYBOARD_schema.pdf: $(KEYBOARD).kicad_sch ecad/keyboard/Panel.kicad_sym
	@mkdir -p $(@D)
	$(KICAD_CLI) sch export pdf --exclude-pdf-property-popups -o $@ $(KEYBOARD).kicad_sch
$(EXPORTS)/BMSX_AV_BREAKOUT_schema.pdf: $(AV).kicad_sch ecad/av/Panel.kicad_sym
	@mkdir -p $(@D)
	$(KICAD_CLI) sch export pdf --exclude-pdf-property-popups -o $@ $(AV).kicad_sch
$(EXPORTS)/BMSX_netlist.xml: $(MAIN_SCH)
	@mkdir -p $(@D)
	$(KICAD_CLI) sch export netlist --format kicadxml -o $@ $(MAINBOARD).kicad_sch
$(EXPORTS)/BMSX_components.csv: $(MAIN_SCH)
	@mkdir -p $(@D)
	$(KICAD_CLI) sch export bom --fields 'Reference,Value,Footprint,Datasheet,$${QUANTITY},$${DNP}' --labels 'Reference,Value,Footprint,Datasheet,Quantity,DNP' -o $@ $(MAINBOARD).kicad_sch

# Strict ERC is an explicit native check, not a green reinterpretation of errors.
check-erc:
	@mkdir -p $(REPORTS)
	$(KICAD_CLI) sch erc --severity-all --format json --exit-code-violations -o $(REPORTS)/mainboard-erc.json $(MAINBOARD).kicad_sch
	$(KICAD_CLI) sch erc --severity-all --format json --exit-code-violations -o $(REPORTS)/front-erc.json $(FRONT).kicad_sch
	$(KICAD_CLI) sch erc --severity-all --format json --exit-code-violations -o $(REPORTS)/keyboard-erc.json $(KEYBOARD).kicad_sch
	$(KICAD_CLI) sch erc --severity-all --format json --exit-code-violations -o $(REPORTS)/av-erc.json $(AV).kicad_sch

$(REPORTS)/mainboard-drc.json: $(MAIN_PCB) $(MAIN_SCH)
	@mkdir -p $(@D)
	$(KICAD_CLI) pcb drc --schematic-parity --severity-all --format json -o $@ $(MAINBOARD).kicad_pcb
$(REPORTS)/front-drc.json: $(FRONT).kicad_pcb $(FRONT).kicad_pro $(FRONT).kicad_sch
	@mkdir -p $(@D)
	$(KICAD_CLI) pcb drc --schematic-parity --severity-all --format json -o $@ $(FRONT).kicad_pcb
$(REPORTS)/keyboard-drc.json: $(KEYBOARD).kicad_pcb $(KEYBOARD).kicad_pro $(KEYBOARD).kicad_sch
	@mkdir -p $(@D)
	$(KICAD_CLI) pcb drc --schematic-parity --severity-all --format json -o $@ $(KEYBOARD).kicad_pcb
$(REPORTS)/av-drc.json: $(AV).kicad_pcb $(AV).kicad_pro $(AV).kicad_sch
	@mkdir -p $(@D)
	$(KICAD_CLI) pcb drc --schematic-parity --severity-all --format json -o $@ $(AV).kicad_pcb
drc-reports: $(REPORTS)/mainboard-drc.json $(REPORTS)/front-drc.json $(REPORTS)/keyboard-drc.json $(REPORTS)/av-drc.json
drc:
	@mkdir -p $(REPORTS)
	$(KICAD_CLI) pcb drc --schematic-parity --severity-all --format json --exit-code-violations -o $(REPORTS)/mainboard-drc.json $(MAINBOARD).kicad_pcb

$(REPORTS)/thermal.json: tools/thermal.py design/thermal.json design/enclosure_structure.json design/enclosure_cooling.json
	$(CAD) tools/thermal.py
$(REPORTS)/video-circuit.json: tools/video_circuit.py design/video_output.json $(EXPORTS)/BMSX_netlist.xml
	$(CAD) tools/video_circuit.py --native-netlist $(EXPORTS)/BMSX_netlist.xml
$(REPORTS)/video-timing.json: tools/video_timing.py design/video_baseline.json $(EXPORTS)/BMSX_netlist.xml rtl/gfx_pcrtc_sys_endpoint.sv rtl/display_context_gfx.sv rtl/gfx_pcrtc_control.sv rtl/gfx_pcrtc_status.sv rtl/gfx_pcrtc_beam_phase.sv rtl/gfx_pcrtc_system_beam.sv rtl/gfx_pcrtc_cdc_startup.sv rtl/async_fifo.sv ../docs/book1/pcrtc.md ../machine/ts/machine/devices/gx/gpu_pcrtc.ts ../machine/cpp/machine/devices/gx/gpu_pcrtc.cpp
	$(CAD) tools/video_timing.py
$(REPORTS)/video-profile.json: tools/video_profile.py tools/video_timing.py design/analog_video_profile.json design/video_baseline.json design/video_output.json tools/video_circuit.py $(REPORTS)/video-circuit.json ../docs/book1/pcrtc.md ../machine/ts/machine/devices/gx/gpu_pcrtc.ts ../machine/cpp/machine/devices/gx/gpu_pcrtc.cpp
	$(CAD) tools/video_profile.py
build/video-memory: tests/video_memory.cpp ../machine/cpp/machine/devices/gx/gpu_local_memory.h ../machine/cpp/spec/gx/vram.h
	@mkdir -p $(@D)
	$(CXX) -std=c++20 -O2 -MMD -MP -I../machine/cpp $< -o $@
-include build/video-memory.d
$(REPORTS)/video-memory-cpp.json: build/video-memory
	@mkdir -p $(@D)
	$< > $@
$(REPORTS)/video-memory-ts.json: tests/video_memory.ts ../machine/ts/machine/devices/gx/gpu_local_memory.ts ../machine/ts/spec/gx/vram.ts
	@mkdir -p $(@D)
	$(TSX) $< > $@
analyses: $(REPORTS)/system-bus-timing.json $(REPORTS)/thermal.json $(REPORTS)/video-circuit.json $(REPORTS)/video-timing.json $(REPORTS)/video-profile.json $(REPORTS)/video-memory-cpp.json $(REPORTS)/video-memory-ts.json

build/tests/system_bus_%.vvp: rtl/system_bus_master.sv tests/system_bus_tb.sv
	@mkdir -p $(@D)
	$(IVERILOG) $(IVERILOG_FLAGS) -g2012 -Wall -s system_bus_tb -Psystem_bus_tb.MAX_WAIT=$* -o $@ $^
$(REPORTS)/system_bus_%.txt: build/tests/system_bus_%.vvp
	@mkdir -p $(@D)
	$(VVP) $< > $@ || { cat $@; exit 1; }
check-rtl: $(REPORTS)/system_bus_1.txt $(REPORTS)/system_bus_3.txt $(REPORTS)/system_bus_16.txt check-pad check-keyboard check-context check-io check-rom check-events check-memory check-gfx check-system-integration check-apu-memory $(REPORTS)/apu-eight-stereo-memory.txt $(REPORTS)/apu-badp-step.txt $(REPORTS)/badp-decoder.txt $(REPORTS)/badp-decoder-coincident.txt $(REPORTS)/badp-decoder-upper-slots.txt $(REPORTS)/apu-upload-commit.txt $(REPORTS)/apu-badp-upload.txt
.SECONDARY: build/tests/system_bus_1.vvp build/tests/system_bus_3.vvp build/tests/system_bus_16.vvp

PAD_RTL = rtl/pad_protocol_pkg.sv rtl/pad_serial_master.sv rtl/pad_host.sv
build/tests/pad_host.vvp: $(PAD_RTL) tests/pad_host_tb.sv
	@mkdir -p $(@D)
	$(IVERILOG) $(IVERILOG_FLAGS) -g2012 -Wall -s pad_host_tb -o $@ $^
build/tests/pad_bus.vvp: $(PAD_RTL) rtl/system_bus_master.sv tests/pad_bus_tb.sv
	@mkdir -p $(@D)
	$(IVERILOG) $(IVERILOG_FLAGS) -g2012 -Wall -s pad_bus_tb -o $@ $^
$(REPORTS)/pad-host.txt: build/tests/pad_host.vvp
	@mkdir -p $(@D)
	$(VVP) $< > $@ || { cat $@; exit 1; }
$(REPORTS)/pad-bus.txt: build/tests/pad_bus.vvp
	@mkdir -p $(@D)
	$(VVP) $< > $@ || { cat $@; exit 1; }
check-pad: $(REPORTS)/pad-host.txt $(REPORTS)/pad-bus.txt $(REPORTS)/accessory-link.txt


build/tests/keyboard_set2.vvp: rtl/keyboard_set2.sv tests/keyboard_set2_tb.sv
	@mkdir -p $(@D)
	$(IVERILOG) $(IVERILOG_FLAGS) -g2012 -Wall -s keyboard_set2_tb -o $@ $^
$(REPORTS)/keyboard-set2.txt: build/tests/keyboard_set2.vvp
	@mkdir -p $(@D)
	$(VVP) $< > $@ || { cat $@; exit 1; }
check-keyboard: $(REPORTS)/keyboard-set2.txt


CONTEXT_RTL = rtl/pad_protocol_pkg.sv rtl/display_context_tx.sv rtl/display_context_rx.sv rtl/display_context_gfx.sv rtl/gfx_pcrtc_beam_phase.sv rtl/gfx_pcrtc_system_beam.sv rtl/gfx_pcrtc_status.sv rtl/gfx_pcrtc_control.sv
IO_RTL = $(PAD_RTL) rtl/display_context_rx.sv rtl/io_registerfile.sv rtl/io_sys_endpoint.sv rtl/io_controller.sv
U7_RTL = $(IO_RTL) rtl/keyboard_set2.sv rtl/rom_sys_endpoint.sv rtl/io_system_pins.sv
build/tests/context_link.vvp: $(CONTEXT_RTL) tests/context_link_tb.sv
	@mkdir -p $(@D)
	$(IVERILOG) $(IVERILOG_FLAGS) -g2012 -Wall -s context_link_tb -o $@ $^
build/tests/accessory_link.vvp: $(PAD_RTL) rtl/pad_accessory.sv tests/accessory_link_tb.sv
	@mkdir -p $(@D)
	$(IVERILOG) $(IVERILOG_FLAGS) -g2012 -Wall -s accessory_link_tb -o $@ $^
build/tests/io_registerfile.vvp: rtl/io_registerfile.sv tests/io_registerfile_tb.sv
	@mkdir -p $(@D)
	$(IVERILOG) $(IVERILOG_FLAGS) -g2012 -Wall -s io_registerfile_tb -o $@ $^
$(REPORTS)/io-registerfile.txt: build/tests/io_registerfile.vvp
	@mkdir -p $(@D)
	$(VVP) $< > $@ || { cat $@; exit 1; }
build/tests/io_bus.vvp: $(IO_RTL) rtl/system_bus_master.sv rtl/pad_accessory.sv tests/io_bus_tb.sv
	@mkdir -p $(@D)
	$(IVERILOG) $(IVERILOG_FLAGS) -g2012 -Wall -s io_bus_tb -o $@ $^
$(REPORTS)/io-bus.txt: build/tests/io_bus.vvp
	@mkdir -p $(@D)
	$(VVP) $< > $@ || { cat $@; exit 1; }
build/tests/io_system_pins.vvp: $(U7_RTL) rtl/system_bus_master.sv tests/io_system_pins_tb.sv
	@mkdir -p $(@D)
	$(IVERILOG) $(IVERILOG_FLAGS) -g2012 -Wall -s io_system_pins_tb -o $@ $^
$(REPORTS)/display-context.txt: build/tests/context_link.vvp
	@mkdir -p $(@D)
	$(VVP) $< > $@ || { cat $@; exit 1; }
$(REPORTS)/accessory-link.txt: build/tests/accessory_link.vvp
	@mkdir -p $(@D)
	$(VVP) $< > $@ || { cat $@; exit 1; }
$(REPORTS)/io-system-pins.txt: build/tests/io_system_pins.vvp
	@mkdir -p $(@D)
	$(VVP) $< > $@ || { cat $@; exit 1; }
check-context: $(REPORTS)/display-context.txt
check-io: $(REPORTS)/io-system-pins.txt $(REPORTS)/io-registerfile.txt $(REPORTS)/io-bus.txt $(REPORTS)/io-reservation.txt

build/tests/rom_sys_endpoint.vvp: rtl/rom_sys_endpoint.sv rtl/system_bus_master.sv tests/rom_sys_endpoint_tb.sv
	@mkdir -p $(@D)
	$(IVERILOG) $(IVERILOG_FLAGS) -g2012 -Wall -s rom_sys_endpoint_tb -o $@ $^
$(REPORTS)/rom-sys-endpoint.txt: build/tests/rom_sys_endpoint.vvp
	@mkdir -p $(@D)
	$(VVP) $< > $@ || { cat $@; exit 1; }
check-rom: $(REPORTS)/rom-sys-endpoint.txt

build/tests/core_events.vvp: rtl/core_events.sv rtl/io_registerfile.sv tests/core_events_tb.sv
	@mkdir -p $(@D)
	$(IVERILOG) $(IVERILOG_FLAGS) -g2012 -Wall -s core_events_tb -o $@ $^
$(REPORTS)/core-events.txt: build/tests/core_events.vvp
	@mkdir -p $(@D)
	$(VVP) $< > $@ || { cat $@; exit 1; }
check-events: $(REPORTS)/core-events.txt

build/tests/main_dram.vvp: rtl/main_dram.sv tests/is41lv16100_model.sv tests/main_dram_tb.sv
	@mkdir -p $(@D)
	$(IVERILOG) $(IVERILOG_FLAGS) -g2012 -Wall -s main_dram_tb -o $@ $^
build/tests/async_sram.vvp: rtl/async_sram.sv tests/issi_bll_model.sv tests/async_sram_tb.sv
	@mkdir -p $(@D)
	$(IVERILOG) $(IVERILOG_FLAGS) -g2012 -Wall -s async_sram_tb -o $@ $^
build/tests/apu_sample_store.vvp: rtl/async_sram.sv rtl/apu_sample_store.sv tests/issi_bll_model.sv tests/apu_sample_store_tb.sv
	@mkdir -p $(@D)
	$(IVERILOG) $(IVERILOG_FLAGS) -g2012 -Wall -s apu_sample_store_tb -o $@ $^
build/tests/core_memory_system.vvp: $(U7_RTL) rtl/system_bus_master.sv rtl/main_dram.sv rtl/core_ram_scalar.sv rtl/core_memory_system.sv tests/is41lv16100_model.sv tests/core_memory_system_tb.sv
	@mkdir -p $(@D)
	$(IVERILOG) $(IVERILOG_FLAGS) -g2012 -Wall -s core_memory_system_tb -o $@ $^
build/tests/core_ram_scalar.vvp: rtl/main_dram.sv rtl/core_ram_scalar.sv tests/is41lv16100_model.sv tests/core_ram_scalar_tb.sv
	@mkdir -p $(@D)
	$(IVERILOG) $(IVERILOG_FLAGS) -g2012 -Wall -s core_ram_scalar_tb -o $@ $^
$(REPORTS)/main-dram.txt: build/tests/main_dram.vvp
	@mkdir -p $(@D)
	$(VVP) $< > $@ || { cat $@; exit 1; }
$(REPORTS)/async-sram.txt: build/tests/async_sram.vvp
	@mkdir -p $(@D)
	$(VVP) $< > $@ || { cat $@; exit 1; }
$(REPORTS)/apu-sample-store.txt: build/tests/apu_sample_store.vvp
	@mkdir -p $(@D)
	$(VVP) $< > $@ || { cat $@; exit 1; }
$(REPORTS)/core-memory-system.txt: build/tests/core_memory_system.vvp
	@mkdir -p $(@D)
	$(VVP) $< > $@ || { cat $@; exit 1; }
$(REPORTS)/core-ram-scalar.txt: build/tests/core_ram_scalar.vvp
	@mkdir -p $(@D)
	$(VVP) $< > $@ || { cat $@; exit 1; }
check-memory: $(REPORTS)/main-dram.txt $(REPORTS)/async-sram.txt $(REPORTS)/apu-sample-store.txt $(REPORTS)/core-memory-system.txt $(REPORTS)/core-ram-scalar.txt

build/tests/core_private_ram_integration.vvp: rtl/cpu_slot_word_store.sv rtl/system_bus_master.sv rtl/main_dram.sv rtl/core_ram_scalar.sv rtl/core_memory_system.sv tests/is41lv16100_model.sv tests/core_private_ram_integration_tb.sv
	@mkdir -p $(@D)
	$(IVERILOG) $(IVERILOG_FLAGS) -g2012 -Wall -s core_private_ram_integration_tb -o $@ $^
$(REPORTS)/core-private-ram-integration.txt: build/tests/core_private_ram_integration.vvp
	@mkdir -p $(REPORTS)
	@set -e; $(VVP) $< > $@; \
	if $(VVP) $< +FAULT_SHARED_OE=1 > $@.failure 2>&1; then cat $@.failure; exit 1; fi; \
	grep -q 'EDO retained output causes inter-bank data contention' $@.failure; \
	echo 'PASS deliberately shared OE detects retained EDO data contention' >> $@; rm -f $@.failure
build/tests/is41lv16100_write_hold.vvp: tests/is41lv16100_model.sv tests/is41lv16100_write_hold_tb.sv
	@mkdir -p $(@D)
	$(IVERILOG) $(IVERILOG_FLAGS) -g2012 -Wall -s is41lv16100_write_hold_tb -o $@ $^
$(REPORTS)/is41lv16100-write-hold.txt: build/tests/is41lv16100_write_hold.vvp
	@mkdir -p $(REPORTS)
	@set -e; for n in 8 9; do $(VVP) $< +HOLD=$$n; done > $@; \
	for n in 8 9; do $(VVP) $< +ADDR_HOLD=$$n >> $@; done; \
	$(VVP) $< +ADDR_HOLD=9 +SHORT_AFTER_ADDRESS=1 >> $@; \
	for n in 4 7; do \
	  if $(VVP) $< +HOLD=$$n > $@.failure 2>&1; then cat $@.failure; exit 1; fi; \
	  grep -q 'DRAM write data hold shorter than8ns' $@.failure; \
	  echo "PASS expected data-hold rejection at $${n}ns" >> $@; \
	  if $(VVP) $< +ADDR_HOLD=$$n > $@.failure 2>&1; then cat $@.failure; exit 1; fi; \
	  grep -q 'DRAM column address hold after CAS falling shorter than8ns' $@.failure; \
	  echo "PASS expected column-address-hold rejection at $${n}ns" >> $@; \
	done; rm -f $@.failure
$(REPORTS)/core-private-ram-synthesis.txt $(EXPORTS)/rtl/core_ram_scalar_2bank.json &: rtl/main_dram.sv rtl/core_ram_scalar.sv
	@mkdir -p $(REPORTS) $(EXPORTS)/rtl
	$(YOSYS) -l $(REPORTS)/core-private-ram-synthesis.txt -p 'read_verilog -sv $^; hierarchy -check -top core_ram_scalar; proc; opt; check -assert; stat; write_json $(EXPORTS)/rtl/core_ram_scalar_2bank.json' > /dev/null
.PHONY: check-core-private-ram
check-core-private-ram: $(REPORTS)/core-private-ram-integration.txt $(REPORTS)/is41lv16100-write-hold.txt $(REPORTS)/core-private-ram-synthesis.txt $(EXPORTS)/rtl/core_ram_scalar_2bank.json


$(REPORTS)/firmware-image.txt: tools/firmware_image.py tests/test_firmware_image.py
	@mkdir -p $(@D)
	$(PYTHON) -m unittest discover -s tests -p 'test_*.py' -v > $@ 2>&1 || { cat $@; exit 1; }
check-firmware: $(REPORTS)/firmware-image.txt

$(EXPORTS)/firmware/U33-normal.bin: $(FIRMWARE) tools/firmware_image.py
	@mkdir -p $(@D) $(REPORTS)
	rm -f $@
	$(PYTHON) tools/firmware_image.py $< $@ > $(REPORTS)/firmware-normal.json
$(EXPORTS)/firmware/U33-debug.bin: $(FIRMWARE_DEBUG) tools/firmware_image.py
	@mkdir -p $(@D) $(REPORTS)
	rm -f $@
	$(PYTHON) tools/firmware_image.py $< $@ > $(REPORTS)/firmware-debug.json
firmware-images: $(EXPORTS)/firmware/U33-normal.bin $(EXPORTS)/firmware/U33-debug.bin


# esbuild supplies the actual imported source closure. A standard make depfile
# retains that closure for local rebuilds and the release collector uses the
# same metadata to include the real owners, not alternate geometry algorithms.
build/tests/geo_resources.cjs $(REPORTS)/geo-resource-inputs.json &: tests/geo_resources.ts
	@mkdir -p build/tests $(REPORTS)
	$(ESBUILD) $< --bundle --platform=node --format=cjs --packages=external --outfile=build/tests/geo_resources.cjs --metafile=$(REPORTS)/geo-resource-inputs.json
	python3 -c 'import json; from pathlib import Path; d=json.loads(Path("$(REPORTS)/geo-resource-inputs.json").read_text()); Path("build/tests/geo_resources.d").write_text("build/tests/geo_resources.cjs $(REPORTS)/geo-resource-inputs.json: " + " ".join(d["inputs"]) + "\n")'
-include build/tests/geo_resources.d
$(REPORTS)/geo-resources.json: build/tests/geo_resources.cjs
	@mkdir -p $(@D)
	$(NODE) $< > $@
check-resources: $(REPORTS)/geo-resources.json

MANUSCRIPT = ../docs/book4/index.md ../docs/book4/construction.md ../docs/book4/hardware.md ../docs/book4/power.md ../docs/book4/connectors.md ../docs/book4/pads.md ../docs/book4/servicing.md
$(EXPORTS)/BMSX_technical_reference.md: $(MANUSCRIPT)
	@mkdir -p $(@D)
	cat $(MANUSCRIPT) > $@
manuscript: publication $(EXPORTS)/BMSX_technical_reference.md
	@mkdir -p $(EXPORTS)/figures
	cp ../docs/book4/figures/* $(EXPORTS)/figures/
	cp build/publication/*.png $(EXPORTS)/figures/

format:
	$(CAD) -m ruff format cad tools tests
lint:
	$(CAD) -m ruff check cad tools tests
clean:
	rm -rf build

include cad/targets.mk

$(REPORTS)/system-bus-timing.json: tools/system_bus_timing.py design/system_bus.json $(EXPORTS)/BMSX_netlist.xml
	$(PYTHON) tools/system_bus_timing.py

build/tests/io_reservation.vvp: $(IO_RTL) rtl/system_bus_master.sv rtl/pad_accessory.sv tests/io_reservation_tb.sv
	@mkdir -p $(@D)
	$(IVERILOG) $(IVERILOG_FLAGS) -g2012 -Wall -s io_reservation_tb -o $@ $^
$(REPORTS)/io-reservation.txt: build/tests/io_reservation.vvp
	@mkdir -p $(@D)
	$(VVP) $< > $@ || { cat $@; exit 1; }

build/tests/gfx_memory_scheduler.vvp: rtl/async_sram.sv rtl/gfx_memory_scheduler.sv tests/issi_bll_model.sv tests/gfx_memory_scheduler_tb.sv
	@mkdir -p $(@D)
	$(IVERILOG) $(IVERILOG_FLAGS) -g2012 -Wall -s gfx_memory_scheduler_tb -o $@ $^
$(REPORTS)/gfx-memory-scheduler.txt: build/tests/gfx_memory_scheduler.vvp
	@mkdir -p $(@D)
	$(VVP) $< > $@ || { cat $@; exit 1; }
check-gfx: $(REPORTS)/gfx-memory-scheduler.txt check-gfx-pcrtc-pipeline check-gfx-pcrtc-compositor check-gfx-pcrtc-window check-gfx-pcrtc-join check-gfx-pcrtc-coordinate-join check-gfx-pcrtc-beam-phase check-gfx-scanout-cdc check-gfx-pcrtc-visibility check-gfx-video-launch

build/tests/gfx_pcrtc_sample_vectors.cjs $(REPORTS)/gfx-pcrtc-sample-inputs.json &: tests/gfx_pcrtc_sample_vectors.ts
	@mkdir -p build/tests $(REPORTS)
	$(ESBUILD) $< --bundle --platform=node --format=cjs --packages=external --outfile=build/tests/gfx_pcrtc_sample_vectors.cjs --metafile=$(REPORTS)/gfx-pcrtc-sample-inputs.json
	$(PYTHON) -c 'import json; from pathlib import Path; d=json.loads(Path("$(REPORTS)/gfx-pcrtc-sample-inputs.json").read_text()); Path("build/tests/gfx_pcrtc_sample_ts.d").write_text("build/tests/gfx_pcrtc_sample_vectors.cjs $(REPORTS)/gfx-pcrtc-sample-inputs.json: " + " ".join(d["inputs"]) + "\n")'
-include build/tests/gfx_pcrtc_sample_ts.d
build/tests/gfx-pcrtc-sample-vectors.txt: build/tests/gfx_pcrtc_sample_vectors.cjs
	$(NODE) $< > $@
build/tests/gfx_pcrtc_sample_cpp: tests/gfx_pcrtc_sample_vectors.cpp ../machine/cpp/render/backend/software/gx_gpu_scanout_palette.cpp
	@mkdir -p $(@D)
	$(CXX) -std=c++20 -O2 -ffunction-sections -fdata-sections -I../machine/cpp -MM -MT $@ $(filter %.cpp,$^) > build/tests/gfx_pcrtc_sample_cpp.d
	$(CXX) -std=c++20 -O2 -ffunction-sections -fdata-sections -I../machine/cpp $(filter %.cpp,$^) -Wl,--gc-sections -o $@
-include build/tests/gfx_pcrtc_sample_cpp.d
$(REPORTS)/gfx-pcrtc-sample-cpp.txt: build/tests/gfx_pcrtc_sample_cpp build/tests/gfx-pcrtc-sample-vectors.txt
	@mkdir -p $(REPORTS)
	$< < build/tests/gfx-pcrtc-sample-vectors.txt > $@

build/tests/gfx_pcrtc_sample_pipeline.vvp: rtl/gfx_pcrtc_sample_pipeline.sv rtl/gfx_memory_scheduler.sv rtl/async_sram.sv tests/issi_bll_model.sv tests/gfx_pcrtc_sample_pipeline_tb.sv
	@mkdir -p $(@D)
	$(IVERILOG) $(IVERILOG_FLAGS) -g2012 -Wall -s gfx_pcrtc_sample_pipeline_tb -o $@ $^
$(REPORTS)/gfx-pcrtc-pipeline-rtl.txt: build/tests/gfx_pcrtc_sample_pipeline.vvp build/tests/gfx-pcrtc-sample-vectors.txt
	@mkdir -p $(REPORTS)
	$(VVP) $< > $@ || { cat $@; exit 1; }
	$(VVP) $< +SATURATE=1 >> $@ || { cat $@; exit 1; }
	$(VVP) $< +HOLD_OUTPUT=1 >> $@ || { cat $@; exit 1; }
	$(VVP) $< +WARM_RESET=1 >> $@ || { cat $@; exit 1; }
	$(VVP) $< +HOLD_OUTPUT=1 +REQUEST_STALL=1 >> $@ || { cat $@; exit 1; }
$(REPORTS)/gfx-pcrtc-pipeline-synthesis.txt $(EXPORTS)/rtl/gfx_pcrtc_sample_pipeline.json &: rtl/gfx_pcrtc_sample_pipeline.sv
	@mkdir -p $(REPORTS) $(EXPORTS)/rtl
	$(YOSYS) -l $(REPORTS)/gfx-pcrtc-pipeline-synthesis.txt -p 'read_verilog -sv $^; hierarchy -check -top gfx_pcrtc_sample_pipeline; proc; opt; check -assert; stat; write_json $(EXPORTS)/rtl/gfx_pcrtc_sample_pipeline.json' > /dev/null
$(REPORTS)/gfx-pcrtc-pipeline-circuit2-synthesis.txt $(EXPORTS)/rtl/gfx_pcrtc_sample_pipeline_circuit2.json &: rtl/gfx_pcrtc_sample_pipeline.sv
	@mkdir -p $(REPORTS) $(EXPORTS)/rtl
	$(YOSYS) -l $(REPORTS)/gfx-pcrtc-pipeline-circuit2-synthesis.txt -p 'read_verilog -sv $^; chparam -set CIRCUIT2 1 gfx_pcrtc_sample_pipeline; hierarchy -check -top gfx_pcrtc_sample_pipeline; proc; opt; check -assert; stat; write_json $(EXPORTS)/rtl/gfx_pcrtc_sample_pipeline_circuit2.json' > /dev/null
.PHONY: check-gfx-pcrtc-pipeline
check-gfx-pcrtc-pipeline: $(REPORTS)/gfx-pcrtc-sample-cpp.txt $(REPORTS)/gfx-pcrtc-pipeline-rtl.txt $(REPORTS)/gfx-pcrtc-pipeline-synthesis.txt $(EXPORTS)/rtl/gfx_pcrtc_sample_pipeline.json $(REPORTS)/gfx-pcrtc-pipeline-circuit2-synthesis.txt $(EXPORTS)/rtl/gfx_pcrtc_sample_pipeline_circuit2.json

build/tests/cpu_instruction_fetch.vvp: rtl/cpu_instruction_fetch.sv tests/cpu_instruction_fetch_tb.sv
	@mkdir -p $(@D)
	$(IVERILOG) $(IVERILOG_FLAGS) -g2012 -Wall -s cpu_instruction_fetch_tb -o $@ $^
build/tests/cpu_instruction_fetch_core.vvp: rtl/cpu_instruction_fetch.sv rtl/system_bus_master.sv rtl/main_dram.sv rtl/core_ram_scalar.sv rtl/core_memory_system.sv rtl/rom_sys_endpoint.sv tests/is41lv16100_model.sv tests/cpu_instruction_fetch_core_tb.sv
	@mkdir -p $(@D)
	$(IVERILOG) $(IVERILOG_FLAGS) -g2012 -Wall -s cpu_instruction_fetch_core_tb -o $@ $^
$(REPORTS)/cpu-instruction-fetch.txt: build/tests/cpu_instruction_fetch.vvp
	@mkdir -p $(REPORTS)
	$(VVP) $< > $@ || { cat $@; exit 1; }
$(REPORTS)/cpu-instruction-fetch-core.txt: build/tests/cpu_instruction_fetch_core.vvp
	@mkdir -p $(REPORTS)
	$(VVP) $< > $@ || { cat $@; exit 1; }
$(REPORTS)/cpu-instruction-fetch-synthesis.txt $(EXPORTS)/rtl/cpu_instruction_fetch.json &: rtl/cpu_instruction_fetch.sv
	@mkdir -p $(REPORTS) $(EXPORTS)/rtl
	$(YOSYS) -l $(REPORTS)/cpu-instruction-fetch-synthesis.txt -p 'read_verilog -sv $^; hierarchy -check -top cpu_instruction_fetch; proc; opt; check -assert; stat; write_json $(EXPORTS)/rtl/cpu_instruction_fetch.json' > /dev/null
.PHONY: check-cpu-fetch
check-cpu-fetch: $(REPORTS)/cpu-instruction-fetch.txt $(REPORTS)/cpu-instruction-fetch-core.txt $(REPORTS)/cpu-instruction-fetch-synthesis.txt $(EXPORTS)/rtl/cpu_instruction_fetch.json

build/tests/cpu_instruction_decode_vectors.cjs $(REPORTS)/cpu-instruction-decode-inputs.json &: tests/cpu_instruction_decode_vectors.ts
	@mkdir -p build/tests $(REPORTS)
	$(ESBUILD) $< --bundle --platform=node --format=cjs --packages=external --outfile=build/tests/cpu_instruction_decode_vectors.cjs --metafile=$(REPORTS)/cpu-instruction-decode-inputs.json
	$(PYTHON) -c 'import json; from pathlib import Path; d=json.loads(Path("$(REPORTS)/cpu-instruction-decode-inputs.json").read_text()); Path("build/tests/cpu_instruction_decode_ts.d").write_text("build/tests/cpu_instruction_decode_vectors.cjs $(REPORTS)/cpu-instruction-decode-inputs.json: " + " ".join(d["inputs"]) + "\n")'
-include build/tests/cpu_instruction_decode_ts.d
build/tests/cpu-instruction-decode-vectors.txt: build/tests/cpu_instruction_decode_vectors.cjs
	$(NODE) $< > $@
build/tests/cpu_instruction_decode_cpp: tests/cpu_instruction_decode_vectors.cpp ../machine/cpp/spec/blua32/instruction_format.cpp ../machine/cpp/spec/blua32/opcode.cpp
	@mkdir -p $(@D)
	$(CXX) -std=c++20 -O2 -ffunction-sections -fdata-sections -I../machine/cpp -MM -MT $@ $(filter %.cpp,$^) > build/tests/cpu_instruction_decode_cpp.d
	$(CXX) -std=c++20 -O2 -ffunction-sections -fdata-sections -I../machine/cpp $(filter %.cpp,$^) -Wl,--gc-sections -o $@
-include build/tests/cpu_instruction_decode_cpp.d
build/tests/cpu_instruction_decode.vvp: rtl/cpu_instruction_decode.sv tests/cpu_instruction_decode_tb.sv
	@mkdir -p $(@D)
	$(IVERILOG) $(IVERILOG_FLAGS) -g2012 -Wall -s cpu_instruction_decode_tb -o $@ $^
build/tests/cpu_instruction_decode_stream.vvp: rtl/cpu_instruction_decode.sv tests/cpu_instruction_decode_stream_tb.sv
	@mkdir -p $(@D)
	$(IVERILOG) $(IVERILOG_FLAGS) -g2012 -Wall -s cpu_instruction_decode_stream_tb -o $@ $^
build/tests/cpu_fetch_decode.vvp: rtl/cpu_instruction_fetch.sv rtl/cpu_instruction_decode.sv tests/cpu_fetch_decode_tb.sv
	@mkdir -p $(@D)
	$(IVERILOG) $(IVERILOG_FLAGS) -g2012 -Wall -s cpu_fetch_decode_tb -o $@ $^
$(REPORTS)/cpu-instruction-decode-cpp.txt: build/tests/cpu_instruction_decode_cpp build/tests/cpu-instruction-decode-vectors.txt
	@mkdir -p $(REPORTS)
	$< < build/tests/cpu-instruction-decode-vectors.txt > $@
$(REPORTS)/cpu-instruction-decode-rtl.txt: build/tests/cpu_instruction_decode.vvp build/tests/cpu-instruction-decode-vectors.txt
	@mkdir -p $(REPORTS)
	$(VVP) $< > $@ || { cat $@; exit 1; }
$(REPORTS)/cpu-instruction-decode-stream.txt: build/tests/cpu_instruction_decode_stream.vvp build/tests/cpu-instruction-decode-vectors.txt
	@mkdir -p $(REPORTS)
	$(VVP) $< > $@ || { cat $@; exit 1; }
$(REPORTS)/cpu-fetch-decode.txt: build/tests/cpu_fetch_decode.vvp build/tests/cpu-instruction-decode-vectors.txt
	@mkdir -p $(REPORTS)
	$(VVP) $< > $@ || { cat $@; exit 1; }
$(REPORTS)/cpu-instruction-decode-synthesis.txt $(EXPORTS)/rtl/cpu_instruction_decode.json &: rtl/cpu_instruction_decode.sv
	@mkdir -p $(REPORTS) $(EXPORTS)/rtl
	$(YOSYS) -l $(REPORTS)/cpu-instruction-decode-synthesis.txt -p 'read_verilog -sv $^; hierarchy -check -top cpu_instruction_decode; proc; opt; check -assert; stat; write_json $(EXPORTS)/rtl/cpu_instruction_decode.json' > /dev/null
.PHONY: check-cpu-decode
check-cpu-decode: $(REPORTS)/cpu-instruction-decode-cpp.txt $(REPORTS)/cpu-instruction-decode-rtl.txt $(REPORTS)/cpu-instruction-decode-stream.txt $(REPORTS)/cpu-fetch-decode.txt $(REPORTS)/cpu-instruction-decode-synthesis.txt $(EXPORTS)/rtl/cpu_instruction_decode.json

build/tests/cpu_word_alu_vectors.cjs $(REPORTS)/cpu-word-alu-inputs.json &: tests/cpu_word_alu_vectors.ts
	@mkdir -p build/tests $(REPORTS)
	$(ESBUILD) $< --bundle --platform=node --format=cjs --packages=external --outfile=build/tests/cpu_word_alu_vectors.cjs --metafile=$(REPORTS)/cpu-word-alu-inputs.json
	$(PYTHON) -c 'import json; from pathlib import Path; d=json.loads(Path("$(REPORTS)/cpu-word-alu-inputs.json").read_text()); Path("build/tests/cpu_word_alu_ts.d").write_text("build/tests/cpu_word_alu_vectors.cjs $(REPORTS)/cpu-word-alu-inputs.json: " + " ".join(d["inputs"]) + "\n")'
-include build/tests/cpu_word_alu_ts.d
build/tests/cpu-word-alu-vectors.txt: build/tests/cpu_word_alu_vectors.cjs
	$(NODE) $< > $@
build/tests/cpu_word_alu_cpp: tests/cpu_word_alu_vectors.cpp
	@mkdir -p $(@D)
	$(CXX) -std=c++20 -O2 -I../machine/cpp -MM -MT $@ $< > build/tests/cpu_word_alu_cpp.d
	$(CXX) -std=c++20 -O2 -I../machine/cpp $< -o $@
-include build/tests/cpu_word_alu_cpp.d
build/tests/cpu_word_alu.vvp: rtl/cpu_word_alu.sv tests/cpu_word_alu_tb.sv
	@mkdir -p $(@D)
	$(IVERILOG) $(IVERILOG_FLAGS) -g2012 -Wall -s cpu_word_alu_tb -o $@ $^
build/tests/cpu_word_alu_stream.vvp: rtl/cpu_word_alu.sv tests/cpu_word_alu_stream_tb.sv
	@mkdir -p $(@D)
	$(IVERILOG) $(IVERILOG_FLAGS) -g2012 -Wall -s cpu_word_alu_stream_tb -o $@ $^
build/tests/cpu_fetch_decode_word_alu.vvp: rtl/cpu_instruction_fetch.sv rtl/cpu_instruction_decode.sv rtl/cpu_word_alu.sv tests/cpu_fetch_decode_word_alu_tb.sv
	@mkdir -p $(@D)
	$(IVERILOG) $(IVERILOG_FLAGS) -g2012 -Wall -s cpu_fetch_decode_word_alu_tb -o $@ $^
$(REPORTS)/cpu-word-alu-cpp.txt: build/tests/cpu_word_alu_cpp build/tests/cpu-word-alu-vectors.txt
	@mkdir -p $(REPORTS)
	$< < build/tests/cpu-word-alu-vectors.txt > $@
$(REPORTS)/cpu-word-alu-rtl.txt: build/tests/cpu_word_alu.vvp build/tests/cpu-word-alu-vectors.txt
	@mkdir -p $(REPORTS)
	$(VVP) $< > $@ || { cat $@; exit 1; }
$(REPORTS)/cpu-word-alu-stream.txt: build/tests/cpu_word_alu_stream.vvp build/tests/cpu-word-alu-vectors.txt
	@mkdir -p $(REPORTS)
	$(VVP) $< > $@ || { cat $@; exit 1; }
$(REPORTS)/cpu-fetch-decode-word-alu.txt: build/tests/cpu_fetch_decode_word_alu.vvp build/tests/cpu-word-alu-vectors.txt
	@mkdir -p $(REPORTS)
	$(VVP) $< > $@ || { cat $@; exit 1; }
$(REPORTS)/cpu-word-alu-synthesis.txt $(EXPORTS)/rtl/cpu_word_alu.json &: rtl/cpu_word_alu.sv
	@mkdir -p $(REPORTS) $(EXPORTS)/rtl
	$(YOSYS) -l $(REPORTS)/cpu-word-alu-synthesis.txt -p 'read_verilog -sv $^; hierarchy -check -top cpu_word_alu; proc; opt; check -assert; stat; write_json $(EXPORTS)/rtl/cpu_word_alu.json' > /dev/null
.PHONY: check-cpu-word-alu
check-cpu-word-alu: $(REPORTS)/cpu-word-alu-cpp.txt $(REPORTS)/cpu-word-alu-rtl.txt $(REPORTS)/cpu-word-alu-stream.txt $(REPORTS)/cpu-fetch-decode-word-alu.txt $(REPORTS)/cpu-word-alu-synthesis.txt $(EXPORTS)/rtl/cpu_word_alu.json
check-rtl: check-cpu-fetch check-cpu-decode check-cpu-word-alu

build/tests/gfx_pcrtc_compositor_vectors.cjs $(REPORTS)/gfx-pcrtc-compositor-inputs.json &: tests/gfx_pcrtc_compositor_vectors.ts
	@mkdir -p build/tests $(REPORTS)
	$(ESBUILD) $< --bundle --platform=node --format=cjs --packages=external --outfile=build/tests/gfx_pcrtc_compositor_vectors.cjs --metafile=$(REPORTS)/gfx-pcrtc-compositor-inputs.json
	$(PYTHON) -c 'import json; from pathlib import Path; d=json.loads(Path("$(REPORTS)/gfx-pcrtc-compositor-inputs.json").read_text()); Path("build/tests/gfx_pcrtc_compositor_ts.d").write_text("build/tests/gfx_pcrtc_compositor_vectors.cjs $(REPORTS)/gfx-pcrtc-compositor-inputs.json: " + " ".join(d["inputs"]) + "\n")'
-include build/tests/gfx_pcrtc_compositor_ts.d
build/tests/gfx-pcrtc-compositor-vectors.txt: build/tests/gfx_pcrtc_compositor_vectors.cjs
	$(NODE) $< > $@
build/tests/gfx_pcrtc_compositor_cpp: tests/gfx_pcrtc_compositor_vectors.cpp ../machine/cpp/render/backend/software/gx_gpu_scanout_palette.cpp
	@mkdir -p $(@D)
	$(CXX) -std=c++20 -O2 -ffunction-sections -fdata-sections -I../machine/cpp -MM -MT $@ $(filter %.cpp,$^) > build/tests/gfx_pcrtc_compositor_cpp.d
	$(CXX) -std=c++20 -O2 -ffunction-sections -fdata-sections -I../machine/cpp $(filter %.cpp,$^) -Wl,--gc-sections -o $@
-include build/tests/gfx_pcrtc_compositor_cpp.d
build/tests/gfx_pcrtc_compositor.vvp: rtl/gfx_pcrtc_compositor.sv tests/gfx_pcrtc_compositor_tb.sv
	@mkdir -p $(@D)
	$(IVERILOG) $(IVERILOG_FLAGS) -g2012 -Wall -s gfx_pcrtc_compositor_tb -o $@ $^
$(REPORTS)/gfx-pcrtc-compositor-cpp.txt: build/tests/gfx_pcrtc_compositor_cpp build/tests/gfx-pcrtc-compositor-vectors.txt
	@mkdir -p $(REPORTS)
	$< < build/tests/gfx-pcrtc-compositor-vectors.txt > $@
$(REPORTS)/gfx-pcrtc-compositor-rtl.txt: build/tests/gfx_pcrtc_compositor.vvp build/tests/gfx-pcrtc-compositor-vectors.txt
	@mkdir -p $(REPORTS)
	$(VVP) $< > $@ || { cat $@; exit 1; }
$(REPORTS)/gfx-pcrtc-compositor-synthesis.txt $(EXPORTS)/rtl/gfx_pcrtc_compositor.json &: rtl/gfx_pcrtc_compositor.sv
	@mkdir -p $(REPORTS) $(EXPORTS)/rtl
	$(YOSYS) -l $(REPORTS)/gfx-pcrtc-compositor-synthesis.txt -p 'read_verilog -sv $^; hierarchy -check -top gfx_pcrtc_compositor; proc; opt; check -assert; stat; write_json $(EXPORTS)/rtl/gfx_pcrtc_compositor.json' > /dev/null
.PHONY: check-gfx-pcrtc-compositor
check-gfx-pcrtc-compositor: $(REPORTS)/gfx-pcrtc-compositor-cpp.txt $(REPORTS)/gfx-pcrtc-compositor-rtl.txt $(REPORTS)/gfx-pcrtc-compositor-synthesis.txt $(EXPORTS)/rtl/gfx_pcrtc_compositor.json

build/tests/gfx_pcrtc_join_vectors.cjs $(REPORTS)/gfx-pcrtc-join-inputs.json &: tests/gfx_pcrtc_join_vectors.ts
	@mkdir -p build/tests $(REPORTS)
	$(ESBUILD) $< --bundle --platform=node --format=cjs --packages=external --outfile=build/tests/gfx_pcrtc_join_vectors.cjs --metafile=$(REPORTS)/gfx-pcrtc-join-inputs.json
	$(PYTHON) -c 'import json; from pathlib import Path; d=json.loads(Path("$(REPORTS)/gfx-pcrtc-join-inputs.json").read_text()); Path("build/tests/gfx_pcrtc_join_ts.d").write_text("build/tests/gfx_pcrtc_join_vectors.cjs $(REPORTS)/gfx-pcrtc-join-inputs.json: " + " ".join(d["inputs"]) + "\n")'
-include build/tests/gfx_pcrtc_join_ts.d
build/tests/gfx-pcrtc-join-vectors.txt: build/tests/gfx_pcrtc_join_vectors.cjs build/tests/gfx-pcrtc-sample-vectors.txt
	$(NODE) $< > $@
build/tests/gfx-pcrtc-join-saturate.txt: build/tests/gfx_pcrtc_join_vectors.cjs build/tests/gfx-pcrtc-sample-vectors.txt
	$(NODE) $< --saturate > $@
build/tests/gfx_pcrtc_join_cpp: tests/gfx_pcrtc_join_vectors.cpp ../machine/cpp/render/backend/software/gx_gpu_scanout_palette.cpp
	@mkdir -p $(@D)
	$(CXX) -std=c++20 -O2 -ffunction-sections -fdata-sections -I../machine/cpp -MM -MT $@ $(filter %.cpp,$^) > build/tests/gfx_pcrtc_join_cpp.d
	$(CXX) -std=c++20 -O2 -ffunction-sections -fdata-sections -I../machine/cpp $(filter %.cpp,$^) -Wl,--gc-sections -o $@
-include build/tests/gfx_pcrtc_join_cpp.d
build/tests/gfx_pcrtc_join.vvp: rtl/gfx_pcrtc_sample_pipeline.sv rtl/gfx_pcrtc_compositor.sv rtl/gfx_pcrtc_join.sv rtl/gfx_memory_scheduler.sv rtl/async_sram.sv tests/issi_bll_model.sv tests/gfx_pcrtc_join_tb.sv
	@mkdir -p $(@D)
	$(IVERILOG) $(IVERILOG_FLAGS) -g2012 -Wall -s gfx_pcrtc_join_tb -o $@ $^
build/tests/gfx_pcrtc_join_elision.vvp: rtl/gfx_pcrtc_sample_pipeline.sv rtl/gfx_pcrtc_compositor.sv rtl/gfx_pcrtc_join.sv tests/gfx_pcrtc_join_elision_tb.sv
	@mkdir -p $(@D)
	$(IVERILOG) $(IVERILOG_FLAGS) -g2012 -Wall -s gfx_pcrtc_join_elision_tb -o $@ $^
$(REPORTS)/gfx-pcrtc-join-cpp.txt: build/tests/gfx_pcrtc_join_cpp build/tests/gfx-pcrtc-join-vectors.txt build/tests/gfx-pcrtc-join-saturate.txt
	@mkdir -p $(REPORTS)
	$< < build/tests/gfx-pcrtc-join-vectors.txt > $@
	$< < build/tests/gfx-pcrtc-join-saturate.txt >> $@
$(REPORTS)/gfx-pcrtc-join-rtl.txt: build/tests/gfx_pcrtc_join.vvp build/tests/gfx-pcrtc-join-vectors.txt build/tests/gfx-pcrtc-join-saturate.txt
	@mkdir -p $(REPORTS)
	$(VVP) $< > $@ || { cat $@; exit 1; }
	$(VVP) $< +SATURATE=1 >> $@ || { cat $@; exit 1; }
	$(VVP) $< +HOLD_OUTPUT=1 +REQUEST_STALL=1 >> $@ || { cat $@; exit 1; }
	$(VVP) $< +WARM_RESET=1 >> $@ || { cat $@; exit 1; }
$(REPORTS)/gfx-pcrtc-join-elision.txt: build/tests/gfx_pcrtc_join_elision.vvp
	@mkdir -p $(REPORTS)
	$(VVP) $< > $@ || { cat $@; exit 1; }
$(REPORTS)/gfx-pcrtc-join-synthesis.txt $(EXPORTS)/rtl/gfx_pcrtc_join.json &: rtl/gfx_pcrtc_sample_pipeline.sv rtl/gfx_pcrtc_compositor.sv rtl/gfx_pcrtc_join.sv
	@mkdir -p $(REPORTS) $(EXPORTS)/rtl
	$(YOSYS) -l $(REPORTS)/gfx-pcrtc-join-synthesis.txt -p 'read_verilog -sv $^; hierarchy -check -top gfx_pcrtc_join; proc; opt; check -assert; stat; write_json $(EXPORTS)/rtl/gfx_pcrtc_join.json' > /dev/null
.PHONY: check-gfx-pcrtc-join
check-gfx-pcrtc-join: $(REPORTS)/gfx-pcrtc-join-cpp.txt $(REPORTS)/gfx-pcrtc-join-rtl.txt $(REPORTS)/gfx-pcrtc-join-elision.txt $(REPORTS)/gfx-pcrtc-join-synthesis.txt $(EXPORTS)/rtl/gfx_pcrtc_join.json

build/tests/gfx_pcrtc_window_vectors.cjs $(REPORTS)/gfx-pcrtc-window-inputs.json &: tests/gfx_pcrtc_window_vectors.ts
	@mkdir -p build/tests $(REPORTS)
	$(ESBUILD) $< --bundle --platform=node --format=cjs --packages=external --outfile=build/tests/gfx_pcrtc_window_vectors.cjs --metafile=$(REPORTS)/gfx-pcrtc-window-inputs.json
	$(PYTHON) -c 'import json; from pathlib import Path; d=json.loads(Path("$(REPORTS)/gfx-pcrtc-window-inputs.json").read_text()); Path("build/tests/gfx_pcrtc_window_ts.d").write_text("build/tests/gfx_pcrtc_window_vectors.cjs $(REPORTS)/gfx-pcrtc-window-inputs.json: " + " ".join(d["inputs"]) + "\n")'
-include build/tests/gfx_pcrtc_window_ts.d
build/tests/gfx-pcrtc-window-vectors.txt: build/tests/gfx_pcrtc_window_vectors.cjs
	$(NODE) $< > $@
build/tests/gfx_pcrtc_window_cpp: tests/gfx_pcrtc_window_vectors.cpp ../machine/cpp/machine/devices/gx/gpu_pcrtc.cpp
	@mkdir -p $(@D)
	$(CXX) -std=c++20 -O2 -ffunction-sections -fdata-sections -I../machine/cpp -MM -MT $@ $(filter %.cpp,$^) > build/tests/gfx_pcrtc_window_cpp.d
	$(CXX) -std=c++20 -O2 -ffunction-sections -fdata-sections -I../machine/cpp $(filter %.cpp,$^) -Wl,--gc-sections -o $@
-include build/tests/gfx_pcrtc_window_cpp.d
build/tests/gfx_pcrtc_window.vvp: rtl/gfx_pcrtc_window_coords.sv tests/gfx_pcrtc_window_tb.sv
	@mkdir -p $(@D)
	$(IVERILOG) $(IVERILOG_FLAGS) -g2012 -Wall -s gfx_pcrtc_window_tb -o $@ $^
$(REPORTS)/gfx-pcrtc-window-cpp.txt: build/tests/gfx_pcrtc_window_cpp build/tests/gfx-pcrtc-window-vectors.txt
	@mkdir -p $(REPORTS)
	$< < build/tests/gfx-pcrtc-window-vectors.txt > $@
$(REPORTS)/gfx-pcrtc-window-rtl.txt: build/tests/gfx_pcrtc_window.vvp build/tests/gfx-pcrtc-window-vectors.txt
	@mkdir -p $(REPORTS)
	$(VVP) $< > $@ || { cat $@; exit 1; }
$(REPORTS)/gfx-pcrtc-window-synthesis.txt $(EXPORTS)/rtl/gfx_pcrtc_window_coords.json &: rtl/gfx_pcrtc_window_coords.sv
	@mkdir -p $(REPORTS) $(EXPORTS)/rtl
	$(YOSYS) -l $(REPORTS)/gfx-pcrtc-window-synthesis.txt -p 'read_verilog -sv $^; hierarchy -check -top gfx_pcrtc_window_coords; proc; opt; check -assert; stat; write_json $(EXPORTS)/rtl/gfx_pcrtc_window_coords.json' > /dev/null
.PHONY: check-gfx-pcrtc-window
check-gfx-pcrtc-window: $(REPORTS)/gfx-pcrtc-window-cpp.txt $(REPORTS)/gfx-pcrtc-window-rtl.txt $(REPORTS)/gfx-pcrtc-window-synthesis.txt $(EXPORTS)/rtl/gfx_pcrtc_window_coords.json

build/tests/gfx_pcrtc_coordinate_join_vectors.cjs $(REPORTS)/gfx-pcrtc-coordinate-join-inputs.json &: tests/gfx_pcrtc_coordinate_join_vectors.ts
	@mkdir -p build/tests $(REPORTS)
	$(ESBUILD) $< --bundle --platform=node --format=cjs --packages=external --outfile=build/tests/gfx_pcrtc_coordinate_join_vectors.cjs --metafile=$(REPORTS)/gfx-pcrtc-coordinate-join-inputs.json
	$(PYTHON) -c 'import json; from pathlib import Path; d=json.loads(Path("$(REPORTS)/gfx-pcrtc-coordinate-join-inputs.json").read_text()); Path("build/tests/gfx_pcrtc_coordinate_join_ts.d").write_text("build/tests/gfx_pcrtc_coordinate_join_vectors.cjs $(REPORTS)/gfx-pcrtc-coordinate-join-inputs.json: " + " ".join(d["inputs"]) + "\n")'
-include build/tests/gfx_pcrtc_coordinate_join_ts.d
build/tests/gfx-pcrtc-coordinate-join-vectors.txt: build/tests/gfx_pcrtc_coordinate_join_vectors.cjs build/tests/gfx-pcrtc-window-vectors.txt
	$(NODE) $< > $@
build/tests/gfx-pcrtc-coordinate-join-saturate.txt: build/tests/gfx_pcrtc_coordinate_join_vectors.cjs build/tests/gfx-pcrtc-window-vectors.txt
	$(NODE) $< --saturate > $@
build/tests/gfx_pcrtc_coordinate_join_cpp: tests/gfx_pcrtc_coordinate_join_vectors.cpp ../machine/cpp/render/backend/software/gx_gpu_scanout_palette.cpp ../machine/cpp/machine/devices/gx/gpu_pcrtc.cpp
	@mkdir -p $(@D)
	$(CXX) -std=c++20 -O2 -ffunction-sections -fdata-sections -I../machine/cpp -MM -MT $@ $(filter %.cpp,$^) > build/tests/gfx_pcrtc_coordinate_join_cpp.d
	$(CXX) -std=c++20 -O2 -ffunction-sections -fdata-sections -I../machine/cpp $(filter %.cpp,$^) -Wl,--gc-sections -o $@
-include build/tests/gfx_pcrtc_coordinate_join_cpp.d
build/tests/gfx_pcrtc_coordinate_join.vvp: rtl/gfx_pcrtc_window_coords.sv rtl/gfx_pcrtc_sample_pipeline.sv rtl/gfx_pcrtc_compositor.sv rtl/gfx_pcrtc_join.sv rtl/gfx_pcrtc_coordinate_join.sv rtl/gfx_memory_scheduler.sv rtl/async_sram.sv tests/issi_bll_model.sv tests/gfx_pcrtc_coordinate_join_tb.sv
	@mkdir -p $(@D)
	$(IVERILOG) $(IVERILOG_FLAGS) -g2012 -Wall -s gfx_pcrtc_coordinate_join_tb -o $@ $^
$(REPORTS)/gfx-pcrtc-coordinate-join-cpp.txt: build/tests/gfx_pcrtc_coordinate_join_cpp build/tests/gfx-pcrtc-coordinate-join-vectors.txt build/tests/gfx-pcrtc-coordinate-join-saturate.txt
	@mkdir -p $(REPORTS)
	$< < build/tests/gfx-pcrtc-coordinate-join-vectors.txt > $@
	$< < build/tests/gfx-pcrtc-coordinate-join-saturate.txt >> $@
$(REPORTS)/gfx-pcrtc-coordinate-join-rtl.txt: build/tests/gfx_pcrtc_coordinate_join.vvp build/tests/gfx-pcrtc-coordinate-join-vectors.txt build/tests/gfx-pcrtc-coordinate-join-saturate.txt
	@mkdir -p $(REPORTS)
	$(VVP) $< > $@ || { cat $@; exit 1; }
	$(VVP) $< +SATURATE=1 >> $@ || { cat $@; exit 1; }
	$(VVP) $< +HOLD_OUTPUT=1 +REQUEST_STALL=1 >> $@ || { cat $@; exit 1; }
	$(VVP) $< +WARM_RESET=1 >> $@ || { cat $@; exit 1; }
$(REPORTS)/gfx-pcrtc-coordinate-join-synthesis.txt $(EXPORTS)/rtl/gfx_pcrtc_coordinate_join.json &: rtl/gfx_pcrtc_window_coords.sv rtl/gfx_pcrtc_sample_pipeline.sv rtl/gfx_pcrtc_compositor.sv rtl/gfx_pcrtc_join.sv rtl/gfx_pcrtc_coordinate_join.sv
	@mkdir -p $(REPORTS) $(EXPORTS)/rtl
	$(YOSYS) -l $(REPORTS)/gfx-pcrtc-coordinate-join-synthesis.txt -p 'read_verilog -sv $^; hierarchy -check -top gfx_pcrtc_coordinate_join; proc; opt; check -assert; stat; write_json $(EXPORTS)/rtl/gfx_pcrtc_coordinate_join.json' > /dev/null
.PHONY: check-gfx-pcrtc-coordinate-join
check-gfx-pcrtc-coordinate-join: $(REPORTS)/gfx-pcrtc-coordinate-join-cpp.txt $(REPORTS)/gfx-pcrtc-coordinate-join-rtl.txt $(REPORTS)/gfx-pcrtc-coordinate-join-synthesis.txt $(EXPORTS)/rtl/gfx_pcrtc_coordinate_join.json

build/tests/async_fifo.vvp: rtl/async_fifo.sv tests/async_fifo_tb.sv
	@mkdir -p $(@D)
	$(IVERILOG) $(IVERILOG_FLAGS) -g2012 -Wall -s async_fifo_tb -o $@ $^
build/tests/async_fifo_small.vvp: rtl/async_fifo.sv tests/async_fifo_small_tb.sv
	@mkdir -p $(@D)
	$(IVERILOG) $(IVERILOG_FLAGS) -g2012 -Wall -s async_fifo_small_tb -o $@ $^
build/tests/gfx_scanout_cdc.vvp: rtl/async_fifo.sv rtl/gfx_pcrtc_window_coords.sv rtl/gfx_pcrtc_sample_pipeline.sv rtl/gfx_pcrtc_compositor.sv rtl/gfx_pcrtc_join.sv rtl/gfx_pcrtc_coordinate_join.sv rtl/gfx_memory_scheduler.sv rtl/async_sram.sv tests/issi_bll_model.sv tests/gfx_scanout_cdc_tb.sv
	@mkdir -p $(@D)
	$(IVERILOG) $(IVERILOG_FLAGS) -g2012 -Wall -s gfx_scanout_cdc_tb -o $@ $^
$(REPORTS)/async-fifo.txt: build/tests/async_fifo.vvp
	@mkdir -p $(REPORTS)
	$(VVP) $< > $@ || { cat $@; exit 1; }
$(REPORTS)/async-fifo-small.txt: build/tests/async_fifo_small.vvp
	@mkdir -p $(REPORTS)
	$(VVP) $< > $@ || { cat $@; exit 1; }
$(REPORTS)/gfx-scanout-cdc.txt: build/tests/gfx_scanout_cdc.vvp build/tests/gfx-pcrtc-coordinate-join-saturate.txt
	@mkdir -p $(REPORTS)
	$(VVP) $< > $@ || { cat $@; exit 1; }
$(REPORTS)/async-fifo-synthesis.txt $(EXPORTS)/rtl/async_fifo.json &: rtl/async_fifo.sv
	@mkdir -p $(REPORTS) $(EXPORTS)/rtl
	$(YOSYS) -l $(REPORTS)/async-fifo-synthesis.txt -p 'read_verilog -sv $^; hierarchy -check -top async_fifo; proc; opt; check -assert; stat; write_json $(EXPORTS)/rtl/async_fifo.json' > /dev/null
.PHONY: check-gfx-scanout-cdc
check-gfx-scanout-cdc: $(REPORTS)/async-fifo.txt $(REPORTS)/async-fifo-small.txt $(REPORTS)/gfx-scanout-cdc.txt $(REPORTS)/async-fifo-synthesis.txt $(EXPORTS)/rtl/async_fifo.json

build/tests/gfx_pcrtc_beam_phase_vectors.cjs $(REPORTS)/gfx-pcrtc-beam-phase-inputs.json &: tests/gfx_pcrtc_beam_phase_vectors.ts
	@mkdir -p build/tests $(REPORTS)
	$(ESBUILD) $< --bundle --platform=node --format=cjs --packages=external --outfile=build/tests/gfx_pcrtc_beam_phase_vectors.cjs --metafile=$(REPORTS)/gfx-pcrtc-beam-phase-inputs.json
	$(PYTHON) -c 'import json; from pathlib import Path; d=json.loads(Path("$(REPORTS)/gfx-pcrtc-beam-phase-inputs.json").read_text()); Path("build/tests/gfx_pcrtc_beam_phase_ts.d").write_text("build/tests/gfx_pcrtc_beam_phase_vectors.cjs $(REPORTS)/gfx-pcrtc-beam-phase-inputs.json: " + " ".join(d["inputs"]) + "\n")'
-include build/tests/gfx_pcrtc_beam_phase_ts.d
build/tests/gfx-pcrtc-beam-phase-vectors.txt: build/tests/gfx_pcrtc_beam_phase_vectors.cjs
	$(NODE) $< > $@
build/tests/gfx_pcrtc_beam_phase_cpp: tests/gfx_pcrtc_beam_phase_vectors.cpp ../machine/cpp/machine/devices/gx/gpu_pcrtc.cpp
	@mkdir -p $(@D)
	$(CXX) -std=c++20 -O2 -ffunction-sections -fdata-sections -I../machine/cpp -MM -MT $@ $(filter %.cpp,$^) > build/tests/gfx_pcrtc_beam_phase_cpp.d
	$(CXX) -std=c++20 -O2 -ffunction-sections -fdata-sections -I../machine/cpp $(filter %.cpp,$^) -Wl,--gc-sections -o $@
-include build/tests/gfx_pcrtc_beam_phase_cpp.d
build/tests/gfx_pcrtc_beam_phase.vvp: rtl/gfx_pcrtc_beam_phase.sv tests/gfx_pcrtc_beam_phase_tb.sv
	@mkdir -p $(@D)
	$(IVERILOG) $(IVERILOG_FLAGS) -g2012 -Wall -s gfx_pcrtc_beam_phase_tb -o $@ $^
$(REPORTS)/gfx-pcrtc-beam-phase-cpp.txt: build/tests/gfx_pcrtc_beam_phase_cpp build/tests/gfx-pcrtc-beam-phase-vectors.txt
	@mkdir -p $(REPORTS)
	$< < build/tests/gfx-pcrtc-beam-phase-vectors.txt > $@
$(REPORTS)/gfx-pcrtc-beam-phase-rtl.txt: build/tests/gfx_pcrtc_beam_phase.vvp build/tests/gfx-pcrtc-beam-phase-vectors.txt
	@mkdir -p $(REPORTS)
	$(VVP) $< > $@ || { cat $@; exit 1; }
$(REPORTS)/gfx-pcrtc-beam-phase-synthesis.txt $(EXPORTS)/rtl/gfx_pcrtc_beam_phase.json &: rtl/gfx_pcrtc_beam_phase.sv
	@mkdir -p $(REPORTS) $(EXPORTS)/rtl
	$(YOSYS) -l $(REPORTS)/gfx-pcrtc-beam-phase-synthesis.txt -p 'read_verilog -sv $^; hierarchy -check -top gfx_pcrtc_beam_phase; proc; opt; check -assert; stat; write_json $(EXPORTS)/rtl/gfx_pcrtc_beam_phase.json' > /dev/null
.PHONY: check-gfx-pcrtc-beam-phase
check-gfx-pcrtc-beam-phase: $(REPORTS)/gfx-pcrtc-beam-phase-cpp.txt $(REPORTS)/gfx-pcrtc-beam-phase-rtl.txt $(REPORTS)/gfx-pcrtc-beam-phase-synthesis.txt $(EXPORTS)/rtl/gfx_pcrtc_beam_phase.json

build/tests/gfx_pcrtc_visibility.vvp: rtl/gfx_memory_scheduler.sv rtl/async_sram.sv tests/issi_bll_model.sv tests/gfx_pcrtc_visibility_tb.sv
	@mkdir -p $(@D)
	$(IVERILOG) $(IVERILOG_FLAGS) -g2012 -Wall -s gfx_pcrtc_visibility_tb -o $@ $^
$(REPORTS)/gfx-pcrtc-visibility.txt: build/tests/gfx_pcrtc_visibility.vvp
	@mkdir -p $(REPORTS)
	$(VVP) $< > $@ || { cat $@; exit 1; }
.PHONY: check-gfx-pcrtc-visibility
check-gfx-pcrtc-visibility: $(REPORTS)/gfx-pcrtc-visibility.txt

build/tests/gfx_video_launch.vvp: rtl/gfx_video_launch.sv tests/gfx_video_launch_tb.sv
	@mkdir -p $(@D)
	$(IVERILOG) $(IVERILOG_FLAGS) -g2012 -Wall -s gfx_video_launch_tb -o $@ $^
$(REPORTS)/gfx-video-launch.txt: build/tests/gfx_video_launch.vvp
	@mkdir -p $(REPORTS)
	$(VVP) $< > $@ || { cat $@; exit 1; }
$(REPORTS)/gfx-video-launch-synthesis.txt $(EXPORTS)/rtl/gfx_video_launch.json &: rtl/gfx_video_launch.sv
	@mkdir -p $(REPORTS) $(EXPORTS)/rtl
	$(YOSYS) -l $(REPORTS)/gfx-video-launch-synthesis.txt -p 'read_verilog -sv $^; hierarchy -check -top gfx_video_launch; proc; opt; check -assert; stat; write_json $(EXPORTS)/rtl/gfx_video_launch.json' > /dev/null
.PHONY: check-gfx-video-launch
check-gfx-video-launch: $(REPORTS)/gfx-video-launch.txt $(REPORTS)/gfx-video-launch-synthesis.txt $(EXPORTS)/rtl/gfx_video_launch.json

CART_RTL = rtl/cart_rom_bridge.sv rtl/cart_rom_arbiter.sv rtl/cart_sys_endpoint.sv
build/tests/cart_rom_bridge.vvp: $(CART_RTL) rtl/system_bus_master.sv tests/cart_rom_model.sv tests/cart_rom_bridge_tb.sv
	@mkdir -p $(@D)
	$(IVERILOG) $(IVERILOG_FLAGS) -g2012 -Wall -s cart_rom_bridge_tb -o $@ $^
$(REPORTS)/cart-rom-bridge.txt: build/tests/cart_rom_bridge.vvp
	@mkdir -p $(@D)
	$(VVP) $< > $@ || { cat $@; exit 1; }

build/tests/apu_rom_integration.vvp: $(U7_RTL) $(CART_RTL) rtl/system_bus_master.sv rtl/main_dram.sv rtl/core_ram_scalar.sv rtl/core_memory_system.sv rtl/system_bus_arbiter.sv rtl/apu_rom_fetch.sv rtl/apu_source_word_router.sv rtl/apu_upload_commit.sv rtl/apu_sample_store.sv rtl/async_sram.sv rtl/pad_accessory.sv tests/is41lv16100_model.sv tests/issi_bll_model.sv tests/cart_rom_model.sv tests/apu_rom_integration_tb.sv
	@mkdir -p $(@D)
	$(IVERILOG) $(IVERILOG_FLAGS) -g2012 -Wall -s apu_rom_integration_tb -o $@ $^
$(REPORTS)/apu-rom-integration.txt: build/tests/apu_rom_integration.vvp
	@mkdir -p $(@D)
	$(VVP) $< > $@ || { cat $@; exit 1; }
build/tests/system_time.vvp: rtl/system_time.sv tests/system_time_tb.sv
	@mkdir -p $(@D)
	$(IVERILOG) $(IVERILOG_FLAGS) -g2012 -Wall -s system_time_tb -o $@ $^
$(REPORTS)/system-time.txt: build/tests/system_time.vvp
	@mkdir -p $(REPORTS)
	$(VVP) $< > $@ || { cat $@; exit 1; }
build/tests/system_debug_transmit.vvp: rtl/system_debug_transmit.sv tests/system_debug_transmit_tb.sv
	@mkdir -p $(@D)
	$(IVERILOG) $(IVERILOG_FLAGS) -g2012 -Wall -s system_debug_transmit_tb -o $@ $^
$(REPORTS)/system-debug-transmit.txt: build/tests/system_debug_transmit.vvp
	@mkdir -p $(REPORTS)
	$(VVP) $< > $@ || { cat $@; exit 1; }
build/tests/system_debug_vectors.cjs $(REPORTS)/system-debug-inputs.json &: tests/system_debug_vectors.ts
	@mkdir -p build/tests $(REPORTS)
	$(ESBUILD) $< --bundle --platform=node --format=cjs --packages=external --outfile=build/tests/system_debug_vectors.cjs --metafile=$(REPORTS)/system-debug-inputs.json
	$(PYTHON) -c 'import json; from pathlib import Path; d=json.loads(Path("$(REPORTS)/system-debug-inputs.json").read_text()); Path("build/tests/system_debug_vectors_ts.d").write_text("build/tests/system_debug_vectors.cjs $(REPORTS)/system-debug-inputs.json: " + " ".join(d["inputs"]) + "\n")'
-include build/tests/system_debug_vectors_ts.d
build/tests/system-debug-vectors.txt: build/tests/system_debug_vectors.cjs
	$(NODE) $< > $@
DEBUG_CPP_DIR = build/tests/system_debug_obj
DEBUG_CPP_SOURCES = machine/memory/memory machine/devices/cartridge/controller machine/devices/cartridge/card machine/devices/cartridge/mailbox machine/devices/system/debug_transmit machine/devices/dma/controller machine/devices/irq/controller machine/scheduler/device machine/cpu/cpu
DEBUG_CPP_OBJECTS = $(addprefix $(DEBUG_CPP_DIR)/,$(addsuffix .o,$(DEBUG_CPP_SOURCES)))
DEBUG_CPP_FLAGS = -std=c++20 -O2 -ffunction-sections -fdata-sections -I../machine/cpp
$(DEBUG_CPP_DIR)/probe.o: tests/system_debug_vectors.cpp
	@mkdir -p $(@D)
	$(CXX) $(DEBUG_CPP_FLAGS) -MMD -MP -MF $(@:.o=.d) -c $< -o $@
$(DEBUG_CPP_DIR)/%.o: ../machine/cpp/%.cpp
	@mkdir -p $(@D)
	$(CXX) $(DEBUG_CPP_FLAGS) -MMD -MP -MF $(@:.o=.d) -c $< -o $@
-include $(DEBUG_CPP_OBJECTS:.o=.d) $(DEBUG_CPP_DIR)/probe.d
build/tests/system_debug_vectors_cpp: $(DEBUG_CPP_DIR)/probe.o $(DEBUG_CPP_OBJECTS)
	$(CXX) -Wl,--gc-sections $^ -o $@
	cat $(DEBUG_CPP_DIR)/probe.d $(DEBUG_CPP_OBJECTS:.o=.d) > build/tests/system_debug_cpp.d
build/tests/system_debug_parity.vvp: rtl/system_debug_transmit.sv tests/system_debug_parity_tb.sv
	@mkdir -p $(@D)
	$(IVERILOG) $(IVERILOG_FLAGS) -g2012 -Wall -s system_debug_parity_tb -o $@ $^
$(REPORTS)/system-debug-parity-cpp.txt: build/tests/system_debug_vectors_cpp build/tests/system-debug-vectors.txt
	@mkdir -p $(REPORTS)
	$< < build/tests/system-debug-vectors.txt > $@
$(REPORTS)/system-debug-parity-rtl.txt: build/tests/system_debug_parity.vvp build/tests/system-debug-vectors.txt
	@mkdir -p $(REPORTS)
	$(VVP) $< > $@ || { cat $@; exit 1; }
.PHONY: check-system-debug-parity
check-system-debug-parity: $(REPORTS)/system-debug-parity-cpp.txt $(REPORTS)/system-debug-parity-rtl.txt
build/tests/system_supervisor_integration.vvp: rtl/system_time.sv rtl/system_supervisor.sv rtl/system_debug_transmit.sv rtl/dma_block_transfer.sv rtl/dma_supervisor_context.sv rtl/dma_channel_controller.sv rtl/core_local_dma_irq.sv rtl/system_bus_master.sv rtl/main_dram.sv rtl/core_ram_scalar.sv rtl/core_memory_system.sv tests/is41lv16100_model.sv tests/system_supervisor_integration_tb.sv
	@mkdir -p $(@D)
	$(IVERILOG) $(IVERILOG_FLAGS) -g2012 -Wall -s system_supervisor_integration_tb -o $@ $^
$(REPORTS)/system-supervisor-integration.txt: build/tests/system_supervisor_integration.vvp
	@mkdir -p $(REPORTS)
	$(VVP) $< > $@ || { cat $@; exit 1; }
check-system-integration: $(REPORTS)/cart-rom-bridge.txt $(REPORTS)/apu-rom-integration.txt $(REPORTS)/system-time.txt $(REPORTS)/system-debug-transmit.txt check-system-debug-parity $(REPORTS)/system-supervisor-integration.txt

build/tests/cart_core_scalar.vvp: rtl/system_bus_master.sv rtl/main_dram.sv rtl/core_ram_scalar.sv rtl/core_memory_system.sv $(CART_RTL) tests/is41lv16100_model.sv tests/cart_rom_model.sv tests/cart_scalar_card_peer.sv tests/cart_core_scalar_tb.sv
	@mkdir -p $(@D)
	$(IVERILOG) $(IVERILOG_FLAGS) -g2012 -Wall -s cart_core_scalar_tb -o $@ $^
build/tests/cart_ram_scalar.vvp: rtl/async_sram.sv rtl/cart_ram_scalar.sv tests/issi_bll_model.sv tests/cart_ram_scalar_tb.sv
	@mkdir -p $(@D)
	$(IVERILOG) $(IVERILOG_FLAGS) -g2012 -Wall -s cart_ram_scalar_tb -o $@ $^
build/tests/cart_ram_physical_integration.vvp: rtl/async_sram.sv rtl/cart_ram_scalar.sv rtl/cart_rom_bridge.sv rtl/cart_rom_arbiter.sv tests/cart_rom_model.sv tests/issi_bll_model.sv tests/cart_ram_physical_peer.sv tests/cart_ram_physical_integration_tb.sv
	@mkdir -p $(@D)
	$(IVERILOG) $(IVERILOG_FLAGS) -g2012 -Wall -s cart_ram_physical_integration_tb -o $@ $^
build/tests/cart_core_ram_integration.vvp: rtl/system_bus_master.sv rtl/main_dram.sv rtl/core_ram_scalar.sv rtl/core_memory_system.sv rtl/cart_rom_bridge.sv rtl/cart_rom_arbiter.sv rtl/async_sram.sv rtl/cart_ram_scalar.sv tests/is41lv16100_model.sv tests/cart_rom_model.sv tests/issi_bll_model.sv tests/cart_ram_physical_peer.sv tests/cart_core_ram_integration_tb.sv
	@mkdir -p $(@D)
	$(IVERILOG) $(IVERILOG_FLAGS) -g2012 -Wall -s cart_core_ram_integration_tb -o $@ $^
$(REPORTS)/cart-core-scalar.txt: build/tests/cart_core_scalar.vvp
	@mkdir -p $(REPORTS)
	$(VVP) $< > $@ || { cat $@; exit 1; }
$(REPORTS)/cart-ram-scalar.txt: build/tests/cart_ram_scalar.vvp
	@mkdir -p $(REPORTS)
	$(VVP) $< > $@ || { cat $@; exit 1; }
$(REPORTS)/cart-ram-physical-integration.txt: build/tests/cart_ram_physical_integration.vvp
	@mkdir -p $(REPORTS)
	$(VVP) $< > $@ || { cat $@; exit 1; }
$(REPORTS)/cart-core-ram-integration.txt: build/tests/cart_core_ram_integration.vvp
	@mkdir -p $(REPORTS)
	$(VVP) $< > $@ || { cat $@; exit 1; }
.PHONY: check-cart-physical
check-cart-physical: $(REPORTS)/cart-core-scalar.txt $(REPORTS)/cart-ram-scalar.txt $(REPORTS)/cart-ram-physical-integration.txt $(REPORTS)/cart-core-ram-integration.txt
$(REPORTS)/cart-ram-synthesis.txt $(EXPORTS)/rtl/cart_ram_scalar.json &: rtl/async_sram.sv rtl/cart_ram_scalar.sv
	@mkdir -p $(REPORTS) $(EXPORTS)/rtl
	$(YOSYS) -l $(REPORTS)/cart-ram-synthesis.txt -p 'read_verilog -sv $^; hierarchy -check -top cart_ram_scalar; proc; opt; check; stat; write_json $(EXPORTS)/rtl/cart_ram_scalar.json' > /dev/null
.PHONY: cart-ram-synthesis
cart-ram-synthesis: $(REPORTS)/cart-ram-synthesis.txt $(EXPORTS)/rtl/cart_ram_scalar.json

CARD_RTL = rtl/async_sram.sv rtl/cart_ram_scalar.sv rtl/cart_rom_scalar.sv rtl/cart_reference_card.sv
build/tests/cart_rom_scalar.vvp: rtl/cart_rom_scalar.sv tests/cart_rom_scalar_tb.sv
	@mkdir -p $(@D)
	$(IVERILOG) $(IVERILOG_FLAGS) -g2012 -Wall -s cart_rom_scalar_tb -o $@ $^
build/tests/cart_reference_card.vvp: $(CARD_RTL) rtl/cart_rom_bridge.sv rtl/cart_rom_arbiter.sv tests/cart_rom_model.sv tests/issi_bll_model.sv tests/cart_reference_card_tb.sv
	@mkdir -p $(@D)
	$(IVERILOG) $(IVERILOG_FLAGS) -g2012 -Wall -s cart_reference_card_tb -o $@ $^
build/tests/cart_reference_fast_host.vvp: $(CARD_RTL) tests/issi_bll_model.sv tests/cart_reference_fast_host_tb.sv
	@mkdir -p $(@D)
	$(IVERILOG) $(IVERILOG_FLAGS) -g2012 -Wall -s cart_reference_fast_host_tb -o $@ $^
build/tests/cart_pin_events.vvp: rtl/cart_pin_events.sv tests/cart_pin_events_tb.sv
	@mkdir -p $(@D)
	$(IVERILOG) $(IVERILOG_FLAGS) -g2012 -Wall -s cart_pin_events_tb -o $@ $^
build/tests/cart_irq_level_candidate.vvp: rtl/cart_irq_level_candidate.sv rtl/dma_block_transfer.sv rtl/dma_supervisor_context.sv rtl/dma_channel_controller.sv rtl/core_local_dma_irq.sv tests/cart_irq_level_candidate_tb.sv
	@mkdir -p $(@D)
	$(IVERILOG) $(IVERILOG_FLAGS) -g2012 -Wall -s cart_irq_level_candidate_tb -o $@ $^
$(REPORTS)/cart-irq-level-candidate.txt: build/tests/cart_irq_level_candidate.vvp
	@mkdir -p $(REPORTS)
	$(VVP) $< > $@ || { cat $@; exit 1; }
$(REPORTS)/cart-irq-level-candidate-synthesis.txt $(EXPORTS)/rtl/cart_irq_level_candidate.json &: rtl/cart_irq_level_candidate.sv
	@mkdir -p $(REPORTS) $(EXPORTS)/rtl
	$(YOSYS) -l $(REPORTS)/cart-irq-level-candidate-synthesis.txt -p 'read_verilog -sv $^; hierarchy -check -top cart_irq_level_candidate; proc; opt; check -assert; stat; write_json $(EXPORTS)/rtl/cart_irq_level_candidate.json' > /dev/null
.PHONY: check-cart-irq-level-candidate
check-cart-irq-level-candidate: $(REPORTS)/cart-irq-level-candidate.txt $(REPORTS)/cart-irq-level-candidate-synthesis.txt $(EXPORTS)/rtl/cart_irq_level_candidate.json
build/tests/cart_irq_banked_contract.vvp: rtl/cart_pin_events.sv rtl/dma_block_transfer.sv rtl/dma_supervisor_context.sv rtl/dma_channel_controller.sv rtl/core_local_dma_irq.sv tests/cart_irq_banked_contract_tb.sv
	@mkdir -p $(@D)
	$(IVERILOG) $(IVERILOG_FLAGS) -g2012 -Wall -s cart_irq_banked_contract_tb -o $@ $^
build/tests/cart_irq_context_observation.vvp: rtl/cart_pin_events.sv rtl/dma_block_transfer.sv rtl/dma_supervisor_context.sv rtl/dma_channel_controller.sv rtl/core_local_dma_irq.sv tests/cart_irq_context_observation_tb.sv
	@mkdir -p $(@D)
	$(IVERILOG) $(IVERILOG_FLAGS) -g2012 -Wall -s cart_irq_context_observation_tb -o $@ $^
build/tests/cart_irq_rearm_sweep.vvp: rtl/cart_pin_events.sv tests/cart_irq_rearm_sweep_tb.sv
	@mkdir -p $(@D)
	$(IVERILOG) $(IVERILOG_FLAGS) -g2012 -Wall -s cart_irq_rearm_sweep_tb -o $@ $^
IRQ_STUDY_BANK = rtl/dma_block_transfer.sv rtl/dma_supervisor_context.sv rtl/dma_channel_controller.sv rtl/core_local_dma_irq.sv
build/tests/cart_irq_sync_candidate.vvp: tests/cart_pin_sync_experiment.sv $(IRQ_STUDY_BANK) tests/cart_irq_sync_candidate_tb.sv
	@mkdir -p $(@D)
	$(IVERILOG) $(IVERILOG_FLAGS) -g2012 -Wall -DIRQ_SYNC_EXPERIMENT -s cart_irq_sync_candidate_tb -o $@ $^
build/tests/cart_irq_capture_study.vvp: rtl/cart_pin_events.sv $(IRQ_STUDY_BANK) tests/cart_irq_sync_candidate_tb.sv
	@mkdir -p $(@D)
	$(IVERILOG) $(IVERILOG_FLAGS) -g2012 -Wall -s cart_irq_sync_candidate_tb -o $@ $^
$(REPORTS)/cart-irq-sync-study.txt: build/tests/cart_irq_sync_candidate.vvp build/tests/cart_irq_capture_study.vvp
	@mkdir -p $(REPORTS)
	@printf '%s\n' 'EXPERIMENTAL TWO-FLOP RECEIVER' > $@
	$(VVP) build/tests/cart_irq_sync_candidate.vvp >> $@ || { cat $@; exit 1; }
	@printf '%s\n' 'EXISTING ASYNCHRONOUS-CAPTURE CANDIDATE' >> $@
	$(VVP) build/tests/cart_irq_capture_study.vvp >> $@ || { cat $@; exit 1; }
$(REPORTS)/cart-irq-rearm-sweep.txt: build/tests/cart_irq_rearm_sweep.vvp
	@mkdir -p $(REPORTS)
	$(VVP) $< > $@ || { cat $@; exit 1; }
$(REPORTS)/cart-irq-context.txt: build/tests/cart_irq_context_observation.vvp
	@mkdir -p $(REPORTS)
	$(VVP) $< +CASE=0 > $@ || { cat $@; exit 1; }
	$(VVP) $< +CASE=1 >> $@ || { cat $@; exit 1; }
	$(VVP) $< +CASE=2 >> $@ || { cat $@; exit 1; }
.PHONY: check-cart-pin-contract check-cart-pin-coalescence check-cart-pin-race check-cart-pin-ack-window
check-cart-pin-contract: build/tests/cart_irq_banked_contract.vvp
	$(VVP) $< +CASE=0
check-cart-pin-coalescence: build/tests/cart_irq_banked_contract.vvp
	$(VVP) $< +CASE=2
check-cart-pin-race: build/tests/cart_irq_banked_contract.vvp
	$(VVP) $< +CASE=1
check-cart-pin-ack-window: build/tests/cart_irq_banked_contract.vvp
	$(VVP) $< +CASE=3
build/tests/cart_core_reference_card.vvp: $(CARD_RTL) $(CART_RTL) rtl/cart_pin_events.sv rtl/dma_block_transfer.sv rtl/dma_supervisor_context.sv rtl/dma_channel_controller.sv rtl/core_local_dma_irq.sv rtl/system_bus_master.sv rtl/main_dram.sv rtl/core_ram_scalar.sv rtl/core_memory_system.sv tests/is41lv16100_model.sv tests/cart_rom_model.sv tests/issi_bll_model.sv tests/cart_core_reference_card_tb.sv
	@mkdir -p $(@D)
	$(IVERILOG) $(IVERILOG_FLAGS) -g2012 -Wall -s cart_core_reference_card_tb -o $@ $^
build/tests/cart_core_level_reference_card.vvp: $(CARD_RTL) $(CART_RTL) rtl/cart_pin_events.sv rtl/cart_irq_level_candidate.sv rtl/dma_block_transfer.sv rtl/dma_supervisor_context.sv rtl/dma_channel_controller.sv rtl/core_local_dma_irq.sv rtl/system_bus_master.sv rtl/main_dram.sv rtl/core_ram_scalar.sv rtl/core_memory_system.sv tests/is41lv16100_model.sv tests/cart_rom_model.sv tests/issi_bll_model.sv tests/cart_core_reference_card_tb.sv
	@mkdir -p $(@D)
	$(IVERILOG) $(IVERILOG_FLAGS) -g2012 -Wall -DIRQ_LEVEL_CANDIDATE -s cart_core_reference_card_tb -o $@ $^
$(REPORTS)/cart-core-level-reference-card.txt: build/tests/cart_core_level_reference_card.vvp
	@mkdir -p $(REPORTS)
	$(VVP) $< > $@ || { cat $@; exit 1; }
.PHONY: check-cart-core-level-reference
check-cart-core-level-reference: $(REPORTS)/cart-core-level-reference-card.txt
$(REPORTS)/cart-rom-scalar.txt: build/tests/cart_rom_scalar.vvp
	@mkdir -p $(REPORTS)
	$(VVP) $< > $@ || { cat $@; exit 1; }
$(REPORTS)/cart-reference-card.txt: build/tests/cart_reference_card.vvp
	@mkdir -p $(REPORTS)
	$(VVP) $< > $@ || { cat $@; exit 1; }
$(REPORTS)/cart-reference-fast-host.txt: build/tests/cart_reference_fast_host.vvp
	@mkdir -p $(REPORTS)
	$(VVP) $< > $@ || { cat $@; exit 1; }
$(REPORTS)/cart-pin-events.txt: build/tests/cart_pin_events.vvp
	@mkdir -p $(REPORTS)
	$(VVP) $< > $@ || { cat $@; exit 1; }
$(REPORTS)/cart-core-reference-card.txt: build/tests/cart_core_reference_card.vvp
	@mkdir -p $(REPORTS)
	$(VVP) $< > $@ || { cat $@; exit 1; }
.PHONY: check-cart-reference
check-cart-reference: check-cart-scalar $(REPORTS)/cart-rom-scalar.txt $(REPORTS)/cart-reference-card.txt $(REPORTS)/cart-core-reference-card.txt $(REPORTS)/cart-reference-fast-host.txt $(REPORTS)/cart-pin-events.txt $(REPORTS)/cart-irq-context.txt
	sed -n 's/^ORACLE //p' $(REPORTS)/cart-core-reference-card.txt > build/tests/cart-reference-oracle.txt
	cmp build/tests/cart-scalar-reference-ts.txt build/tests/cart-reference-oracle.txt

build/tests/dma_block_transfer.vvp: rtl/dma_block_transfer.sv tests/dma_block_transfer_tb.sv
	@mkdir -p $(@D)
	$(IVERILOG) $(IVERILOG_FLAGS) -g2012 -Wall -s dma_block_transfer_tb -o $@ $^
build/tests/dma_block_integration.vvp: rtl/dma_block_transfer.sv rtl/system_bus_master.sv rtl/main_dram.sv rtl/core_ram_scalar.sv rtl/core_memory_system.sv $(CART_RTL) tests/is41lv16100_model.sv tests/cart_rom_model.sv tests/cart_scalar_card_peer.sv tests/dma_block_integration_tb.sv
	@mkdir -p $(@D)
	$(IVERILOG) $(IVERILOG_FLAGS) -g2012 -Wall -s dma_block_integration_tb -o $@ $^
$(REPORTS)/dma-block-transfer.txt: build/tests/dma_block_transfer.vvp
	@mkdir -p $(REPORTS)
	$(VVP) $< > $@ || { cat $@; exit 1; }
$(REPORTS)/dma-block-integration.txt: build/tests/dma_block_integration.vvp
	@mkdir -p $(REPORTS)
	$(VVP) $< > $@ || { cat $@; exit 1; }
build/tests/dma_channel_controller.vvp: rtl/dma_block_transfer.sv rtl/dma_supervisor_context.sv rtl/dma_channel_controller.sv tests/dma_channel_controller_tb.sv
	@mkdir -p $(@D)
	$(IVERILOG) $(IVERILOG_FLAGS) -g2012 -Wall -s dma_channel_controller_tb -o $@ $^
$(REPORTS)/dma-channel-controller.txt: build/tests/dma_channel_controller.vvp
	@mkdir -p $(REPORTS)
	$(VVP) $< > $@ || { cat $@; exit 1; }
build/tests/dma_controller_memory_integration.vvp: rtl/dma_block_transfer.sv rtl/dma_supervisor_context.sv rtl/dma_channel_controller.sv rtl/system_bus_master.sv rtl/main_dram.sv rtl/core_ram_scalar.sv rtl/core_memory_system.sv tests/is41lv16100_model.sv tests/dma_controller_memory_integration_tb.sv
	@mkdir -p $(@D)
	$(IVERILOG) $(IVERILOG_FLAGS) -g2012 -Wall -s dma_controller_memory_integration_tb -o $@ $^
$(REPORTS)/dma-controller-memory-integration.txt: build/tests/dma_controller_memory_integration.vvp
	@mkdir -p $(REPORTS)
	$(VVP) $< > $@ || { cat $@; exit 1; }
build/tests/dma_supervisor_context.vvp: rtl/dma_supervisor_context.sv tests/dma_supervisor_context_tb.sv
	@mkdir -p $(@D)
	$(IVERILOG) $(IVERILOG_FLAGS) -g2012 -Wall -s dma_supervisor_context_tb -o $@ $^
build/tests/dma_supervisor_integration.vvp: rtl/dma_block_transfer.sv rtl/dma_supervisor_context.sv rtl/dma_channel_controller.sv tests/dma_supervisor_integration_tb.sv
	@mkdir -p $(@D)
	$(IVERILOG) $(IVERILOG_FLAGS) -g2012 -Wall -s dma_supervisor_integration_tb -o $@ $^
build/tests/dma_local_irq_integration.vvp: rtl/dma_block_transfer.sv rtl/dma_supervisor_context.sv rtl/dma_channel_controller.sv rtl/core_local_dma_irq.sv rtl/system_bus_master.sv rtl/main_dram.sv rtl/core_ram_scalar.sv rtl/core_memory_system.sv tests/is41lv16100_model.sv tests/dma_local_irq_integration_tb.sv
	@mkdir -p $(@D)
	$(IVERILOG) $(IVERILOG_FLAGS) -g2012 -Wall -s dma_local_irq_integration_tb -o $@ $^
$(REPORTS)/dma-supervisor-context.txt: build/tests/dma_supervisor_context.vvp
	@mkdir -p $(REPORTS)
	$(VVP) $< > $@ || { cat $@; exit 1; }
$(REPORTS)/dma-supervisor-integration.txt: build/tests/dma_supervisor_integration.vvp
	@mkdir -p $(REPORTS)
	$(VVP) $< > $@ || { cat $@; exit 1; }
$(REPORTS)/dma-local-irq-integration.txt: build/tests/dma_local_irq_integration.vvp
	@mkdir -p $(REPORTS)
	$(VVP) $< > $@ || { cat $@; exit 1; }
.PHONY: check-dma-block
check-dma-block: $(REPORTS)/dma-block-transfer.txt $(REPORTS)/dma-block-integration.txt $(REPORTS)/dma-channel-controller.txt $(REPORTS)/dma-controller-memory-integration.txt $(REPORTS)/dma-supervisor-context.txt $(REPORTS)/dma-supervisor-integration.txt $(REPORTS)/dma-local-irq-integration.txt

$(REPORTS)/cart-card-synthesis.txt $(EXPORTS)/rtl/cart_reference_card.json &: $(CARD_RTL)
	@mkdir -p $(REPORTS) $(EXPORTS)/rtl
	$(YOSYS) -l $(REPORTS)/cart-card-synthesis.txt -p 'read_verilog -sv $^; hierarchy -check -top cart_reference_card; proc; opt; check; stat; write_json $(EXPORTS)/rtl/cart_reference_card.json' > /dev/null
$(REPORTS)/dma-block-synthesis.txt $(EXPORTS)/rtl/dma_block_transfer.json &: rtl/dma_block_transfer.sv
	@mkdir -p $(REPORTS) $(EXPORTS)/rtl
	$(YOSYS) -l $(REPORTS)/dma-block-synthesis.txt -p 'read_verilog -sv $^; hierarchy -check -top dma_block_transfer; proc; opt; check; stat; write_json $(EXPORTS)/rtl/dma_block_transfer.json' > /dev/null
$(REPORTS)/dma-channel-synthesis.txt $(EXPORTS)/rtl/dma_channel_controller.json &: rtl/dma_block_transfer.sv rtl/dma_supervisor_context.sv rtl/dma_channel_controller.sv
	@mkdir -p $(REPORTS) $(EXPORTS)/rtl
	$(YOSYS) -l $(REPORTS)/dma-channel-synthesis.txt -p 'read_verilog -sv $^; hierarchy -check -top dma_channel_controller; proc; opt; check; stat; write_json $(EXPORTS)/rtl/dma_channel_controller.json' > /dev/null
$(REPORTS)/dma-local-irq-synthesis.txt $(EXPORTS)/rtl/core_local_dma_irq.json &: rtl/dma_block_transfer.sv rtl/dma_supervisor_context.sv rtl/dma_channel_controller.sv rtl/core_local_dma_irq.sv
	@mkdir -p $(REPORTS) $(EXPORTS)/rtl
	$(YOSYS) -l $(REPORTS)/dma-local-irq-synthesis.txt -p 'read_verilog -sv $^; hierarchy -check -top core_local_dma_irq; proc; opt; check; stat; write_json $(EXPORTS)/rtl/core_local_dma_irq.json' > /dev/null
$(REPORTS)/cart-pin-synthesis.txt $(EXPORTS)/rtl/cart_pin_events.json &: rtl/cart_pin_events.sv
	@mkdir -p $(REPORTS) $(EXPORTS)/rtl
	$(YOSYS) -l $(REPORTS)/cart-pin-synthesis.txt -p 'read_verilog -sv $^; hierarchy -check -top cart_pin_events; proc; opt; check; stat; write_json $(EXPORTS)/rtl/cart_pin_events.json' > /dev/null
$(REPORTS)/system-supervisor-synthesis.txt $(EXPORTS)/rtl/system_supervisor.json &: rtl/system_time.sv rtl/system_debug_transmit.sv rtl/system_supervisor.sv
	@mkdir -p $(REPORTS) $(EXPORTS)/rtl
	$(YOSYS) -l $(REPORTS)/system-supervisor-synthesis.txt -p 'read_verilog -sv $^; hierarchy -check -top system_supervisor; proc; opt; check; stat; write_json $(EXPORTS)/rtl/system_supervisor.json' > /dev/null
$(REPORTS)/system-debug-synthesis.txt $(EXPORTS)/rtl/system_debug_transmit.json &: rtl/system_debug_transmit.sv
	@mkdir -p $(REPORTS) $(EXPORTS)/rtl
	$(YOSYS) -l $(REPORTS)/system-debug-synthesis.txt -p 'read_verilog -sv $^; hierarchy -check -top system_debug_transmit; proc; opt; check; stat; write_json $(EXPORTS)/rtl/system_debug_transmit.json' > /dev/null
.PHONY: cart-card-synthesis dma-block-synthesis system-supervisor-synthesis
system-supervisor-synthesis: $(REPORTS)/system-supervisor-synthesis.txt $(EXPORTS)/rtl/system_supervisor.json $(REPORTS)/system-debug-synthesis.txt $(EXPORTS)/rtl/system_debug_transmit.json
cart-card-synthesis: $(REPORTS)/cart-card-synthesis.txt $(EXPORTS)/rtl/cart_reference_card.json $(REPORTS)/cart-pin-synthesis.txt $(EXPORTS)/rtl/cart_pin_events.json
dma-block-synthesis: $(REPORTS)/dma-block-synthesis.txt $(EXPORTS)/rtl/dma_block_transfer.json $(REPORTS)/dma-channel-synthesis.txt $(EXPORTS)/rtl/dma_channel_controller.json $(REPORTS)/dma-local-irq-synthesis.txt $(EXPORTS)/rtl/core_local_dma_irq.json

# Compare the physical card peer with both actual cartridge implementations.
build/tests/cart_scalar_bridge.vvp: $(CART_RTL) tests/cart_rom_model.sv tests/cart_scalar_card_peer.sv tests/cart_scalar_bridge_tb.sv
	@mkdir -p $(@D)
	$(IVERILOG) $(IVERILOG_FLAGS) -g2012 -Wall -s cart_scalar_bridge_tb -o $@ $^
.PHONY: check-cart-scalar
build/tests/cart_scalar_reference.cjs $(REPORTS)/cart-scalar-inputs.json &: tests/cart_scalar_reference.ts
	@mkdir -p build/tests $(REPORTS)
	$(ESBUILD) $< --bundle --platform=node --format=cjs --packages=external --outfile=build/tests/cart_scalar_reference.cjs --metafile=$(REPORTS)/cart-scalar-inputs.json
	$(PYTHON) -c 'import json; from pathlib import Path; d=json.loads(Path("$(REPORTS)/cart-scalar-inputs.json").read_text()); Path("build/tests/cart_scalar_reference_ts.d").write_text("build/tests/cart_scalar_reference.cjs $(REPORTS)/cart-scalar-inputs.json: " + " ".join(d["inputs"]) + "\n")'
-include build/tests/cart_scalar_reference_ts.d
check-cart-scalar: build/tests/cart_scalar_bridge.vvp build/tests/cart_scalar_reference.cjs
	@mkdir -p build/tests $(REPORTS)
	$(NODE) build/tests/cart_scalar_reference.cjs > build/tests/cart-scalar-reference-ts.txt
	$(CXX) -std=c++20 -I../machine/cpp -MM tests/cart_scalar_reference.cpp ../machine/cpp/machine/devices/cartridge/card.cpp ../machine/cpp/machine/devices/cartridge/mailbox.cpp > build/tests/cart_scalar_reference_cpp.d
	$(CXX) -std=c++20 -O2 -I../machine/cpp tests/cart_scalar_reference.cpp ../machine/cpp/machine/devices/cartridge/card.cpp ../machine/cpp/machine/devices/cartridge/mailbox.cpp -o build/tests/cart_scalar_reference
	build/tests/cart_scalar_reference > build/tests/cart-scalar-reference-cpp.txt
	$(VVP) $< > $(REPORTS)/cart-scalar-bridge.txt || { cat $(REPORTS)/cart-scalar-bridge.txt; exit 1; }
	sed -n 's/^ORACLE //p' $(REPORTS)/cart-scalar-bridge.txt > build/tests/cart-scalar-reference-sv.txt
	cmp build/tests/cart-scalar-reference-ts.txt build/tests/cart-scalar-reference-cpp.txt
	cmp build/tests/cart-scalar-reference-ts.txt build/tests/cart-scalar-reference-sv.txt

# The actual mixer/decoder imports, not a frozen APU demand implementation.
# esbuild's metadata owns the TS import closure, shared with release collection.
build/tests/apu_workloads.cjs $(REPORTS)/apu-workload-inputs.json &: tests/apu_workloads.ts
	@mkdir -p build/tests $(REPORTS)
	$(ESBUILD) $< --bundle --platform=node --format=cjs --packages=external --outfile=build/tests/apu_workloads.cjs --metafile=$(REPORTS)/apu-workload-inputs.json
	$(PYTHON) -c 'import json; from pathlib import Path; d=json.loads(Path("$(REPORTS)/apu-workload-inputs.json").read_text()); Path("build/tests/apu_workloads_ts.d").write_text("build/tests/apu_workloads.cjs $(REPORTS)/apu-workload-inputs.json: " + " ".join(d["inputs"]) + "\n")'
-include build/tests/apu_workloads_ts.d
$(REPORTS)/apu-workloads-ts.json build/tests/apu-workloads-input.txt &: build/tests/apu_workloads.cjs
	@mkdir -p $(REPORTS)
	$(NODE) $< > $(REPORTS)/apu-workloads-ts.json
	$(NODE) $< --cpp-input > build/tests/apu-workloads-input.txt

# One -MMD file per translation unit retains every actual header dependency.
# The aggregate is an ordinary generated compiler depfile, not a new source map.
APU_CPP_OWNER_DIR = ../machine/cpp/machine/devices/audio
APU_CPP_OWNERS = output playback biquad_filter badp_decoder output_ring
APU_CPP_OBJECT_DIR = build/tests/apu_workloads_obj
APU_CPP_OBJECTS = $(APU_CPP_OBJECT_DIR)/probe.o $(addprefix $(APU_CPP_OBJECT_DIR)/,$(addsuffix .o,$(APU_CPP_OWNERS)))
APU_CPP_FLAGS = -std=c++20 -O2 -ffunction-sections -fdata-sections -I../machine/cpp
$(APU_CPP_OBJECT_DIR)/probe.o: tests/apu_workloads.cpp
	@mkdir -p $(@D)
	$(CXX) $(APU_CPP_FLAGS) -MMD -MP -MF $(@:.o=.d) -c $< -o $@
$(APU_CPP_OBJECT_DIR)/%.o: $(APU_CPP_OWNER_DIR)/%.cpp
	@mkdir -p $(@D)
	$(CXX) $(APU_CPP_FLAGS) -MMD -MP -MF $(@:.o=.d) -c $< -o $@
build/tests/apu_workloads: $(APU_CPP_OBJECTS)
	$(CXX) -Wl,--gc-sections $^ -o $@
	cat $(APU_CPP_OBJECTS:.o=.d) > build/tests/apu_workloads.d
-include build/tests/apu_workloads.d
$(REPORTS)/apu-workloads-cpp.json: build/tests/apu_workloads build/tests/apu-workloads-input.txt
	@mkdir -p $(@D)
	$< < build/tests/apu-workloads-input.txt > $@

build/tests/apu_mix_vectors.cjs $(REPORTS)/apu-mix-inputs.json &: tests/apu_mix_vectors.ts
	@mkdir -p build/tests $(REPORTS)
	$(ESBUILD) $< --bundle --platform=node --format=cjs --packages=external --outfile=build/tests/apu_mix_vectors.cjs --metafile=$(REPORTS)/apu-mix-inputs.json
	$(PYTHON) -c 'import json; from pathlib import Path; d=json.loads(Path("$(REPORTS)/apu-mix-inputs.json").read_text()); Path("build/tests/apu_mix_vectors_ts.d").write_text("build/tests/apu_mix_vectors.cjs $(REPORTS)/apu-mix-inputs.json: " + " ".join(d["inputs"]) + "\n")'
-include build/tests/apu_mix_vectors_ts.d
build/tests/apu-mix-vectors.txt: build/tests/apu_mix_vectors.cjs
	$(NODE) $< > $@
$(APU_CPP_OBJECT_DIR)/mix_vectors.o: tests/apu_mix_vectors.cpp
	@mkdir -p $(@D)
	$(CXX) $(APU_CPP_FLAGS) -MMD -MP -MF $(@:.o=.d) -c $< -o $@
-include $(APU_CPP_OBJECT_DIR)/mix_vectors.d
build/tests/apu_mix_vectors_cpp: $(APU_CPP_OBJECT_DIR)/mix_vectors.o $(filter-out $(APU_CPP_OBJECT_DIR)/probe.o,$(APU_CPP_OBJECTS))
	$(CXX) -Wl,--gc-sections $^ -o $@
build/tests/apu_mix_engine.vvp: rtl/apu_mix_engine.sv tests/apu_mix_engine_tb.sv
	@mkdir -p $(@D)
	$(IVERILOG) $(IVERILOG_FLAGS) -g2012 -Wall -s apu_mix_engine_tb -o $@ $^
build/tests/apu_mix_timing.vvp: rtl/apu_mix_engine.sv tests/apu_mix_timing_tb.sv
	@mkdir -p $(@D)
	$(IVERILOG) $(IVERILOG_FLAGS) -g2012 -Wall -s apu_mix_timing_tb -o $@ $^
$(REPORTS)/apu-mix-cpp.txt: build/tests/apu_mix_vectors_cpp build/tests/apu-mix-vectors.txt
	@mkdir -p $(REPORTS)
	$< < build/tests/apu-mix-vectors.txt > $@
$(REPORTS)/apu-mix-rtl.txt: build/tests/apu_mix_engine.vvp build/tests/apu-mix-vectors.txt
	@mkdir -p $(REPORTS)
	$(VVP) $< > $@ || { cat $@; exit 1; }
$(REPORTS)/apu-mix-timing.txt: build/tests/apu_mix_timing.vvp
	@mkdir -p $(REPORTS)
	$(VVP) $< > $@ || { cat $@; exit 1; }
$(REPORTS)/apu-mix-synthesis.txt $(EXPORTS)/rtl/apu_mix_engine.json &: rtl/apu_mix_engine.sv
	@mkdir -p $(REPORTS) $(EXPORTS)/rtl
	$(YOSYS) -l $(REPORTS)/apu-mix-synthesis.txt -p 'read_verilog -sv $^; hierarchy -check -top apu_mix_engine; proc; opt; check; stat; write_json $(EXPORTS)/rtl/apu_mix_engine.json' > /dev/null
.PHONY: check-apu-mix
check-apu-mix: $(REPORTS)/apu-mix-cpp.txt $(REPORTS)/apu-mix-rtl.txt $(REPORTS)/apu-mix-timing.txt $(REPORTS)/apu-mix-synthesis.txt $(EXPORTS)/rtl/apu_mix_engine.json

build/tests/apu_pan_vectors.cjs $(REPORTS)/apu-pan-inputs.json &: tests/apu_pan_vectors.ts
	@mkdir -p build/tests $(REPORTS)
	$(ESBUILD) $< --bundle --platform=node --format=cjs --packages=external --outfile=build/tests/apu_pan_vectors.cjs --metafile=$(REPORTS)/apu-pan-inputs.json
	$(PYTHON) -c 'import json; from pathlib import Path; d=json.loads(Path("$(REPORTS)/apu-pan-inputs.json").read_text()); Path("build/tests/apu_pan_vectors_ts.d").write_text("build/tests/apu_pan_vectors.cjs $(REPORTS)/apu-pan-inputs.json: " + " ".join(d["inputs"]) + "\n")'
-include build/tests/apu_pan_vectors_ts.d
build/tests/apu-pan-vectors.txt: build/tests/apu_pan_vectors.cjs
	$(NODE) $< > $@
$(APU_CPP_OBJECT_DIR)/pan_vectors.o: tests/apu_pan_vectors.cpp
	@mkdir -p $(@D)
	$(CXX) $(APU_CPP_FLAGS) -MMD -MP -MF $(@:.o=.d) -c $< -o $@
-include $(APU_CPP_OBJECT_DIR)/pan_vectors.d
build/tests/apu_pan_vectors_cpp: $(APU_CPP_OBJECT_DIR)/pan_vectors.o $(filter-out $(APU_CPP_OBJECT_DIR)/probe.o,$(APU_CPP_OBJECTS))
	$(CXX) -Wl,--gc-sections $^ -o $@
build/tests/apu_pan_engine.vvp: rtl/apu_mix_engine.sv tests/apu_pan_engine_tb.sv
	@mkdir -p $(@D)
	$(IVERILOG) $(IVERILOG_FLAGS) -g2012 -Wall -s apu_pan_engine_tb -o $@ $^
$(REPORTS)/apu-pan-cpp.txt: build/tests/apu_pan_vectors_cpp build/tests/apu-pan-vectors.txt
	@mkdir -p $(REPORTS)
	$< < build/tests/apu-pan-vectors.txt > $@
$(REPORTS)/apu-pan-rtl.txt: build/tests/apu_pan_engine.vvp build/tests/apu-pan-vectors.txt
	@mkdir -p $(REPORTS)
	$(VVP) $< > $@ || { cat $@; exit 1; }
.PHONY: check-apu-pan
check-apu-pan: $(REPORTS)/apu-pan-cpp.txt $(REPORTS)/apu-pan-rtl.txt $(REPORTS)/apu-mix-synthesis.txt $(EXPORTS)/rtl/apu_mix_engine.json

build/tests/apu_command_ingress.vvp: rtl/apu_command_ingress.sv tests/apu_command_ingress_tb.sv
	@mkdir -p $(@D)
	$(IVERILOG) $(IVERILOG_FLAGS) -g2012 -Wall -s apu_command_ingress_tb -o $@ $^
$(REPORTS)/apu-command-ingress.txt: build/tests/apu_command_ingress.vvp
	@mkdir -p $(REPORTS)
	$(VVP) $< > $@ || { cat $@; exit 1; }
$(REPORTS)/apu-command-ingress-synthesis.txt $(EXPORTS)/rtl/apu_command_ingress.json &: rtl/apu_command_ingress.sv
	@mkdir -p $(REPORTS) $(EXPORTS)/rtl
	$(YOSYS) -l $(REPORTS)/apu-command-ingress-synthesis.txt -p 'read_verilog -sv $^; hierarchy -check -top apu_command_ingress; proc; opt; check; stat; write_json $(EXPORTS)/rtl/apu_command_ingress.json' > /dev/null
build/tests/apu_command_fifo_oracle.cjs $(REPORTS)/apu-command-inputs.json &: tests/apu_command_fifo_oracle.ts
	@mkdir -p build/tests $(REPORTS)
	$(ESBUILD) $< --bundle --platform=node --format=cjs --packages=external --outfile=build/tests/apu_command_fifo_oracle.cjs --metafile=$(REPORTS)/apu-command-inputs.json
	$(PYTHON) -c 'import json; from pathlib import Path; d=json.loads(Path("$(REPORTS)/apu-command-inputs.json").read_text()); Path("build/tests/apu_command_fifo_ts.d").write_text("build/tests/apu_command_fifo_oracle.cjs $(REPORTS)/apu-command-inputs.json: " + " ".join(d["inputs"]) + "\n")'
-include build/tests/apu_command_fifo_ts.d
build/tests/apu-command-fifo-ts.txt: build/tests/apu_command_fifo_oracle.cjs
	$(NODE) $< > $@
build/tests/apu_command_fifo_cpp: tests/apu_command_fifo_oracle.cpp ../machine/cpp/machine/devices/audio/command_fifo.cpp
	@mkdir -p $(@D)
	$(CXX) -std=c++20 -O2 -I../machine/cpp -MM -MT $@ $(filter %.cpp,$^) > build/tests/apu_command_fifo_cpp.d
	$(CXX) -std=c++20 -O2 -I../machine/cpp $(filter %.cpp,$^) -o $@
-include build/tests/apu_command_fifo_cpp.d
$(REPORTS)/apu-command-parity.txt: build/tests/apu_command_fifo_cpp build/tests/apu-command-fifo-ts.txt $(REPORTS)/apu-command-ingress.txt
	$< > build/tests/apu-command-fifo-cpp.txt
	sed -n 's/^ORACLE //p' $(REPORTS)/apu-command-ingress.txt > build/tests/apu-command-fifo-rtl.txt
	cmp build/tests/apu-command-fifo-ts.txt build/tests/apu-command-fifo-cpp.txt
	cmp build/tests/apu-command-fifo-ts.txt build/tests/apu-command-fifo-rtl.txt
	@printf '%s\n' 'PASS 34 command FIFO outputs match actual TS/C++ owners and physical ingress' > $@
.PHONY: check-apu-command-ingress
check-apu-command-ingress: $(REPORTS)/apu-command-ingress.txt $(REPORTS)/apu-command-parity.txt $(REPORTS)/apu-command-ingress-synthesis.txt $(EXPORTS)/rtl/apu_command_ingress.json

build/tests/apu_command_sys_endpoint.vvp: rtl/system_bus_master.sv rtl/apu_command_ingress.sv rtl/apu_command_sys_endpoint.sv tests/apu_command_sys_endpoint_tb.sv
	@mkdir -p $(@D)
	$(IVERILOG) $(IVERILOG_FLAGS) -g2012 -Wall -s apu_command_sys_endpoint_tb -o $@ $^
$(REPORTS)/apu-command-sys-endpoint.txt: build/tests/apu_command_sys_endpoint.vvp
	@mkdir -p $(REPORTS)
	$(VVP) $< > $@ || { cat $@; exit 1; }
$(REPORTS)/apu-command-sys-synthesis.txt $(EXPORTS)/rtl/apu_command_sys_endpoint.json &: rtl/apu_command_ingress.sv rtl/apu_command_sys_endpoint.sv
	@mkdir -p $(REPORTS) $(EXPORTS)/rtl
	$(YOSYS) -l $(REPORTS)/apu-command-sys-synthesis.txt -p 'read_verilog -sv $^; hierarchy -check -top apu_command_sys_endpoint; proc; opt; check -assert; stat; write_json $(EXPORTS)/rtl/apu_command_sys_endpoint.json' > /dev/null
.PHONY: check-apu-command-sys
check-apu-command-sys: $(REPORTS)/apu-command-sys-endpoint.txt $(REPORTS)/apu-command-sys-synthesis.txt $(EXPORTS)/rtl/apu_command_sys_endpoint.json

build/tests/apu_command_executor.vvp: rtl/apu_command_ingress.sv rtl/apu_slot_bank.sv rtl/apu_command_executor.sv tests/apu_command_executor_tb.sv
	@mkdir -p $(@D)
	$(IVERILOG) $(IVERILOG_FLAGS) -g2012 -Wall -s apu_command_executor_tb -o $@ $^
$(REPORTS)/apu-command-executor.txt: build/tests/apu_command_executor.vvp
	@mkdir -p $(REPORTS)
	$(VVP) $< > $@ || { cat $@; exit 1; }
$(REPORTS)/apu-command-executor-synthesis.txt $(EXPORTS)/rtl/apu_command_executor.json &: rtl/apu_command_executor.sv
	@mkdir -p $(REPORTS) $(EXPORTS)/rtl
	$(YOSYS) -l $(REPORTS)/apu-command-executor-synthesis.txt -p 'read_verilog -sv $^; hierarchy -check -top apu_command_executor; proc; opt; check -assert; stat; write_json $(EXPORTS)/rtl/apu_command_executor.json' > /dev/null
.PHONY: check-apu-command-executor
check-apu-command-executor: $(REPORTS)/apu-command-executor.txt $(REPORTS)/apu-command-executor-synthesis.txt $(EXPORTS)/rtl/apu_command_executor.json

build/tests/apu_frame_timeline.vvp: rtl/apu_frame_timeline.sv rtl/apu_command_ingress.sv rtl/apu_command_executor.sv rtl/apu_slot_bank.sv tests/apu_frame_timeline_tb.sv
	@mkdir -p $(@D)
	$(IVERILOG) $(IVERILOG_FLAGS) -g2012 -Wall -s apu_frame_timeline_tb -o $@ $^
$(REPORTS)/apu-frame-timeline.txt: build/tests/apu_frame_timeline.vvp
	@mkdir -p $(REPORTS)
	$(VVP) $< > $@ || { cat $@; exit 1; }
$(REPORTS)/apu-frame-timeline-synthesis.txt $(EXPORTS)/rtl/apu_frame_timeline.json &: rtl/apu_frame_timeline.sv
	@mkdir -p $(REPORTS) $(EXPORTS)/rtl
	$(YOSYS) -l $(REPORTS)/apu-frame-timeline-synthesis.txt -p 'read_verilog -sv $^; hierarchy -check -top apu_frame_timeline; proc; opt; check -assert; stat; write_json $(EXPORTS)/rtl/apu_frame_timeline.json' > /dev/null
.PHONY: check-apu-frame-timeline
check-apu-frame-timeline: $(REPORTS)/apu-frame-timeline.txt $(REPORTS)/apu-frame-timeline-synthesis.txt $(EXPORTS)/rtl/apu_frame_timeline.json

build/tests/apu_frame_snapshot_integration.vvp: rtl/apu_frame_timeline.sv rtl/apu_command_executor.sv rtl/apu_upload_commit.sv rtl/apu_badp_decoder.sv rtl/apu_badp_step.sv tests/apu_frame_snapshot_integration_tb.sv
	@mkdir -p $(@D)
	$(IVERILOG) $(IVERILOG_FLAGS) -g2012 -Wall -s apu_frame_snapshot_integration_tb -o $@ $^
$(REPORTS)/apu-frame-snapshot-integration.txt: build/tests/apu_frame_snapshot_integration.vvp
	@mkdir -p $(@D)
	$(VVP) $< > $@ || { cat $@; exit 1; }
.PHONY: check-apu-frame-snapshot-integration
check-apu-frame-snapshot-integration: $(REPORTS)/apu-frame-snapshot-integration.txt $(REPORTS)/apu-frame-snapshot-edge.txt

build/tests/apu_frame_snapshot_edge.vvp: rtl/apu_frame_timeline.sv rtl/apu_upload_commit.sv tests/apu_frame_snapshot_edge_tb.sv
	@mkdir -p $(@D)
	$(IVERILOG) $(IVERILOG_FLAGS) -g2012 -Wall -s apu_frame_snapshot_edge_tb -o $@ $^
$(REPORTS)/apu-frame-snapshot-edge.txt: build/tests/apu_frame_snapshot_edge.vvp
	@mkdir -p $(@D)
	$(VVP) $< > $@ || { cat $@; exit 1; }

build/tests/apu_timeline_memory_order.vvp: rtl/apu_frame_timeline.sv rtl/apu_upload_commit.sv tests/apu_timeline_memory_order_tb.sv
	@mkdir -p $(@D)
	$(IVERILOG) $(IVERILOG_FLAGS) -g2012 -Wall -s apu_timeline_memory_order_tb -o $@ $^
$(REPORTS)/apu-timeline-memory-order.txt: build/tests/apu_timeline_memory_order.vvp
	@mkdir -p $(REPORTS)
	$(VVP) $< +EARLY=0 > $@ || { cat $@; exit 1; }
	$(VVP) $< +EARLY=1 >> $@ || { cat $@; exit 1; }
	$(VVP) $< +EARLY=1 +SATURATION=1 >> $@ || { cat $@; exit 1; }
.PHONY: check-apu-timeline-memory-order
check-apu-timeline-memory-order: $(REPORTS)/apu-timeline-memory-order.txt

build/tests/apu_upload_multisnapshot.vvp: rtl/apu_frame_timeline.sv rtl/apu_upload_commit.sv tests/apu_upload_multisnapshot_tb.sv
	@mkdir -p $(@D)
	$(IVERILOG) $(IVERILOG_FLAGS) -g2012 -Wall -s apu_upload_multisnapshot_tb -o $@ $^
build/tests/apu_upload_multisnapshot_stress.vvp: rtl/apu_upload_commit.sv tests/apu_upload_multisnapshot_stress_tb.sv
	@mkdir -p $(@D)
	$(IVERILOG) $(IVERILOG_FLAGS) -g2012 -Wall -s apu_upload_multisnapshot_stress_tb -o $@ $^
$(REPORTS)/apu-upload-multisnapshot.txt: build/tests/apu_upload_multisnapshot.vvp
	@mkdir -p $(REPORTS)
	$(VVP) $< > $@ || { cat $@; exit 1; }
$(REPORTS)/apu-upload-multisnapshot-stress.txt: build/tests/apu_upload_multisnapshot_stress.vvp
	@mkdir -p $(REPORTS)
	$(VVP) $< > $@ || { cat $@; exit 1; }
APU_SNAPSHOT_PROVENANCE = apu_badp_multisnapshot_provenance apu_badp_empty_snapshot_handoff apu_badp_empty_due_handoff
$(addprefix build/tests/,$(addsuffix .vvp,$(APU_SNAPSHOT_PROVENANCE))): build/tests/%.vvp: rtl/apu_upload_commit.sv rtl/apu_badp_step.sv rtl/apu_badp_decoder.sv tests/%_tb.sv
	@mkdir -p $(@D)
	$(IVERILOG) $(IVERILOG_FLAGS) -g2012 -Wall -s $*_tb -o $@ $^
$(addprefix $(REPORTS)/,$(addsuffix .txt,$(APU_SNAPSHOT_PROVENANCE))): $(REPORTS)/%.txt: build/tests/%.vvp
	@mkdir -p $(REPORTS)
	$(VVP) $< > $@ || { cat $@; exit 1; }
.PHONY: check-apu-upload-multisnapshot
check-apu-upload-multisnapshot: $(REPORTS)/apu-upload-multisnapshot.txt $(REPORTS)/apu-upload-multisnapshot-stress.txt $(addprefix $(REPORTS)/,$(addsuffix .txt,$(APU_SNAPSHOT_PROVENANCE))) check-apu-synthesis


build/tests/apu_i2s_tx.vvp: rtl/apu_i2s_tx.sv tests/apu_i2s_tx_tb.sv
	@mkdir -p $(@D)
	$(IVERILOG) $(IVERILOG_FLAGS) -g2012 -Wall -s apu_i2s_tx_tb -o $@ $^
build/tests/apu_i2s_timing.vvp: rtl/apu_i2s_tx.sv rtl/apu_frame_timeline.sv tests/apu_i2s_timing_tb.sv
	@mkdir -p $(@D)
	$(IVERILOG) $(IVERILOG_FLAGS) -g2012 -Wall -s apu_i2s_timing_tb -o $@ $^
$(REPORTS)/apu-i2s-tx.txt: build/tests/apu_i2s_tx.vvp
	@mkdir -p $(REPORTS)
	$(VVP) $< > $@ || { cat $@; exit 1; }
$(REPORTS)/apu-i2s-timing.txt: build/tests/apu_i2s_timing.vvp
	@mkdir -p $(REPORTS)
	$(VVP) $< > $@ || { cat $@; exit 1; }
$(REPORTS)/apu-i2s-tx-synthesis.txt $(EXPORTS)/rtl/apu_i2s_tx.json &: rtl/apu_i2s_tx.sv
	@mkdir -p $(REPORTS) $(EXPORTS)/rtl
	$(YOSYS) -l $(REPORTS)/apu-i2s-tx-synthesis.txt -p 'read_verilog -sv $^; hierarchy -check -top apu_i2s_tx; proc; opt; check -assert; stat; write_json $(EXPORTS)/rtl/apu_i2s_tx.json' > /dev/null
.PHONY: check-apu-i2s
check-apu-i2s: $(REPORTS)/apu-i2s-tx.txt $(REPORTS)/apu-i2s-timing.txt $(REPORTS)/apu-i2s-tx-synthesis.txt $(EXPORTS)/rtl/apu_i2s_tx.json

build/tests/apu_slot_bank_oracle.cjs $(REPORTS)/apu-slot-bank-inputs.json &: tests/apu_slot_bank_oracle.ts
	@mkdir -p build/tests $(REPORTS)
	$(ESBUILD) $< --bundle --platform=node --format=cjs --packages=external --outfile=build/tests/apu_slot_bank_oracle.cjs --metafile=$(REPORTS)/apu-slot-bank-inputs.json
	$(PYTHON) -c 'import json; from pathlib import Path; d=json.loads(Path("$(REPORTS)/apu-slot-bank-inputs.json").read_text()); Path("build/tests/apu_slot_bank_ts.d").write_text("build/tests/apu_slot_bank_oracle.cjs $(REPORTS)/apu-slot-bank-inputs.json: " + " ".join(d["inputs"]) + "\n")'
-include build/tests/apu_slot_bank_ts.d
build/tests/apu-slot-bank-ts.txt: build/tests/apu_slot_bank_oracle.cjs
	$(NODE) $< > $@
build/tests/apu_slot_bank_cpp: tests/apu_slot_bank_oracle.cpp ../machine/cpp/machine/devices/audio/slot_bank.cpp
	@mkdir -p $(@D)
	$(CXX) -std=c++20 -O2 -I../machine/cpp -MM -MT $@ $(filter %.cpp,$^) > build/tests/apu_slot_bank_cpp.d
	$(CXX) -std=c++20 -O2 -I../machine/cpp $(filter %.cpp,$^) -o $@
-include build/tests/apu_slot_bank_cpp.d
build/tests/apu_slot_bank.vvp: rtl/apu_slot_bank.sv tests/apu_slot_bank_tb.sv
	@mkdir -p $(@D)
	$(IVERILOG) $(IVERILOG_FLAGS) -g2012 -Wall -s apu_slot_bank_tb -o $@ $^
$(REPORTS)/apu-slot-bank-rtl.txt: build/tests/apu_slot_bank.vvp
	@mkdir -p $(REPORTS)
	$(VVP) $< > $@ || { cat $@; exit 1; }
$(REPORTS)/apu-slot-bank-parity.txt: build/tests/apu_slot_bank_cpp build/tests/apu-slot-bank-ts.txt $(REPORTS)/apu-slot-bank-rtl.txt
	$< > build/tests/apu-slot-bank-cpp.txt
	sed -n 's/^ORACLE //p' $(REPORTS)/apu-slot-bank-rtl.txt > build/tests/apu-slot-bank-rtl.txt
	cmp build/tests/apu-slot-bank-ts.txt build/tests/apu-slot-bank-cpp.txt
	cmp build/tests/apu-slot-bank-ts.txt build/tests/apu-slot-bank-rtl.txt
	@printf '%s\n' 'PASS 336 slot register words match actual TS/C++ owners and physical slot bank' > $@
$(REPORTS)/apu-slot-bank-synthesis.txt $(EXPORTS)/rtl/apu_slot_bank.json &: rtl/apu_slot_bank.sv
	@mkdir -p $(REPORTS) $(EXPORTS)/rtl
	$(YOSYS) -l $(REPORTS)/apu-slot-bank-synthesis.txt -p 'read_verilog -sv $^; hierarchy -check -top apu_slot_bank; proc; opt; check -assert; stat; write_json $(EXPORTS)/rtl/apu_slot_bank.json' > /dev/null
.PHONY: check-apu-slot-bank
check-apu-slot-bank: $(REPORTS)/apu-slot-bank-rtl.txt $(REPORTS)/apu-slot-bank-parity.txt $(REPORTS)/apu-slot-bank-synthesis.txt $(EXPORTS)/rtl/apu_slot_bank.json

build/tests/apu_pcm_frame_vectors.cjs $(REPORTS)/apu-pcm-inputs.json &: tests/apu_pcm_frame_vectors.ts
	@mkdir -p build/tests $(REPORTS)
	$(ESBUILD) $< --bundle --platform=node --format=cjs --packages=external --outfile=build/tests/apu_pcm_frame_vectors.cjs --metafile=$(REPORTS)/apu-pcm-inputs.json
	$(PYTHON) -c 'import json; from pathlib import Path; d=json.loads(Path("$(REPORTS)/apu-pcm-inputs.json").read_text()); Path("build/tests/apu_pcm_frame_ts.d").write_text("build/tests/apu_pcm_frame_vectors.cjs $(REPORTS)/apu-pcm-inputs.json: " + " ".join(d["inputs"]) + "\n")'
-include build/tests/apu_pcm_frame_ts.d
build/tests/apu-pcm-frame-vectors.txt: build/tests/apu_pcm_frame_vectors.cjs
	$(NODE) $< > $@
build/tests/apu_pcm_frame_cpp: tests/apu_pcm_frame_vectors.cpp
	@mkdir -p $(@D)
	$(CXX) -std=c++20 -O2 -I../machine/cpp -MM -MT $@ $< > build/tests/apu_pcm_frame_cpp.d
	$(CXX) -std=c++20 -O2 -I../machine/cpp $< -o $@
-include build/tests/apu_pcm_frame_cpp.d
build/tests/apu_pcm_frame.vvp: rtl/apu_pcm_frame.sv tests/apu_pcm_frame_tb.sv
	@mkdir -p $(@D)
	$(IVERILOG) $(IVERILOG_FLAGS) -g2012 -Wall -s apu_pcm_frame_tb -o $@ $^
$(REPORTS)/apu-pcm-cpp.txt: build/tests/apu_pcm_frame_cpp build/tests/apu-pcm-frame-vectors.txt
	@mkdir -p $(REPORTS)
	$< < build/tests/apu-pcm-frame-vectors.txt > $@
$(REPORTS)/apu-pcm-rtl.txt: build/tests/apu_pcm_frame.vvp build/tests/apu-pcm-frame-vectors.txt
	@mkdir -p $(REPORTS)
	$(VVP) $< > $@ || { cat $@; exit 1; }
$(REPORTS)/apu-pcm-synthesis.txt $(EXPORTS)/rtl/apu_pcm_frame.json &: rtl/apu_pcm_frame.sv
	@mkdir -p $(REPORTS) $(EXPORTS)/rtl
	$(YOSYS) -l $(REPORTS)/apu-pcm-synthesis.txt -p 'read_verilog -sv $^; hierarchy -check -top apu_pcm_frame; proc; opt; check; stat; write_json $(EXPORTS)/rtl/apu_pcm_frame.json' > /dev/null
.PHONY: check-apu-pcm
check-apu-pcm: $(REPORTS)/apu-pcm-cpp.txt $(REPORTS)/apu-pcm-rtl.txt $(REPORTS)/apu-pcm-synthesis.txt $(EXPORTS)/rtl/apu_pcm_frame.json

build/tests/apu_biquad_vectors.cjs $(REPORTS)/apu-biquad-inputs.json &: tests/apu_biquad_vectors.ts
	@mkdir -p build/tests $(REPORTS)
	$(ESBUILD) $< --bundle --platform=node --format=cjs --packages=external --outfile=build/tests/apu_biquad_vectors.cjs --metafile=$(REPORTS)/apu-biquad-inputs.json
	$(PYTHON) -c 'import json; from pathlib import Path; d=json.loads(Path("$(REPORTS)/apu-biquad-inputs.json").read_text()); Path("build/tests/apu_biquad_ts.d").write_text("build/tests/apu_biquad_vectors.cjs $(REPORTS)/apu-biquad-inputs.json: " + " ".join(d["inputs"]) + "\n")'
-include build/tests/apu_biquad_ts.d
build/tests/apu-biquad-vectors.txt: build/tests/apu_biquad_vectors.cjs
	$(NODE) $< > $@
build/tests/apu_biquad_cpp: tests/apu_biquad_vectors.cpp ../machine/cpp/machine/devices/audio/biquad_filter.cpp
	@mkdir -p $(@D)
	$(CXX) -std=c++20 -O2 -I../machine/cpp -MM -MT $@ $(filter %.cpp,$^) > build/tests/apu_biquad_cpp.d
	$(CXX) -std=c++20 -O2 -I../machine/cpp $(filter %.cpp,$^) -o $@
-include build/tests/apu_biquad_cpp.d
build/tests/apu_biquad.vvp: rtl/apu_biquad.sv tests/apu_biquad_tb.sv
	@mkdir -p $(@D)
	$(IVERILOG) $(IVERILOG_FLAGS) -g2012 -Wall -s apu_biquad_tb -o $@ $^
$(REPORTS)/apu-biquad-cpp.txt: build/tests/apu_biquad_cpp build/tests/apu-biquad-vectors.txt
	@mkdir -p $(REPORTS)
	$< < build/tests/apu-biquad-vectors.txt > $@
$(REPORTS)/apu-biquad-rtl.txt: build/tests/apu_biquad.vvp build/tests/apu-biquad-vectors.txt
	@mkdir -p $(REPORTS)
	$(VVP) $< > $@ || { cat $@; exit 1; }
$(REPORTS)/apu-biquad-synthesis.txt $(EXPORTS)/rtl/apu_biquad.json &: rtl/apu_biquad.sv
	@mkdir -p $(REPORTS) $(EXPORTS)/rtl
	$(YOSYS) -l $(REPORTS)/apu-biquad-synthesis.txt -p 'read_verilog -sv $^; hierarchy -check -top apu_biquad; proc; opt; check -assert; stat; write_json $(EXPORTS)/rtl/apu_biquad.json' > /dev/null
.PHONY: check-apu-biquad
check-apu-biquad: $(REPORTS)/apu-biquad-cpp.txt $(REPORTS)/apu-biquad-rtl.txt $(REPORTS)/apu-biquad-synthesis.txt $(EXPORTS)/rtl/apu_biquad.json

build/tests/apu_badp_coherence_vectors.cjs $(REPORTS)/apu-badp-coherence-inputs.json &: tests/apu_badp_coherence_vectors.ts
	@mkdir -p build/tests $(REPORTS)
	$(ESBUILD) $< --bundle --platform=node --format=cjs --packages=external --outfile=build/tests/apu_badp_coherence_vectors.cjs --metafile=$(REPORTS)/apu-badp-coherence-inputs.json
	$(PYTHON) -c 'import json; from pathlib import Path; d=json.loads(Path("$(REPORTS)/apu-badp-coherence-inputs.json").read_text()); Path("build/tests/apu_badp_coherence_ts.d").write_text("build/tests/apu_badp_coherence_vectors.cjs $(REPORTS)/apu-badp-coherence-inputs.json: " + " ".join(d["inputs"]) + "\n")'
-include build/tests/apu_badp_coherence_ts.d
build/tests/apu-badp-coherence-vectors.txt: build/tests/apu_badp_coherence_vectors.cjs
	$(NODE) $< > $@
build/tests/apu_badp_coherence_cpp: tests/apu_badp_coherence_vectors.cpp
	@mkdir -p $(@D)
	$(CXX) -std=c++20 -O2 -I../machine/cpp -MM -MT $@ $< > build/tests/apu_badp_coherence_cpp.d
	$(CXX) -std=c++20 -O2 -I../machine/cpp $< -o $@
-include build/tests/apu_badp_coherence_cpp.d
build/tests/apu_badp_coherence.vvp: rtl/apu_badp_step.sv rtl/apu_badp_decoder.sv tests/apu_badp_coherence_tb.sv
	@mkdir -p $(@D)
	$(IVERILOG) $(IVERILOG_FLAGS) -g2012 -Wall -s apu_badp_coherence_tb -o $@ $^
$(REPORTS)/apu-badp-coherence-parity.txt: build/tests/apu_badp_coherence_cpp build/tests/apu-badp-coherence-vectors.txt
	$< > build/tests/apu-badp-coherence-cpp.txt
	cmp build/tests/apu-badp-coherence-vectors.txt build/tests/apu-badp-coherence-cpp.txt
	@printf '%s\n' 'PASS BADP coherence vectors match actual TS/C++ decoder owners' > $@
$(REPORTS)/apu-badp-coherence-rtl.txt: build/tests/apu_badp_coherence.vvp build/tests/apu-badp-coherence-vectors.txt
	@mkdir -p $(REPORTS)
	$(VVP) $< > $@ || { cat $@; exit 1; }
.PHONY: check-apu-badp-coherence
check-apu-badp-coherence: $(REPORTS)/apu-badp-coherence-parity.txt $(REPORTS)/apu-badp-coherence-rtl.txt $(REPORTS)/apu-badp-bank-coincidence.txt

build/tests/apu_fixed_block_loop_vectors.cjs $(REPORTS)/apu-fixed-block-loop-inputs.json &: tests/apu_fixed_block_loop_vectors.ts
	@mkdir -p build/tests $(REPORTS)
	$(ESBUILD) $< --bundle --platform=node --format=cjs --packages=external --outfile=build/tests/apu_fixed_block_loop_vectors.cjs --metafile=$(REPORTS)/apu-fixed-block-loop-inputs.json
	$(PYTHON) -c 'import json; from pathlib import Path; d=json.loads(Path("$(REPORTS)/apu-fixed-block-loop-inputs.json").read_text()); Path("build/tests/apu_fixed_block_loop_ts.d").write_text("build/tests/apu_fixed_block_loop_vectors.cjs $(REPORTS)/apu-fixed-block-loop-inputs.json: " + " ".join(d["inputs"]) + "\n")'
-include build/tests/apu_fixed_block_loop_ts.d
$(REPORTS)/apu-fixed-block-loop.txt: build/tests/apu_fixed_block_loop_vectors.cjs
	@mkdir -p $(REPORTS)
	$(NODE) $< > $@ || { cat $@; exit 1; }
.PHONY: check-apu-fixed-block-loop
check-apu-fixed-block-loop: $(REPORTS)/apu-fixed-block-loop.txt

build/tests/apu_badp_bank_coincidence.vvp: rtl/apu_badp_step.sv rtl/apu_badp_decoder.sv tests/apu_badp_bank_coincidence_tb.sv
	@mkdir -p $(@D)
	$(IVERILOG) $(IVERILOG_FLAGS) -g2012 -Wall -s apu_badp_bank_coincidence_tb -o $@ $^
$(REPORTS)/apu-badp-bank-coincidence.txt: build/tests/apu_badp_bank_coincidence.vvp
	@mkdir -p $(REPORTS)
	$(VVP) $< > $@ || { cat $@; exit 1; }

build/tests/apu_badp_mix_vectors.cjs $(REPORTS)/apu-badp-mix-inputs.json &: tests/apu_badp_mix_vectors.ts
	@mkdir -p build/tests $(REPORTS)
	$(ESBUILD) $< --bundle --platform=node --format=cjs --packages=external --outfile=build/tests/apu_badp_mix_vectors.cjs --metafile=$(REPORTS)/apu-badp-mix-inputs.json
	$(PYTHON) -c 'import json; from pathlib import Path; d=json.loads(Path("$(REPORTS)/apu-badp-mix-inputs.json").read_text()); Path("build/tests/apu_badp_mix_vectors_ts.d").write_text("build/tests/apu_badp_mix_vectors.cjs $(REPORTS)/apu-badp-mix-inputs.json: " + " ".join(d["inputs"]) + "\n")'
-include build/tests/apu_badp_mix_vectors_ts.d
build/tests/apu-badp-mix-vectors.txt: build/tests/apu_badp_mix_vectors.cjs
	$(NODE) $< > $@
build/tests/apu-badp-mix-mono8.txt: build/tests/apu_badp_mix_vectors.cjs
	$(NODE) $< --mono > $@
build/tests/apu-badp-mix-mono16.txt: build/tests/apu_badp_mix_vectors.cjs
	$(NODE) $< --mono --voices=16 > $@
$(APU_CPP_OBJECT_DIR)/badp_mix_vectors.o: tests/apu_badp_mix_vectors.cpp
	@mkdir -p $(@D)
	$(CXX) $(APU_CPP_FLAGS) -MMD -MP -MF $(@:.o=.d) -c $< -o $@
-include $(APU_CPP_OBJECT_DIR)/badp_mix_vectors.d
build/tests/apu_badp_mix_vectors_cpp: $(APU_CPP_OBJECT_DIR)/badp_mix_vectors.o $(filter-out $(APU_CPP_OBJECT_DIR)/probe.o,$(APU_CPP_OBJECTS))
	$(CXX) -Wl,--gc-sections $^ -o $@
build/tests/apu_badp_mix.vvp: rtl/apu_badp_step.sv rtl/apu_badp_decoder.sv rtl/apu_biquad.sv rtl/apu_mix_engine.sv rtl/apu_badp_mix.sv rtl/apu_pcm_frame.sv rtl/async_sram.sv rtl/apu_sample_store.sv tests/issi_bll_model.sv tests/apu_badp_mix_tb.sv
	@mkdir -p $(@D)
	$(IVERILOG) $(IVERILOG_FLAGS) -g2012 -Wall -s apu_badp_mix_tb -o $@ $^
$(REPORTS)/apu-badp-mix-cpp.txt: build/tests/apu_badp_mix_vectors_cpp build/tests/apu-badp-mix-vectors.txt build/tests/apu-badp-mix-mono8.txt build/tests/apu-badp-mix-mono16.txt
	@mkdir -p $(REPORTS)
	$< < build/tests/apu-badp-mix-vectors.txt > $@
	$< < build/tests/apu-badp-mix-mono8.txt >> $@
	$< < build/tests/apu-badp-mix-mono16.txt >> $@
$(REPORTS)/apu-badp-mix-rtl.txt: build/tests/apu_badp_mix.vvp build/tests/apu-badp-mix-vectors.txt build/tests/apu-badp-mix-mono8.txt build/tests/apu-badp-mix-mono16.txt build/tests/apu-pcm-frame-vectors.txt
	@mkdir -p $(REPORTS)
	$(VVP) $< +VECTORS=build/tests/apu-badp-mix-mono8.txt +VECTORS_EXTRA1=build/tests/apu-badp-mix-mono16.txt +VECTORS_EXTRA2=build/tests/apu-badp-mix-vectors.txt +VECTORS_PAN_L=build/tests/apu-badp-mix-mono8.txt +PCM_VECTORS=build/tests/apu-pcm-frame-vectors.txt > $@ || { cat $@; exit 1; }
$(REPORTS)/apu-badp-mix-synthesis.txt $(EXPORTS)/rtl/apu_badp_mix.json &: rtl/apu_badp_step.sv rtl/apu_badp_decoder.sv rtl/apu_biquad.sv rtl/apu_mix_engine.sv rtl/apu_badp_mix.sv rtl/apu_pcm_frame.sv
	@mkdir -p $(REPORTS) $(EXPORTS)/rtl
	$(YOSYS) -l $(REPORTS)/apu-badp-mix-synthesis.txt -p 'read_verilog -sv $^; hierarchy -check -top apu_badp_mix; proc; opt; check; stat; write_json $(EXPORTS)/rtl/apu_badp_mix.json' > /dev/null
.PHONY: check-apu-badp-mix
check-apu-badp-mix: $(REPORTS)/apu-badp-mix-cpp.txt $(REPORTS)/apu-badp-mix-rtl.txt $(REPORTS)/apu-badp-mix-synthesis.txt $(EXPORTS)/rtl/apu_badp_mix.json

build/tests/apu_badp_filter_vectors.cjs $(REPORTS)/apu-badp-filter-inputs.json &: tests/apu_badp_filter_vectors.ts
	@mkdir -p build/tests $(REPORTS)
	$(ESBUILD) $< --bundle --platform=node --format=cjs --packages=external --outfile=build/tests/apu_badp_filter_vectors.cjs --metafile=$(REPORTS)/apu-badp-filter-inputs.json
	$(PYTHON) -c 'import json; from pathlib import Path; d=json.loads(Path("$(REPORTS)/apu-badp-filter-inputs.json").read_text()); Path("build/tests/apu_badp_filter_vectors_ts.d").write_text("build/tests/apu_badp_filter_vectors.cjs $(REPORTS)/apu-badp-filter-inputs.json: " + " ".join(d["inputs"]) + "\n")'
-include build/tests/apu_badp_filter_vectors_ts.d
build/tests/apu-badp-filter-vectors.txt: build/tests/apu_badp_filter_vectors.cjs
	$(NODE) $< > $@
$(APU_CPP_OBJECT_DIR)/badp_filter_vectors.o: tests/apu_badp_filter_vectors.cpp
	@mkdir -p $(@D)
	$(CXX) $(APU_CPP_FLAGS) -MMD -MP -MF $(@:.o=.d) -c $< -o $@
-include $(APU_CPP_OBJECT_DIR)/badp_filter_vectors.d
build/tests/apu_badp_filter_vectors_cpp: $(APU_CPP_OBJECT_DIR)/badp_filter_vectors.o $(filter-out $(APU_CPP_OBJECT_DIR)/probe.o,$(APU_CPP_OBJECTS))
	$(CXX) -Wl,--gc-sections $^ -o $@
build/tests/apu_badp_filter.vvp: rtl/apu_badp_step.sv rtl/apu_badp_decoder.sv rtl/apu_biquad.sv rtl/apu_mix_engine.sv rtl/apu_badp_mix.sv rtl/apu_pcm_frame.sv tests/apu_badp_filter_tb.sv
	@mkdir -p $(@D)
	$(IVERILOG) $(IVERILOG_FLAGS) -g2012 -Wall -s apu_badp_filter_tb -o $@ $^
$(REPORTS)/apu-badp-filter-cpp.txt: build/tests/apu_badp_filter_vectors_cpp build/tests/apu-badp-filter-vectors.txt
	@mkdir -p $(REPORTS)
	$< < build/tests/apu-badp-filter-vectors.txt > $@
$(REPORTS)/apu-badp-filter-rtl.txt: build/tests/apu_badp_filter.vvp build/tests/apu-badp-filter-vectors.txt
	@mkdir -p $(REPORTS)
	$(VVP) $< > $@ || { cat $@; exit 1; }
.PHONY: check-apu-badp-filter
check-apu-badp-filter: $(REPORTS)/apu-badp-filter-cpp.txt $(REPORTS)/apu-badp-filter-rtl.txt $(REPORTS)/apu-badp-mix-synthesis.txt $(EXPORTS)/rtl/apu_badp_mix.json

build/tests/apu_mixed_memory.vvp: rtl/async_sram.sv rtl/apu_sample_store.sv tests/issi_bll_model.sv tests/apu_mixed_memory_tb.sv
	@mkdir -p $(@D)
	$(IVERILOG) $(IVERILOG_FLAGS) -g2012 -Wall -s apu_mixed_memory_tb -o $@ $^
$(REPORTS)/apu-mixed-memory.txt $(REPORTS)/apu-mixed-memory.json &: build/tests/apu_mixed_memory.vvp
	@mkdir -p $(REPORTS)
	$(VVP) $< +REPORT=$(REPORTS)/apu-mixed-memory.json > $(REPORTS)/apu-mixed-memory.txt || { cat $(REPORTS)/apu-mixed-memory.txt; exit 1; }
check-apu-memory: $(REPORTS)/apu-mixed-memory.txt $(REPORTS)/apu-mixed-memory.json

$(REPORTS)/apu-feasibility.json $(EXPORTS)/APU_workload_matrix.csv &: tools/apu_feasibility.py design/apu_workloads.json design/system_bus.json $(REPORTS)/apu-workloads-ts.json $(REPORTS)/apu-workloads-cpp.json $(REPORTS)/apu-mixed-memory.json $(REPORTS)/apu-rom-integration.txt $(REPORTS)/apu-upload-commit.json
	$(PYTHON) tools/apu_feasibility.py
check-apu: $(REPORTS)/apu-workloads-ts.json $(REPORTS)/apu-workloads-cpp.json check-apu-memory check-apu-eight check-apu-physical check-apu-mix check-apu-pan check-apu-command-ingress check-apu-command-sys check-apu-command-executor check-apu-frame-timeline check-apu-frame-snapshot-integration check-apu-timeline-memory-order check-apu-upload-multisnapshot check-apu-i2s check-apu-slot-bank check-apu-pcm check-apu-biquad check-apu-badp-coherence check-apu-badp-filter check-apu-badp-mix $(REPORTS)/apu-feasibility.json $(EXPORTS)/APU_workload_matrix.csv

# One producer owns fixture bytes for C++, source-demand counting and physical
# SRAM replay. No local copy of the BADP encoder/decoder exists in the bench.
build/tests/apu-eight-stereo-trace.txt: build/tests/apu_workloads.cjs
	@mkdir -p $(@D)
	$(NODE) $< --eight-stereo-input > $@
build/tests/apu_eight_stereo.vvp: rtl/async_sram.sv rtl/apu_sample_store.sv tests/issi_bll_model.sv tests/apu_eight_stereo_tb.sv
	@mkdir -p $(@D)
	$(IVERILOG) $(IVERILOG_FLAGS) -g2012 -Wall -s apu_eight_stereo_tb -o $@ $^
$(REPORTS)/apu-eight-stereo-memory.txt $(REPORTS)/apu-eight-stereo-memory.json &: build/tests/apu_eight_stereo.vvp build/tests/apu-eight-stereo-trace.txt
	@mkdir -p $(REPORTS)
	$(VVP) $< +TRACE=build/tests/apu-eight-stereo-trace.txt +REPORT=$(REPORTS)/apu-eight-stereo-memory.json > $(REPORTS)/apu-eight-stereo-memory.txt || { cat $(REPORTS)/apu-eight-stereo-memory.txt; exit 1; }
$(REPORTS)/apu-eight-stereo.json $(EXPORTS)/APU_eight_stereo.csv &: tools/apu_eight_stereo.py $(REPORTS)/apu-eight-stereo-memory.json $(REPORTS)/apu-workloads-ts.json $(REPORTS)/apu-workloads-cpp.json $(REPORTS)/apu-mixed-memory.json
	$(PYTHON) tools/apu_eight_stereo.py
check-apu-eight: $(REPORTS)/apu-eight-stereo-memory.txt $(REPORTS)/apu-eight-stereo.json $(EXPORTS)/APU_eight_stereo.csv

# Golden requests are emitted by the unchanged codec/mixer owners. The physical
# decoder, commit queue and pin controllers execute them; no demand-only peer.
build/tests/apu-badp-step-input.txt: build/tests/apu_workloads.cjs
	@mkdir -p $(@D)
	$(NODE) $< --badp-step-input > $@
build/tests/apu-badp-request-input.txt: build/tests/apu_workloads.cjs
	@mkdir -p $(@D)
	$(NODE) $< --badp-request-input > $@
build/tests/apu_badp_step.vvp: rtl/apu_badp_step.sv tests/apu_badp_step_tb.sv
	@mkdir -p $(@D)
	$(IVERILOG) $(IVERILOG_FLAGS) -g2012 -Wall -s apu_badp_step_tb -o $@ $^
$(REPORTS)/apu-badp-step.txt $(REPORTS)/apu-badp-step.json &: build/tests/apu_badp_step.vvp build/tests/apu-badp-step-input.txt
	@mkdir -p $(REPORTS)
	$(VVP) $< +REPORT=$(REPORTS)/apu-badp-step.json > $(REPORTS)/apu-badp-step.txt || { cat $(REPORTS)/apu-badp-step.txt; exit 1; }

APU_BADP_RTL = rtl/apu_badp_step.sv rtl/apu_badp_decoder.sv
APU_STORE_RTL = rtl/async_sram.sv rtl/apu_sample_store.sv
build/tests/apu_badp_decoder.vvp: $(APU_BADP_RTL) $(APU_STORE_RTL) tests/issi_bll_model.sv tests/apu_badp_decoder_tb.sv
	@mkdir -p $(@D)
	$(IVERILOG) $(IVERILOG_FLAGS) -g2012 -Wall -s apu_badp_decoder_tb -o $@ $^
$(REPORTS)/badp-decoder.txt $(REPORTS)/badp-decoder.json &: build/tests/apu_badp_decoder.vvp build/tests/apu-badp-request-input.txt
	@mkdir -p $(REPORTS)
	$(VVP) $< +REPORT=$(REPORTS)/badp-decoder.json > $(REPORTS)/badp-decoder.txt || { cat $(REPORTS)/badp-decoder.txt; exit 1; }
$(REPORTS)/badp-decoder-coincident.txt $(REPORTS)/badp-decoder-coincident.json &: build/tests/apu_badp_decoder.vvp build/tests/apu-badp-request-input.txt
	@mkdir -p $(REPORTS)
	$(VVP) $< +COINCIDENT=1 +REPORT=$(REPORTS)/badp-decoder-coincident.json > $(REPORTS)/badp-decoder-coincident.txt || { cat $(REPORTS)/badp-decoder-coincident.txt; exit 1; }

build/tests/apu_badp_vectors_obj/probe.o: tests/apu_badp_vectors.cpp
	@mkdir -p $(@D)
	$(CXX) $(APU_CPP_FLAGS) -MMD -MP -MF $(@:.o=.d) -c $< -o $@
build/tests/apu_badp_vectors: build/tests/apu_badp_vectors_obj/probe.o $(APU_CPP_OBJECT_DIR)/badp_decoder.o
	$(CXX) -Wl,--gc-sections $^ -o $@
-include build/tests/apu_badp_vectors_obj/probe.d
$(REPORTS)/apu-badp-vectors-cpp.json: build/tests/apu_badp_vectors build/tests/apu-badp-request-input.txt
	@mkdir -p $(@D)
	$< < build/tests/apu-badp-request-input.txt > $@

build/tests/apu_upload_commit.vvp: rtl/apu_upload_commit.sv $(APU_STORE_RTL) tests/issi_bll_model.sv tests/apu_upload_commit_tb.sv
	@mkdir -p $(@D)
	$(IVERILOG) $(IVERILOG_FLAGS) -g2012 -Wall -s apu_upload_commit_tb -o $@ $^
$(REPORTS)/apu-upload-commit.txt $(REPORTS)/apu-upload-commit.json &: build/tests/apu_upload_commit.vvp
	@mkdir -p $(REPORTS)
	$(VVP) $< +REPORT=$(REPORTS)/apu-upload-commit.json > $(REPORTS)/apu-upload-commit.txt || { cat $(REPORTS)/apu-upload-commit.txt; exit 1; }

$(REPORTS)/badp-decoder-upper-slots.txt $(REPORTS)/badp-decoder-upper-slots.json &: build/tests/apu_badp_decoder.vvp build/tests/apu-badp-request-input.txt
	@mkdir -p $(REPORTS)
	$(VVP) $< +SLOT_BASE=8 +REPORT=$(REPORTS)/badp-decoder-upper-slots.json > $(REPORTS)/badp-decoder-upper-slots.txt || { cat $(REPORTS)/badp-decoder-upper-slots.txt; exit 1; }

APU_SYNTHESIS_EXPORTS = $(EXPORTS)/rtl/apu_badp_step.json $(EXPORTS)/rtl/apu_badp_decoder.json $(EXPORTS)/rtl/apu_upload_commit.json $(EXPORTS)/rtl/apu_badp_step-techmap.json
$(REPORTS)/apu-synthesis.json $(APU_SYNTHESIS_EXPORTS) &: tools/apu_synthesis.py $(APU_BADP_RTL) rtl/apu_upload_commit.sv $(wildcard $(YOSYS))
	$(PYTHON) tools/apu_synthesis.py --yosys $(YOSYS)
check-apu-synthesis: $(REPORTS)/apu-synthesis.json $(APU_SYNTHESIS_EXPORTS)

build/tests/apu_badp_upload.vvp: $(APU_BADP_RTL) rtl/apu_upload_commit.sv $(APU_STORE_RTL) tests/issi_bll_model.sv tests/apu_badp_upload_tb.sv
	@mkdir -p $(@D)
	$(IVERILOG) $(IVERILOG_FLAGS) -g2012 -Wall -s apu_badp_upload_tb -o $@ $^
$(REPORTS)/apu-badp-upload.txt $(REPORTS)/apu-badp-upload.json &: build/tests/apu_badp_upload.vvp build/tests/apu-badp-request-input.txt
	@mkdir -p $(REPORTS)
	$(VVP) $< +REPORT=$(REPORTS)/apu-badp-upload.json > $(REPORTS)/apu-badp-upload.txt || { cat $(REPORTS)/apu-badp-upload.txt; exit 1; }

APU_PHYSICAL_REPORTS = apu-badp-step apu-badp-vectors-cpp badp-decoder badp-decoder-coincident badp-decoder-upper-slots apu-upload-commit apu-badp-upload apu-synthesis
$(REPORTS)/apu-physical.json $(EXPORTS)/APU_physical_decoder.csv $(EXPORTS)/APU_system_budget.csv &: tools/apu_physical.py $(addprefix $(REPORTS)/,$(addsuffix .json,$(APU_PHYSICAL_REPORTS)))
	$(PYTHON) tools/apu_physical.py
check-apu-physical: $(REPORTS)/apu-physical.json $(EXPORTS)/APU_physical_decoder.csv

# High-level service model and native drawing only; no RTL/CAD batch is implied.
.PHONY: apu-blueprint
$(EXPORTS)/figures/APU_execution_organization.svg: ../docs/book4/figures/apu-execution-organization.svg
	@mkdir -p $(@D)
	cp $< $@
$(EXPORTS)/figures/APU_execution_organization.png: $(EXPORTS)/figures/APU_execution_organization.svg
	rsvg-convert -w 1360 -o $@ $<
apu-blueprint: $(REPORTS)/apu-physical.json $(EXPORTS)/APU_system_budget.csv $(EXPORTS)/figures/APU_execution_organization.svg $(EXPORTS)/figures/APU_execution_organization.png

# Electrical assembly and supply inventory; no ASIC simulation or CAD rebuild.
.PHONY: board-integration
$(REPORTS)/interconnect.json $(EXPORTS)/BMSX_wiring_schedule.csv $(EXPORTS)/BMSX_harness_parts.csv $(EXPORTS)/BMSX_JST_pad_nominal_fit.csv $(EXPORTS)/BMSX_internal_harnesses.svg $(EXPORTS)/BMSX_internal_harnesses.png $(EXPORTS)/BMSX_DC_wire_routes.csv $(EXPORTS)/BMSX_SCART_factory_tails.csv &: tools/interconnect.py $(MAINBOARD).kicad_pcb $(FRONT).kicad_pcb $(KEYBOARD).kicad_pcb $(AV).kicad_pcb $(SCART).kicad_pcb ecad/scart/board.json models/scart/K-SCART-021.json design/enclosure_rear_io.json design/enclosure_front_io.json design/enclosure_controls.json models/front/manifest.json models/harness/parts.json models/rear/mating.json ../docs/book4/connectors.md
	$(KICAD_PYTHON) tools/interconnect.py
$(REPORTS)/power-budget.json $(EXPORTS)/Power_rail_capacitance.csv $(EXPORTS)/Power_load_envelope.csv $(EXPORTS)/Power_transient_sensitivity.csv $(EXPORTS)/Power_brownout_sensitivity.csv $(EXPORTS)/Power_protection_thresholds.csv &: tools/power_budget.py $(EXPORTS)/BMSX_netlist.xml $(EXPORTS)/BMSX_components.csv $(MAINBOARD).kicad_pcb
	$(PYTHON) tools/power_budget.py
board-integration: $(REPORTS)/interconnect.json $(EXPORTS)/BMSX_wiring_schedule.csv $(EXPORTS)/BMSX_harness_parts.csv $(EXPORTS)/BMSX_JST_pad_nominal_fit.csv $(EXPORTS)/BMSX_internal_harnesses.svg $(EXPORTS)/BMSX_internal_harnesses.png $(REPORTS)/power-budget.json $(EXPORTS)/Power_rail_capacitance.csv $(EXPORTS)/Power_load_envelope.csv $(EXPORTS)/Power_transient_sensitivity.csv $(EXPORTS)/Power_brownout_sensitivity.csv $(EXPORTS)/figures/scart-assembly-datums.svg $(EXPORTS)/figures/scart-assembly-datums.png
board-integration: $(EXPORTS)/BMSX_DC_wire_routes.csv $(EXPORTS)/BMSX_SCART_factory_tails.csv $(EXPORTS)/Power_protection_thresholds.csv $(EXPORTS)/figures/dc-harness-routing.svg $(EXPORTS)/figures/dc-harness-routing.png

$(EXPORTS)/figures/dc-harness-routing.svg: ../docs/book4/figures/dc-harness-routing.svg
	@mkdir -p $(@D)
	cp $< $@
$(EXPORTS)/figures/dc-harness-routing.png: $(EXPORTS)/figures/dc-harness-routing.svg
	rsvg-convert -o $@ $<

$(EXPORTS)/figures/scart-assembly-datums.svg: ../docs/book4/figures/scart-assembly-datums.svg
	@mkdir -p $(@D)
	cp $< $@
$(EXPORTS)/figures/scart-assembly-datums.png: $(EXPORTS)/figures/scart-assembly-datums.svg
	rsvg-convert -o $@ $<

# Decoded word execution with explicit frame/image numeric-read interface.
build/tests/cpu_word_execute_vectors.cjs $(REPORTS)/cpu-word-execute-inputs.json &: tests/cpu_word_execute_vectors.ts
	@mkdir -p build/tests $(REPORTS)
	$(ESBUILD) $< --bundle --platform=node --format=cjs --packages=external --outfile=build/tests/cpu_word_execute_vectors.cjs --metafile=$(REPORTS)/cpu-word-execute-inputs.json
	$(PYTHON) -c 'import json; from pathlib import Path; d=json.loads(Path("$(REPORTS)/cpu-word-execute-inputs.json").read_text()); Path("build/tests/cpu_word_execute_ts.d").write_text("build/tests/cpu_word_execute_vectors.cjs $(REPORTS)/cpu-word-execute-inputs.json: " + " ".join(d["inputs"]) + "\n")'
-include build/tests/cpu_word_execute_ts.d
build/tests/cpu-word-execute-vectors.txt: build/tests/cpu_word_execute_vectors.cjs
	$(NODE) $< > $@
build/tests/cpu_word_execute_cpp: tests/cpu_word_execute_vectors.cpp ../machine/cpp/spec/blua32/instruction_format.cpp ../machine/cpp/spec/blua32/opcode.cpp
	@mkdir -p $(@D)
	$(CXX) -std=c++20 -O2 -ffunction-sections -fdata-sections -I../machine/cpp -MM -MT $@ $(filter %.cpp,$^) > build/tests/cpu_word_execute_cpp.d
	$(CXX) -std=c++20 -O2 -ffunction-sections -fdata-sections -I../machine/cpp $(filter %.cpp,$^) -Wl,--gc-sections -o $@
-include build/tests/cpu_word_execute_cpp.d
build/tests/cpu_word_execute.vvp: rtl/cpu_instruction_decode.sv rtl/cpu_word_alu.sv rtl/cpu_word_execute.sv tests/cpu_word_execute_tb.sv
	@mkdir -p $(@D)
	$(IVERILOG) $(IVERILOG_FLAGS) -g2012 -Wall -s cpu_word_execute_tb -o $@ $^
$(REPORTS)/cpu-word-execute-cpp.txt: build/tests/cpu_word_execute_cpp build/tests/cpu-word-execute-vectors.txt
	@mkdir -p $(REPORTS)
	$< < build/tests/cpu-word-execute-vectors.txt > $@
$(REPORTS)/cpu-word-execute-rtl.txt: build/tests/cpu_word_execute.vvp build/tests/cpu-word-execute-vectors.txt
	@mkdir -p $(REPORTS)
	$(VVP) $< > $@ || { cat $@; exit 1; }
$(REPORTS)/cpu-word-execute-synthesis.txt $(EXPORTS)/rtl/cpu_word_execute.json &: rtl/cpu_word_alu.sv rtl/cpu_word_execute.sv
	@mkdir -p $(REPORTS) $(EXPORTS)/rtl
	$(YOSYS) -l $(REPORTS)/cpu-word-execute-synthesis.txt -p 'read_verilog -sv $^; hierarchy -check -top cpu_word_execute; proc; opt; check -assert; stat; write_json $(EXPORTS)/rtl/cpu_word_execute.json' > /dev/null
.PHONY: check-cpu-word-execute
check-cpu-word-execute: $(REPORTS)/cpu-word-execute-cpp.txt $(REPORTS)/cpu-word-execute-rtl.txt $(REPORTS)/cpu-word-execute-synthesis.txt $(EXPORTS)/rtl/cpu_word_execute.json
check-rtl: check-cpu-word-execute
build/tests/cpu_word_execute_readyloop.vvp: rtl/cpu_word_alu.sv rtl/cpu_word_execute.sv tests/cpu_word_execute_readyloop_tb.sv
	@mkdir -p $(@D)
	$(IVERILOG) $(IVERILOG_FLAGS) -g2012 -Wall -s cpu_word_execute_readyloop_tb -o $@ $^
$(REPORTS)/cpu-word-execute-readyloop.txt: build/tests/cpu_word_execute_readyloop.vvp
	@mkdir -p $(REPORTS)
	$(VVP) $< > $@ || { cat $@; exit 1; }
check-cpu-word-execute: $(REPORTS)/cpu-word-execute-readyloop.txt

build/tests/cpu_word_frame.vvp: rtl/cpu_instruction_decode.sv rtl/cpu_word_alu.sv rtl/cpu_word_execute.sv rtl/cpu_word_frame.sv tests/cpu_word_frame_tb.sv
	@mkdir -p $(@D)
	$(IVERILOG) $(IVERILOG_FLAGS) -g2012 -Wall -s cpu_word_frame_tb -o $@ $^
build/tests/cpu_word_frame_edges.vvp: rtl/cpu_word_alu.sv rtl/cpu_word_execute.sv rtl/cpu_word_frame.sv tests/cpu_word_frame_edges_tb.sv
	@mkdir -p $(@D)
	$(IVERILOG) $(IVERILOG_FLAGS) -g2012 -Wall -s cpu_word_frame_edges_tb -o $@ $^
$(REPORTS)/cpu-word-frame.txt: build/tests/cpu_word_frame.vvp build/tests/cpu-word-execute-vectors.txt
	@mkdir -p $(REPORTS)
	$(VVP) $< > $@ || { cat $@; exit 1; }
$(REPORTS)/cpu-word-frame-edges.txt: build/tests/cpu_word_frame_edges.vvp
	@mkdir -p $(REPORTS)
	$(VVP) $< > $@ || { cat $@; exit 1; }
$(REPORTS)/cpu-word-frame-synthesis.txt $(EXPORTS)/rtl/cpu_word_frame.json &: rtl/cpu_word_alu.sv rtl/cpu_word_execute.sv rtl/cpu_word_frame.sv
	@mkdir -p $(REPORTS) $(EXPORTS)/rtl
	$(YOSYS) -l $(REPORTS)/cpu-word-frame-synthesis.txt -p 'read_verilog -sv $^; hierarchy -check -top cpu_word_frame; proc; opt; check -assert; stat; write_json $(EXPORTS)/rtl/cpu_word_frame.json' > /dev/null
.PHONY: check-cpu-word-frame
check-cpu-word-frame: $(REPORTS)/cpu-word-frame.txt $(REPORTS)/cpu-word-frame-edges.txt $(REPORTS)/cpu-word-frame-synthesis.txt $(EXPORTS)/rtl/cpu_word_frame.json
check-rtl: check-cpu-word-frame

build/tests/cpu_word_frame_switch.vvp: rtl/cpu_word_alu.sv rtl/cpu_word_execute.sv rtl/cpu_word_frame.sv tests/cpu_word_frame_switch_tb.sv
	@mkdir -p $(@D)
	$(IVERILOG) $(IVERILOG_FLAGS) -g2012 -Wall -s cpu_word_frame_switch_tb -o $@ $^
$(REPORTS)/cpu-word-frame-switch.txt: build/tests/cpu_word_frame_switch.vvp
	@mkdir -p $(REPORTS)
	$(VVP) $< > $@ || { cat $@; exit 1; }
check-cpu-word-frame: $(REPORTS)/cpu-word-frame-switch.txt

build/tests/cpu_value_store.vvp: rtl/cpu_instruction_decode.sv rtl/cpu_word_alu.sv rtl/cpu_word_execute.sv rtl/cpu_word_frame.sv rtl/cpu_value_store.sv tests/cpu_value_store_tb.sv
	@mkdir -p $(@D)
	$(IVERILOG) $(IVERILOG_FLAGS) -g2012 -Wall -s cpu_value_store_tb -o $@ $^
build/tests/cpu_value_store_arbitration.vvp: rtl/cpu_value_store.sv tests/cpu_value_store_arbitration_tb.sv
	@mkdir -p $(@D)
	$(IVERILOG) $(IVERILOG_FLAGS) -g2012 -Wall -s cpu_value_store_arbitration_tb -o $@ $^
$(REPORTS)/cpu-value-store.txt: build/tests/cpu_value_store.vvp build/tests/cpu-word-execute-vectors.txt
	@mkdir -p $(REPORTS)
	$(VVP) $< > $@ || { cat $@; exit 1; }
$(REPORTS)/cpu-value-store-arbitration.txt: build/tests/cpu_value_store_arbitration.vvp
	@mkdir -p $(REPORTS)
	$(VVP) $< > $@ || { cat $@; exit 1; }
$(REPORTS)/cpu-value-store-synthesis.txt $(EXPORTS)/rtl/cpu_value_store.json &: rtl/cpu_value_store.sv
	@mkdir -p $(REPORTS) $(EXPORTS)/rtl
	$(YOSYS) -l $(REPORTS)/cpu-value-store-synthesis.txt -p 'read_verilog -sv $^; hierarchy -check -top cpu_value_store; proc; opt; check -assert; stat; write_json $(EXPORTS)/rtl/cpu_value_store.json' > /dev/null
.PHONY: check-cpu-value-store
check-cpu-value-store: $(REPORTS)/cpu-value-store.txt $(REPORTS)/cpu-value-store-arbitration.txt $(REPORTS)/cpu-value-store-synthesis.txt $(EXPORTS)/rtl/cpu_value_store.json
build/tests/cpu_value_store_reset.vvp: rtl/cpu_value_store.sv tests/cpu_value_store_reset_tb.sv
	@mkdir -p $(@D)
	$(IVERILOG) $(IVERILOG_FLAGS) -g2012 -Wall -s cpu_value_store_reset_tb -o $@ $^
$(REPORTS)/cpu-value-store-reset.txt: build/tests/cpu_value_store_reset.vvp
	@mkdir -p $(REPORTS)
	$(VVP) $< > $@ || { cat $@; exit 1; }
check-cpu-value-store: $(REPORTS)/cpu-value-store-reset.txt
build/tests/cpu_value_store_fairness.vvp: rtl/cpu_value_store.sv tests/cpu_value_store_fairness_tb.sv
	@mkdir -p $(@D)
	$(IVERILOG) $(IVERILOG_FLAGS) -g2012 -Wall -s cpu_value_store_fairness_tb -o $@ $^
$(REPORTS)/cpu-value-store-fairness.txt: build/tests/cpu_value_store_fairness.vvp
	@mkdir -p $(REPORTS)
	$(VVP) $< > $@ || { cat $@; exit 1; }
check-cpu-value-store: $(REPORTS)/cpu-value-store-fairness.txt
build/tests/cpu_value_store_rotor.vvp: rtl/cpu_value_store.sv tests/cpu_value_store_rotor_tb.sv
	@mkdir -p $(@D)
	$(IVERILOG) $(IVERILOG_FLAGS) -g2012 -Wall -s cpu_value_store_rotor_tb -o $@ $^
$(REPORTS)/cpu-value-store-rotor.txt: build/tests/cpu_value_store_rotor.vvp
	@mkdir -p $(REPORTS)
	$(VVP) $< > $@ || { cat $@; exit 1; }
check-cpu-value-store: $(REPORTS)/cpu-value-store-rotor.txt
check-rtl: check-cpu-value-store

build/tests/cpu_slot_word_store.vvp: rtl/cpu_value_store.sv rtl/cpu_slot_word_store.sv tests/cpu_slot_word_store_tb.sv
	@mkdir -p $(@D)
	$(IVERILOG) $(IVERILOG_FLAGS) -g2012 -Wall -s cpu_slot_word_store_tb -o $@ $^
build/tests/cpu_slot_core_dram.vvp: rtl/cpu_word_alu.sv rtl/cpu_word_execute.sv rtl/cpu_word_frame.sv rtl/cpu_value_store.sv rtl/cpu_slot_word_store.sv rtl/system_bus_master.sv rtl/main_dram.sv rtl/core_ram_scalar.sv rtl/core_memory_system.sv tests/is41lv16100_model.sv tests/cpu_slot_core_dram_tb.sv
	@mkdir -p $(@D)
	$(IVERILOG) $(IVERILOG_FLAGS) -g2012 -Wall -s cpu_slot_core_dram_tb -o $@ $^
$(REPORTS)/cpu-slot-word-store.txt: build/tests/cpu_slot_word_store.vvp
	@mkdir -p $(REPORTS)
	$(VVP) $< > $@ || { cat $@; exit 1; }
$(REPORTS)/cpu-slot-core-dram.txt: build/tests/cpu_slot_core_dram.vvp
	@mkdir -p $(REPORTS)
	$(VVP) $< > $@ || { cat $@; exit 1; }
$(REPORTS)/cpu-slot-word-store-synthesis.txt $(EXPORTS)/rtl/cpu_slot_word_store.json &: rtl/cpu_slot_word_store.sv
	@mkdir -p $(REPORTS) $(EXPORTS)/rtl
	$(YOSYS) -l $(REPORTS)/cpu-slot-word-store-synthesis.txt -p 'read_verilog -sv $^; hierarchy -check -top cpu_slot_word_store; proc; opt; check -assert; stat; write_json $(EXPORTS)/rtl/cpu_slot_word_store.json' > /dev/null
.PHONY: check-cpu-slot-word-store
check-cpu-slot-word-store: $(REPORTS)/cpu-slot-word-store.txt $(REPORTS)/cpu-slot-core-dram.txt $(REPORTS)/cpu-slot-word-store-synthesis.txt $(EXPORTS)/rtl/cpu_slot_word_store.json
check-rtl: check-cpu-slot-word-store

# System-domain programmed PCRTC words and rational beam timing.
build/tests/gfx_pcrtc_system_beam_vectors.cjs $(REPORTS)/gfx-pcrtc-system-beam-inputs.json &: tests/gfx_pcrtc_system_beam_vectors.ts
	@mkdir -p build/tests $(REPORTS)
	$(ESBUILD) $< --bundle --platform=node --format=cjs --packages=external --outfile=build/tests/gfx_pcrtc_system_beam_vectors.cjs --metafile=$(REPORTS)/gfx-pcrtc-system-beam-inputs.json
	$(PYTHON) -c 'import json; from pathlib import Path; d=json.loads(Path("$(REPORTS)/gfx-pcrtc-system-beam-inputs.json").read_text()); Path("build/tests/gfx_pcrtc_system_beam_ts.d").write_text("build/tests/gfx_pcrtc_system_beam_vectors.cjs $(REPORTS)/gfx-pcrtc-system-beam-inputs.json: " + " ".join(d["inputs"]) + "\n")'
-include build/tests/gfx_pcrtc_system_beam_ts.d
build/tests/gfx-pcrtc-system-beam-vectors.txt: build/tests/gfx_pcrtc_system_beam_vectors.cjs
	$(NODE) $< > $@
build/tests/gfx_pcrtc_system_beam_cpp: tests/gfx_pcrtc_system_beam_vectors.cpp ../machine/cpp/machine/devices/gx/gpu_pcrtc.cpp
	@mkdir -p $(@D)
	$(CXX) -std=c++20 -O2 -ffunction-sections -fdata-sections -I../machine/cpp -MM -MT $@ $(filter %.cpp,$^) > build/tests/gfx_pcrtc_system_beam_cpp.d
	$(CXX) -std=c++20 -O2 -ffunction-sections -fdata-sections -I../machine/cpp $(filter %.cpp,$^) -Wl,--gc-sections -o $@
-include build/tests/gfx_pcrtc_system_beam_cpp.d
build/tests/gfx_pcrtc_system_beam.vvp: rtl/gfx_pcrtc_beam_phase.sv rtl/gfx_pcrtc_system_beam.sv tests/gfx_pcrtc_system_beam_tb.sv
	@mkdir -p $(@D)
	$(IVERILOG) $(IVERILOG_FLAGS) -g2012 -Wall -s gfx_pcrtc_system_beam_tb -o $@ $^
$(REPORTS)/gfx-pcrtc-system-beam-cpp.txt: build/tests/gfx_pcrtc_system_beam_cpp build/tests/gfx-pcrtc-system-beam-vectors.txt
	@mkdir -p $(REPORTS)
	$< < build/tests/gfx-pcrtc-system-beam-vectors.txt > $@
$(REPORTS)/gfx-pcrtc-system-beam-rtl.txt: build/tests/gfx_pcrtc_system_beam.vvp build/tests/gfx-pcrtc-system-beam-vectors.txt
	@mkdir -p $(REPORTS)
	$(VVP) $< > $@ || { cat $@; exit 1; }
$(REPORTS)/gfx-pcrtc-system-beam-synthesis.txt $(EXPORTS)/rtl/gfx_pcrtc_system_beam.json &: rtl/gfx_pcrtc_beam_phase.sv rtl/gfx_pcrtc_system_beam.sv
	@mkdir -p $(REPORTS) $(EXPORTS)/rtl
	$(YOSYS) -l $(REPORTS)/gfx-pcrtc-system-beam-synthesis.txt -p 'read_verilog -sv $^; hierarchy -check -top gfx_pcrtc_system_beam; proc; opt; check -assert; stat; write_json $(EXPORTS)/rtl/gfx_pcrtc_system_beam.json' > /dev/null
.PHONY: check-gfx-pcrtc-system-beam
check-gfx-pcrtc-system-beam: $(REPORTS)/gfx-pcrtc-system-beam-cpp.txt $(REPORTS)/gfx-pcrtc-system-beam-rtl.txt $(REPORTS)/gfx-pcrtc-system-beam-synthesis.txt $(EXPORTS)/rtl/gfx_pcrtc_system_beam.json
build/tests/gfx_pcrtc_system_registers.vvp: rtl/gfx_pcrtc_beam_phase.sv rtl/gfx_pcrtc_system_beam.sv tests/gfx_pcrtc_system_registers_tb.sv
	@mkdir -p $(@D)
	$(IVERILOG) $(IVERILOG_FLAGS) -g2012 -Wall -s gfx_pcrtc_system_registers_tb -o $@ $^
$(REPORTS)/gfx-pcrtc-system-registers.txt: build/tests/gfx_pcrtc_system_registers.vvp
	@mkdir -p $(REPORTS)
	$(VVP) $< > $@ || { cat $@; exit 1; }
check-gfx-pcrtc-system-beam: $(REPORTS)/gfx-pcrtc-system-registers.txt
check-gfx: check-gfx-pcrtc-system-beam

# SYS transport for the PCRTC's two configuration-word ranges.
build/tests/gfx_pcrtc_sys_endpoint.vvp: rtl/system_bus_master.sv rtl/gfx_pcrtc_sys_endpoint.sv rtl/gfx_pcrtc_beam_phase.sv rtl/gfx_pcrtc_system_beam.sv rtl/gfx_pcrtc_status.sv rtl/display_context_gfx.sv rtl/gfx_pcrtc_control.sv tests/gfx_pcrtc_sys_endpoint_tb.sv
	@mkdir -p $(@D)
	$(IVERILOG) $(IVERILOG_FLAGS) -g2012 -Wall -s gfx_pcrtc_sys_endpoint_tb -o $@ $^
$(REPORTS)/gfx-pcrtc-sys-endpoint.txt: build/tests/gfx_pcrtc_sys_endpoint.vvp
	@mkdir -p $(REPORTS)
	$(VVP) $< > $@ || { cat $@; exit 1; }
$(REPORTS)/gfx-pcrtc-sys-endpoint-synthesis.txt $(EXPORTS)/rtl/gfx_pcrtc_sys_endpoint.json &: rtl/gfx_pcrtc_sys_endpoint.sv
	@mkdir -p $(REPORTS) $(EXPORTS)/rtl
	$(YOSYS) -l $(REPORTS)/gfx-pcrtc-sys-endpoint-synthesis.txt -p 'read_verilog -sv $^; hierarchy -check -top gfx_pcrtc_sys_endpoint; proc; opt; check -assert; stat; write_json $(EXPORTS)/rtl/gfx_pcrtc_sys_endpoint.json' > /dev/null
.PHONY: check-gfx-pcrtc-sys-endpoint
check-gfx-pcrtc-sys-endpoint: $(REPORTS)/gfx-pcrtc-sys-endpoint.txt $(REPORTS)/gfx-pcrtc-sys-endpoint-synthesis.txt $(EXPORTS)/rtl/gfx_pcrtc_sys_endpoint.json
build/tests/gfx_pcrtc_core_sys.vvp: rtl/system_bus_master.sv rtl/main_dram.sv rtl/core_ram_scalar.sv rtl/core_memory_system.sv rtl/gfx_pcrtc_sys_endpoint.sv rtl/gfx_pcrtc_beam_phase.sv rtl/gfx_pcrtc_system_beam.sv rtl/gfx_pcrtc_status.sv rtl/display_context_gfx.sv rtl/gfx_pcrtc_control.sv tests/gfx_pcrtc_core_sys_tb.sv
	@mkdir -p $(@D)
	$(IVERILOG) $(IVERILOG_FLAGS) -g2012 -Wall -s gfx_pcrtc_core_sys_tb -o $@ $^
$(REPORTS)/gfx-pcrtc-core-sys.txt: build/tests/gfx_pcrtc_core_sys.vvp
	@mkdir -p $(REPORTS)
	$(VVP) $< > $@ || { cat $@; exit 1; }
check-gfx-pcrtc-sys-endpoint: $(REPORTS)/gfx-pcrtc-core-sys.txt
check-gfx: check-gfx-pcrtc-sys-endpoint

# Pre- and post-write VBlank presentation snapshots.
build/tests/gfx_pcrtc_display_latch_vectors.cjs $(REPORTS)/gfx-pcrtc-display-latch-inputs.json &: tests/gfx_pcrtc_display_latch_vectors.ts
	@mkdir -p build/tests $(REPORTS)
	$(ESBUILD) $< --bundle --platform=node --format=cjs --packages=external --outfile=build/tests/gfx_pcrtc_display_latch_vectors.cjs --metafile=$(REPORTS)/gfx-pcrtc-display-latch-inputs.json
	$(PYTHON) -c 'import json; from pathlib import Path; d=json.loads(Path("$(REPORTS)/gfx-pcrtc-display-latch-inputs.json").read_text()); Path("build/tests/gfx_pcrtc_display_latch_ts.d").write_text("build/tests/gfx_pcrtc_display_latch_vectors.cjs $(REPORTS)/gfx-pcrtc-display-latch-inputs.json: " + " ".join(d["inputs"]) + "\n")'
-include build/tests/gfx_pcrtc_display_latch_ts.d
build/tests/gfx-pcrtc-display-latch-vectors.txt: build/tests/gfx_pcrtc_display_latch_vectors.cjs build/tests/gfx-pcrtc-system-beam-vectors.txt
	$(NODE) $< > $@
build/tests/gfx_pcrtc_display_latch_cpp: tests/gfx_pcrtc_display_latch_vectors.cpp ../machine/cpp/machine/devices/gx/gpu_pcrtc.cpp
	@mkdir -p $(@D)
	$(CXX) -std=c++20 -O2 -ffunction-sections -fdata-sections -I../machine/cpp -MM -MT $@ $(filter %.cpp,$^) > build/tests/gfx_pcrtc_display_latch_cpp.d
	$(CXX) -std=c++20 -O2 -ffunction-sections -fdata-sections -I../machine/cpp $(filter %.cpp,$^) -Wl,--gc-sections -o $@
-include build/tests/gfx_pcrtc_display_latch_cpp.d
build/tests/gfx_pcrtc_display_latch.vvp: rtl/gfx_pcrtc_beam_phase.sv rtl/gfx_pcrtc_system_beam.sv tests/gfx_pcrtc_display_latch_tb.sv
	@mkdir -p $(@D)
	$(IVERILOG) $(IVERILOG_FLAGS) -g2012 -Wall -s gfx_pcrtc_display_latch_tb -o $@ $^
$(REPORTS)/gfx-pcrtc-display-latch-cpp.txt: build/tests/gfx_pcrtc_display_latch_cpp build/tests/gfx-pcrtc-display-latch-vectors.txt
	@mkdir -p $(REPORTS)
	$< < build/tests/gfx-pcrtc-display-latch-vectors.txt > $@
$(REPORTS)/gfx-pcrtc-display-latch-rtl.txt: build/tests/gfx_pcrtc_display_latch.vvp build/tests/gfx-pcrtc-display-latch-vectors.txt
	@mkdir -p $(REPORTS)
	$(VVP) $< > $@ || { cat $@; exit 1; }
.PHONY: check-gfx-pcrtc-display-latch
check-gfx-pcrtc-display-latch: $(REPORTS)/gfx-pcrtc-display-latch-cpp.txt $(REPORTS)/gfx-pcrtc-display-latch-rtl.txt $(REPORTS)/gfx-pcrtc-system-beam-synthesis.txt $(EXPORTS)/rtl/gfx_pcrtc_system_beam.json
check-gfx: check-gfx-pcrtc-display-latch

build/tests/gfx_pcrtc_control_vectors.cjs $(REPORTS)/gfx-pcrtc-control-inputs.json &: tests/gfx_pcrtc_control_vectors.ts
	@mkdir -p build/tests $(REPORTS)
	$(ESBUILD) $< --bundle --platform=node --format=cjs --packages=external --outfile=build/tests/gfx_pcrtc_control_vectors.cjs --metafile=$(REPORTS)/gfx-pcrtc-control-inputs.json
	$(PYTHON) -c 'import json; from pathlib import Path; d=json.loads(Path("$(REPORTS)/gfx-pcrtc-control-inputs.json").read_text()); Path("build/tests/gfx_pcrtc_control_ts.d").write_text("build/tests/gfx_pcrtc_control_vectors.cjs $(REPORTS)/gfx-pcrtc-control-inputs.json: " + " ".join(d["inputs"]) + "\n")'
-include build/tests/gfx_pcrtc_control_ts.d
build/tests/gfx-pcrtc-control-vectors.txt: build/tests/gfx_pcrtc_control_vectors.cjs
	$(NODE) $< > $@
build/tests/gfx_pcrtc_control_cpp: tests/gfx_pcrtc_control_vectors.cpp ../machine/cpp/machine/devices/gx/gpu_pcrtc.cpp
	@mkdir -p $(@D)
	$(CXX) -std=c++20 -O2 -ffunction-sections -fdata-sections -I../machine/cpp -MM -MT $@ $(filter %.cpp,$^) > build/tests/gfx_pcrtc_control_cpp.d
	$(CXX) -std=c++20 -O2 -ffunction-sections -fdata-sections -I../machine/cpp $(filter %.cpp,$^) -Wl,--gc-sections -o $@
-include build/tests/gfx_pcrtc_control_cpp.d
build/tests/gfx_pcrtc_control.vvp: rtl/gfx_pcrtc_beam_phase.sv rtl/gfx_pcrtc_system_beam.sv rtl/gfx_pcrtc_status.sv rtl/display_context_gfx.sv rtl/gfx_pcrtc_control.sv tests/gfx_pcrtc_control_tb.sv
	@mkdir -p $(@D)
	$(IVERILOG) $(IVERILOG_FLAGS) -g2012 -Wall -s gfx_pcrtc_control_tb -o $@ $^
build/tests/gfx_pcrtc_status.vvp: rtl/gfx_pcrtc_status.sv tests/gfx_pcrtc_status_tb.sv
	@mkdir -p $(@D)
	$(IVERILOG) $(IVERILOG_FLAGS) -g2012 -Wall -s gfx_pcrtc_status_tb -o $@ $^
$(REPORTS)/gfx-pcrtc-control-cpp.txt: build/tests/gfx_pcrtc_control_cpp build/tests/gfx-pcrtc-control-vectors.txt
	@mkdir -p $(REPORTS)
	$< < build/tests/gfx-pcrtc-control-vectors.txt > $@
$(REPORTS)/gfx-pcrtc-control-rtl.txt: build/tests/gfx_pcrtc_control.vvp build/tests/gfx-pcrtc-control-vectors.txt
	@mkdir -p $(REPORTS)
	$(VVP) $< > $@ || { cat $@; exit 1; }
$(REPORTS)/gfx-pcrtc-status.txt: build/tests/gfx_pcrtc_status.vvp
	@mkdir -p $(REPORTS)
	$(VVP) $< > $@ || { cat $@; exit 1; }
$(REPORTS)/gfx-pcrtc-control-synthesis.txt $(EXPORTS)/rtl/gfx_pcrtc_control.json &: rtl/gfx_pcrtc_beam_phase.sv rtl/gfx_pcrtc_system_beam.sv rtl/gfx_pcrtc_status.sv rtl/display_context_gfx.sv rtl/gfx_pcrtc_control.sv
	@mkdir -p $(REPORTS) $(EXPORTS)/rtl
	$(YOSYS) -l $(REPORTS)/gfx-pcrtc-control-synthesis.txt -p 'read_verilog -sv $^; hierarchy -check -top gfx_pcrtc_control; proc; opt; check -assert; stat; write_json $(EXPORTS)/rtl/gfx_pcrtc_control.json' > /dev/null
.PHONY: check-gfx-pcrtc-control
check-gfx-pcrtc-control: $(REPORTS)/gfx-pcrtc-control-cpp.txt $(REPORTS)/gfx-pcrtc-control-rtl.txt $(REPORTS)/gfx-pcrtc-status.txt $(REPORTS)/gfx-pcrtc-control-synthesis.txt $(EXPORTS)/rtl/gfx_pcrtc_control.json
build/tests/gfx_pcrtc_irq_bank.vvp: rtl/gfx_pcrtc_beam_phase.sv rtl/gfx_pcrtc_system_beam.sv rtl/gfx_pcrtc_status.sv rtl/display_context_gfx.sv rtl/gfx_pcrtc_control.sv rtl/dma_block_transfer.sv rtl/dma_supervisor_context.sv rtl/dma_channel_controller.sv rtl/core_local_dma_irq.sv tests/gfx_pcrtc_irq_bank_tb.sv
	@mkdir -p $(@D)
	$(IVERILOG) $(IVERILOG_FLAGS) -g2012 -Wall -s gfx_pcrtc_irq_bank_tb -o $@ $^
$(REPORTS)/gfx-pcrtc-irq-bank.txt: build/tests/gfx_pcrtc_irq_bank.vvp
	@mkdir -p $(REPORTS)
	$(VVP) $< > $@ || { cat $@; exit 1; }
check-gfx-pcrtc-control: $(REPORTS)/gfx-pcrtc-irq-bank.txt
build/tests/gfx_pcrtc_reset_timing.vvp: rtl/gfx_pcrtc_beam_phase.sv rtl/gfx_pcrtc_system_beam.sv rtl/gfx_pcrtc_status.sv rtl/display_context_gfx.sv rtl/gfx_pcrtc_control.sv tests/gfx_pcrtc_reset_timing_tb.sv
	@mkdir -p $(@D)
	$(IVERILOG) $(IVERILOG_FLAGS) -g2012 -Wall -s gfx_pcrtc_reset_timing_tb -o $@ $^
$(REPORTS)/gfx-pcrtc-reset-timing.txt: build/tests/gfx_pcrtc_reset_timing.vvp
	@mkdir -p $(REPORTS)
	$(VVP) $< > $@ || { cat $@; exit 1; }
check-gfx-pcrtc-control: $(REPORTS)/gfx-pcrtc-reset-timing.txt
check-gfx: check-gfx-pcrtc-control

# Voice-rate resolution and frame cursor, compared with the real audio owners.
build/tests/apu_voice_cursor_vectors.cjs $(REPORTS)/apu-voice-cursor-inputs.json &: tests/apu_voice_cursor_vectors.ts
	@mkdir -p build/tests $(REPORTS)
	$(ESBUILD) $< --bundle --platform=node --format=cjs --packages=external --outfile=build/tests/apu_voice_cursor_vectors.cjs --metafile=$(REPORTS)/apu-voice-cursor-inputs.json
	$(PYTHON) -c 'import json; from pathlib import Path; d=json.loads(Path("$(REPORTS)/apu-voice-cursor-inputs.json").read_text()); Path("build/tests/apu_voice_cursor_ts.d").write_text("build/tests/apu_voice_cursor_vectors.cjs $(REPORTS)/apu-voice-cursor-inputs.json: " + " ".join(d["inputs"]) + "\n")'
-include build/tests/apu_voice_cursor_ts.d
build/tests/apu-voice-cursor-vectors.txt: build/tests/apu_voice_cursor_vectors.cjs
	$(NODE) $< > $@
$(APU_CPP_OBJECT_DIR)/voice_cursor_vectors.o: tests/apu_voice_cursor_vectors.cpp
	@mkdir -p $(@D)
	$(CXX) $(APU_CPP_FLAGS) -MMD -MP -MF $(@:.o=.d) -c $< -o $@
build/tests/apu_voice_cursor_vectors_cpp: $(APU_CPP_OBJECT_DIR)/voice_cursor_vectors.o $(APU_CPP_OBJECT_DIR)/save_state.o $(filter-out $(APU_CPP_OBJECT_DIR)/probe.o,$(APU_CPP_OBJECTS))
	$(CXX) -Wl,--gc-sections $^ -o $@
	cat $(patsubst %.o,%.d,$^) > build/tests/apu_voice_cursor_cpp.d
-include $(APU_CPP_OBJECT_DIR)/voice_cursor_vectors.d $(APU_CPP_OBJECT_DIR)/save_state.d
$(REPORTS)/apu-voice-cursor-cpp.txt: build/tests/apu_voice_cursor_vectors_cpp build/tests/apu-voice-cursor-vectors.txt
	@mkdir -p $(REPORTS)
	$< < build/tests/apu-voice-cursor-vectors.txt > $@
build/tests/apu_voice_rate.vvp: rtl/apu_voice_rate.sv tests/apu_voice_rate_tb.sv
	@mkdir -p $(@D)
	$(IVERILOG) $(IVERILOG_FLAGS) -g2012 -Wall -s apu_voice_rate_tb -o $@ $^
build/tests/apu_voice_cursor.vvp: rtl/apu_voice_cursor.sv tests/apu_voice_cursor_tb.sv
	@mkdir -p $(@D)
	$(IVERILOG) $(IVERILOG_FLAGS) -g2012 -Wall -s apu_voice_cursor_tb -o $@ $^
build/tests/apu_voice_cursor_mix.vvp: rtl/apu_frame_scheduler.sv rtl/apu_voice_cursor.sv rtl/apu_voice_rate.sv rtl/apu_badp_mix.sv rtl/apu_pcm_frame.sv rtl/apu_badp_decoder.sv rtl/apu_badp_step.sv rtl/apu_biquad.sv rtl/apu_mix_engine.sv tests/apu_voice_cursor_mix_tb.sv
	@mkdir -p $(@D)
	$(IVERILOG) $(IVERILOG_FLAGS) -g2012 -Wall -s apu_voice_cursor_mix_tb -o $@ $^
build/tests/apu_voice_cursor_capacity.vvp: rtl/apu_frame_scheduler.sv rtl/apu_voice_cursor.sv tests/apu_voice_cursor_capacity_tb.sv
	@mkdir -p $(@D)
	$(IVERILOG) $(IVERILOG_FLAGS) -g2012 -Wall -s apu_voice_cursor_capacity_tb -o $@ $^
$(REPORTS)/apu-voice-rate.txt: build/tests/apu_voice_rate.vvp build/tests/apu-voice-cursor-vectors.txt
	@mkdir -p $(REPORTS)
	$(VVP) $< > $@ || { cat $@; exit 1; }
$(REPORTS)/apu-voice-cursor.txt: build/tests/apu_voice_cursor.vvp build/tests/apu-voice-cursor-vectors.txt
	@mkdir -p $(REPORTS)
	$(VVP) $< > $@ || { cat $@; exit 1; }
$(REPORTS)/apu-voice-cursor-mix.txt: build/tests/apu_voice_cursor_mix.vvp build/tests/apu-badp-mix-vectors.txt $(REPORTS)/apu-badp-mix-cpp.txt
	@mkdir -p $(REPORTS)
	$(VVP) $< > $@ || { cat $@; exit 1; }
$(REPORTS)/apu-voice-cursor-capacity.txt: build/tests/apu_voice_cursor_capacity.vvp
	@mkdir -p $(REPORTS)
	$(VVP) $< > $@ || { cat $@; exit 1; }
$(REPORTS)/apu-voice-cursor-synthesis.txt $(EXPORTS)/rtl/apu_voice_cursor.json &: rtl/apu_voice_cursor.sv
	@mkdir -p $(REPORTS) $(EXPORTS)/rtl
	$(YOSYS) -l $(REPORTS)/apu-voice-cursor-synthesis.txt -p 'read_verilog -sv $^; hierarchy -check -top apu_voice_cursor; proc; opt; check -assert; stat; write_json $(EXPORTS)/rtl/apu_voice_cursor.json' > /dev/null
$(REPORTS)/apu-voice-rate-synthesis.txt $(EXPORTS)/rtl/apu_voice_rate.json &: rtl/apu_voice_rate.sv
	@mkdir -p $(REPORTS) $(EXPORTS)/rtl
	$(YOSYS) -l $(REPORTS)/apu-voice-rate-synthesis.txt -p 'read_verilog -sv $^; hierarchy -check -top apu_voice_rate; proc; opt; check -assert; stat; write_json $(EXPORTS)/rtl/apu_voice_rate.json' > /dev/null
.PHONY: check-apu-voice-cursor
check-apu-voice-cursor: $(REPORTS)/apu-voice-cursor-cpp.txt $(REPORTS)/apu-voice-rate.txt $(REPORTS)/apu-voice-cursor.txt $(REPORTS)/apu-voice-cursor-mix.txt $(REPORTS)/apu-voice-cursor-capacity.txt $(REPORTS)/apu-voice-cursor-synthesis.txt $(REPORTS)/apu-voice-rate-synthesis.txt $(EXPORTS)/rtl/apu_voice_cursor.json $(EXPORTS)/rtl/apu_voice_rate.json
check-apu: check-apu-voice-cursor

# Additional full-word rate edge cases against both runtime phase owners.
build/tests/apu_voice_rate_extremes.cjs $(REPORTS)/apu-voice-rate-extremes-inputs.json &: tests/apu_voice_rate_extremes.ts
	@mkdir -p build/tests $(REPORTS)
	$(ESBUILD) $< --bundle --platform=node --format=cjs --packages=external --outfile=build/tests/apu_voice_rate_extremes.cjs --metafile=$(REPORTS)/apu-voice-rate-extremes-inputs.json
	$(PYTHON) -c 'import json; from pathlib import Path; d=json.loads(Path("$(REPORTS)/apu-voice-rate-extremes-inputs.json").read_text()); Path("build/tests/apu_voice_rate_extremes_ts.d").write_text("build/tests/apu_voice_rate_extremes.cjs $(REPORTS)/apu-voice-rate-extremes-inputs.json: " + " ".join(d["inputs"]) + "\n")'
-include build/tests/apu_voice_rate_extremes_ts.d
build/tests/apu-voice-rate-extremes.txt: build/tests/apu_voice_rate_extremes.cjs
	$(NODE) $< > $@
build/tests/apu_voice_rate_extremes_cpp: tests/apu_voice_rate_extremes.cpp ../machine/cpp/machine/devices/audio/playback.cpp
	@mkdir -p $(@D)
	$(CXX) -std=c++20 -O2 -I../machine/cpp -MM -MT $@ $(filter %.cpp,$^) > build/tests/apu_voice_rate_extremes_cpp.d
	$(CXX) -std=c++20 -O2 -I../machine/cpp $(filter %.cpp,$^) -o $@
-include build/tests/apu_voice_rate_extremes_cpp.d
build/tests/apu_voice_rate_extremes.vvp: rtl/apu_voice_rate.sv tests/apu_voice_rate_extremes_tb.sv
	@mkdir -p $(@D)
	$(IVERILOG) $(IVERILOG_FLAGS) -g2012 -Wall -s apu_voice_rate_extremes_tb -o $@ $^
$(REPORTS)/apu-voice-rate-extremes-cpp.txt: build/tests/apu_voice_rate_extremes_cpp build/tests/apu-voice-rate-extremes.txt
	@mkdir -p $(REPORTS)
	$< < build/tests/apu-voice-rate-extremes.txt > $@
$(REPORTS)/apu-voice-rate-extremes-rtl.txt: build/tests/apu_voice_rate_extremes.vvp build/tests/apu-voice-rate-extremes.txt
	@mkdir -p $(REPORTS)
	$(VVP) $< > $@ || { cat $@; exit 1; }
.PHONY: check-apu-voice-rate-extremes
check-apu-voice-rate-extremes: $(REPORTS)/apu-voice-rate-extremes-cpp.txt $(REPORTS)/apu-voice-rate-extremes-rtl.txt
check-apu-voice-cursor: check-apu-voice-rate-extremes

build/tests/apu_voice_cursor_extremes.cjs $(REPORTS)/apu-voice-cursor-extremes-inputs.json &: tests/apu_voice_cursor_extremes.ts
	@mkdir -p build/tests $(REPORTS)
	$(ESBUILD) $< --bundle --platform=node --format=cjs --packages=external --outfile=build/tests/apu_voice_cursor_extremes.cjs --metafile=$(REPORTS)/apu-voice-cursor-extremes-inputs.json
	$(PYTHON) -c 'import json; from pathlib import Path; d=json.loads(Path("$(REPORTS)/apu-voice-cursor-extremes-inputs.json").read_text()); Path("build/tests/apu_voice_cursor_extremes_ts.d").write_text("build/tests/apu_voice_cursor_extremes.cjs $(REPORTS)/apu-voice-cursor-extremes-inputs.json: " + " ".join(d["inputs"]) + "\n")'
-include build/tests/apu_voice_cursor_extremes_ts.d
build/tests/apu-voice-cursor-extremes.txt: build/tests/apu_voice_cursor_extremes.cjs
	$(NODE) $< > $@
$(REPORTS)/apu-voice-cursor-extremes-cpp.txt: build/tests/apu_voice_cursor_vectors_cpp build/tests/apu-voice-cursor-extremes.txt
	@mkdir -p $(REPORTS)
	$< < build/tests/apu-voice-cursor-extremes.txt > $@
$(REPORTS)/apu-voice-cursor-extremes-rtl.txt: build/tests/apu_voice_cursor.vvp build/tests/apu-voice-cursor-extremes.txt
	@mkdir -p $(REPORTS)
	$(VVP) $< +VECTORS=build/tests/apu-voice-cursor-extremes.txt > $@ || { cat $@; exit 1; }
.PHONY: check-apu-voice-cursor-extremes
check-apu-voice-cursor-extremes: $(REPORTS)/apu-voice-cursor-extremes-cpp.txt $(REPORTS)/apu-voice-cursor-extremes-rtl.txt

build/tests/apu_voice_cursor_lanes_vectors.vvp: rtl/apu_voice_cursor.sv rtl/apu_voice_cursor_lanes.sv tests/apu_voice_cursor_lanes_vectors_tb.sv
	@mkdir -p $(@D)
	$(IVERILOG) $(IVERILOG_FLAGS) -g2012 -Wall -s apu_voice_cursor_lanes_vectors_tb -o $@ $^
build/tests/apu_voice_cursor_lanes_order.vvp: rtl/apu_voice_cursor.sv rtl/apu_voice_cursor_lanes.sv tests/apu_voice_cursor_lanes_order_tb.sv
	@mkdir -p $(@D)
	$(IVERILOG) $(IVERILOG_FLAGS) -g2012 -Wall -s apu_voice_cursor_lanes_order_tb -o $@ $^
build/tests/apu_voice_cursor_lanes_capacity.vvp: rtl/apu_frame_scheduler.sv rtl/apu_voice_cursor.sv rtl/apu_voice_cursor_lanes.sv tests/apu_voice_cursor_lanes_capacity_tb.sv
	@mkdir -p $(@D)
	$(IVERILOG) $(IVERILOG_FLAGS) -g2012 -Wall -s apu_voice_cursor_lanes_capacity_tb -o $@ $^
$(REPORTS)/apu-voice-cursor-lanes-vectors.txt: build/tests/apu_voice_cursor_lanes_vectors.vvp build/tests/apu-voice-cursor-extremes.txt $(REPORTS)/apu-voice-cursor-extremes-cpp.txt
	@mkdir -p $(REPORTS)
	$(VVP) $< +VECTORS=build/tests/apu-voice-cursor-extremes.txt > $@ || { cat $@; exit 1; }
$(REPORTS)/apu-voice-cursor-lanes-order.txt: build/tests/apu_voice_cursor_lanes_order.vvp
	@mkdir -p $(REPORTS)
	$(VVP) $< > $@ || { cat $@; exit 1; }
$(REPORTS)/apu-voice-cursor-lanes-capacity.txt: build/tests/apu_voice_cursor_lanes_capacity.vvp
	@mkdir -p $(REPORTS)
	$(VVP) $< > $@ || { cat $@; exit 1; }
$(REPORTS)/apu-voice-cursor-lanes-synthesis.txt $(EXPORTS)/rtl/apu_voice_cursor_lanes.json &: rtl/apu_voice_cursor.sv rtl/apu_voice_cursor_lanes.sv
	@mkdir -p $(REPORTS) $(EXPORTS)/rtl
	$(YOSYS) -l $(REPORTS)/apu-voice-cursor-lanes-synthesis.txt -p 'read_verilog -sv $^; hierarchy -check -top apu_voice_cursor_lanes; proc; opt; check -assert; stat; write_json $(EXPORTS)/rtl/apu_voice_cursor_lanes.json' > /dev/null
.PHONY: check-apu-voice-cursor-lanes
check-apu-voice-cursor-lanes: $(REPORTS)/apu-voice-cursor-lanes-vectors.txt $(REPORTS)/apu-voice-cursor-lanes-order.txt $(REPORTS)/apu-voice-cursor-lanes-capacity.txt $(REPORTS)/apu-voice-cursor-lanes-synthesis.txt $(EXPORTS)/rtl/apu_voice_cursor_lanes.json
build/tests/apu_voice_cursor_lanes_boundary.vvp: rtl/apu_voice_cursor.sv rtl/apu_voice_cursor_lanes.sv tests/apu_voice_cursor_lanes_boundary_tb.sv
	@mkdir -p $(@D)
	$(IVERILOG) $(IVERILOG_FLAGS) -g2012 -Wall -s apu_voice_cursor_lanes_boundary_tb -o $@ $^
$(REPORTS)/apu-voice-cursor-lanes-boundary.txt: build/tests/apu_voice_cursor_lanes_boundary.vvp
	@mkdir -p $(REPORTS)
	$(VVP) $< > $@ || { cat $@; exit 1; }
check-apu-voice-cursor-lanes: $(REPORTS)/apu-voice-cursor-lanes-boundary.txt
check-apu: check-apu-voice-cursor-lanes

# Real PCM8/PCM16 and BADP voices share one filter and mixer owner.
build/tests/apu_mixed_voice_vectors.cjs $(REPORTS)/apu-mixed-voice-inputs.json &: tests/apu_mixed_voice_vectors.ts
	@mkdir -p build/tests $(REPORTS)
	$(ESBUILD) $< --bundle --platform=node --format=cjs --packages=external --outfile=build/tests/apu_mixed_voice_vectors.cjs --metafile=$(REPORTS)/apu-mixed-voice-inputs.json
	$(PYTHON) -c 'import json; from pathlib import Path; d=json.loads(Path("$(REPORTS)/apu-mixed-voice-inputs.json").read_text()); Path("build/tests/apu_mixed_voice_ts.d").write_text("build/tests/apu_mixed_voice_vectors.cjs $(REPORTS)/apu-mixed-voice-inputs.json: " + " ".join(d["inputs"]) + "\n")'
-include build/tests/apu_mixed_voice_ts.d
build/tests/apu_mixed_snapshot_vectors.cjs $(REPORTS)/apu-mixed-snapshot-inputs.json &: tests/apu_mixed_snapshot_vectors.ts
	@mkdir -p build/tests $(REPORTS)
	$(ESBUILD) $< --bundle --platform=node --format=cjs --packages=external --outfile=build/tests/apu_mixed_snapshot_vectors.cjs --metafile=$(REPORTS)/apu-mixed-snapshot-inputs.json
	$(PYTHON) -c 'import json; from pathlib import Path; d=json.loads(Path("$(REPORTS)/apu-mixed-snapshot-inputs.json").read_text()); Path("build/tests/apu_mixed_snapshot_ts.d").write_text("build/tests/apu_mixed_snapshot_vectors.cjs $(REPORTS)/apu-mixed-snapshot-inputs.json: " + " ".join(d["inputs"]) + "\n")'
-include build/tests/apu_mixed_snapshot_ts.d
build/tests/apu-mixed-voice-vectors.txt: build/tests/apu_mixed_voice_vectors.cjs
	$(NODE) $< > $@
build/tests/apu-mixed-snapshot-vectors.txt: build/tests/apu_mixed_snapshot_vectors.cjs
	$(NODE) $< > $@
$(APU_CPP_OBJECT_DIR)/mixed_voice_vectors.o: tests/apu_mixed_voice_vectors.cpp
	@mkdir -p $(@D)
	$(CXX) $(APU_CPP_FLAGS) -MMD -MP -MF $(@:.o=.d) -c $< -o $@
$(APU_CPP_OBJECT_DIR)/mixed_snapshot_vectors.o: tests/apu_mixed_snapshot_vectors.cpp
	@mkdir -p $(@D)
	$(CXX) $(APU_CPP_FLAGS) -MMD -MP -MF $(@:.o=.d) -c $< -o $@
build/tests/apu_mixed_voice_cpp: $(APU_CPP_OBJECT_DIR)/mixed_voice_vectors.o $(filter-out $(APU_CPP_OBJECT_DIR)/probe.o,$(APU_CPP_OBJECTS))
	$(CXX) -Wl,--gc-sections $^ -o $@
	cat $(patsubst %.o,%.d,$^) > build/tests/apu_mixed_voice_cpp.d
build/tests/apu_mixed_snapshot_cpp: $(APU_CPP_OBJECT_DIR)/mixed_snapshot_vectors.o $(filter-out $(APU_CPP_OBJECT_DIR)/probe.o,$(APU_CPP_OBJECTS))
	$(CXX) -Wl,--gc-sections $^ -o $@
	cat $(patsubst %.o,%.d,$^) > build/tests/apu_mixed_snapshot_cpp.d
-include $(APU_CPP_OBJECT_DIR)/mixed_voice_vectors.d $(APU_CPP_OBJECT_DIR)/mixed_snapshot_vectors.d
MIXED_VOICE_RTL = rtl/apu_frame_scheduler.sv rtl/apu_voice_cursor.sv rtl/apu_voice_cursor_lanes.sv rtl/apu_voice_rate.sv rtl/apu_badp_mix.sv rtl/apu_badp_decoder.sv rtl/apu_badp_step.sv rtl/apu_pcm_frame.sv rtl/apu_biquad.sv rtl/apu_mix_engine.sv
build/tests/apu_mixed_voice.vvp: $(MIXED_VOICE_RTL) tests/apu_mixed_voice_tb.sv
	@mkdir -p $(@D)
	$(IVERILOG) $(IVERILOG_FLAGS) -g2012 -Wall -s apu_mixed_voice_tb -o $@ $^
build/tests/apu_mixed_voice_lanes.vvp: $(MIXED_VOICE_RTL) tests/apu_mixed_voice_tb.sv
	@mkdir -p $(@D)
	$(IVERILOG) $(IVERILOG_FLAGS) -g2012 -Wall -DAPU_FOUR_LANES -s apu_mixed_voice_tb -o $@ $^
build/tests/apu_mixed_snapshot.vvp: $(MIXED_VOICE_RTL) rtl/apu_upload_commit.sv tests/apu_mixed_snapshot_tb.sv
	@mkdir -p $(@D)
	$(IVERILOG) $(IVERILOG_FLAGS) -g2012 -Wall -s apu_mixed_snapshot_tb -o $@ $^
build/tests/apu_mixed_snapshot_pins.vvp: $(MIXED_VOICE_RTL) rtl/apu_source_word_router.sv rtl/apu_upload_commit.sv rtl/apu_sample_store.sv rtl/async_sram.sv tests/issi_bll_model.sv tests/apu_mixed_snapshot_pins_tb.sv
	@mkdir -p $(@D)
	$(IVERILOG) $(IVERILOG_FLAGS) -g2012 -Wall -s apu_mixed_snapshot_pins_tb -o $@ $^
build/tests/apu_pcm_frame_immediate.vvp: rtl/apu_pcm_frame.sv tests/apu_pcm_frame_immediate_tb.sv
	@mkdir -p $(@D)
	$(IVERILOG) $(IVERILOG_FLAGS) -g2012 -Wall -s apu_pcm_frame_immediate_tb -o $@ $^
$(REPORTS)/apu-mixed-voice-cpp.txt: build/tests/apu_mixed_voice_cpp build/tests/apu-mixed-voice-vectors.txt
	@mkdir -p $(REPORTS)
	$< < build/tests/apu-mixed-voice-vectors.txt > $@
$(REPORTS)/apu-mixed-snapshot-cpp.txt: build/tests/apu_mixed_snapshot_cpp build/tests/apu-mixed-snapshot-vectors.txt
	@mkdir -p $(REPORTS)
	$< < build/tests/apu-mixed-snapshot-vectors.txt > $@
$(REPORTS)/apu-mixed-voice-rtl.txt: build/tests/apu_mixed_voice.vvp build/tests/apu-mixed-voice-vectors.txt
	@mkdir -p $(REPORTS)
	$(VVP) $< > $@ || { cat $@; exit 1; }
$(REPORTS)/apu-mixed-voice-lanes.txt: build/tests/apu_mixed_voice_lanes.vvp build/tests/apu-mixed-voice-vectors.txt
	@mkdir -p $(REPORTS)
	$(VVP) $< > $@ || { cat $@; exit 1; }
$(REPORTS)/apu-mixed-snapshot-rtl.txt: build/tests/apu_mixed_snapshot.vvp build/tests/apu-mixed-snapshot-vectors.txt
	@mkdir -p $(REPORTS)
	$(VVP) $< > $@ || { cat $@; exit 1; }
$(REPORTS)/apu-mixed-snapshot-pins.txt: build/tests/apu_mixed_snapshot_pins.vvp build/tests/apu-mixed-snapshot-vectors.txt
	@mkdir -p $(REPORTS)
	$(VVP) $< > $@ || { cat $@; exit 1; }
$(REPORTS)/apu-pcm-frame-immediate.txt: build/tests/apu_pcm_frame_immediate.vvp
	@mkdir -p $(REPORTS)
	$(VVP) $< > $@ || { cat $@; exit 1; }
.PHONY: check-apu-mixed-voice
check-apu-mixed-voice: $(REPORTS)/apu-mixed-voice-cpp.txt $(REPORTS)/apu-mixed-snapshot-cpp.txt $(REPORTS)/apu-mixed-voice-rtl.txt $(REPORTS)/apu-mixed-voice-lanes.txt $(REPORTS)/apu-mixed-snapshot-rtl.txt $(REPORTS)/apu-mixed-snapshot-pins.txt $(REPORTS)/apu-pcm-frame-immediate.txt
check-apu: check-apu-mixed-voice

# Horizontal phase mapping only: CDC, vertical timing and synthesis remain separate.
build/tests/gfx_pcrtc_sample_x.vvp: rtl/gfx_pcrtc_beam_phase.sv rtl/gfx_pcrtc_sample_x.sv tests/gfx_pcrtc_sample_x_tb.sv
	@mkdir -p $(@D)
	$(IVERILOG) $(IVERILOG_FLAGS) -g2012 -Wall -s gfx_pcrtc_sample_x_tb -o $@ $^
$(REPORTS)/gfx-pcrtc-sample-x.txt: build/tests/gfx_pcrtc_sample_x.vvp
	@mkdir -p $(REPORTS)
	$(VVP) $< > $@ || { cat $@; exit 1; }
.PHONY: check-gfx-pcrtc-sample-x
check-gfx-pcrtc-sample-x: $(REPORTS)/gfx-pcrtc-sample-x.txt

# A candidate video-clock epoch only; the system-to-video CDC and FIELD
# crossing are separate obligations, not part of this directed test.
GFX_DISPLAY_EPOCH_RTL = rtl/gfx_pcrtc_beam_phase.sv rtl/gfx_pcrtc_sample_x.sv rtl/gfx_pcrtc_display_epoch.sv
build/tests/gfx_pcrtc_display_epoch.vvp: $(GFX_DISPLAY_EPOCH_RTL) tests/gfx_pcrtc_display_epoch_tb.sv
	@mkdir -p $(@D)
	$(IVERILOG) $(IVERILOG_FLAGS) -g2012 -Wall -s gfx_pcrtc_display_epoch_tb -o $@ $^
$(REPORTS)/gfx-pcrtc-display-epoch.txt: build/tests/gfx_pcrtc_display_epoch.vvp
	@mkdir -p $(REPORTS)
	$(VVP) $< > $@ || { cat $@; exit 1; }
.PHONY: check-gfx-pcrtc-display-epoch
check-gfx-pcrtc-display-epoch: $(REPORTS)/gfx-pcrtc-display-epoch.txt

# System control's atomic latch transaction, reset marker and candidate
# 4-entry CDC feeding the physical epoch. The directed test assumes that FIFO
# write-reset release precedes source bootstrap, traffic is separated by four
# SYS clocks and the video sink runs. A source pulse while full or in write
# reset is lost; these tests do not establish those assumptions for the top.
build/tests/gfx_pcrtc_display_epoch_integration.vvp: rtl/display_context_gfx.sv rtl/gfx_pcrtc_control.sv rtl/gfx_pcrtc_status.sv rtl/gfx_pcrtc_system_beam.sv $(GFX_DISPLAY_EPOCH_RTL) rtl/async_fifo.sv tests/gfx_pcrtc_display_epoch_integration_tb.sv
	@mkdir -p $(@D)
	$(IVERILOG) $(IVERILOG_FLAGS) -g2012 -Wall -s gfx_pcrtc_display_epoch_integration_tb -o $@ $^
$(REPORTS)/gfx-pcrtc-display-epoch-integration.txt: build/tests/gfx_pcrtc_display_epoch_integration.vvp
	@mkdir -p $(REPORTS)
	@for phase in 0 3 7 11 17 23 29 37 43 53 67; do $(VVP) $< +phase=$$phase || exit 1; done > $@ || { cat $@; exit 1; }
check-gfx-pcrtc-display-epoch: $(REPORTS)/gfx-pcrtc-display-epoch-integration.txt

# Actual system-bus master through PCRTC and the display FIFO. This models a
# three-SYS-clock local reset release, not a fitted ASIC reset owner. The STOP
# experiment deliberately detects the existing loss when VIDEO is stopped; it
# is not a successful fault-recovery or physical CDC-qualification test.
build/tests/gfx_pcrtc_real_bus_cdc.vvp: rtl/system_bus_master.sv rtl/gfx_pcrtc_sys_endpoint.sv rtl/display_context_gfx.sv rtl/gfx_pcrtc_control.sv rtl/gfx_pcrtc_status.sv rtl/gfx_pcrtc_system_beam.sv $(GFX_DISPLAY_EPOCH_RTL) rtl/async_fifo.sv tests/gfx_pcrtc_real_bus_cdc_tb.sv
	@mkdir -p $(@D)
	$(IVERILOG) $(IVERILOG_FLAGS) -g2012 -Wall -s gfx_pcrtc_real_bus_cdc_tb -o $@ $^
$(REPORTS)/gfx-pcrtc-real-bus-cdc.txt: build/tests/gfx_pcrtc_real_bus_cdc.vvp
	@mkdir -p $(REPORTS)
	@for corner in '14762 37039' '14764 37035'; do set -- $$corner; for phase in 0 1173 5000 11111 17777 25000 37000 43000 52000 63000 73000; do $(VVP) $< +SYS_HALF=$$1 +VIDEO_HALF=$$2 +PHASE=$$phase || exit 1; done; done > $@ || { cat $@; exit 1; }
	@$(VVP) $< +STOP=1 >> $@ || { cat $@; exit 1; }
.PHONY: check-gfx-pcrtc-real-bus-cdc
check-gfx-pcrtc-real-bus-cdc: $(REPORTS)/gfx-pcrtc-real-bus-cdc.txt

# Physical source/FIFO bootstrap and video-domain reset release. This does
# not make the unbackpressured source lossless when VIDEO stops or FIFO fills.
GFX_PCRTC_CDC_STARTUP_RTL = rtl/gfx_pcrtc_cdc_startup.sv rtl/display_context_gfx.sv rtl/gfx_pcrtc_control.sv rtl/gfx_pcrtc_status.sv rtl/gfx_pcrtc_system_beam.sv $(GFX_DISPLAY_EPOCH_RTL) rtl/async_fifo.sv
build/tests/gfx_pcrtc_cdc_startup.vvp: rtl/system_bus_master.sv rtl/gfx_pcrtc_sys_endpoint.sv $(GFX_PCRTC_CDC_STARTUP_RTL) tests/gfx_pcrtc_cdc_startup_tb.sv
	@mkdir -p $(@D)
	$(IVERILOG) $(IVERILOG_FLAGS) -g2012 -Wall -s gfx_pcrtc_cdc_startup_tb -o $@ $^
build/tests/gfx_pcrtc_cdc_early.vvp: $(GFX_PCRTC_CDC_STARTUP_RTL) tests/gfx_pcrtc_cdc_early_tb.sv
	@mkdir -p $(@D)
	$(IVERILOG) $(IVERILOG_FLAGS) -g2012 -Wall -s gfx_pcrtc_cdc_early_tb -o $@ $^
$(REPORTS)/gfx-pcrtc-cdc-startup.txt: build/tests/gfx_pcrtc_cdc_startup.vvp build/tests/gfx_pcrtc_cdc_early.vvp
	@mkdir -p $(REPORTS)
	@$(VVP) build/tests/gfx_pcrtc_cdc_early.vvp > $@ || { cat $@; exit 1; }
	@for phase in 0 17777 37000; do $(VVP) build/tests/gfx_pcrtc_cdc_startup.vvp +PHASE=$$phase || exit 1; done >> $@ || { cat $@; exit 1; }
	@for phase in 0 17777 37000; do $(VVP) build/tests/gfx_pcrtc_cdc_startup.vvp +FAST_ENDPOINT=1 +PHASE=$$phase || exit 1; done >> $@ || { cat $@; exit 1; }
	@$(VVP) build/tests/gfx_pcrtc_cdc_startup.vvp +FAST_ENDPOINT=1 +SYS_HALF=14762 +VIDEO_HALF=37039 +PHASE=17777 >> $@ || { cat $@; exit 1; }
	@$(VVP) build/tests/gfx_pcrtc_cdc_startup.vvp +STOP=1 >> $@ || { cat $@; exit 1; }
.PHONY: check-gfx-pcrtc-cdc-startup
check-gfx-pcrtc-cdc-startup: $(REPORTS)/gfx-pcrtc-cdc-startup.txt

build/tests/apu_source_word_router.vvp: rtl/apu_source_word_router.sv tests/apu_source_word_router_tb.sv
	@mkdir -p $(@D)
	$(IVERILOG) $(IVERILOG_FLAGS) -g2012 -Wall -s apu_source_word_router_tb -o $@ $^
$(REPORTS)/apu-source-word-router.txt: build/tests/apu_source_word_router.vvp
	@mkdir -p $(REPORTS)
	$(VVP) $< > $@ || { cat $@; exit 1; }
$(REPORTS)/apu-source-word-router-synthesis.txt $(EXPORTS)/rtl/apu_source_word_router.json &: rtl/apu_source_word_router.sv
	@mkdir -p $(REPORTS) $(EXPORTS)/rtl
	$(YOSYS) -l $(REPORTS)/apu-source-word-router-synthesis.txt -p 'read_verilog -sv $^; hierarchy -check -top apu_source_word_router; proc; opt; check -assert; stat; write_json $(EXPORTS)/rtl/apu_source_word_router.json' > /dev/null
.PHONY: check-apu-source-word-router
check-apu-source-word-router: $(REPORTS)/apu-source-word-router.txt $(REPORTS)/apu-source-word-router-synthesis.txt $(EXPORTS)/rtl/apu_source_word_router.json $(REPORTS)/apu-rom-integration.txt $(REPORTS)/apu-mixed-snapshot-pins.txt
check-apu: check-apu-source-word-router

build/tests/apu_live_source_update.vvp: rtl/apu_slot_bank.sv rtl/apu_live_source_update.sv rtl/apu_source_word_router.sv tests/apu_live_source_update_tb.sv
	@mkdir -p $(@D)
	$(IVERILOG) $(IVERILOG_FLAGS) -g2012 -Wall -s apu_live_source_update_tb -o $@ $^
$(REPORTS)/apu-live-source-update.txt: build/tests/apu_live_source_update.vvp
	@mkdir -p $(REPORTS)
	$(VVP) $< > $@ || { cat $@; exit 1; }
$(REPORTS)/apu-live-source-update-synthesis.txt $(EXPORTS)/rtl/apu_live_source_update.json &: rtl/apu_live_source_update.sv
	@mkdir -p $(REPORTS) $(EXPORTS)/rtl
	$(YOSYS) -l $(REPORTS)/apu-live-source-update-synthesis.txt -p 'read_verilog -sv $^; hierarchy -check -top apu_live_source_update; proc; opt; check -assert; stat; write_json $(EXPORTS)/rtl/apu_live_source_update.json' > /dev/null
.PHONY: check-apu-live-source-update
check-apu-live-source-update: $(REPORTS)/apu-live-source-update.txt $(REPORTS)/apu-live-source-update-synthesis.txt $(EXPORTS)/rtl/apu_live_source_update.json
check-apu: check-apu-live-source-update

build/tests/apu_live_frame_order.vvp: rtl/apu_slot_bank.sv rtl/apu_live_source_update.sv rtl/apu_frame_timeline.sv rtl/apu_frame_scheduler.sv rtl/apu_badp_mix.sv rtl/apu_badp_decoder.sv rtl/apu_badp_step.sv rtl/apu_pcm_frame.sv rtl/apu_biquad.sv rtl/apu_mix_engine.sv tests/apu_live_frame_order_tb.sv
	@mkdir -p $(@D)
	$(IVERILOG) $(IVERILOG_FLAGS) -g2012 -Wall -s apu_live_frame_order_tb -o $@ $^
$(REPORTS)/apu-live-frame-order.txt: build/tests/apu_live_frame_order.vvp
	@mkdir -p $(REPORTS)
	$(VVP) $< > $@ || { cat $@; exit 1; }
.PHONY: check-apu-live-frame-order
check-apu-live-frame-order: $(REPORTS)/apu-live-frame-order.txt
check-apu: check-apu-live-frame-order

APU_CONTROL_INTEGRATION_RTL = rtl/apu_control_integration.sv rtl/apu_command_ingress.sv rtl/apu_command_executor.sv rtl/apu_slot_bank.sv rtl/apu_live_source_update.sv rtl/apu_frame_timeline.sv rtl/apu_end_event.sv
build/tests/apu_control_integration.vvp: $(APU_CONTROL_INTEGRATION_RTL) tests/apu_control_integration_tb.sv
	@mkdir -p $(@D)
	$(IVERILOG) $(IVERILOG_FLAGS) -g2012 -Wall -s apu_control_integration_tb -o $@ $^
$(REPORTS)/apu-control-integration.txt: build/tests/apu_control_integration.vvp
	@mkdir -p $(REPORTS)
	$(VVP) $< > $@ || { cat $@; exit 1; }
.PHONY: check-apu-control-integration
check-apu-control-integration: $(REPORTS)/apu-control-integration.txt
check-apu: check-apu-control-integration
$(REPORTS)/apu-control-integration-synthesis.txt $(EXPORTS)/rtl/apu_control_integration.json &: $(APU_CONTROL_INTEGRATION_RTL)
	@mkdir -p $(REPORTS) $(EXPORTS)/rtl
	$(YOSYS) -l $(REPORTS)/apu-control-integration-synthesis.txt -p 'read_verilog -sv $^; hierarchy -check -top apu_control_integration; flatten; proc; opt; check -assert; stat; write_json $(EXPORTS)/rtl/apu_control_integration.json' > /dev/null
.PHONY: check-apu-control-synthesis
check-apu-control-synthesis: $(REPORTS)/apu-control-integration-synthesis.txt $(EXPORTS)/rtl/apu_control_integration.json

APU_PLAYBACK_FRAME_RTL = rtl/apu_playback_frame.sv rtl/apu_frame_scheduler.sv rtl/apu_voice_cursor.sv rtl/apu_voice_cursor_lanes.sv rtl/apu_badp_mix.sv rtl/apu_badp_decoder.sv rtl/apu_badp_step.sv rtl/apu_pcm_frame.sv rtl/apu_biquad.sv rtl/apu_mix_engine.sv
build/tests/apu_serial_playback.vvp: rtl/apu_serial_output.sv rtl/apu_i2s_tx.sv rtl/apu_frame_timeline.sv $(APU_PLAYBACK_FRAME_RTL) tests/apu_serial_playback_tb.sv
	@mkdir -p $(@D)
	$(IVERILOG) $(IVERILOG_FLAGS) -g2012 -Wall -s apu_serial_playback_tb -o $@ $^
$(REPORTS)/apu-serial-playback.txt: build/tests/apu_serial_playback.vvp
	@mkdir -p $(REPORTS)
	$(VVP) $< > $@ || { cat $@; exit 1; }
$(REPORTS)/apu-serial-output-synthesis.txt $(EXPORTS)/rtl/apu_serial_output.json &: rtl/apu_i2s_tx.sv rtl/apu_serial_output.sv
	@mkdir -p $(REPORTS) $(EXPORTS)/rtl
	$(YOSYS) -l $(REPORTS)/apu-serial-output-synthesis.txt -p 'read_verilog -sv $^; hierarchy -check -top apu_serial_output; proc; opt; check -assert; stat; write_json $(EXPORTS)/rtl/apu_serial_output.json' > /dev/null
.PHONY: check-apu-serial-output
check-apu-serial-output: $(REPORTS)/apu-serial-playback.txt $(REPORTS)/apu-serial-output-synthesis.txt $(EXPORTS)/rtl/apu_serial_output.json
check-apu: check-apu-serial-output
build/tests/apu_control_playback.vvp: $(APU_CONTROL_INTEGRATION_RTL) $(APU_PLAYBACK_FRAME_RTL) rtl/apu_play_start.sv rtl/apu_voice_rate.sv tests/apu_control_playback_tb.sv
	@mkdir -p $(@D)
	$(IVERILOG) $(IVERILOG_FLAGS) -g2012 -Wall -s apu_control_playback_tb -o $@ $^
build/tests/apu_play_start.vvp: rtl/apu_play_start.sv rtl/apu_voice_rate.sv tests/apu_play_start_tb.sv
	@mkdir -p $(@D)
	$(IVERILOG) $(IVERILOG_FLAGS) -g2012 -Wall -s apu_play_start_tb -o $@ $^
$(REPORTS)/apu-play-start.txt: build/tests/apu_play_start.vvp build/tests/apu-voice-rate-extremes.txt $(REPORTS)/apu-voice-rate-extremes-cpp.txt
	@mkdir -p $(REPORTS)
	$(VVP) $< > $@ || { cat $@; exit 1; }
$(REPORTS)/apu-control-playback.txt: build/tests/apu_control_playback.vvp
	@mkdir -p $(REPORTS)
	$(VVP) $< > $@ || { cat $@; exit 1; }
$(REPORTS)/apu-play-start-synthesis.txt $(EXPORTS)/rtl/apu_play_start.json &: rtl/apu_play_start.sv rtl/apu_voice_rate.sv
	@mkdir -p $(REPORTS) $(EXPORTS)/rtl
	$(YOSYS) -l $(REPORTS)/apu-play-start-synthesis.txt -p 'read_verilog -sv $^; hierarchy -check -top apu_play_start; proc; opt; check -assert; stat; write_json $(EXPORTS)/rtl/apu_play_start.json' > /dev/null
.PHONY: check-apu-control-playback
check-apu-control-playback: $(REPORTS)/apu-control-playback.txt $(REPORTS)/apu-play-start.txt $(REPORTS)/apu-play-start-synthesis.txt $(EXPORTS)/rtl/apu_play_start.json
check-apu: check-apu-control-playback
build/tests/apu_source_bind.vvp: rtl/apu_source_bind.sv tests/apu_source_bind_tb.sv
	@mkdir -p $(@D)
	$(IVERILOG) $(IVERILOG_FLAGS) -g2012 -Wall -s apu_source_bind_tb -o $@ $^
build/tests/apu_control_sample_bind.vvp: $(APU_CONTROL_INTEGRATION_RTL) $(APU_PLAYBACK_FRAME_RTL) rtl/apu_play_start.sv rtl/apu_voice_rate.sv rtl/apu_source_bind.sv tests/apu_control_sample_bind_tb.sv
	@mkdir -p $(@D)
	$(IVERILOG) $(IVERILOG_FLAGS) -g2012 -Wall -s apu_control_sample_bind_tb -o $@ $^
$(REPORTS)/apu-source-bind.txt: build/tests/apu_source_bind.vvp
	@mkdir -p $(REPORTS)
	$(VVP) $< > $@ || { cat $@; exit 1; }
$(REPORTS)/apu-control-sample-bind.txt: build/tests/apu_control_sample_bind.vvp
	@mkdir -p $(REPORTS)
	$(VVP) $< > $@ || { cat $@; exit 1; }
$(REPORTS)/apu-source-bind-synthesis.txt $(EXPORTS)/rtl/apu_source_bind.json &: rtl/apu_source_bind.sv
	@mkdir -p $(REPORTS) $(EXPORTS)/rtl
	$(YOSYS) -l $(REPORTS)/apu-source-bind-synthesis.txt -p 'read_verilog -sv $^; hierarchy -check -top apu_source_bind; proc; opt; check -assert; stat; write_json $(EXPORTS)/rtl/apu_source_bind.json' > /dev/null
.PHONY: check-apu-source-bind
check-apu-source-bind: $(REPORTS)/apu-source-bind.txt $(REPORTS)/apu-control-sample-bind.txt $(REPORTS)/apu-source-bind-synthesis.txt $(EXPORTS)/rtl/apu_source_bind.json
check-apu: check-apu-source-bind
build/tests/apu_playback_frame_integration.vvp: $(APU_PLAYBACK_FRAME_RTL) rtl/apu_end_event.sv rtl/apu_frame_timeline.sv rtl/apu_source_word_router.sv rtl/apu_slot_bank.sv rtl/apu_upload_commit.sv rtl/apu_sample_store.sv rtl/async_sram.sv tests/issi_bll_model.sv tests/apu_playback_frame_integration_tb.sv
	@mkdir -p $(@D)
	$(IVERILOG) $(IVERILOG_FLAGS) -g2012 -Wall -s apu_playback_frame_integration_tb -o $@ $^
$(REPORTS)/apu-playback-frame-integration.txt: build/tests/apu_playback_frame_integration.vvp build/tests/apu-mixed-snapshot-vectors.txt
	@mkdir -p $(REPORTS)
	$(VVP) $< > $@ || { cat $@; exit 1; }
build/tests/apu_end_irq_integration.vvp: rtl/apu_end_event.sv rtl/apu_slot_bank.sv rtl/dma_block_transfer.sv rtl/dma_supervisor_context.sv rtl/dma_channel_controller.sv rtl/core_local_dma_irq.sv tests/apu_end_irq_integration_tb.sv
	@mkdir -p $(@D)
	$(IVERILOG) $(IVERILOG_FLAGS) -g2012 -Wall -s apu_end_irq_integration_tb -o $@ $^
$(REPORTS)/apu-end-irq-integration.txt: build/tests/apu_end_irq_integration.vvp
	@mkdir -p $(REPORTS)
	$(VVP) $< > $@ || { cat $@; exit 1; }
$(REPORTS)/apu-playback-frame-synthesis.txt $(EXPORTS)/rtl/apu_playback_frame.json &: $(APU_PLAYBACK_FRAME_RTL)
	@mkdir -p $(REPORTS) $(EXPORTS)/rtl
	$(YOSYS) -l $(REPORTS)/apu-playback-frame-synthesis.txt -p 'read_verilog -sv $^; hierarchy -check -top apu_playback_frame; proc; opt; check -assert; stat; write_json $(EXPORTS)/rtl/apu_playback_frame.json' > /dev/null
$(REPORTS)/apu-end-event-synthesis.txt $(EXPORTS)/rtl/apu_end_event.json &: rtl/apu_end_event.sv
	@mkdir -p $(REPORTS) $(EXPORTS)/rtl
	$(YOSYS) -l $(REPORTS)/apu-end-event-synthesis.txt -p 'read_verilog -sv $^; hierarchy -check -top apu_end_event; proc; opt; check -assert; stat; write_json $(EXPORTS)/rtl/apu_end_event.json' > /dev/null
.PHONY: check-apu-playback-frame
check-apu-playback-frame: $(REPORTS)/apu-playback-frame-integration.txt $(REPORTS)/apu-end-irq-integration.txt $(REPORTS)/apu-playback-frame-synthesis.txt $(EXPORTS)/rtl/apu_playback_frame.json $(REPORTS)/apu-end-event-synthesis.txt $(EXPORTS)/rtl/apu_end_event.json
check-apu: check-apu-playback-frame

build/tests/gfx_pcrtc_display_transport.vvp: rtl/gfx_pcrtc_beam_phase.sv rtl/gfx_pcrtc_system_beam.sv rtl/async_fifo.sv tests/gfx_pcrtc_display_transport_tb.sv
	@mkdir -p $(@D)
	$(IVERILOG) $(IVERILOG_FLAGS) -g2012 -Wall -s gfx_pcrtc_display_transport_tb -o $@ $^
$(REPORTS)/gfx-pcrtc-display-transport.txt: build/tests/gfx_pcrtc_display_transport.vvp
	@mkdir -p $(REPORTS)
	@for phase in 0 9 18 27 36; do $(VVP) $< +phase=$$phase || exit 1; done > $@ || { cat $@; exit 1; }
	@$(VVP) $< +stall >> $@ || { cat $@; exit 1; }
.PHONY: check-gfx-pcrtc-display-transport
check-gfx-pcrtc-display-transport: $(REPORTS)/gfx-pcrtc-display-transport.txt

# The real runtime value producers are evidence for a candidate slot encoding,
# not a completed ASIC representation or a complete VM/GC test.
build/tests/cpu_value_representation_vectors.cjs $(REPORTS)/cpu-value-representation-inputs.json &: tests/cpu_value_representation_vectors.ts
	@mkdir -p build/tests $(REPORTS)
	$(ESBUILD) $< --bundle --platform=node --format=cjs --packages=external --outfile=build/tests/cpu_value_representation_vectors.cjs --metafile=$(REPORTS)/cpu-value-representation-inputs.json
	$(PYTHON) -c 'import json; from pathlib import Path; d=json.loads(Path("$(REPORTS)/cpu-value-representation-inputs.json").read_text()); Path("build/tests/cpu_value_representation_ts.d").write_text("build/tests/cpu_value_representation_vectors.cjs $(REPORTS)/cpu-value-representation-inputs.json: " + " ".join(d["inputs"]) + "\n")'
-include build/tests/cpu_value_representation_ts.d
build/tests/cpu_value_representation_cpp: tests/cpu_value_representation_vectors.cpp
	@mkdir -p $(@D)
	$(CXX) -std=c++20 -O2 -I../machine/cpp -MMD -MP -MF build/tests/cpu_value_representation_cpp.d $< -o $@
-include build/tests/cpu_value_representation_cpp.d
$(REPORTS)/cpu-value-representation-ts.txt: build/tests/cpu_value_representation_vectors.cjs
	@mkdir -p $(REPORTS)
	$(NODE) $< > $@
$(REPORTS)/cpu-value-representation-cpp.txt: build/tests/cpu_value_representation_cpp
	@mkdir -p $(REPORTS)
	$< > $@
.PHONY: check-cpu-value-representation
check-cpu-value-representation: $(REPORTS)/cpu-value-representation-ts.txt $(REPORTS)/cpu-value-representation-cpp.txt

build/tests/cpu_compact_slot_vectors: tests/cpu_compact_slot_vectors.cpp
	@mkdir -p $(@D)
	$(CXX) -std=c++20 -O2 -I../machine/cpp -MMD -MP -MF build/tests/cpu_compact_slot_vectors.d $< -o $@
-include build/tests/cpu_compact_slot_vectors.d
build/tests/cpu-compact-slot-vectors.txt: build/tests/cpu_compact_slot_vectors
	$< > $@
build/tests/cpu_compact_slot_word_store.vvp: rtl/cpu_compact_slot_word_store.sv tests/cpu_compact_slot_word_store_tb.sv
	@mkdir -p $(@D)
	$(IVERILOG) $(IVERILOG_FLAGS) -g2012 -Wall -s cpu_compact_slot_word_store_tb -o $@ $^
$(REPORTS)/cpu-compact-slot-word-store.txt: build/tests/cpu_compact_slot_word_store.vvp build/tests/cpu-compact-slot-vectors.txt
	@mkdir -p $(REPORTS)
	$(VVP) $< > $@ || { cat $@; exit 1; }
$(REPORTS)/cpu-compact-slot-word-store-synthesis.txt $(EXPORTS)/rtl/cpu_compact_slot_word_store.json &: rtl/cpu_compact_slot_word_store.sv
	@mkdir -p $(REPORTS) $(EXPORTS)/rtl
	$(YOSYS) -l $(REPORTS)/cpu-compact-slot-word-store-synthesis.txt -p 'read_verilog -sv $^; hierarchy -check -top cpu_compact_slot_word_store; proc; opt; check -assert; stat; write_json $(EXPORTS)/rtl/cpu_compact_slot_word_store.json' > /dev/null
.PHONY: check-cpu-compact-slot
check-cpu-compact-slot: $(REPORTS)/cpu-compact-slot-word-store.txt $(REPORTS)/cpu-compact-slot-word-store-synthesis.txt $(EXPORTS)/rtl/cpu_compact_slot_word_store.json check-cpu-value-representation
build/tests/cpu_compact_core_private.vvp: rtl/cpu_compact_slot_word_store.sv rtl/system_bus_master.sv rtl/main_dram.sv rtl/core_ram_scalar.sv rtl/core_memory_system.sv tests/is41lv16100_model.sv tests/core_private_ram_integration_tb.sv
	@mkdir -p $(@D)
	$(IVERILOG) $(IVERILOG_FLAGS) -g2012 -Wall -DCOMPACT_SLOT -s core_private_ram_integration_tb -o $@ $^
$(REPORTS)/cpu-compact-core-private.txt: build/tests/cpu_compact_core_private.vvp
	@mkdir -p $(REPORTS)
	$(VVP) $< > $@ || { cat $@; exit 1; }
check-cpu-compact-slot: $(REPORTS)/cpu-compact-core-private.txt
build/tests/cpu_compact_value_core.vvp: rtl/cpu_word_alu.sv rtl/cpu_word_execute.sv rtl/cpu_word_frame.sv rtl/cpu_compact_value_store.sv rtl/cpu_compact_slot_word_store.sv rtl/system_bus_master.sv rtl/main_dram.sv rtl/core_ram_scalar.sv rtl/core_memory_system.sv tests/is41lv16100_model.sv tests/cpu_compact_value_core_tb.sv
	@mkdir -p $(@D)
	$(IVERILOG) $(IVERILOG_FLAGS) -g2012 -Wall -s cpu_compact_value_core_tb -o $@ $^
$(REPORTS)/cpu-compact-value-core.txt: build/tests/cpu_compact_value_core.vvp build/tests/cpu-word-execute-vectors.txt $(REPORTS)/cpu-word-execute-cpp.txt
	@mkdir -p $(REPORTS)
	$(VVP) $< > $@ || { cat $@; exit 1; }
$(REPORTS)/cpu-compact-value-store-synthesis.txt $(EXPORTS)/rtl/cpu_compact_value_store.json &: rtl/cpu_compact_value_store.sv
	@mkdir -p $(REPORTS) $(EXPORTS)/rtl
	$(YOSYS) -l $(REPORTS)/cpu-compact-value-store-synthesis.txt -p 'read_verilog -sv $^; hierarchy -check -top cpu_compact_value_store; proc; opt; check -assert; stat; write_json $(EXPORTS)/rtl/cpu_compact_value_store.json' > /dev/null
.PHONY: check-cpu-compact-value-core
check-cpu-compact-value-core: $(REPORTS)/cpu-compact-value-core.txt $(REPORTS)/cpu-compact-value-store-synthesis.txt $(EXPORTS)/rtl/cpu_compact_value_store.json
check-rtl: check-cpu-compact-slot
check-rtl: check-cpu-compact-value-core

build/tests/cpu_vm_frame_budget_vectors.cjs $(REPORTS)/cpu-vm-frame-budget-inputs.json &: tests/cpu_vm_frame_budget_vectors.ts
	@mkdir -p build/tests $(REPORTS)
	$(ESBUILD) $< --bundle --platform=node --format=cjs --packages=external --outfile=build/tests/cpu_vm_frame_budget_vectors.cjs --metafile=$(REPORTS)/cpu-vm-frame-budget-inputs.json
	$(PYTHON) -c 'import json; from pathlib import Path; d=json.loads(Path("$(REPORTS)/cpu-vm-frame-budget-inputs.json").read_text()); Path("build/tests/cpu_vm_frame_budget_ts.d").write_text("build/tests/cpu_vm_frame_budget_vectors.cjs $(REPORTS)/cpu-vm-frame-budget-inputs.json: " + " ".join(d["inputs"]) + "\n")'
-include build/tests/cpu_vm_frame_budget_ts.d
build/tests/cpu_image_inventory.cjs $(REPORTS)/cpu-image-inventory-inputs.json build/tests/cpu_image_inventory_ts.d &: tools/cpu_image_inventory.ts
	@mkdir -p build/tests $(REPORTS)
	$(ESBUILD) $< --bundle --platform=node --format=cjs --packages=external --outfile=build/tests/cpu_image_inventory.cjs --metafile=$(REPORTS)/cpu-image-inventory-inputs.json
	$(PYTHON) -c 'import json; from pathlib import Path; d=json.loads(Path("$(REPORTS)/cpu-image-inventory-inputs.json").read_text()); Path("build/tests/cpu_image_inventory_ts.d").write_text("build/tests/cpu_image_inventory.cjs $(REPORTS)/cpu-image-inventory-inputs.json: " + " ".join(d["inputs"]) + "\n")'
-include build/tests/cpu_image_inventory_ts.d
build/tests/cpu_boot_profile.cjs $(REPORTS)/cpu-boot-profile-inputs.json build/tests/cpu_boot_profile_ts.d &: tools/cpu_boot_profile.ts
	@mkdir -p build/tests $(REPORTS)
	$(ESBUILD) $< --bundle --platform=node --format=cjs --packages=external --loader:.glsl=text --loader:.wgsl=text --outfile=build/tests/cpu_boot_profile.cjs --metafile=$(REPORTS)/cpu-boot-profile-inputs.json
	$(PYTHON) -c 'import json; from pathlib import Path; d=json.loads(Path("$(REPORTS)/cpu-boot-profile-inputs.json").read_text()); Path("build/tests/cpu_boot_profile_ts.d").write_text("build/tests/cpu_boot_profile.cjs $(REPORTS)/cpu-boot-profile-inputs.json: " + " ".join(d["inputs"]) + "\n")'
-include build/tests/cpu_boot_profile_ts.d
$(REPORTS)/cpu-vm-frame-budget.txt: build/tests/cpu_vm_frame_budget_vectors.cjs
	@mkdir -p $(REPORTS)
	$(NODE) $< > $@
.PHONY: check-cpu-vm-frame-budget
check-cpu-vm-frame-budget: $(REPORTS)/cpu-vm-frame-budget.txt

# Binary64 service candidate; the serial reference and its parallel-alignment
# derivative are exercised against the same TypeScript and C++ vectors.
build/tests/core_binary64_vectors.cjs $(REPORTS)/core-binary64-inputs.json &: tests/core_binary64_vectors.ts
	@mkdir -p build/tests $(REPORTS)
	$(ESBUILD) $< --bundle --platform=node --format=cjs --packages=external --outfile=build/tests/core_binary64_vectors.cjs --metafile=$(REPORTS)/core-binary64-inputs.json
	$(PYTHON) -c 'import json; from pathlib import Path; d=json.loads(Path("$(REPORTS)/core-binary64-inputs.json").read_text()); Path("build/tests/core_binary64_ts.d").write_text("build/tests/core_binary64_vectors.cjs $(REPORTS)/core-binary64-inputs.json: " + " ".join(d["inputs"]) + "\n")'
-include build/tests/core_binary64_ts.d
build/tests/core-binary64-vectors.txt: build/tests/core_binary64_vectors.cjs
	$(NODE) $< > $@
build/tests/core_binary64_vectors_cpp build/tests/core_binary64_cpp.d &: tests/core_binary64_vectors.cpp
	@mkdir -p $(@D)
	$(CXX) -std=c++20 -O2 -I../machine/cpp -MMD -MP -MT build/tests/core_binary64_vectors_cpp -MF build/tests/core_binary64_cpp.d $< -o build/tests/core_binary64_vectors_cpp
-include build/tests/core_binary64_cpp.d
$(REPORTS)/core-binary64-cpp.txt: build/tests/core_binary64_vectors_cpp build/tests/core-binary64-vectors.txt
	@mkdir -p $(REPORTS)
	$< < build/tests/core-binary64-vectors.txt > $@
CORE_BINARY64_RTL = rtl/core_binary64_service.sv rtl/core_binary64_sqrt.sv third_party/dawson_fpu/double_adder.v third_party/dawson_fpu/double_adder_fast.v third_party/dawson_fpu/double_multiplier.v third_party/dawson_fpu/double_divider_corrected.v third_party/dawson_fpu/double_multiplier_fast.v third_party/dawson_fpu/double_divider_fast.v third_party/dawson_fpu/binary64_lzc53.v
build/tests/core_binary64_service.vvp: $(CORE_BINARY64_RTL) tests/core_binary64_service_tb.sv
	@mkdir -p $(@D)
	$(IVERILOG) $(IVERILOG_FLAGS) -g2012 -Wall -s core_binary64_service_tb -o $@ $^
build/tests/core_binary64_service_fast.vvp: $(CORE_BINARY64_RTL) tests/core_binary64_service_tb.sv
	@mkdir -p $(@D)
	$(IVERILOG) $(IVERILOG_FLAGS) -g2012 -Wall -DCORE_BINARY64_FAST_ADD -s core_binary64_service_tb -o $@ $^
build/tests/core_binary64_service_fast_muldiv.vvp: $(CORE_BINARY64_RTL) tests/core_binary64_service_tb.sv
	@mkdir -p $(@D)
	$(IVERILOG) $(IVERILOG_FLAGS) -g2012 -Wall -DCORE_BINARY64_FAST_ADD -DCORE_BINARY64_FAST_MULDIV -s core_binary64_service_tb -o $@ $^
build/tests/core_binary64_legacy_divider.vvp: third_party/dawson_fpu/double_divider.v tests/core_binary64_legacy_divider_tb.sv
	@mkdir -p $(@D)
	$(IVERILOG) $(IVERILOG_FLAGS) -g2012 -Wall -s core_binary64_legacy_divider_tb -o $@ $^
$(REPORTS)/core-binary64-legacy-divider.txt: build/tests/core_binary64_legacy_divider.vvp
	@mkdir -p $(REPORTS)
	$(VVP) $< > $@ || { cat $@; exit 1; }
$(REPORTS)/core-binary64-rtl.txt: build/tests/core_binary64_service.vvp build/tests/core-binary64-vectors.txt
	@mkdir -p $(REPORTS)
	$(VVP) $< > $@ || { cat $@; exit 1; }
$(REPORTS)/core-binary64-fast-rtl.txt: build/tests/core_binary64_service_fast.vvp build/tests/core-binary64-vectors.txt
	@mkdir -p $(REPORTS)
	$(VVP) $< > $@ || { cat $@; exit 1; }
$(REPORTS)/core-binary64-fast-muldiv-rtl.txt: build/tests/core_binary64_service_fast_muldiv.vvp build/tests/core-binary64-vectors.txt
	@mkdir -p $(REPORTS)
	$(VVP) $< > $@ || { cat $@; exit 1; }
$(REPORTS)/core-binary64-synthesis.txt $(EXPORTS)/rtl/core_binary64_service.json &: $(CORE_BINARY64_RTL)
	@mkdir -p $(REPORTS) $(EXPORTS)/rtl
	$(YOSYS) -l $(REPORTS)/core-binary64-synthesis.txt -p 'read_verilog -sv $^; hierarchy -check -top core_binary64_service; proc; opt; check -assert; stat; write_json $(EXPORTS)/rtl/core_binary64_service.json' > /dev/null
$(REPORTS)/core-binary64-fast-synthesis.txt $(EXPORTS)/rtl/core_binary64_service_fast.json &: $(CORE_BINARY64_RTL)
	@mkdir -p $(REPORTS) $(EXPORTS)/rtl
	$(YOSYS) -l $(REPORTS)/core-binary64-fast-synthesis.txt -p 'read_verilog -sv $^; chparam -set FAST_ADDER 1 core_binary64_service; hierarchy -check -top core_binary64_service; proc; opt; check -assert; stat; write_json $(EXPORTS)/rtl/core_binary64_service_fast.json' > /dev/null
$(REPORTS)/core-binary64-fast-muldiv-synthesis.txt $(EXPORTS)/rtl/core_binary64_service_fast_muldiv.json &: $(CORE_BINARY64_RTL)
	@mkdir -p $(REPORTS) $(EXPORTS)/rtl
	$(YOSYS) -l $(REPORTS)/core-binary64-fast-muldiv-synthesis.txt -p 'read_verilog -sv $^; chparam -set FAST_ADDER 1 -set FAST_MULDIV 1 core_binary64_service; hierarchy -check -top core_binary64_service; proc; opt; check -assert; stat; write_json $(EXPORTS)/rtl/core_binary64_service_fast_muldiv.json' > /dev/null
.PHONY: check-core-binary64
check-core-binary64: $(REPORTS)/core-binary64-cpp.txt $(REPORTS)/core-binary64-rtl.txt $(REPORTS)/core-binary64-fast-rtl.txt $(REPORTS)/core-binary64-synthesis.txt $(REPORTS)/core-binary64-fast-synthesis.txt $(EXPORTS)/rtl/core_binary64_service.json $(EXPORTS)/rtl/core_binary64_service_fast.json
check-core-binary64: $(REPORTS)/core-binary64-fast-muldiv-rtl.txt $(REPORTS)/core-binary64-fast-muldiv-synthesis.txt $(REPORTS)/core-binary64-legacy-divider.txt $(EXPORTS)/rtl/core_binary64_service_fast_muldiv.json

build/tests/core-binary64-sqrt-vectors.txt: tests/core_binary64_sqrt_vectors.js
	@mkdir -p $(@D)
	$(NODE) $< > $@
build/tests/core_binary64_sqrt_vectors_cpp: tests/core_binary64_sqrt_vectors.cpp
	@mkdir -p $(@D)
	$(CXX) -std=c++20 -O2 $< -o $@
build/tests/core_binary64_sqrt_service.vvp: $(CORE_BINARY64_RTL) tests/core_binary64_sqrt_service_tb.sv
	@mkdir -p $(@D)
	$(IVERILOG) $(IVERILOG_FLAGS) -g2012 -Wall -s core_binary64_sqrt_service_tb -o $@ $^
$(REPORTS)/core-binary64-sqrt-cpp.txt: build/tests/core_binary64_sqrt_vectors_cpp build/tests/core-binary64-sqrt-vectors.txt
	@mkdir -p $(REPORTS)
	$< < build/tests/core-binary64-sqrt-vectors.txt > $@ || { cat $@; exit 1; }
$(REPORTS)/core-binary64-sqrt-rtl.txt: build/tests/core_binary64_sqrt_service.vvp build/tests/core-binary64-sqrt-vectors.txt
	@mkdir -p $(REPORTS)
	$(VVP) $< +VECTORS=build/tests/core-binary64-sqrt-vectors.txt > $@ || { cat $@; exit 1; }
.PHONY: check-core-binary64-sqrt
check-core-binary64-sqrt: $(REPORTS)/core-binary64-sqrt-cpp.txt $(REPORTS)/core-binary64-sqrt-rtl.txt
check-core-binary64: check-core-binary64-sqrt

build/tests/core_binary64_normalize_vectors.cjs $(REPORTS)/core-binary64-normalize-inputs.json &: tests/core_binary64_normalize_vectors.ts
	@mkdir -p build/tests $(REPORTS)
	$(ESBUILD) $< --bundle --platform=node --format=cjs --packages=external --outfile=build/tests/core_binary64_normalize_vectors.cjs --metafile=$(REPORTS)/core-binary64-normalize-inputs.json
	$(PYTHON) -c 'import json; from pathlib import Path; d=json.loads(Path("$(REPORTS)/core-binary64-normalize-inputs.json").read_text()); Path("build/tests/core_binary64_normalize_ts.d").write_text("build/tests/core_binary64_normalize_vectors.cjs $(REPORTS)/core-binary64-normalize-inputs.json: " + " ".join(d["inputs"]) + "\n")'
-include build/tests/core_binary64_normalize_ts.d
build/tests/core-binary64-normalize-vectors.txt: build/tests/core_binary64_normalize_vectors.cjs
	$(NODE) $< > $@
$(REPORTS)/core-binary64-normalize-cpp.txt: build/tests/core_binary64_vectors_cpp build/tests/core-binary64-normalize-vectors.txt
	@mkdir -p $(REPORTS)
	$< < build/tests/core-binary64-normalize-vectors.txt > $@
$(REPORTS)/core-binary64-normalize-rtl.txt: build/tests/core_binary64_service.vvp build/tests/core-binary64-normalize-vectors.txt
	@mkdir -p $(REPORTS)
	$(VVP) $< +VECTORS=build/tests/core-binary64-normalize-vectors.txt > $@ || { cat $@; exit 1; }
$(REPORTS)/core-binary64-normalize-fast-rtl.txt: build/tests/core_binary64_service_fast.vvp build/tests/core-binary64-normalize-vectors.txt
	@mkdir -p $(REPORTS)
	$(VVP) $< +VECTORS=build/tests/core-binary64-normalize-vectors.txt > $@ || { cat $@; exit 1; }
check-core-binary64: $(REPORTS)/core-binary64-normalize-cpp.txt $(REPORTS)/core-binary64-normalize-rtl.txt $(REPORTS)/core-binary64-normalize-fast-rtl.txt

build/tests/core_binary64_muldiv_vectors.cjs $(REPORTS)/core-binary64-muldiv-inputs.json &: tests/core_binary64_muldiv_vectors.ts
	@mkdir -p build/tests $(REPORTS)
	$(ESBUILD) $< --bundle --platform=node --format=cjs --packages=external --outfile=build/tests/core_binary64_muldiv_vectors.cjs --metafile=$(REPORTS)/core-binary64-muldiv-inputs.json
	$(PYTHON) -c 'import json; from pathlib import Path; d=json.loads(Path("$(REPORTS)/core-binary64-muldiv-inputs.json").read_text()); Path("build/tests/core_binary64_muldiv_ts.d").write_text("build/tests/core_binary64_muldiv_vectors.cjs $(REPORTS)/core-binary64-muldiv-inputs.json: " + " ".join(d["inputs"]) + "\n")'
-include build/tests/core_binary64_muldiv_ts.d
build/tests/core-binary64-muldiv-vectors.txt: build/tests/core_binary64_muldiv_vectors.cjs
	$(NODE) $< > $@
$(REPORTS)/core-binary64-muldiv-cpp.txt: build/tests/core_binary64_vectors_cpp build/tests/core-binary64-muldiv-vectors.txt
	@mkdir -p $(REPORTS)
	$< < build/tests/core-binary64-muldiv-vectors.txt > $@
$(REPORTS)/core-binary64-muldiv-rtl.txt: build/tests/core_binary64_service.vvp build/tests/core-binary64-muldiv-vectors.txt
	@mkdir -p $(REPORTS)
	$(VVP) $< +VECTORS=build/tests/core-binary64-muldiv-vectors.txt > $@ || { cat $@; exit 1; }
$(REPORTS)/core-binary64-muldiv-fast-rtl.txt: build/tests/core_binary64_service_fast_muldiv.vvp build/tests/core-binary64-muldiv-vectors.txt
	@mkdir -p $(REPORTS)
	$(VVP) $< +VECTORS=build/tests/core-binary64-muldiv-vectors.txt > $@ || { cat $@; exit 1; }
check-core-binary64: $(REPORTS)/core-binary64-muldiv-cpp.txt $(REPORTS)/core-binary64-muldiv-rtl.txt $(REPORTS)/core-binary64-muldiv-fast-rtl.txt

$(EXPORTS)/figures/core-values-architecture.svg: ../docs/book4/figures/core-values-architecture.svg
	@mkdir -p $(@D)
	cp $< $@
$(EXPORTS)/figures/core-values-architecture.png: $(EXPORTS)/figures/core-values-architecture.svg
	rsvg-convert -w 1320 -o $@ $<
$(EXPORTS)/figures/core-private-memory.svg: ../docs/book4/figures/core-private-memory.svg
	@mkdir -p $(@D)
	cp $< $@
$(EXPORTS)/figures/core-private-memory.png: $(EXPORTS)/figures/core-private-memory.svg
	rsvg-convert -w 1320 -o $@ $<

# Ordered frame scheduling and empty-to-active decoder snapshot handoff.
build/tests/apu_frame_scheduler.vvp: rtl/apu_frame_scheduler.sv tests/apu_frame_scheduler_tb.sv
	@mkdir -p $(@D)
	$(IVERILOG) $(IVERILOG_FLAGS) -g2012 -Wall -s apu_frame_scheduler_tb -o $@ $^
build/tests/apu_frame_scheduler_integration.vvp: rtl/apu_frame_timeline.sv rtl/apu_frame_scheduler.sv rtl/apu_upload_commit.sv rtl/apu_badp_step.sv rtl/apu_badp_decoder.sv rtl/apu_biquad.sv rtl/apu_mix_engine.sv rtl/apu_badp_mix.sv rtl/apu_pcm_frame.sv tests/apu_frame_scheduler_integration_tb.sv
	@mkdir -p $(@D)
	$(IVERILOG) $(IVERILOG_FLAGS) -g2012 -Wall -s apu_frame_scheduler_integration_tb -o $@ $^
$(REPORTS)/apu-frame-scheduler.txt: build/tests/apu_frame_scheduler.vvp
	@mkdir -p $(@D)
	$(VVP) $< > $@ || { cat $@; exit 1; }
$(REPORTS)/apu-frame-scheduler-integration.txt: build/tests/apu_frame_scheduler_integration.vvp
	@mkdir -p $(@D)
	$(VVP) $< > $@ || { cat $@; exit 1; }
$(REPORTS)/apu-frame-scheduler-synthesis.txt $(EXPORTS)/rtl/apu_frame_scheduler.json &: rtl/apu_frame_scheduler.sv
	@mkdir -p $(REPORTS) $(EXPORTS)/rtl
	$(YOSYS) -l $(REPORTS)/apu-frame-scheduler-synthesis.txt -p 'read_verilog -sv $^; hierarchy -check -top apu_frame_scheduler; proc; opt; check -assert; stat; write_json $(EXPORTS)/rtl/apu_frame_scheduler.json' > /dev/null
.PHONY: check-apu-frame-scheduler
check-apu-frame-scheduler: $(REPORTS)/apu-frame-scheduler.txt $(REPORTS)/apu-frame-scheduler-integration.txt $(REPORTS)/apu-frame-scheduler-synthesis.txt $(EXPORTS)/rtl/apu_frame_scheduler.json
check-apu: check-apu-frame-scheduler

# IMGDEC token/history datapath; packet, FIFO, timing and system control are
# separate owners and are not exercised by this standalone target.
build/tests/imgdec_payload.vvp: rtl/imgdec_payload.sv tests/imgdec_payload_tb.sv
	@mkdir -p $(@D)
	$(IVERILOG) $(IVERILOG_FLAGS) -g2012 -Wall -s imgdec_payload_tb -o $@ $^
$(REPORTS)/imgdec-payload.txt: build/tests/imgdec_payload.vvp
	@mkdir -p $(@D)
	$(VVP) $< > $@ || { cat $@; exit 1; }
$(REPORTS)/imgdec-payload-synthesis.txt $(EXPORTS)/rtl/imgdec_payload.json &: rtl/imgdec_payload.sv
	@mkdir -p $(REPORTS) $(EXPORTS)/rtl
	$(YOSYS) -l $(REPORTS)/imgdec-payload-synthesis.txt -p 'read_verilog -sv $^; hierarchy -check -top imgdec_payload; proc; opt; memory_collect; check -assert; stat; write_json $(EXPORTS)/rtl/imgdec_payload.json' > /dev/null
.PHONY: check-imgdec-payload
check-imgdec-payload: $(REPORTS)/imgdec-payload.txt $(REPORTS)/imgdec-payload-synthesis.txt $(EXPORTS)/rtl/imgdec_payload.json

# Replay one shared stream through the actual TS and C++ IMGDEC owners and
# compare their payload words with the physical token/history datapath.
# The C++ library is built by the full BMSX checkout's existing CMake build.
IMGDEC_CPP_BUILD ?= ../build-cpp-tests
build/tests/imgdec_payload_reference.cjs $(REPORTS)/imgdec-payload-ts-inputs.json &: tests/imgdec_payload_reference.ts
	@mkdir -p build/tests $(REPORTS)
	$(ESBUILD) $< --bundle --platform=node --format=cjs --packages=external --outfile=build/tests/imgdec_payload_reference.cjs --metafile=$(REPORTS)/imgdec-payload-ts-inputs.json
	$(PYTHON) -c 'import json; from pathlib import Path; d=json.loads(Path("$(REPORTS)/imgdec-payload-ts-inputs.json").read_text()); Path("build/tests/imgdec_payload_ts.d").write_text("build/tests/imgdec_payload_reference.cjs $(REPORTS)/imgdec-payload-ts-inputs.json: " + " ".join(d["inputs"]) + "\n")'
-include build/tests/imgdec_payload_ts.d
.PHONY: imgdec-reference-libraries
imgdec-reference-libraries:
	cmake --build $(IMGDEC_CPP_BUILD) --target bmsx_core bmsx_binary_codec --parallel 2
build/tests/imgdec_payload_reference_cpp: tests/imgdec_payload_reference.cpp $(IMGDEC_CPP_BUILD)/libbmsx.a $(IMGDEC_CPP_BUILD)/libbmsx_binary_codec.a | imgdec-reference-libraries
	@mkdir -p build/tests
	$(CXX) -std=c++20 -O2 -I../machine/cpp -MMD -MP -MF build/tests/imgdec_payload_cpp.d $< $(IMGDEC_CPP_BUILD)/libbmsx.a $(IMGDEC_CPP_BUILD)/libbmsx_binary_codec.a -o $@
-include build/tests/imgdec_payload_cpp.d
build/tests/imgdec_payload_reference_ts.txt: build/tests/imgdec_payload_reference.cjs tests/imgdec_payload_vectors.hex
	$(NODE) --max-old-space-size=384 $< > $@
build/tests/imgdec_payload_reference_cpp.txt: build/tests/imgdec_payload_reference_cpp tests/imgdec_payload_vectors.hex
	$< > $@
build/tests/imgdec_payload_reference.vvp: rtl/imgdec_payload.sv tests/imgdec_payload_reference_tb.sv
	@mkdir -p $(@D)
	$(IVERILOG) $(IVERILOG_FLAGS) -g2012 -Wall -s imgdec_payload_reference_tb -o $@ $^
$(REPORTS)/imgdec-payload-reference.txt: build/tests/imgdec_payload_reference.vvp build/tests/imgdec_payload_reference_ts.txt build/tests/imgdec_payload_reference_cpp.txt
	@mkdir -p $(REPORTS)
	cmp build/tests/imgdec_payload_reference_ts.txt build/tests/imgdec_payload_reference_cpp.txt
	$(VVP) $< > $@ || { cat $@; exit 1; }
.PHONY: check-imgdec-payload-reference
check-imgdec-payload-reference: $(REPORTS)/imgdec-payload-reference.txt

# Square generator through the shared voice filter and mixer, compared with
# the existing TS vectors and their independent C++ replay.
build/tests/apu_square_mix.vvp: rtl/apu_badp_step.sv rtl/apu_badp_decoder.sv rtl/apu_biquad.sv rtl/apu_mix_engine.sv rtl/apu_badp_mix.sv rtl/apu_pcm_frame.sv tests/apu_square_mix_tb.sv
	@mkdir -p $(@D)
	$(IVERILOG) $(IVERILOG_FLAGS) -g2012 -Wall -s apu_square_mix_tb -o $@ $^
$(REPORTS)/apu-square-mix.txt: build/tests/apu_square_mix.vvp build/tests/apu-voice-cursor-vectors.txt $(REPORTS)/apu-voice-cursor-cpp.txt
	@mkdir -p $(REPORTS)
	$(VVP) $< > $@ || { cat $@; exit 1; }
.PHONY: check-apu-square-mix
check-apu-square-mix: $(REPORTS)/apu-square-mix.txt
check-apu: check-apu-square-mix

# Full generated texture/CLUT packet against the existing TS and C++ IMGDEC
# owners. This tests the stream producer, not MMIO, DMA, FIFO or IRQ timing.
build/tests/imgdec_stream_reference_ts.txt: build/tests/imgdec_payload_reference.cjs tests/imgdec_payload_vectors.hex
	$(NODE) --max-old-space-size=384 $< --packet > $@
build/tests/imgdec_stream_reference_cpp.txt: build/tests/imgdec_payload_reference_cpp tests/imgdec_payload_vectors.hex
	$< --packet > $@
build/tests/imgdec_stream.vvp: rtl/imgdec_payload.sv rtl/imgdec_stream.sv tests/imgdec_stream_tb.sv
	@mkdir -p $(@D)
	$(IVERILOG) $(IVERILOG_FLAGS) -g2012 -Wall -s imgdec_stream_tb -o $@ $^
$(REPORTS)/imgdec-stream.txt: build/tests/imgdec_stream.vvp build/tests/imgdec_stream_reference_ts.txt build/tests/imgdec_stream_reference_cpp.txt
	@mkdir -p $(REPORTS)
	cmp build/tests/imgdec_stream_reference_ts.txt build/tests/imgdec_stream_reference_cpp.txt
	$(VVP) $< > $@ || { cat $@; exit 1; }
$(REPORTS)/imgdec-stream-synthesis.txt $(EXPORTS)/rtl/imgdec_stream.json &: rtl/imgdec_payload.sv rtl/imgdec_stream.sv
	@mkdir -p $(REPORTS) $(EXPORTS)/rtl
	$(YOSYS) -l $(REPORTS)/imgdec-stream-synthesis.txt -p 'read_verilog -sv $^; hierarchy -check -top imgdec_stream; proc; opt; memory_collect; check -assert; stat; write_json $(EXPORTS)/rtl/imgdec_stream.json' > /dev/null
.PHONY: check-imgdec-stream
check-imgdec-stream: $(REPORTS)/imgdec-stream.txt $(REPORTS)/imgdec-stream-synthesis.txt $(EXPORTS)/rtl/imgdec_stream.json

build/tests/apu_serial_output.vvp: rtl/apu_serial_output.sv rtl/apu_i2s_tx.sv tests/apu_serial_output_tb.sv
	@mkdir -p $(@D)
	$(IVERILOG) $(IVERILOG_FLAGS) -g2012 -Wall -s apu_serial_output_tb -o $@ $^
$(REPORTS)/apu-serial-buffer.txt: build/tests/apu_serial_output.vvp
	@mkdir -p $(REPORTS)
	$(VVP) $< > $@ || { cat $@; exit 1; }
check-apu-serial-output: $(REPORTS)/apu-serial-buffer.txt

# Candidate edge-IRQ timing: ideal digital sweep only, not pad qualification.
build/tests/cart_irq_edge_timing.vvp: tests/cart_pin_sync_experiment.sv $(IRQ_STUDY_BANK) tests/cart_irq_edge_timing_tb.sv
	@mkdir -p $(@D)
	$(IVERILOG) $(IVERILOG_FLAGS) -g2012 -Wall -s cart_irq_edge_timing_tb -o $@ $^
$(REPORTS)/cart-irq-edge-timing.txt: build/tests/cart_irq_edge_timing.vvp
	@mkdir -p $(REPORTS)
	$(VVP) $< > $@ || { cat $@; exit 1; }
.PHONY: check-cart-irq-edge-timing
check-cart-irq-edge-timing: $(REPORTS)/cart-irq-edge-timing.txt
build/tests/cart_core_sync_reference_card.vvp: $(CARD_RTL) $(CART_RTL) tests/cart_pin_sync_experiment.sv $(IRQ_STUDY_BANK) rtl/system_bus_master.sv rtl/main_dram.sv rtl/core_ram_scalar.sv rtl/core_memory_system.sv tests/is41lv16100_model.sv tests/cart_rom_model.sv tests/issi_bll_model.sv tests/cart_core_reference_card_tb.sv
	@mkdir -p $(@D)
	$(IVERILOG) $(IVERILOG_FLAGS) -g2012 -Wall -DIRQ_SYNC_EXPERIMENT -s cart_core_reference_card_tb -o $@ $^
$(REPORTS)/cart-core-sync-reference-card.txt: build/tests/cart_core_sync_reference_card.vvp
	@mkdir -p $(REPORTS)
	$(VVP) $< > $@ || { cat $@; exit 1; }
.PHONY: check-cart-core-sync-reference
check-cart-core-sync-reference: $(REPORTS)/cart-core-sync-reference-card.txt

# IMGDEC output storage and the stream producer joined to the actual 64-word
# FIFO. Storage supports atomic batches through 16 words; the current stream
# producer issues payload one word at a time and does not implement timing.
build/tests/imgdec_output_fifo.vvp: rtl/imgdec_output_fifo.sv tests/imgdec_output_fifo_tb.sv
	@mkdir -p $(@D)
	$(IVERILOG) $(IVERILOG_FLAGS) -g2012 -Wall -s imgdec_output_fifo_tb -o $@ $^
$(REPORTS)/imgdec-output-fifo.txt: build/tests/imgdec_output_fifo.vvp
	@mkdir -p $(REPORTS)
	$(VVP) $< > $@ || { cat $@; exit 1; }
build/tests/imgdec_stream_queued.vvp: rtl/imgdec_payload.sv rtl/imgdec_stream.sv rtl/imgdec_output_fifo.sv rtl/imgdec_stream_queued.sv tests/imgdec_stream_queued_tb.sv
	@mkdir -p $(@D)
	$(IVERILOG) $(IVERILOG_FLAGS) -g2012 -Wall -s imgdec_stream_queued_tb -o $@ $^
$(REPORTS)/imgdec-stream-queued.txt: build/tests/imgdec_stream_queued.vvp build/tests/imgdec_stream_reference_ts.txt build/tests/imgdec_stream_reference_cpp.txt
	@mkdir -p $(REPORTS)
	cmp build/tests/imgdec_stream_reference_ts.txt build/tests/imgdec_stream_reference_cpp.txt
	$(VVP) $< > $@ || { cat $@; exit 1; }
$(REPORTS)/imgdec-stream-queued-synthesis.txt $(EXPORTS)/rtl/imgdec_stream_queued.json &: rtl/imgdec_payload.sv rtl/imgdec_stream.sv rtl/imgdec_output_fifo.sv rtl/imgdec_stream_queued.sv
	@mkdir -p $(REPORTS) $(EXPORTS)/rtl
	$(YOSYS) -l $(REPORTS)/imgdec-stream-queued-synthesis.txt -p 'read_verilog -sv $^; hierarchy -check -top imgdec_stream_queued; proc; opt; memory_collect; check -assert; stat; write_json $(EXPORTS)/rtl/imgdec_stream_queued.json' > /dev/null
.PHONY: check-imgdec-stream-queued
check-imgdec-stream-queued: $(REPORTS)/imgdec-output-fifo.txt $(REPORTS)/imgdec-stream-queued.txt $(REPORTS)/imgdec-stream-queued-synthesis.txt $(EXPORTS)/rtl/imgdec_stream_queued.json

build/tests/gfx_config_fast_cdc.vvp: rtl/async_fifo.sv tests/gfx_config_fast_cdc_tb.sv
	@mkdir -p $(@D)
	$(IVERILOG) $(IVERILOG_FLAGS) -g2012 -Wall -s gfx_config_fast_cdc_tb -o $@ $^
$(REPORTS)/gfx-config-fast-cdc.txt: build/tests/gfx_config_fast_cdc.vvp
	@mkdir -p $(@D)
	@for phase in 0 4000 9000 14000 18517 22500 29523; do $(VVP) $< +PHASE=$$phase || exit 1; done > $@ || { cat $@; exit 1; }
.PHONY: check-gfx-config-fast-cdc
check-gfx-config-fast-cdc: $(REPORTS)/gfx-config-fast-cdc.txt

# Mixed PCM/BADP through the actual sample SRAM, timeline and serial DAC pins.
# One scenario, not a guarantee for other source mixes or deadline loads.
build/tests/apu_serial_mixed.vvp: $(APU_PLAYBACK_FRAME_RTL) rtl/apu_end_event.sv rtl/apu_frame_timeline.sv rtl/apu_source_word_router.sv rtl/apu_slot_bank.sv rtl/apu_upload_commit.sv rtl/apu_sample_store.sv rtl/async_sram.sv rtl/apu_i2s_tx.sv rtl/apu_serial_output.sv tests/issi_bll_model.sv tests/apu_playback_frame_integration_tb.sv
	@mkdir -p $(@D)
	$(IVERILOG) $(IVERILOG_FLAGS) -g2012 -Wall -DAPU_SERIAL_MIXED_TEST -s apu_playback_frame_integration_tb -o $@ $^
$(REPORTS)/apu-serial-mixed.txt: build/tests/apu_serial_mixed.vvp build/tests/apu-mixed-snapshot-vectors.txt $(REPORTS)/apu-mixed-snapshot-cpp.txt
	@mkdir -p $(REPORTS)
	$(VVP) $< > $@ || { cat $@; exit 1; }
.PHONY: check-apu-serial-mixed
check-apu-serial-mixed: $(REPORTS)/apu-serial-mixed.txt

# Batch visibility trial. Timing/MMIO/DMA/supervisor are deliberately outside.
build/tests/imgdec_stream_batched.vvp: rtl/imgdec_payload.sv rtl/imgdec_stream.sv rtl/imgdec_output_fifo.sv rtl/imgdec_stream_batched.sv tests/imgdec_stream_batched_tb.sv
	@mkdir -p $(@D)
	$(IVERILOG) $(IVERILOG_FLAGS) -g2012 -Wall -s imgdec_stream_batched_tb -o $@ $^
$(REPORTS)/imgdec-stream-batched.txt: build/tests/imgdec_stream_batched.vvp build/tests/imgdec_stream_reference_ts.txt build/tests/imgdec_stream_reference_cpp.txt
	@mkdir -p $(REPORTS)
	cmp build/tests/imgdec_stream_reference_ts.txt build/tests/imgdec_stream_reference_cpp.txt
	$(VVP) $< > $@ || { cat $@; exit 1; }
$(REPORTS)/imgdec-stream-batched-synthesis.txt $(EXPORTS)/rtl/imgdec_stream_batched.json &: rtl/imgdec_payload.sv rtl/imgdec_stream.sv rtl/imgdec_output_fifo.sv rtl/imgdec_stream_batched.sv
	@mkdir -p $(REPORTS) $(EXPORTS)/rtl
	$(YOSYS) -l $(REPORTS)/imgdec-stream-batched-synthesis.txt -p 'read_verilog -sv $^; hierarchy -check -top imgdec_stream_batched; proc; opt; memory_collect; check -assert; stat; write_json $(EXPORTS)/rtl/imgdec_stream_batched.json' > /dev/null
.PHONY: check-imgdec-stream-batched
check-imgdec-stream-batched: $(REPORTS)/imgdec-stream-batched.txt $(REPORTS)/imgdec-stream-batched-synthesis.txt $(EXPORTS)/rtl/imgdec_stream_batched.json

# Real PCRTC SYS owner to continuously running 54 MHz coherent state receiver.
# The resulting field/word snapshots still need an output sampling policy.
GFX_FAST_SNAPSHOT_RTL = rtl/async_fifo.sv rtl/gfx_pcrtc_status.sv rtl/gfx_pcrtc_system_beam.sv rtl/gfx_pcrtc_beam_phase.sv rtl/display_context_gfx.sv rtl/gfx_pcrtc_control.sv rtl/gfx_pcrtc_fast_snapshot.sv
build/tests/gfx_pcrtc_fast_snapshot.vvp: $(GFX_FAST_SNAPSHOT_RTL) tests/gfx_pcrtc_fast_snapshot_tb.sv
	@mkdir -p $(@D)
	$(IVERILOG) $(IVERILOG_FLAGS) -g2012 -Wall -s gfx_pcrtc_fast_snapshot_tb -o $@ $^
build/tests/gfx_pcrtc_fast_snapshot_stop.vvp: $(GFX_FAST_SNAPSHOT_RTL) tests/gfx_pcrtc_fast_snapshot_stop_tb.sv
	@mkdir -p $(@D)
	$(IVERILOG) $(IVERILOG_FLAGS) -g2012 -Wall -s gfx_pcrtc_fast_snapshot_stop_tb -o $@ $^
$(REPORTS)/gfx-pcrtc-fast-snapshot.txt: build/tests/gfx_pcrtc_fast_snapshot.vvp build/tests/gfx_pcrtc_fast_snapshot_stop.vvp
	@mkdir -p $(REPORTS)
	@for phase in 0 3000 9000 17777 29523; do $(VVP) build/tests/gfx_pcrtc_fast_snapshot.vvp +PHASE=$$phase || exit 1; done > $@ || { cat $@; exit 1; }
	@$(VVP) build/tests/gfx_pcrtc_fast_snapshot_stop.vvp >> $@ || { cat $@; exit 1; }
$(REPORTS)/gfx-pcrtc-fast-snapshot-synthesis.txt $(EXPORTS)/rtl/gfx_pcrtc_fast_snapshot.json &: $(GFX_FAST_SNAPSHOT_RTL)
	@mkdir -p $(REPORTS) $(EXPORTS)/rtl
	$(YOSYS) -l $(REPORTS)/gfx-pcrtc-fast-snapshot-synthesis.txt -p 'read_verilog -sv $^; hierarchy -check -top gfx_pcrtc_fast_snapshot; proc; opt; memory_collect; check -assert; stat; write_json $(EXPORTS)/rtl/gfx_pcrtc_fast_snapshot.json' > /dev/null
.PHONY: check-gfx-pcrtc-fast-snapshot
check-gfx-pcrtc-fast-snapshot: $(REPORTS)/gfx-pcrtc-fast-snapshot.txt $(REPORTS)/gfx-pcrtc-fast-snapshot-synthesis.txt $(EXPORTS)/rtl/gfx_pcrtc_fast_snapshot.json

# Candidate 54 MHz-to-pixel sampling checkpoint; beam/DAC timing remains open.
build/tests/gfx_pcrtc_sample_checkpoint.vvp: rtl/gfx_pcrtc_sample_checkpoint.sv tests/gfx_pcrtc_sample_checkpoint_tb.sv
	@mkdir -p $(@D)
	$(IVERILOG) $(IVERILOG_FLAGS) -g2012 -Wall -s gfx_pcrtc_sample_checkpoint_tb -o $@ $^
$(REPORTS)/gfx-pcrtc-sample-checkpoint.txt: build/tests/gfx_pcrtc_sample_checkpoint.vvp
	@mkdir -p $(REPORTS)
	$(VVP) $< > $@ || { cat $@; exit 1; }
.PHONY: check-gfx-pcrtc-sample-checkpoint
check-gfx-pcrtc-sample-checkpoint: $(REPORTS)/gfx-pcrtc-sample-checkpoint.txt

# Actual PLAY/control, local binder, timed SRAM pins and serial DAC path.
# One PCM case; no claim for all formats, traffic or workloads.
build/tests/apu_control_serial.vvp: $(APU_CONTROL_INTEGRATION_RTL) $(APU_PLAYBACK_FRAME_RTL) rtl/apu_play_start.sv rtl/apu_voice_rate.sv rtl/apu_source_bind.sv rtl/apu_sample_store.sv rtl/async_sram.sv rtl/apu_serial_output.sv rtl/apu_i2s_tx.sv tests/issi_bll_model.sv tests/apu_control_sample_bind_tb.sv
	@mkdir -p $(@D)
	$(IVERILOG) $(IVERILOG_FLAGS) -g2012 -Wall -DAPU_FULL_SERIAL_TEST -s apu_control_sample_bind_tb -o $@ $^
$(REPORTS)/apu-control-serial.txt: build/tests/apu_control_serial.vvp
	@mkdir -p $(REPORTS)
	$(VVP) $< > $@ || { cat $@; exit 1; }
.PHONY: check-apu-control-serial
check-apu-control-serial: $(REPORTS)/apu-control-serial.txt

build/tests/gfx_pcrtc_checkpoint_integration.vvp: $(GFX_FAST_SNAPSHOT_RTL) rtl/gfx_pcrtc_sample_checkpoint.sv tests/gfx_pcrtc_checkpoint_integration_tb.sv
	@mkdir -p $(@D)
	$(IVERILOG) $(IVERILOG_FLAGS) -g2012 -Wall -s gfx_pcrtc_checkpoint_integration_tb -o $@ $^
$(REPORTS)/gfx-pcrtc-checkpoint-integration.txt: build/tests/gfx_pcrtc_checkpoint_integration.vvp
	@mkdir -p $(REPORTS)
	@for phase in 0 9000 17777 29523; do $(VVP) $< +PHASE=$$phase || exit 1; done > $@ || { cat $@; exit 1; }
check-gfx-pcrtc-sample-checkpoint: $(REPORTS)/gfx-pcrtc-checkpoint-integration.txt
$(REPORTS)/gfx-pcrtc-sample-checkpoint-synthesis.txt $(EXPORTS)/rtl/gfx_pcrtc_sample_checkpoint.json &: rtl/gfx_pcrtc_sample_checkpoint.sv
	@mkdir -p $(REPORTS) $(EXPORTS)/rtl
	$(YOSYS) -l $(REPORTS)/gfx-pcrtc-sample-checkpoint-synthesis.txt -p 'read_verilog -sv $^; hierarchy -check -top gfx_pcrtc_sample_checkpoint; proc; opt; memory_collect; check -assert; stat; write_json $(EXPORTS)/rtl/gfx_pcrtc_sample_checkpoint.json' > /dev/null
check-gfx-pcrtc-sample-checkpoint: $(REPORTS)/gfx-pcrtc-sample-checkpoint-synthesis.txt $(EXPORTS)/rtl/gfx_pcrtc_sample_checkpoint.json

# SYS bus and the control owner's single command ingress through one mono PCM
# voice to serial output. Sample initialization is direct; DMA, ROM, centralized
# IRQ, analog output and general multi-voice deadlines are outside this test.
build/tests/apu_sys_control_serial.vvp: rtl/system_bus_master.sv rtl/apu_command_sys_endpoint.sv rtl/apu_sys_control.sv $(APU_CONTROL_INTEGRATION_RTL) $(APU_PLAYBACK_FRAME_RTL) rtl/apu_play_start.sv rtl/apu_voice_rate.sv rtl/apu_source_bind.sv rtl/apu_sample_store.sv rtl/async_sram.sv rtl/apu_serial_output.sv rtl/apu_i2s_tx.sv tests/issi_bll_model.sv tests/apu_control_sample_bind_tb.sv
	@mkdir -p $(@D)
	$(IVERILOG) $(IVERILOG_FLAGS) -g2012 -Wall -DAPU_FULL_SERIAL_TEST -DAPU_SYS_SERIAL_TEST -s apu_control_sample_bind_tb -o $@ $^
$(REPORTS)/apu-sys-control-serial.txt: build/tests/apu_sys_control_serial.vvp
	@mkdir -p $(REPORTS)
	$(VVP) $< > $@ || { cat $@; exit 1; }
.PHONY: check-apu-sys-control-serial
check-apu-sys-control-serial: $(REPORTS)/apu-sys-control-serial.txt

# CPU-side register and DATA owner around the real physical batch stream.
# DMA block transactions, supervisor quiescence and cycle conformance remain open.
IMGDEC_CPU_DEVICE_RTL = rtl/imgdec_payload.sv rtl/imgdec_stream.sv rtl/imgdec_output_fifo.sv rtl/imgdec_stream_batched.sv rtl/imgdec_cpu_device.sv
build/tests/imgdec_cpu_device.vvp: $(IMGDEC_CPU_DEVICE_RTL) tests/imgdec_cpu_device_tb.sv
	@mkdir -p $(@D)
	$(IVERILOG) $(IVERILOG_FLAGS) -g2012 -Wall -s imgdec_cpu_device_tb -o $@ $^
$(REPORTS)/imgdec-cpu-device.txt: build/tests/imgdec_cpu_device.vvp
	@mkdir -p $(REPORTS)
	$(VVP) $< > $@ || { cat $@; exit 1; }
$(REPORTS)/imgdec-cpu-device-synthesis.txt $(EXPORTS)/rtl/imgdec_cpu_device.json &: $(IMGDEC_CPU_DEVICE_RTL)
	@mkdir -p $(REPORTS) $(EXPORTS)/rtl
	$(YOSYS) -l $(REPORTS)/imgdec-cpu-device-synthesis.txt -p 'read_verilog -sv $^; hierarchy -check -top imgdec_cpu_device; proc; opt; memory_collect; check -assert; stat; write_json $(EXPORTS)/rtl/imgdec_cpu_device.json' > /dev/null
.PHONY: check-imgdec-cpu-device
check-imgdec-cpu-device: $(REPORTS)/imgdec-cpu-device.txt $(REPORTS)/imgdec-cpu-device-synthesis.txt $(EXPORTS)/rtl/imgdec_cpu_device.json

# Candidate private native code flash, sharing guest-ROM address/data pins.
build/tests/rom_program_pair.vvp: rtl/system_bus_master.sv rtl/rom_sys_endpoint.sv rtl/rom_program_pair_candidate.sv tests/rom_program_pair_tb.sv
	@mkdir -p $(@D)
	$(IVERILOG) $(IVERILOG_FLAGS) -g2012 -Wall -s rom_program_pair_tb -o $@ $^
$(REPORTS)/rom-program-pair.txt: build/tests/rom_program_pair.vvp
	@mkdir -p $(REPORTS)
	$(VVP) $< > $@ || { cat $@; exit 1; }
.PHONY: check-rom-program-pair
check-rom-program-pair: $(REPORTS)/rom-program-pair.txt
$(REPORTS)/rom-program-pair-synthesis.txt $(EXPORTS)/rtl/rom_program_pair_candidate.json &: rtl/rom_sys_endpoint.sv rtl/rom_program_pair_candidate.sv
	@mkdir -p $(REPORTS) $(EXPORTS)/rtl
	$(YOSYS) -l $(REPORTS)/rom-program-pair-synthesis.txt -p 'read_verilog -sv $^; hierarchy -check -top rom_program_pair_candidate; proc; opt; memory_collect; check -assert; stat; write_json $(EXPORTS)/rtl/rom_program_pair_candidate.json' > /dev/null
check-rom-program-pair: $(REPORTS)/rom-program-pair-synthesis.txt $(EXPORTS)/rtl/rom_program_pair_candidate.json

# Ordered 54 MHz snapshot -> display beam -> coherent 4:1 sample candidate.
GFX_FAST_BEAM_RTL = rtl/gfx_pcrtc_beam_phase.sv rtl/gfx_pcrtc_fast_beam.sv
build/tests/gfx_pcrtc_fast_beam.vvp: $(GFX_FAST_BEAM_RTL) tests/gfx_pcrtc_fast_beam_tb.sv
	@mkdir -p $(@D)
	$(IVERILOG) $(IVERILOG_FLAGS) -g2012 -Wall -s gfx_pcrtc_fast_beam_tb -o $@ $^
$(REPORTS)/gfx-pcrtc-fast-beam.txt: build/tests/gfx_pcrtc_fast_beam.vvp
	@mkdir -p $(REPORTS)
	$(VVP) $< > $@ || { cat $@; exit 1; }
$(REPORTS)/gfx-pcrtc-fast-beam-synthesis.txt $(EXPORTS)/rtl/gfx_pcrtc_fast_beam.json &: $(GFX_FAST_BEAM_RTL)
	@mkdir -p $(REPORTS) $(EXPORTS)/rtl
	$(YOSYS) -l $(REPORTS)/gfx-pcrtc-fast-beam-synthesis.txt -p 'read_verilog -sv $^; hierarchy -check -top gfx_pcrtc_fast_beam; proc; opt; memory_collect; check -assert; stat; write_json $(EXPORTS)/rtl/gfx_pcrtc_fast_beam.json' > /dev/null
.PHONY: check-gfx-pcrtc-fast-beam
check-gfx-pcrtc-fast-beam: $(REPORTS)/gfx-pcrtc-fast-beam.txt $(REPORTS)/gfx-pcrtc-fast-beam-synthesis.txt $(EXPORTS)/rtl/gfx_pcrtc_fast_beam.json

$(REPORTS)/apu-sys-control-synthesis.txt $(EXPORTS)/rtl/apu_sys_control.json &: rtl/apu_command_sys_endpoint.sv rtl/apu_sys_control.sv $(APU_CONTROL_INTEGRATION_RTL)
	@mkdir -p $(REPORTS) $(EXPORTS)/rtl
	$(YOSYS) -l $(REPORTS)/apu-sys-control-synthesis.txt -p 'read_verilog -sv $^; hierarchy -check -top apu_sys_control; proc; opt; check -assert; stat; write_json $(EXPORTS)/rtl/apu_sys_control.json' > /dev/null
check-apu-sys-control-serial: $(REPORTS)/apu-sys-control-synthesis.txt $(EXPORTS)/rtl/apu_sys_control.json

build/tests/gfx_pcrtc_fast_beam_integration.vvp: $(GFX_FAST_SNAPSHOT_RTL) rtl/gfx_pcrtc_fast_beam.sv tests/gfx_pcrtc_fast_beam_integration_tb.sv
	@mkdir -p $(@D)
	$(IVERILOG) $(IVERILOG_FLAGS) -g2012 -Wall -s gfx_pcrtc_fast_beam_integration_tb -o $@ $^
$(REPORTS)/gfx-pcrtc-fast-beam-integration.txt: build/tests/gfx_pcrtc_fast_beam_integration.vvp
	@mkdir -p $(REPORTS)
	@for phase in 0 9000 17777 29523; do $(VVP) $< +PHASE=$$phase || exit 1; done > $@ || { cat $@; exit 1; }
check-gfx-pcrtc-fast-beam: $(REPORTS)/gfx-pcrtc-fast-beam-integration.txt

build/tests/apu_sys_control.vvp: rtl/system_bus_master.sv rtl/apu_command_sys_endpoint.sv rtl/apu_sys_control.sv $(APU_CONTROL_INTEGRATION_RTL) tests/apu_sys_control_tb.sv
	@mkdir -p $(@D)
	$(IVERILOG) $(IVERILOG_FLAGS) -g2012 -Wall -s apu_sys_control_tb -o $@ $^
$(REPORTS)/apu-sys-control.txt: build/tests/apu_sys_control.vvp
	@mkdir -p $(REPORTS)
	$(VVP) $< > $@ || { cat $@; exit 1; }
check-apu-sys-control-serial: $(REPORTS)/apu-sys-control.txt
build/tests/gfx_pcrtc_fast_beam_ratio.vvp: rtl/gfx_pcrtc_beam_phase.sv tests/gfx_pcrtc_fast_beam_ratio_tb.sv
	@mkdir -p $(@D)
	$(IVERILOG) $(IVERILOG_FLAGS) -g2012 -Wall -s gfx_pcrtc_fast_beam_ratio_tb -o $@ $^
$(REPORTS)/gfx-pcrtc-fast-beam-ratio.txt: build/tests/gfx_pcrtc_fast_beam_ratio.vvp
	@mkdir -p $(REPORTS)
	$(VVP) $< > $@ || { cat $@; exit 1; }
check-gfx-pcrtc-fast-beam: $(REPORTS)/gfx-pcrtc-fast-beam-ratio.txt

# IMGDEC protocol boundary: a detected stream fault immediately withdraws new
# DATA requests before the register owner latches FORMAT_FAULT and IRQ.
build/tests/imgdec_cpu_fault_race.vvp: $(IMGDEC_CPU_DEVICE_RTL) tests/imgdec_cpu_fault_race_tb.sv
	@mkdir -p $(@D)
	$(IVERILOG) $(IVERILOG_FLAGS) -g2012 -Wall -s imgdec_cpu_fault_race_tb -o $@ $^
$(REPORTS)/imgdec-cpu-fault-race.txt: build/tests/imgdec_cpu_fault_race.vvp
	@mkdir -p $(REPORTS)
	$(VVP) $< > $@ || { cat $@; exit 1; }
.PHONY: check-imgdec-cpu-fault-race
check-imgdec-cpu-fault-race: $(REPORTS)/imgdec-cpu-fault-race.txt

# PCRTC control exports the beam's two ordered event representations for INPUT.
build/tests/gfx_pcrtc_control_input_events.vvp: rtl/gfx_pcrtc_beam_phase.sv rtl/gfx_pcrtc_system_beam.sv rtl/gfx_pcrtc_status.sv rtl/display_context_gfx.sv rtl/gfx_pcrtc_control.sv tests/gfx_pcrtc_control_input_events_tb.sv
	@mkdir -p $(@D)
	$(IVERILOG) $(IVERILOG_FLAGS) -g2012 -Wall -s gfx_pcrtc_control_input_events_tb -o $@ $^
$(REPORTS)/gfx-pcrtc-control-input-events.txt: build/tests/gfx_pcrtc_control_input_events.vvp build/tests/gfx-pcrtc-system-beam-vectors.txt build/tests/gfx-pcrtc-display-latch-vectors.txt
	@mkdir -p $(REPORTS)
	$(VVP) $< > $@ || { cat $@; exit 1; }
.PHONY: check-gfx-pcrtc-control-input-events
check-gfx-pcrtc-control-input-events: $(REPORTS)/gfx-pcrtc-control-input-events.txt

build/tests/io_context_pad_boundary.vvp: $(U7_RTL) rtl/display_context_tx.sv rtl/pad_accessory.sv tests/io_context_pad_boundary_tb.sv
	@mkdir -p $(@D)
	$(IVERILOG) $(IVERILOG_FLAGS) -g2012 -Wall -s io_context_pad_boundary_tb -o $@ $^
$(REPORTS)/io-context-pad-boundary.txt: build/tests/io_context_pad_boundary.vvp
	@mkdir -p $(REPORTS)
	$(VVP) $< > $@ || { cat $@; exit 1; }
.PHONY: check-io-context-pad-boundary
check-io-context-pad-boundary: $(REPORTS)/io-context-pad-boundary.txt

build/tests/gfx_context_to_pad.vvp: $(IO_RTL) rtl/pad_accessory.sv rtl/gfx_pcrtc_beam_phase.sv rtl/gfx_pcrtc_system_beam.sv rtl/gfx_pcrtc_status.sv rtl/display_context_gfx.sv rtl/gfx_pcrtc_control.sv tests/gfx_context_to_pad_tb.sv
	@mkdir -p $(@D)
	$(IVERILOG) $(IVERILOG_FLAGS) -g2012 -Wall -s gfx_context_to_pad_tb -o $@ $^
$(REPORTS)/gfx-context-to-pad.txt: build/tests/gfx_context_to_pad.vvp
	@mkdir -p $(REPORTS)
	$(VVP) $< > $@ || { cat $@; exit 1; }
.PHONY: check-gfx-context-to-pad
check-gfx-context-to-pad: $(REPORTS)/gfx-context-to-pad.txt

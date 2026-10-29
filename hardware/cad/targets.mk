# Each owner produces its own native geometry/report. BRep intermediates are
# owned by that same rule; removing build output is done with make clean.
GEOMETRY = cad/geometry.py
POLARISATION = cad/cartridge_polarisation.py design/cartridge_polarisation.json
FIXTURES = cad/fixtures.py cad/fasteners.py $(GEOMETRY)
MAIN_MODELS = models/mainboard/manifest.json $(wildcard models/mainboard/*.brep)
CARD_MODELS = models/cartridge/manifest.json $(wildcard models/cartridge/*.brep)
FRAME_MODELS = models/frame/manifest.json models/frame/frame_finish.json models/frame/frame_fasteners.json $(wildcard models/frame/*.brep)
FRONT_MODELS = models/front/manifest.json $(wildcard models/front/*.brep)
REAR_MODELS = models/rear/manifest.json models/rear/mating.json $(wildcard models/rear/*.brep)

$(REPORTS)/mainboard.json: tools/mainboard.py $(MAINBOARD).kicad_pcb
	$(KICAD_PYTHON) tools/mainboard.py
$(REPORTS)/compact-main-scene.json $(EXPORTS)/BMSX_COMPACT_components.step &: cad/compact_main_scene.py $(GEOMETRY) $(MAIN_MODELS) $(REPORTS)/mainboard.json
	$(CAD) cad/compact_main_scene.py
$(REPORTS)/compact-board-body.json $(EXPORTS)/BMSX_COMPACT_board_assembly.step &: cad/compact_board_body.py cad/board_model.py $(REPORTS)/mainboard.json design/packaging_outline.json $(EXPORTS)/BMSX_COMPACT_board_native.step
	$(CAD) cad/compact_board_body.py
$(REPORTS)/compact-cartridge-bank.json $(EXPORTS)/compact_cartridge_bank.step &: cad/compact_cartridge_bank.py design/compact_cartridge_bank.json design/enclosure_appearance.json $(CARD_MODELS) $(POLARISATION)
	$(CAD) cad/compact_cartridge_bank.py
$(REPORTS)/compact-packaging-fit.json: cad/compact_packaging_fit.py $(GEOMETRY) design/enclosure_cooling.json $(REPORTS)/mainboard.json $(REPORTS)/compact-main-scene.json $(REPORTS)/compact-board-body.json $(REPORTS)/compact-cartridge-bank.json
	$(CAD) cad/compact_packaging_fit.py
$(REPORTS)/compact-front-io.json $(EXPORTS)/BMSX_COMPACT_front_io.step &: cad/compact_front_io.py cad/board_model.py $(FIXTURES) design/enclosure_front_io.json $(FRONT_MODELS) $(EXPORTS)/BMSX_FRONT_board_native.step $(REPORTS)/compact-main-scene.json
	$(CAD) cad/compact_front_io.py
$(REPORTS)/rear-mate-datums.json: cad/rear_mate_datums.py $(REPORTS)/mainboard.json models/rear/mating.json
	$(PYTHON) cad/rear_mate_datums.py
$(REPORTS)/compact-rear-io.json $(EXPORTS)/BMSX_COMPACT_rear_io.step &: cad/compact_rear_io.py cad/rear_components.py cad/board_model.py $(FIXTURES) design/enclosure_rear_io.json $(REAR_MODELS) ecad/av/board.json ecad/scart/board.json models/scart/K-SCART-021.json $(EXPORTS)/BMSX_AV_BREAKOUT_board_native.step $(EXPORTS)/BMSX_SCART_TERM_board_native.step $(REPORTS)/rear-mate-datums.json
	$(CAD) cad/compact_rear_io.py
$(REPORTS)/compact-rear-main-clearance.json: cad/check_rear_main.py $(GEOMETRY) $(REPORTS)/compact-rear-io.json $(REPORTS)/compact-main-scene.json
	$(CAD) cad/check_rear_main.py
.PHONY: check-rear-incremental
check-rear-incremental:
	$(PYTHON) tests/rear_cad_incremental.py
.PHONY: check-pad-loom-candidate
check-pad-loom-candidate:
	$(CAD) cad/pad_loom_candidate.py
.PHONY: check-rear-main-collision
check-rear-main-collision: $(REPORTS)/compact-rear-io.json
	$(CAD) tests/rear_main_collision.py
.PHONY: check-dc-carrier
$(REPORTS)/dc-carrier.json $(EXPORTS)/BMSX_DC_carrier.step &: cad/check_dc_carrier.py cad/rear_components.py $(FIXTURES) design/enclosure_rear_io.json $(REAR_MODELS)
	$(CAD) cad/check_dc_carrier.py
check-dc-carrier: $(REPORTS)/dc-carrier.json $(EXPORTS)/BMSX_DC_carrier.step
cad-native: $(EXPORTS)/BMSX_DC_carrier.step
check-cad: $(REPORTS)/dc-carrier.json
$(REPORTS)/compact-controls.json $(EXPORTS)/BMSX_COMPACT_controls.step &: cad/compact_controls.py cad/control_components.py $(FIXTURES) design/enclosure_controls.json design/enclosure_controls_fasteners.json models/controls/references.json
	$(CAD) cad/compact_controls.py
$(REPORTS)/compact-cartridge-frame.json $(EXPORTS)/BMSX_COMPACT_cartridge_frame.step &: cad/compact_cartridge_frame.py $(FIXTURES) design/enclosure_cartridge_frame.json $(FRAME_MODELS) $(CARD_MODELS) $(POLARISATION) $(REPORTS)/compact-main-scene.json
	$(CAD) cad/compact_cartridge_frame.py
$(REPORTS)/compact-cooling.json $(EXPORTS)/BMSX_COMPACT_cooling.step &: cad/compact_cooling.py $(FIXTURES) design/enclosure_cooling.json $(REPORTS)/compact-main-scene.json
	$(CAD) cad/compact_cooling.py
$(REPORTS)/compact-cartridge-flaps.json $(EXPORTS)/BMSX_CARTRIDGE_KLEPPEN_closed.step $(EXPORTS)/BMSX_CARTRIDGE_KLEPPEN_insertion.step $(EXPORTS)/BMSX_CARTRIDGE_KLEPPEN_seated.step &: cad/compact_cartridge_flaps.py cad/cartridge_return_spring.py $(GEOMETRY) design/cartridge_flaps.json design/enclosure_cartridge_frame.json $(CARD_MODELS) $(POLARISATION)
	$(CAD) cad/compact_cartridge_flaps.py
STRUCTURE_CONFIG = $(addprefix design/,enclosure_structure.json enclosure_front_io.json enclosure_rear_io.json enclosure_controls.json enclosure_cartridge_frame.json enclosure_cooling.json enclosure_styling.json enclosure_appearance.json)
$(REPORTS)/compact-structure.json $(EXPORTS)/BMSX_COMPACT_structure.step &: cad/compact_structure.py cad/case_closure.py cad/enclosure_style.py $(FIXTURES) $(STRUCTURE_CONFIG) $(POLARISATION) $(REPORTS)/compact-front-io.json $(REPORTS)/compact-rear-io.json $(REPORTS)/compact-controls.json $(REPORTS)/compact-cartridge-flaps.json
	$(CAD) cad/compact_structure.py
ASSEMBLY_MODULES = main-scene board-body packaging-fit front-io rear-io controls cartridge-frame cooling structure cartridge-flaps
$(REPORTS)/compact-assembly.json: cad/compact_assembly.py cad/check_cartridge_flaps.py $(GEOMETRY) $(POLARISATION) $(REPORTS)/compact-rear-main-clearance.json $(addprefix $(REPORTS)/compact-,$(addsuffix .json,$(ASSEMBLY_MODULES)))
	$(CAD) cad/compact_assembly.py
$(REPORTS)/cartridge-flaps-interfaces.json: cad/check_cartridge_flaps.py $(GEOMETRY) $(REPORTS)/compact-assembly.json $(REPORTS)/compact-cartridge-flaps.json
	$(CAD) cad/check_cartridge_flaps.py
$(REPORTS)/cartridge-edge-contact.json: cad/check_cartridge_edge_contact.py design/cartridge_flaps.json $(REPORTS)/mainboard.json $(REPORTS)/compact-cartridge-bank.json $(REPORTS)/compact-cartridge-flaps.json
	$(CAD) cad/check_cartridge_edge_contact.py
.PHONY: check-cartridge-edge-contact
check-cartridge-edge-contact: $(REPORTS)/cartridge-edge-contact.json
.PHONY: cartridge-protective-skirt-concept
cartridge-protective-skirt-concept:
	$(CAD) cad/cartridge_leading_skirt.py
.PHONY: cartridge-msx-skirt-concept
cartridge-msx-skirt-concept:
	$(CAD) cad/cartridge_leading_skirt.py --msx-style

.PHONY: cartridge-reference-image
cartridge-reference-image:
	EGL_PLATFORM=surfaceless $(CAD) cad/render_cartridge_editions.py --reference
$(REPORTS)/cartridge-polarisation.json $(EXPORTS)/BMSX_CARTRIDGE_POLARISATION.step $(EXPORTS)/BMSX_CARTRIDGE_POLARISATION_DETAIL.step &: cad/check_cartridge_polarisation.py $(GEOMETRY) $(POLARISATION) $(REPORTS)/compact-cartridge-bank.json $(REPORTS)/compact-cartridge-frame.json $(REPORTS)/compact-cartridge-flaps.json $(REPORTS)/compact-structure.json
	$(CAD) cad/check_cartridge_polarisation.py
$(REPORTS)/console-exchange.json $(EXPORTS)/BMSX_COMPACT_console.step &: cad/export_console.py cad/enclosure_style.py $(GEOMETRY) design/enclosure_appearance.json $(REPORTS)/compact-assembly.json
	$(CAD) cad/export_console.py
$(REPORTS)/compact-parts-export.json: cad/export_compact_parts.py $(REPORTS)/compact-structure.json
	$(CAD) cad/export_compact_parts.py
.PHONY: cad-native check-cad render publication
cad-native: $(EXPORTS)/BMSX_COMPACT_console.step $(REPORTS)/compact-parts-export.json $(EXPORTS)/BMSX_CARTRIDGE_POLARISATION.step
check-cad: check-rear-incremental check-rear-main-collision $(REPORTS)/compact-assembly.json $(REPORTS)/cartridge-flaps-interfaces.json $(REPORTS)/cartridge-polarisation.json
$(REPORTS)/console-render.json: cad/render_console.py cad/rendering.py $(GEOMETRY) design/enclosure_appearance.json $(REPORTS)/compact-assembly.json $(REPORTS)/compact-cartridge-flaps.json
	EGL_PLATFORM=surfaceless $(CAD) cad/render_console.py
$(REPORTS)/board-render.json: cad/render_board.py cad/rendering.py $(REPORTS)/compact-main-scene.json $(REPORTS)/compact-board-body.json $(REPORTS)/compact-packaging-fit.json
	EGL_PLATFORM=surfaceless $(CAD) cad/render_board.py --annotate
render: $(REPORTS)/console-render.json $(REPORTS)/board-render.json
PUBLICATION = build/publication
$(PUBLICATION)/exterior.png $(PUBLICATION)/cartridge-insertion.png $(PUBLICATION)/cartridge-doors.png $(PUBLICATION)/exterior-rear.png $(PUBLICATION)/exterior-underside.png &: cad/render_console.py cad/rendering.py $(GEOMETRY) design/enclosure_appearance.json $(REPORTS)/compact-assembly.json $(REPORTS)/compact-cartridge-flaps.json
	EGL_PLATFORM=surfaceless $(CAD) cad/render_console.py --publication-dir $(PUBLICATION)
$(PUBLICATION)/motherboard-top.png $(PUBLICATION)/motherboard-iso.png &: cad/render_board.py cad/rendering.py $(REPORTS)/compact-main-scene.json $(REPORTS)/compact-board-body.json $(REPORTS)/compact-packaging-fit.json
	EGL_PLATFORM=surfaceless $(CAD) cad/render_board.py --publication-dir $(PUBLICATION) --annotate
$(PUBLICATION)/motherboard-input-candidate-top.png $(REPORTS)/board-input-candidate-publication.json &: cad/render_board.py cad/rendering.py $(REPORTS)/compact-main-scene.json $(REPORTS)/compact-board-body.json $(REPORTS)/compact-packaging-fit.json $(REPORTS)/console-exchange-input-candidate.json $(REPORTS)/mainboard.json $(REPORTS)/mainboard-input-candidate.json ecad/mainboard/BMSX.kicad_pcb ecad/mainboard_input_candidate/BMSX.kicad_pcb
	EGL_PLATFORM=surfaceless $(CAD) cad/render_board.py --publication-dir $(PUBLICATION) --annotate --input-candidate
publication: $(PUBLICATION)/motherboard-input-candidate-top.png

$(REPORTS)/mainboard-passive-candidate.json: tools/mainboard.py ecad/mainboard_passive_candidate/BMSX.kicad_pcb
	@mkdir -p $(REPORTS)
	$(KICAD_PYTHON) tools/mainboard.py --board ecad/mainboard_passive_candidate/BMSX.kicad_pcb --output $@
$(PUBLICATION)/motherboard-passive-candidate-top.png $(REPORTS)/board-passive-candidate-publication.json &: cad/render_board.py cad/rendering.py $(REPORTS)/compact-main-scene.json $(REPORTS)/compact-board-body.json $(REPORTS)/compact-packaging-fit.json $(REPORTS)/console-exchange-input-candidate.json $(REPORTS)/mainboard.json $(REPORTS)/mainboard-input-candidate.json $(REPORTS)/mainboard-passive-candidate.json ecad/mainboard/BMSX.kicad_pcb ecad/mainboard_input_candidate/BMSX.kicad_pcb ecad/mainboard_passive_candidate/BMSX.kicad_pcb
	EGL_PLATFORM=surfaceless $(CAD) cad/render_board.py --publication-dir $(PUBLICATION) --annotate --passive-candidate
publication: $(PUBLICATION)/motherboard-passive-candidate-top.png
publication: $(PUBLICATION)/exterior-rear.png $(PUBLICATION)/exterior-underside.png $(PUBLICATION)/exterior.png $(PUBLICATION)/cartridge-insertion.png $(PUBLICATION)/cartridge-doors.png $(PUBLICATION)/motherboard-top.png $(PUBLICATION)/motherboard-iso.png
$(PUBLICATION)/cartridge-polarisation.png $(REPORTS)/polarisation-publication.json &: cad/render_cartridge_polarisation.py cad/rendering.py $(EXPORTS)/BMSX_CARTRIDGE_POLARISATION_DETAIL.step $(REPORTS)/cartridge-polarisation.json
	EGL_PLATFORM=surfaceless $(CAD) cad/render_cartridge_polarisation.py
publication: $(PUBLICATION)/cartridge-polarisation.png

$(PUBLICATION)/cartridge-editions-native.png $(REPORTS)/cartridge-editions-publication.json &: cad/render_cartridge_editions.py cad/rendering.py design/enclosure_appearance.json $(REPORTS)/compact-cartridge-bank.json reference/accessories-a04/research/game_art/pietsona_title.png reference/accessories-a04/research/game_art/pietious_title.png
	EGL_PLATFORM=surfaceless $(CAD) cad/render_cartridge_editions.py
publication: $(PUBLICATION)/cartridge-editions-native.png

$(PUBLICATION)/cartridge-door-operation.png: ../docs/book4/figures/cartridge-door-operation.svg
	@mkdir -p $(@D)
	rsvg-convert -w 1500 $< -o $@
publication: $(PUBLICATION)/cartridge-door-operation.png

# Native raster preview of the authored vector drawing; no CAD regeneration.
$(PUBLICATION)/core-internal.png: ../docs/book4/figures/core-internal.svg
	@mkdir -p $(@D)
	rsvg-convert -w 1520 $< -o $@
publication: $(PUBLICATION)/core-internal.png

$(PUBLICATION)/gte-datapath.png: ../docs/book4/figures/gte-datapath.svg
	@mkdir -p $(@D)
	rsvg-convert -w 1600 $< -o $@
publication: $(PUBLICATION)/gte-datapath.png

$(PUBLICATION)/geo-job-datapath.png: ../docs/book4/figures/geo-job-datapath.svg
	@mkdir -p $(@D)
	rsvg-convert -w 1600 $< -o $@
publication: $(PUBLICATION)/geo-job-datapath.png

$(PUBLICATION)/gpu-raster-datapath.png: ../docs/book4/figures/gpu-raster-datapath.svg
	@mkdir -p $(@D)
	rsvg-convert -w 1700 $< -o $@
publication: $(PUBLICATION)/gpu-raster-datapath.png

$(PUBLICATION)/imgdec-datapath.png: ../docs/book4/figures/imgdec-datapath.svg
	@mkdir -p $(@D)
	rsvg-convert -w 1500 $< -o $@
publication: $(PUBLICATION)/imgdec-datapath.png

$(PUBLICATION)/apu-signal-path.png: ../docs/book4/figures/apu-signal-path.svg
	@mkdir -p $(@D)
	rsvg-convert -w 1320 $< -o $@
publication: $(PUBLICATION)/apu-signal-path.png

$(PUBLICATION)/apu-command-path.png: ../docs/book4/figures/apu-command-path.svg
	@mkdir -p $(@D)
	rsvg-convert -w 1600 $< -o $@
publication: $(PUBLICATION)/apu-command-path.png

$(PUBLICATION)/video-signal-path.png: ../docs/book4/figures/video-signal-path.svg
	@mkdir -p $(@D)
	rsvg-convert -w 1320 $< -o $@
publication: $(PUBLICATION)/video-signal-path.png

$(PUBLICATION)/video-pipeline-proposal.png: ../docs/book4/figures/video-pipeline-proposal.svg
	@mkdir -p $(@D)
	rsvg-convert -w 1500 $< -o $@
publication: $(PUBLICATION)/video-pipeline-proposal.png

$(PUBLICATION)/gfx-drawing-path.png: ../docs/book4/figures/gfx-drawing-path.svg
	@mkdir -p $(@D)
	rsvg-convert -w 1440 $< -o $@
publication: $(PUBLICATION)/gfx-drawing-path.png

$(PUBLICATION)/io-rom-datapaths.png: ../docs/book4/figures/io-rom-datapaths.svg
	@mkdir -p $(@D)
	rsvg-convert -w 1320 $< -o $@
publication: $(PUBLICATION)/io-rom-datapaths.png

$(PUBLICATION)/supervisor-sources-proposal.png: ../docs/book4/figures/supervisor-sources-proposal.svg
	@mkdir -p $(@D)
	rsvg-convert -w 1500 $< -o $@
publication: $(PUBLICATION)/supervisor-sources-proposal.png

$(PUBLICATION)/vblank-publication-proposal.png: ../docs/book4/figures/vblank-publication-proposal.svg
	@mkdir -p $(@D)
	rsvg-convert -w 1500 $< -o $@
publication: $(PUBLICATION)/vblank-publication-proposal.png

$(PUBLICATION)/gfx-input-integration-proposal.png: ../docs/book4/figures/gfx-input-integration-proposal.svg
	@mkdir -p $(@D)
	rsvg-convert -w 1500 $< -o $@
publication: $(PUBLICATION)/gfx-input-integration-proposal.png

$(PUBLICATION)/memory-datapaths.png: ../docs/book4/figures/memory-datapaths.svg
	@mkdir -p $(@D)
	rsvg-convert -w 1420 $< -o $@
publication: $(PUBLICATION)/memory-datapaths.png

$(PUBLICATION)/memory-arbitration.png: ../docs/book4/figures/memory-arbitration.svg
	@mkdir -p $(@D)
	rsvg-convert -w 1440 $< -o $@
publication: $(PUBLICATION)/memory-arbitration.png

$(PUBLICATION)/apu-service-envelope.png: ../docs/book4/figures/apu-service-envelope.svg
	@mkdir -p $(@D)
	rsvg-convert -w 1400 $< -o $@
publication: $(PUBLICATION)/apu-service-envelope.png

$(PUBLICATION)/native-program-store.png: ../docs/book4/figures/native-program-store.svg
	@mkdir -p $(@D)
	rsvg-convert -w 1250 $< -o $@
publication: $(PUBLICATION)/native-program-store.png

$(PUBLICATION)/native-cpu-execution-proposal.png: ../docs/book4/figures/native-cpu-execution-proposal.svg
	@mkdir -p $(@D)
	rsvg-convert -w 1600 $< -o $@
publication: $(PUBLICATION)/native-cpu-execution-proposal.png

$(PUBLICATION)/runtime-memory-baseline.png: ../docs/book4/figures/runtime-memory-baseline.svg
	@mkdir -p $(@D)
	rsvg-convert -w 1600 $< -o $@
publication: $(PUBLICATION)/runtime-memory-baseline.png

$(PUBLICATION)/console-connections.png: ../docs/book4/figures/console-connections.svg
	@mkdir -p $(@D)
	rsvg-convert -w 1500 $< -o $@
publication: $(PUBLICATION)/console-connections.png

$(PUBLICATION)/console-connection-setup.png: ../docs/book4/figures/console-connection-setup.svg
	@mkdir -p $(@D)
	rsvg-convert -w 1500 $< -o $@
publication: $(PUBLICATION)/console-connection-setup.png

$(PUBLICATION)/console-interior-labeled.png: ../docs/book4/figures/console-interior-labeled.svg ../docs/book4/figures/console-interior-passive-candidate.png
	@mkdir -p $(@D)
	rsvg-convert -w 1800 $< -o $@
publication: $(PUBLICATION)/console-interior-labeled.png

$(PUBLICATION)/console-interior-spreader-labeled.png: ../docs/book4/figures/console-interior-spreader-labeled.svg ../docs/book4/figures/console-interior-passive-spreader.png
	@mkdir -p $(@D)
	rsvg-convert -w 1800 $< -o $@
publication: $(PUBLICATION)/console-interior-spreader-labeled.png

# A separate exterior view uses the local keyboard-lip candidate without
# rebuilding the retained assembly or replacing the existing exterior image.
.PHONY: publication-exterior-keyboard-candidate
publication-exterior-keyboard-candidate:
	EGL_PLATFORM=surfaceless $(CAD) cad/render_console.py --view closed-keyboard --publication-dir $(PUBLICATION)

$(PUBLICATION)/mainboard-four-chip-placement.png: ../docs/book4/figures/mainboard-four-chip-placement.svg ../docs/book4/figures/motherboard-passive-candidate-top.png
	@mkdir -p $(@D)
	rsvg-convert -w 1500 $< -o $@
publication: $(PUBLICATION)/mainboard-four-chip-placement.png

$(PUBLICATION)/rear-connections-concept.png: ../docs/book4/figures/rear-connections-concept.svg
	@mkdir -p $(@D)
	rsvg-convert -w 1500 $< -o $@
publication: $(PUBLICATION)/rear-connections-concept.png

$(PUBLICATION)/pad-pointer-adapter-proposal.png: ../docs/book4/figures/pad-pointer-adapter-proposal.svg
	@mkdir -p $(@D)
	rsvg-convert -w 1600 $< -o $@
publication: $(PUBLICATION)/pad-pointer-adapter-proposal.png

$(PUBLICATION)/cartridge-rom-reference.png: ../docs/book4/figures/cartridge-rom-reference.svg
	@mkdir -p $(@D)
	rsvg-convert -w 1600 $< -o $@
publication: $(PUBLICATION)/cartridge-rom-reference.png

$(PUBLICATION)/pad-socket-contacts.png: ../docs/book4/figures/pad-socket-contacts.svg
	@mkdir -p $(@D)
	rsvg-convert -w 1000 $< -o $@
publication: $(PUBLICATION)/pad-socket-contacts.png

$(PUBLICATION)/keyboard-socket-contacts.png: ../docs/book4/figures/keyboard-socket-contacts.svg
	@mkdir -p $(@D)
	rsvg-convert -w 1000 $< -o $@
publication: $(PUBLICATION)/keyboard-socket-contacts.png

$(PUBLICATION)/reference-gamepad.png: ../docs/book4/figures/reference-gamepad.svg
	@mkdir -p $(@D)
	rsvg-convert -w 1500 $< -o $@
publication: $(PUBLICATION)/reference-gamepad.png

$(PUBLICATION)/reference-pointer.png: ../docs/book4/figures/reference-pointer.svg
	@mkdir -p $(@D)
	rsvg-convert -w 1200 $< -o $@
publication: $(PUBLICATION)/reference-pointer.png

$(PUBLICATION)/apu-channel-placement-proposal.png: ../docs/book4/figures/apu-channel-placement-proposal.svg
	@mkdir -p $(@D)
	rsvg-convert -w 1400 $< -o $@
publication: $(PUBLICATION)/apu-channel-placement-proposal.png

$(PUBLICATION)/geometry-image-flow.png: ../docs/book4/figures/geometry-image-flow.svg
	@mkdir -p $(@D)
	rsvg-convert -w 1500 $< -o $@
publication: $(PUBLICATION)/geometry-image-flow.png

# Non-destructive styling candidate: retains the complete reference bank.
$(REPORTS)/msx-cartridge-candidate.json $(EXPORTS)/BMSX_MSX_STYLE_cartridge_bank.step &: cad/msx_cartridge_candidate.py $(REPORTS)/compact-cartridge-bank.json design/enclosure_appearance.json
	$(CAD) cad/msx_cartridge_candidate.py
$(PUBLICATION)/cartridge-editions-msx-native.png $(REPORTS)/cartridge-editions-msx-publication.json &: cad/render_cartridge_editions.py cad/rendering.py design/enclosure_appearance.json $(REPORTS)/msx-cartridge-candidate.json reference/accessories-a04/research/game_art/pietsona_title.png reference/accessories-a04/research/game_art/pietious_title.png
	EGL_PLATFORM=surfaceless $(CAD) cad/render_cartridge_editions.py --msx-style

$(PUBLICATION)/cartridges-dual-seated.png $(REPORTS)/console-dual-publication.json &: cad/render_console.py cad/rendering.py $(GEOMETRY) design/enclosure_appearance.json design/cartridge_polarisation.json $(REPORTS)/compact-assembly.json $(REPORTS)/compact-cartridge-flaps.json $(REPORTS)/msx-cartridge-candidate.json
	EGL_PLATFORM=surfaceless $(CAD) cad/render_console.py --view dual --publication-dir $(PUBLICATION)

KEYBOARD_VIEW_INPUTS = $(EXPORTS)/BMSX_KEYBOARD_PANEL_CANDIDATE.step $(REPORTS)/keyboard-panel-candidate.json $(REPORTS)/console-exchange-passive-spreader-keyboard.json design/enclosure_styling.json cad/enclosure_style.py
$(PUBLICATION)/exterior-underside-keyboard-candidate.png $(REPORTS)/console-underside-keyboard-publication.json &: cad/render_console.py cad/rendering.py $(GEOMETRY) design/enclosure_appearance.json $(REPORTS)/compact-assembly.json $(REPORTS)/compact-cartridge-flaps.json $(KEYBOARD_VIEW_INPUTS)
	EGL_PLATFORM=surfaceless $(CAD) cad/render_console.py --view underside-keyboard --publication-dir $(PUBLICATION)

$(PUBLICATION)/cartridge-insertion-keyboard-candidate.png $(REPORTS)/console-insertion-keyboard-publication.json &: cad/render_console.py cad/rendering.py $(GEOMETRY) design/enclosure_appearance.json $(REPORTS)/compact-assembly.json $(REPORTS)/compact-cartridge-flaps.json $(KEYBOARD_VIEW_INPUTS)
	EGL_PLATFORM=surfaceless $(CAD) cad/render_console.py --view insertion-keyboard --publication-dir $(PUBLICATION)

$(PUBLICATION)/cartridges-dual-seated-keyboard-candidate.png $(REPORTS)/console-dual-keyboard-publication.json &: cad/render_console.py cad/rendering.py $(GEOMETRY) design/enclosure_appearance.json design/cartridge_polarisation.json $(REPORTS)/compact-assembly.json $(REPORTS)/compact-cartridge-flaps.json $(REPORTS)/msx-cartridge-candidate.json $(KEYBOARD_VIEW_INPUTS)
	EGL_PLATFORM=surfaceless $(CAD) cad/render_console.py --view dual-keyboard --publication-dir $(PUBLICATION)

$(PUBLICATION)/cartridges-dual-seated-reference.png $(REPORTS)/console-dual-reference-publication.json &: cad/render_console.py cad/rendering.py $(GEOMETRY) design/enclosure_appearance.json design/enclosure_styling.json cad/enclosure_style.py $(REPORTS)/compact-assembly.json $(REPORTS)/compact-cartridge-flaps.json $(REPORTS)/keyboard-panel-candidate.json $(REPORTS)/console-exchange-two-msx-skirt-cartridges.json $(EXPORTS)/BMSX_CONSOLE_TWO_MSX_SKIRT_CARTRIDGES_CONCEPT.step
	EGL_PLATFORM=surfaceless $(CAD) cad/render_console.py --view dual-reference --publication-dir $(PUBLICATION)

$(PUBLICATION)/console-interior-candidate.png $(REPORTS)/console-open-publication.json &: cad/render_console.py cad/rendering.py $(GEOMETRY) design/enclosure_appearance.json $(REPORTS)/compact-assembly.json $(REPORTS)/compact-cartridge-flaps.json $(REPORTS)/mainboard.json $(REPORTS)/console-exchange-input-candidate.json
	EGL_PLATFORM=surfaceless $(CAD) cad/render_console.py --view open --publication-dir $(PUBLICATION)

$(PUBLICATION)/console-interior-finned-concept.png $(REPORTS)/console-open-finned-publication.json &: cad/render_console.py cad/rendering.py $(GEOMETRY) design/enclosure_appearance.json design/enclosure_cooling.json design/cooling_presentation.json $(REPORTS)/compact-assembly.json $(REPORTS)/compact-cartridge-flaps.json $(REPORTS)/mainboard.json $(REPORTS)/console-exchange-input-candidate.json
	EGL_PLATFORM=surfaceless $(CAD) cad/render_console.py --view open-finned --publication-dir $(PUBLICATION)

$(PUBLICATION)/gfx-readback-snapshot.png: ../docs/book4/figures/gfx-readback-snapshot.svg
	@mkdir -p $(@D)
	rsvg-convert -w 1600 $< -o $@
publication: $(PUBLICATION)/gfx-readback-snapshot.png

$(PUBLICATION)/four-chip-system-candidate.png: ../docs/book4/figures/four-chip-system-candidate.svg
	@mkdir -p $(@D)
	rsvg-convert -w 1800 $< -o $@
publication: $(PUBLICATION)/four-chip-system-candidate.png

$(PUBLICATION)/system-functional-overview.png: ../docs/book4/figures/system-functional-overview.svg
	@mkdir -p $(@D)
	rsvg-convert -w 1600 $< -o $@
publication: $(PUBLICATION)/system-functional-overview.png

$(PUBLICATION)/core-table-datapath-proposal.png: ../docs/book4/figures/core-table-datapath-proposal.svg
	@mkdir -p $(@D)
	rsvg-convert -w 1650 $< -o $@
publication: $(PUBLICATION)/core-table-datapath-proposal.png

$(PUBLICATION)/memory-placement-blueprint.png: ../docs/book4/figures/memory-placement-blueprint.svg
	@mkdir -p $(@D)
	rsvg-convert -w 1600 $< -o $@
publication: $(PUBLICATION)/memory-placement-blueprint.png

$(PUBLICATION)/memory-placement-grouped.png: ../docs/book4/figures/memory-placement-grouped.svg
	@mkdir -p $(@D)
	rsvg-convert -w 1600 $< -o $@
publication: $(PUBLICATION)/memory-placement-grouped.png

# Candidate uses native PCB placement and retained background geometry; it does
# not replace the baseline console or imply a fresh whole-assembly check.
.PHONY: candidate-console
candidate-console:
	$(KICAD_PYTHON) tools/mainboard.py --board ecad/mainboard_input_candidate/BMSX.kicad_pcb --output $(REPORTS)/mainboard-input-candidate.json
	$(CAD) cad/export_console.py --input-candidate

$(PUBLICATION)/pad-plug-concept.png: ../docs/book4/figures/pad-plug-concept.svg
	@mkdir -p $(@D)
	rsvg-convert -w 1400 $< -o $@
publication: $(PUBLICATION)/pad-plug-concept.png

# Standalone nominal illustration; it does not replace the front socket owner.
.PHONY: pad-plug-concept
pad-plug-concept:
	$(CAD) cad/pad_plug_concept.py

.PHONY: pad-plug-contacts-concept
pad-plug-contacts-concept:
	$(CAD) cad/pad_plug_contacts_candidate.py

.PHONY: pad-plug-reinforced-nose-concept
pad-plug-reinforced-nose-concept:
	$(CAD) cad/pad_plug_contacts_candidate.py --reinforced-nose

.PHONY: keyboard-socket-face-illustration
keyboard-socket-face-illustration:
	$(CAD) cad/keyboard_socket_presentation.py

# Reuse the retained enclosure with the separately generated passive board.
.PHONY: passive-candidate-console
passive-candidate-console:
	$(KICAD_PYTHON) tools/mainboard.py --board ecad/mainboard_passive_candidate/BMSX.kicad_pcb --output $(REPORTS)/mainboard-passive-candidate.json
	$(CAD) cad/export_console.py --passive-candidate

# Keep the flat-spreader proposal separate from the retained passive export.
.PHONY: passive-spreader-console
passive-spreader-console: $(REPORTS)/mainboard-passive-candidate.json $(REPORTS)/passive-spreader-candidate.json $(EXPORTS)/BMSX_PASSIVE_SPREADER_CONCEPT.step
	$(CAD) cad/export_console.py --passive-spreader

# Combine two separate proposals against the same retained assembly; do not
# implicitly rebuild the complete assembly when generating this exchange.
.PHONY: passive-spreader-keyboard-console
passive-spreader-keyboard-console:
	$(CAD) cad/export_console.py --passive-spreader-keyboard
.PHONY: protective-skirt-frame-console
protective-skirt-frame-console:
	$(CAD) cad/export_console.py --protective-skirt

.PHONY: protective-skirt-seated-console
protective-skirt-seated-console:
	$(CAD) cad/export_console_seated_cartridges.py
.PHONY: msx-skirt-seated-console
msx-skirt-seated-console:
	$(CAD) cad/export_console_seated_cartridges.py --msx-style

.PHONY: complete-console-presentation
complete-console-presentation:
	$(CAD) cad/export_console_complete_presentation.py

.PHONY: all-faces-console-presentation
all-faces-console-presentation:
	$(CAD) cad/export_console_all_faces_presentation.py

# Visual-only connector faces; these do not replace occupancy or fit models.
.PHONY: rear-connector-presentation
rear-connector-presentation:
	$(CAD) cad/rear_connector_presentation.py

# Separate local front-wall proposal; the retained case is not overwritten.
.PHONY: keyboard-panel-candidate
keyboard-panel-candidate:
	$(CAD) cad/keyboard_panel_candidate.py

$(PUBLICATION)/console-interior-passive-candidate.png $(REPORTS)/console-open-passive-finned-publication.json &: cad/render_console.py cad/rendering.py $(GEOMETRY) design/enclosure_appearance.json design/enclosure_cooling.json design/cooling_presentation.json $(REPORTS)/compact-assembly.json $(REPORTS)/compact-cartridge-flaps.json $(REPORTS)/mainboard.json $(REPORTS)/console-exchange-passive-candidate.json
	EGL_PLATFORM=surfaceless $(CAD) cad/render_console.py --view open-passive-finned --publication-dir $(PUBLICATION)
publication: $(PUBLICATION)/console-interior-passive-candidate.png

# An optional low-profile passive spreader; preserves the tall reference model.
$(REPORTS)/passive-spreader-candidate.json $(EXPORTS)/BMSX_PASSIVE_SPREADER_CONCEPT.step &: cad/passive_spreader_candidate.py $(GEOMETRY) design/enclosure_cooling.json $(REPORTS)/compact-cooling.json
	$(CAD) cad/passive_spreader_candidate.py
.PHONY: passive-spreader-candidate
passive-spreader-candidate: $(REPORTS)/passive-spreader-candidate.json $(EXPORTS)/BMSX_PASSIVE_SPREADER_CONCEPT.step

$(PUBLICATION)/passive-spreader-concept.png: ../docs/book4/figures/passive-spreader-concept.svg
	@mkdir -p $(@D)
	rsvg-convert -w 1400 $< -o $@
publication: $(PUBLICATION)/passive-spreader-concept.png

# Additional open view of the low-profile option; retained views are unchanged.
$(PUBLICATION)/console-interior-passive-spreader.png $(REPORTS)/console-open-passive-spreader-publication.json &: cad/render_console.py cad/rendering.py $(GEOMETRY) design/enclosure_appearance.json $(REPORTS)/compact-assembly.json $(REPORTS)/compact-cartridge-flaps.json $(REPORTS)/mainboard.json $(REPORTS)/console-exchange-passive-candidate.json $(REPORTS)/passive-spreader-candidate.json $(EXPORTS)/BMSX_PASSIVE_SPREADER_CONCEPT.step
	EGL_PLATFORM=surfaceless $(CAD) cad/render_console.py --view open-passive-spreader --publication-dir $(PUBLICATION)

# Explicitly illustrative connector faces replace the two visible occupancy
# solids only in this separate presentation exchange; fit owners are retained.
.PHONY: rear-console-presentation
rear-console-presentation:
	$(CAD) cad/export_console.py --rear-presentation

.PHONY: publication-rear-connector-concept
publication-rear-connector-concept:
	EGL_PLATFORM=surfaceless $(CAD) cad/render_console.py --view rear-presentation --publication-dir $(PUBLICATION)

# Focused placement sanity screen; consumes the retained reports and CAD owners.
.PHONY: check-combined-candidate-placement
check-combined-candidate-placement:
	$(CAD) cad/check_candidate_placement.py

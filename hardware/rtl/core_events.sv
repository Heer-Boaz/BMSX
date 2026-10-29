`timescale 1ns/1ps
// U1 event-input owner, not the SYSTEM transition sequencer or the whole IRQ
// controller. supervisor_event goes directly to SYSTEM: USER starts entry,
// ACTIVE+RESUMABLE requests exit, other phases discard it. There is deliberately
// no supervisor queue that could replay an ignored event in a later phase.
//
// supervisor_n is the digital output of U1's 3.3 V Schmitt-qualified input pad.
// Its driven falling edge clocks ONE event-toggle cell; slow open-drain release
// is not a clock edge. This must map to an ASIC asynchronous-reset event-clock
// leaf, with a declared clock/pad path, pulse-width and recovery/removal checks;
// it is not an ordinary data-flop path and RTL does not qualify an input cell.
// The toggle persists after the one-CLK_IO pulse, independent of CORE phase.
//
// Both toggle links need each source level to reach a valid CORE sampling edge
// with setup/hold margin. The two synchronizer stages add latency, not a blanket
// four-clock spacing rule. U7's registered pulse has a low and a released-high
// interval between events; its pull-up must reach the Schmitt high threshold
// before the next assertion. VBLANK_EVT is a source toggle, not a pulse. GFX
// owns the SYS-domain live-beam/event/CSR arithmetic; this receiver only owns
// pin-event transfer. Shared reset initializes BOTH source toggles to zero;
// independent receiver-only reset is not a lossless event-transfer protocol.
module core_events (
    input wire clk, reset_n,
    input wire supervisor_n,
    input wire vblank_evt,
    input wire vblank_consume,
    output wire supervisor_event,
    output wire vblank_event,
    output reg vblank_pending
);
    reg supervisor_toggle;
    (* async_reg = "true" *) reg supervisor_meta, supervisor_sync;
    (* async_reg = "true" *) reg vblank_meta, vblank_sync;
    reg supervisor_seen, vblank_seen;
    reg [1:0] reset_release;

    // Actual pin-edge capture. A short pulse cannot vanish between CORE clocks;
    // holding the pin low and its later RC rise do not create additional events.
    always @(negedge supervisor_n or negedge reset_n) begin
        if (!reset_n) supervisor_toggle <= 0;
        else supervisor_toggle <= !supervisor_toggle;
    end

    assign supervisor_event = reset_release[1] && (supervisor_sync != supervisor_seen);
    assign vblank_event = reset_release[1] && (vblank_sync != vblank_seen);

    always @(posedge clk or negedge reset_n) begin
        if (!reset_n) begin
            reset_release <= 0;
            supervisor_meta <= 0; supervisor_sync <= 0; supervisor_seen <= 0;
            vblank_meta <= 0; vblank_sync <= 0; vblank_seen <= 0;
            vblank_pending <= 0;
        end else begin
            reset_release <= {reset_release[0], 1'b1};
            supervisor_meta <= supervisor_toggle;
            supervisor_sync <= supervisor_meta;
            vblank_meta <= vblank_evt;
            vblank_sync <= vblank_meta;
            if (reset_release[1]) begin
                supervisor_seen <= supervisor_sync;
                vblank_seen <= vblank_sync;
                // New event wins over a concurrent consume. This is the retained
                // VBlank source bit, not an event count and not an INPUT latch.
                vblank_pending <= vblank_event || (vblank_pending && !vblank_consume);
            end
        end
    end
endmodule

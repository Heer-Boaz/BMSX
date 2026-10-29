`timescale 1ns/1ps
// Proposed reference-card input receiver, not a qualified general cartridge
// IRQ implementation. The slot IRQ inputs are active-low event wires;
// the card's pending latch is independent of the central IRQ pending bank.
// Each asynchronous assertion sets an event latch, then two synchronization
// stages deliver one event per retained assertion to the central IRQ owner.
// The source event re-arms only after the captured assertion has cleared and
// the input is released; central ACK does not clear the cartridge latch.
// DREQ levels use separate two-flop synchronizers and retain slot identity.
//
// Asynchronous set requires an actual library cell with pin pulse-width,
// recovery/removal and metastability closure. Two distinct assertions faster
// than the capture/rearm path can coalesce, including when central ACK occurs
// between assertions. Book III specifies no such minimum spacing, so this is
// an explicit unresolved contract gap for autonomous/external cards, not an
// installed timing limit. The reference mailbox holds IRQ until a later card
// acknowledgement. This RTL does not certify arbitrary external-card pulses or
// analogue pin behavior.
// Production patterns: OpenTitan prim_edge_detector and PULP common_cells sync:
// https://github.com/lowRISC/opentitan/blob/master/hw/ip/prim/rtl/prim_edge_detector.sv
// https://github.com/pulp-platform/common_cells/blob/master/src/sync.sv
module cart_pin_events (
    input wire clk, reset_n,
    input wire [1:0] irq_cart_n, dreq_read, dreq_write,
    output wire [31:0] irq_raise,
    output wire [15:0] dma_requests
);
    reg [1:0] captured,seen;
    (* async_reg = "true" *) reg [1:0] irq_meta,irq_sync;
    (* async_reg = "true" *) reg [1:0] read_meta,read_sync,write_meta,write_sync;
    genvar i;
    generate for(i=0;i<2;i=i+1) begin: event_capture
        always @(posedge clk or negedge reset_n or negedge irq_cart_n[i]) begin
            if(!reset_n) captured[i]<=0;
            else if(!irq_cart_n[i]) captured[i]<=1;
            else if(irq_sync[i]) captured[i]<=0;
        end
    end endgenerate
    assign irq_raise={21'd0,irq_sync[1] && !seen[1],irq_sync[0] && !seen[0],9'd0};
    assign dma_requests={5'd0,read_sync[1],write_sync[1],read_sync[0],write_sync[0],7'd0};
    always @(posedge clk or negedge reset_n) begin
        if(!reset_n) begin
            irq_meta<=0;irq_sync<=0;seen<=0;
            read_meta<=0;read_sync<=0;write_meta<=0;write_sync<=0;
        end else begin
            irq_meta<=captured;irq_sync<=irq_meta;seen<=irq_sync;
            read_meta<=dreq_read;read_sync<=read_meta;
            write_meta<=dreq_write;write_sync<=write_meta;
        end
    end
endmodule

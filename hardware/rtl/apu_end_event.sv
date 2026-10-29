`timescale 1ns/1ps
// An output-reported end owns a slot-bank CLEAR and the retained latest-event
// registers. end_ready and the bank commit handshake are the same transaction:
// the source word is sampled before CLEAR and the event registers are
// published. The IRQ request follows on the next clock. The IRQ request targets CORE's user IRQ raise input;
// it is independent of the first-fault latch and central IRQ acknowledgement.
// The enclosing datapath must provide the source for end_slot and arbitrate
// the bank commit; the event commit must not be interleaved with another
// mutation of that bank. An independent event read port avoids retargeting a
// simultaneous playback fetch while an end is held.
// MAME models stream completion within the sound owner; LiteX keeps event
// pending and acknowledgement in the interrupt controller, not the producer:
// https://github.com/mamedev/mame/blob/master/src/devices/sound/spu.cpp
// https://github.com/enjoy-digital/litex/blob/master/litex/soc/interconnect/csr_eventmanager.py
module apu_end_event (
 input wire clk, reset_n,
 input wire end_valid, output wire end_ready, input wire [3:0] end_slot,
 input wire [31:0] end_source_address,
 output wire commit_valid, input wire commit_ready, output wire [3:0] commit_slot,
 output reg [31:0] event_kind, event_slot, event_source_address, event_sequence,
 output reg [31:0] user_irq_raise
);
 reg irq_due;
 assign commit_valid=reset_n && end_valid;
 assign commit_slot=end_slot;
 assign end_ready=reset_n && commit_ready;
 always @(posedge clk or negedge reset_n) begin
  if(!reset_n) begin
   event_kind<=0;event_slot<=0;event_source_address<=0;event_sequence<=0;user_irq_raise<=0;irq_due<=0;
  end else begin
   user_irq_raise<=irq_due ? 32'h20 : 32'd0;
   irq_due<=end_valid && end_ready;
   if(end_valid && end_ready) begin
    event_kind<=32'd1;event_slot<={28'd0,end_slot};event_source_address<=end_source_address;
    event_sequence<=event_sequence+32'd1;
   end
  end
 end
endmodule

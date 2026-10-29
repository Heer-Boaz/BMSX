`timescale 1ns/1ps
// Alternative cartridge IRQ input for the proposed level-held contract.
// This is NOT the Book III edge contract: a card holds IRQ_N low until its
// local request is acknowledged. The two synchronized levels feed the actual
// central IRQ bank as continuous set requests. Consequently an ACK while a
// synchronized level is active cannot clear that socket's pending bit.
// After local ACK the release must traverse both stages before central ACK.
// A pulse entirely between clock edges can be missed; this circuit does not
// turn short pulses into a guaranteed event. The card and its software must
// implement the held-level protocol. Analog pad thresholds, pulse timing,
// metastability MTBF and reset release remain physical design requirements.
// The mask, ACK, supervisor and pending owners remain in CORE, not here.
// Level event reference: https://github.com/enjoy-digital/litex/blob/master/litex/soc/interconnect/csr_eventmanager.py
module cart_irq_level_candidate (
 input wire clk,reset_n,
 input wire [1:0] irq_cart_n,
 output wire [31:0] irq_raise
);
 (* async_reg="true" *) reg [1:0] irq_meta,irq_sync;
 assign irq_raise={21'd0,irq_sync[1],irq_sync[0],9'd0};
 always @(posedge clk or negedge reset_n) begin
  if(!reset_n) begin irq_meta<=0;irq_sync<=0;end
  else begin irq_meta<=~irq_cart_n;irq_sync<=irq_meta;end
 end
endmodule

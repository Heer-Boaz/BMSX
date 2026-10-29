`timescale 1ns/1ps
// PCRTC event-pending and mask register owner. The old beam is serviced before
// the accepted CSR/IMR operation; a zero-position VSync from a changed timing
// word is serviced after that operation. Pending events coalesce, masking does
// not clear them, and unmasking an already pending event raises the central IRQ.
// HSYNC crossings are generated only at subsequent even half-lines by the beam;
// clearing HSINT therefore does not replay suppressed crossings.
//
// A RESET action restores these registers and requests synchronous beam and
// display reset. Both RESET and FLUSH request the GPU queue action; RESET takes
// priority. The GPU command/readback owner must carry out that action: this
// block does not claim cancellation of accepted drawing or implement a FIFO.
// IRQ is an event pulse to the central IRQ bank, not a level held until ACK.
// LiteX's CSR event manager likewise separates pending, clear and enable:
// https://github.com/enjoy-digital/litex/blob/master/litex/soc/interconnect/csr_eventmanager.py
module gfx_pcrtc_status (
 input wire clk,reset_n,
 input wire write_valid,input wire [1:0] write_index,input wire [31:0] write_word,
 input wire [1:0] read_index,output reg [31:0] read_word,
 input wire hsync_before,vsync_before,vsync_after,
 input wire field_current,field_before,
 input wire [4:0] event_before,
 output wire irq_raise,soft_reset,queue_action,
 output wire [31:0] csr_word,imr_word
);
 reg [4:0] pending,mask;
 wire csr_write=write_valid && write_index==0;
 wire imr_write=write_valid && write_index==2;
 wire [4:0] pre_events=event_before | {1'b0,vsync_before,hsync_before,2'b00};
 wire [4:0] pending_pre=pending | pre_events;
 wire [4:0] cleared=csr_write ? pending_pre & ~write_word[4:0] : pending_pre;
 wire [4:0] new_mask=imr_write ? write_word[12:8] : mask;
 wire [4:0] post_events={1'b0,vsync_after,3'b000};
 wire [4:0] pending_post=cleared | post_events;
 wire [4:0] pre_irq=pre_events & ~pending & ~mask;
 wire [4:0] unmask_irq=imr_write ? cleared & mask & ~new_mask : 5'd0;
 wire [4:0] post_irq=post_events & ~cleared & ~new_mask;
 assign soft_reset=reset_n && csr_write && write_word[9];
 assign queue_action=reset_n && csr_write && (write_word[9] || write_word[8]);
 assign irq_raise=reset_n && (|pre_irq || |unmask_irq || (!soft_reset && |post_irq));
 assign csr_word=(32'h551b4000 & ~32'h0000201f) | {18'd0,field_current,8'd0,pending};
 assign imr_word=32'h00006000 | {19'd0,mask,8'd0};
 always @* begin
  case(read_index)
   0: read_word=(32'h551b4000 & ~32'h0000201f) | {18'd0,field_before,8'd0,pending_pre};
   1: read_word=0;
   2: read_word=imr_word;
   3: read_word=0;
  endcase
 end
 always @(posedge clk or negedge reset_n) begin
  if(!reset_n) begin pending<=0;mask<=5'h1f;end
  else if(soft_reset) begin pending<=0;mask<=5'h1f;end
  else begin pending<=pending_post;mask<=new_mask;end
 end
endmodule

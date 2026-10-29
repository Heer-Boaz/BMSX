`timescale 1ns/1ps
// NON-PRODUCTION comparator for the cartridge input study. This implementation
// samples each active-low IRQ through two flops and emits one pulse per
// synchronized falling transition. It is not a substitute for the installed
// asynchronous-capture candidate: an isolated pulse between sample clocks can
// be lost. Book III has no cartridge pin minimum pulse timing, so replacing the
// current input without an explicit physical contract would change behavior.
// No fabricated pad, setup/hold, MTBF, clock or reset timing is proven by RTL.
// The separate DREQ inputs stay level-synchronized.
// Synchronizer reference: PULP common_cells sync.sv
// https://github.com/pulp-platform/common_cells/blob/master/src/sync.sv
module cart_pin_sync_experiment (
 input wire clk,reset_n,
 input wire [1:0] irq_cart_n,dreq_read,dreq_write,
 output wire [31:0] irq_raise,
 output wire [15:0] dma_requests
);
 (* async_reg="true" *) reg [1:0] irq_meta,irq_sync;
 (* async_reg="true" *) reg [1:0] read_meta,read_sync,write_meta,write_sync;
 reg [1:0] irq_previous;
 assign irq_raise={21'd0,irq_previous[1] && !irq_sync[1],irq_previous[0] && !irq_sync[0],9'd0};
 assign dma_requests={5'd0,read_sync[1],write_sync[1],read_sync[0],write_sync[0],7'd0};
 always @(posedge clk or negedge reset_n) begin
  if(!reset_n) begin
   irq_meta<=3;irq_sync<=3;irq_previous<=3;
   read_meta<=0;read_sync<=0;write_meta<=0;write_sync<=0;
  end else begin
   irq_meta<=irq_cart_n;irq_sync<=irq_meta;irq_previous<=irq_sync;
   read_meta<=dreq_read;read_sync<=read_meta;write_meta<=dreq_write;write_sync<=write_meta;
  end
 end
endmodule

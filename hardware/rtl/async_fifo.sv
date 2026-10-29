`timescale 1ns/1ps
// Dual-clock hardware FIFO with Gray pointer crossing and a common async reset.
// ADDR_BITS is at least one, so the FIFO has at least two entries.
// Each domain releases reset through its own two-flop synchronizer. One entry
// is retained from write acceptance until read acceptance; full/empty indicate
// real hardware capacity and no stale-data/underrun replacement is generated.
// Read data is meaningful only while r_valid. This register-file realization
// requires an independently qualified dual-clock storage implementation, two
// synchronizer cells and Gray-bus skew/max-delay constraints in the ASIC flow.
// Reset must be common to both domains; unilateral pointer reset is not a flush
// protocol. See production async stream FIFO design:
// https://github.com/enjoy-digital/litex/blob/master/litex/soc/interconnect/stream.py
module async_fifo #(
 parameter integer WIDTH=64,
 parameter integer ADDR_BITS=4
)(
 input wire reset_n,
 input wire w_clk,input wire w_valid,output wire w_ready,input wire [WIDTH-1:0] w_data,
 input wire r_clk,output wire r_valid,input wire r_ready,output wire [WIDTH-1:0] r_data
);
 localparam integer DEPTH=1<<ADDR_BITS;
 localparam [ADDR_BITS:0] FULL_MASK={2'b11,{(ADDR_BITS-1){1'b0}}};
 reg [WIDTH-1:0] words[0:DEPTH-1];
 reg [ADDR_BITS:0] w_bin,w_gray,r_bin,r_gray;
 (* async_reg = "true" *) reg [1:0] w_release,r_release;
 (* async_reg = "true" *) reg [ADDR_BITS:0] rgray_w1,rgray_w2,wgray_r1,wgray_r2;
 wire full=w_gray==(rgray_w2^FULL_MASK);
 wire empty=r_gray==wgray_r2;
 assign w_ready=w_release[1] && !full;
 assign r_valid=r_release[1] && !empty;
 assign r_data=words[r_bin[ADDR_BITS-1:0]];
 wire [ADDR_BITS:0] w_next=w_bin+1'b1;
 wire [ADDR_BITS:0] r_next=r_bin+1'b1;
 always @(posedge w_clk or negedge reset_n) begin
  if(!reset_n) begin w_release<=0;w_bin<=0;w_gray<=0;rgray_w1<=0;rgray_w2<=0;end
  else begin
   w_release<={w_release[0],1'b1};rgray_w1<=r_gray;rgray_w2<=rgray_w1;
   if(!w_release[1]) begin w_bin<=0;w_gray<=0;end
   else if(w_valid && w_ready) begin
    words[w_bin[ADDR_BITS-1:0]]<=w_data;w_bin<=w_next;w_gray<=(w_next>>1)^w_next;
   end
  end
 end
 always @(posedge r_clk or negedge reset_n) begin
  if(!reset_n) begin r_release<=0;r_bin<=0;r_gray<=0;wgray_r1<=0;wgray_r2<=0;end
  else begin
   r_release<={r_release[0],1'b1};wgray_r1<=w_gray;wgray_r2<=wgray_r1;
   if(!r_release[1]) begin r_bin<=0;r_gray<=0;end
   else if(r_valid && r_ready) begin r_bin<=r_next;r_gray<=(r_next>>1)^r_next;end
  end
 end
endmodule

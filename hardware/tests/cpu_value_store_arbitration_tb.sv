`timescale 1ns/1ps
// Directed typed-slot owner arbitration, raw bit preservation, address wrap,
// simultaneous request/response and held responses. This is an atomic-slot
// port model, not proof of a physical memory implementation or a VM scheduler.
module cpu_value_store_arbitration_tb;
 reg clk=0;always #5 clk=~clk;reg reset_n=0;
 reg [31:0] frame_base=32'hfffffff0,constant_base=32'hfffffff8;
 reg rd_valid=0,rd_constant=0,rd_rsp_ready=0,wr_valid=0;
 reg [14:0] rd_index=0;reg [13:0] wr_index=0;reg [63:0] wr_number=0;
 wire rd_ready,rd_rsp_valid,rd_is_number,wr_ready;wire [63:0] rd_payload;
 reg raw_valid=0,raw_write=0,raw_constant=0,raw_rsp_ready=0;
 reg [31:0] raw_index=0;reg [3:0] raw_kind=0;reg [63:0] raw_payload=0;
 wire raw_ready,raw_rsp_valid;wire [3:0] raw_rsp_kind;wire [63:0] raw_rsp_payload;
 wire mem_valid,mem_write,mem_rsp_ready;reg mem_ready=0,mem_rsp_valid=0;
 wire [31:0] mem_address;wire [67:0] mem_wdata;reg [67:0] mem_rsp_data=0;
 cpu_value_store d(.clk(clk),.reset_n(reset_n),.frame_base(frame_base),.constant_base(constant_base),
  .slot_read_valid(rd_valid),.slot_read_ready(rd_ready),.slot_read_constant(rd_constant),.slot_read_index(rd_index),
  .slot_rsp_valid(rd_rsp_valid),.slot_rsp_ready(rd_rsp_ready),.slot_rsp_is_number(rd_is_number),.slot_rsp_payload(rd_payload),
  .slot_write_valid(wr_valid),.slot_write_ready(wr_ready),.slot_write_index(wr_index),.slot_write_number(wr_number),
  .raw_valid(raw_valid),.raw_ready(raw_ready),.raw_write(raw_write),.raw_constant(raw_constant),.raw_index(raw_index),
  .raw_kind(raw_kind),.raw_payload(raw_payload),.raw_rsp_valid(raw_rsp_valid),.raw_rsp_ready(raw_rsp_ready),
  .raw_rsp_kind(raw_rsp_kind),.raw_rsp_payload(raw_rsp_payload),.mem_valid(mem_valid),.mem_ready(mem_ready),
  .mem_write(mem_write),.mem_address(mem_address),.mem_wdata(mem_wdata),.mem_rsp_valid(mem_rsp_valid),
  .mem_rsp_ready(mem_rsp_ready),.mem_rsp_data(mem_rsp_data),.mem_fault_valid(1'b0),.raw_fault(),.slot_write_fault(),.slot_read_fault());
 integer i;
 initial begin
  repeat(2)@(negedge clk);reset_n=1;
  // Raw access wins; address and complete typed word remain stable under stall.
  @(negedge clk);raw_valid=1;raw_write=1;raw_constant=0;raw_index=31;raw_kind=4'hb;raw_payload=64'h0123456789abcdef;
  wr_valid=1;wr_index=31;wr_number=64'h8000000000000000;rd_valid=1;rd_index=31;
  for(i=0;i<3;i=i+1)begin #1;
   if(!mem_valid || !mem_write || mem_address!==32'hf || mem_wdata!==68'hb0123456789abcdef || raw_ready || wr_ready || rd_ready)$fatal(1,"raw priority/stall");
   @(negedge clk);
  end
  mem_ready=1;#1;if(!raw_ready || wr_ready || rd_ready)$fatal(1,"raw priority acceptance");
  @(negedge clk);raw_valid=0;#1;
  if(!wr_ready || rd_ready || !mem_write || mem_address!==32'hf || mem_wdata!==68'h38000000000000000)$fatal(1,"Number write priority or representation");
  @(negedge clk);wr_valid=0;rd_constant=1;rd_index=16;rd_rsp_ready=0;#1;
  if(!rd_ready || mem_write || mem_address!==32'h8)$fatal(1,"constant read address");
  @(negedge clk);rd_valid=0;raw_valid=1;raw_write=1;raw_index=0;raw_kind=4'hf;raw_payload=64'hffff;
  mem_rsp_valid=1;mem_rsp_data=68'h37ff8000000000001;#1;
  if(raw_ready || mem_valid || !rd_rsp_valid || !rd_is_number || rd_payload!==64'h7ff8000000000001 || mem_rsp_ready)$fatal(1,"pending read ownership");
  repeat(3)begin @(negedge clk);#1;if(!rd_rsp_valid || raw_ready || mem_rsp_ready)$fatal(1,"response not held");end
  rd_rsp_ready=1;#1;if(!mem_rsp_ready)$fatal(1,"read response ready");
  @(negedge clk);mem_rsp_valid=0;#1;if(!raw_ready || !mem_valid || !mem_write)$fatal(1,"raw write blocked after response");
  @(negedge clk);raw_valid=0;raw_write=0;raw_constant=1;raw_index=16;raw_rsp_ready=0;raw_valid=1;
  #1;if(!raw_ready || mem_write || mem_address!==8)$fatal(1,"raw read admission");
  @(negedge clk);raw_valid=0;mem_rsp_valid=1;mem_rsp_data=68'hfdeadbeef01234567;#1;
  if(!raw_rsp_valid || raw_rsp_kind!==4'hf || raw_rsp_payload!==64'hdeadbeef01234567 || mem_rsp_ready || rd_rsp_valid)$fatal(1,"raw response");
  raw_rsp_ready=1;#1;if(!mem_rsp_ready)$fatal(1,"raw response ready");
  @(negedge clk);mem_rsp_valid=0;raw_rsp_ready=0;
  // A response on the request-acceptance edge is routed without a ready loop.
  rd_valid=1;rd_index=31;rd_constant=0;rd_rsp_ready=1;mem_rsp_valid=1;mem_rsp_data=68'h17ff8000000000000;#1;
  if(!rd_ready || !rd_rsp_valid || rd_is_number || !mem_rsp_ready || rd_payload!==64'h7ff8000000000000)$fatal(1,"immediate non-Number response");
  @(negedge clk);rd_valid=0;mem_rsp_valid=0;#1;
  if(d.pending)$fatal(1,"immediate response left pending state");
  // A higher-priority raw request must not replace an already offered read
  // while the physical memory is stalled. The read stays selected until its
  // handshake, even though the new raw request is waiting concurrently.
  rd_valid=1;rd_index=16;rd_constant=1;rd_rsp_ready=1;mem_ready=0;
  #1;if(!mem_valid || mem_write || mem_address!==32'h8)$fatal(1,"initial stalled read");
  @(negedge clk);raw_valid=1;raw_write=1;raw_constant=0;raw_index=31;raw_kind=4'hb;raw_payload=64'h0123456789abcdef;
  wr_valid=1;wr_index=31;wr_number=64'h8000000000000000;
  for(i=0;i<3;i=i+1)begin #1;
   if(!mem_valid || mem_write || mem_address!==32'h8 || raw_ready || wr_ready || rd_ready)$fatal(1,"higher priority displaced stalled read");
   @(negedge clk);
  end
  mem_ready=1;mem_rsp_valid=1;mem_rsp_data=68'h33ff0000000000000;#1;
  if(!rd_ready || raw_ready || wr_ready || !rd_rsp_valid || !rd_is_number || !mem_rsp_ready)$fatal(1,"stalled read acceptance");
  @(negedge clk);rd_valid=0;mem_rsp_valid=0;#1;
  if(!raw_ready || wr_ready || !mem_write || mem_address!==32'hf || mem_wdata!==68'hb0123456789abcdef)$fatal(1,"waiting raw request after locked read");
  @(negedge clk);raw_valid=0;wr_valid=0;
  // A stalled Number write likewise keeps its original complete slot word.
  mem_ready=0;wr_valid=1;wr_index=31;wr_number=64'h8000000000000000;
  #1;if(!mem_valid || !mem_write || mem_address!==32'hf || mem_wdata!==68'h38000000000000000)$fatal(1,"initial stalled Number write");
  @(negedge clk);raw_valid=1;raw_write=1;raw_constant=0;raw_index=30;raw_kind=4'h5;raw_payload=64'h42;
  repeat(3)begin #1;
   if(!mem_valid || !mem_write || mem_address!==32'hf || mem_wdata!==68'h38000000000000000 || raw_ready || wr_ready)$fatal(1,"raw request displaced stalled Number write");
   @(negedge clk);
  end
  mem_ready=1;#1;if(!wr_ready || raw_ready)$fatal(1,"stalled Number write acceptance");
  @(negedge clk);wr_valid=0;#1;
  if(!raw_ready || mem_address!==32'he || mem_wdata!==68'h50000000000000042)$fatal(1,"waiting raw after locked Number write");
  @(negedge clk);raw_valid=0;
  // The general value owner must address the complete 32-bit slot-index
  // representation, not just the narrower RK operand's 15-bit index.
  raw_valid=1;raw_write=1;raw_constant=1;raw_index=32'h03ffffff;raw_kind=4'h9;raw_payload=64'h9abcdef012345678;
  #1;if(!raw_ready || mem_address!==32'h03fffff7 || mem_wdata!==68'h99abcdef012345678)$fatal(1,"wide constant index");
  @(negedge clk);raw_index=32'hffffffff;#1;
  if(!raw_ready || mem_address!==32'hfffffff7)$fatal(1,"full-width index wrap");
  @(negedge clk);raw_valid=0;
  $display("PASS raw/read/write arbitration, 32-bit slot address wrap, held and immediate responses, full typed payload");$finish;
 end
 initial begin #10000;$fatal(1,"timeout");end
endmodule

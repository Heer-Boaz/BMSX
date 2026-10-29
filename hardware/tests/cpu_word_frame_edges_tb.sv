`timescale 1ns/1ps
// Backing fixture owns all nine value kinds; cpu_word_frame sees only Number
// classification and an opaque payload. Exact frame/top/Number stores tested.
module cpu_word_frame_edges_tb;
 reg clk=0;always #5 clk=~clk;
 reg reset_n=0,frame_load=0,req_valid=0,write_ready=0;
 reg [31:0] frame_load_top=0;reg [5:0] op=34;reg [13:0] a=0;reg [14:0] b=0;
 wire req_ready,select,read_valid,read_rsp_ready,write_valid,read_constant;
 wire [14:0] read_index;wire [13:0] write_index;wire [63:0] write_number;wire [31:0] top;
 reg [3:0] tag=0;reg [63:0] payload=0;reg [3:0] committed_tag=0;reg [63:0] committed_payload=0;
 // Storage can make request-ready depend on response-ready without a ready loop.
 wire read_ready=read_rsp_ready;
 cpu_word_frame dut(.clk(clk),.reset_n(reset_n),.frame_load(frame_load),.frame_load_top(frame_load_top),.frame_top(top),
  .req_valid(req_valid),.req_ready(req_ready),.select(select),.req_opcode(op),.req_a(a),.req_b(b),.req_rkb(32'd0),.req_rkc(32'd0),
  .slot_read_valid(read_valid),.slot_read_ready(read_ready),.slot_read_constant(read_constant),.slot_read_index(read_index),
  .slot_rsp_valid(read_valid),.slot_rsp_ready(read_rsp_ready),.slot_rsp_is_number(tag==4'd3),.slot_rsp_payload(payload),
  .slot_write_valid(write_valid),.slot_write_ready(write_ready),.slot_write_index(write_index),.slot_write_number(write_number));
 always @(posedge clk) if(reset_n && write_valid && write_ready)begin committed_tag<=3;committed_payload<=write_number;end
 task automatic run(input [3:0] t,input [63:0] p,input [31:0] prior,input [13:0] dest,input [14:0] src,input [63:0] result);
  integer k;
  begin
   tag=t;payload=p;frame_load_top=prior;a=dest;b=src;
   @(negedge clk);frame_load=1;@(negedge clk);frame_load=0;
   while(!req_ready)@(negedge clk);req_valid=1;@(negedge clk);req_valid=0;
   while(!read_valid)@(negedge clk);
   if(read_constant || read_index!==src || !read_ready || !read_rsp_ready)$fatal(1,"wrong numeric read");
   while(!write_valid)@(negedge clk);
   if(write_index!==dest || write_number!==result || top!==prior)$fatal(1,"wrong precommit");
   for(k=0;k<3;k=k+1)begin @(negedge clk);
    if(!write_valid || write_index!==dest || write_number!==result || top!==prior)$fatal(1,"stall changed frame");end
   write_ready=1;@(negedge clk);write_ready=0;
   if(committed_tag!==3 || committed_payload!==result || top!==(prior>({18'd0,dest}+1) ? prior : {18'd0,dest}+1))
    $fatal(1,"writeback or top");
  end
 endtask
 integer i;
 initial begin repeat(2)@(negedge clk);reset_n=1;
  for(i=0;i<9;i=i+1)if(i!=3)run(i,64'hfeff000000000000+i,0,14'd16383,15'd32767,64'hbff0000000000000);
  run(3,64'h3ff0000000000000,32'hfffffffe,14'd123,15'd123,64'hc000000000000000); // ~1 = -2, source=destination
  run(3,64'h7ff8000000000000,9,14'd0,15'd0,64'hbff0000000000000); // Number NaN
  $display("PASS all non-Number kinds, NaN, high BNOT index, alias, top increase/retention and stalled Number commit");$finish;
 end
 initial begin #30000;$fatal(1,"timeout");end
endmodule

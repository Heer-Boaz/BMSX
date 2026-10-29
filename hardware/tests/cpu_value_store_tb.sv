`timescale 1ns/1ps
// Real decode, frame and typed-value owner. Slot-memory backend is an atomic
// typed-memory fixture with variable request/response latency; it is not a
// fabricated SRAM/DRAM, a complete allocator, GC, or a full CPU implementation.
module cpu_value_store_tb;
 reg clk=0;always #5 clk=~clk;
 reg reset_n=0,frame_load=0,in_valid=0,wide=0;
 reg [31:0] load_top=0,pc=0,prefix=0,body=0;
 wire [31:0] frame_top;wire in_ready,decoded,execute_ready,select;
 wire [5:0] op;wire [13:0] a;wire [14:0] b;wire [31:0] rkb,rkc;
 cpu_instruction_decode decode(.clk(clk),.reset_n(reset_n),.req_valid(in_valid),.req_ready(in_ready),
  .req_pc(pc),.req_prefix(prefix),.req_body(body),.req_wide(wide),.rsp_valid(decoded),.rsp_ready(execute_ready),
  .rsp_pc(),.rsp_next_pc(),.rsp_opcode(op),.rsp_a(a),.rsp_b(b),.rsp_c(),.rsp_bx(),.rsp_sbx(),
  .rsp_rkb(rkb),.rsp_rkc(rkc),.rsp_branch_target(),.rsp_disp(),.rsp_wide(),.rsp_nested_wide(),.rsp_reserved_memory());
 wire read_valid,read_ready,read_constant,rsp_valid,rsp_ready,rsp_is_number,write_valid,write_ready;
 wire [14:0] read_index;wire [13:0] write_index;wire [63:0] rsp_payload,write_number;
 cpu_word_frame cpu(.clk(clk),.reset_n(reset_n),.frame_load(frame_load),.frame_load_top(load_top),.frame_top(frame_top),
  .req_valid(decoded),.req_ready(execute_ready),.select(select),.req_opcode(op),.req_a(a),.req_b(b),.req_rkb(rkb),.req_rkc(rkc),
  .slot_read_valid(read_valid),.slot_read_ready(read_ready),.slot_read_constant(read_constant),.slot_read_index(read_index),
  .slot_rsp_valid(rsp_valid),.slot_rsp_ready(rsp_ready),.slot_rsp_is_number(rsp_is_number),.slot_rsp_payload(rsp_payload),
  .slot_write_valid(write_valid),.slot_write_ready(write_ready),.slot_write_index(write_index),.slot_write_number(write_number));
 reg raw_valid=0,raw_write=0,raw_constant=0,raw_rsp_ready=0;
 reg [31:0] raw_index=0;reg [3:0] raw_kind=0;reg [63:0] raw_payload=0;
 wire raw_ready,raw_rsp_valid;wire [3:0] raw_rsp_kind;wire [63:0] raw_rsp_payload;
 wire mem_valid,mem_ready,mem_write,mem_rsp_valid,mem_rsp_ready;wire [31:0] mem_address;
 wire [67:0] mem_wdata,mem_rsp_data;
 cpu_value_store store(.clk(clk),.reset_n(reset_n),.frame_base(32'd0),.constant_base(32'd32768),
  .slot_read_valid(read_valid),.slot_read_ready(read_ready),.slot_read_constant(read_constant),.slot_read_index(read_index),
  .slot_rsp_valid(rsp_valid),.slot_rsp_ready(rsp_ready),.slot_rsp_is_number(rsp_is_number),.slot_rsp_payload(rsp_payload),
  .slot_write_valid(write_valid),.slot_write_ready(write_ready),.slot_write_index(write_index),.slot_write_number(write_number),
  .raw_valid(raw_valid),.raw_ready(raw_ready),.raw_write(raw_write),.raw_constant(raw_constant),.raw_index(raw_index),
  .raw_kind(raw_kind),.raw_payload(raw_payload),.raw_rsp_valid(raw_rsp_valid),.raw_rsp_ready(raw_rsp_ready),
  .raw_rsp_kind(raw_rsp_kind),.raw_rsp_payload(raw_rsp_payload),.mem_valid(mem_valid),.mem_ready(mem_ready),
  .mem_write(mem_write),.mem_address(mem_address),.mem_wdata(mem_wdata),.mem_rsp_valid(mem_rsp_valid),
  .mem_rsp_ready(mem_rsp_ready),.mem_rsp_data(mem_rsp_data),.mem_fault_valid(1'b0),.raw_fault(),.slot_write_fault(),.slot_read_fault());
 reg [67:0] memory[0:65535];
 reg delayed_valid=0;reg [67:0] delayed_data=0;integer cycle=0,delay_count=0;
 integer stalls=0,direct_reads=0,delayed_reads=0,writebacks=0,raw_reads=0;
 wire direct=mem_valid && mem_ready && !mem_write && (cycle%3==0);
 assign mem_ready=!delayed_valid && (cycle%7)!=0 && (cycle%11)!=0;
 assign mem_rsp_valid=(delayed_valid && delay_count==0) || direct;
 assign mem_rsp_data=direct ? memory[mem_address] : delayed_data;
 always @(posedge clk) if(reset_n) begin
  cycle<=cycle+1;
  if(mem_valid&&!mem_ready)stalls<=stalls+1;
  if(mem_valid&&mem_ready)begin
   if(mem_address>=65536)$fatal(1,"fixture address outside bank");
   if(mem_write)begin memory[mem_address]<=mem_wdata;if(write_valid&&write_ready)writebacks<=writebacks+1;end
   else if(direct)begin direct_reads<=direct_reads+1; if(!mem_rsp_ready)begin delayed_valid<=1;delayed_data<=memory[mem_address];delay_count<=0;end end
   else begin delayed_data<=memory[mem_address];delay_count<=1+(cycle%4);delayed_valid<=1;delayed_reads<=delayed_reads+1;end
  end
  if(delayed_valid)begin
   if(delay_count!=0)delay_count<=delay_count-1;
   else if(mem_rsp_ready)delayed_valid<=0;
  end
 end
 // delayed_valid means the backend owns a response; it becomes visible when
 // the modeled memory latency has elapsed and stays valid until accepted.
 // Gate the test backend's raw valid with the countdown, not the production owner.
 task automatic raw_put(input bit constant_bank,input [14:0] index,input [3:0] kind,input [63:0] value);
 begin
  @(negedge clk);raw_valid=1;raw_write=1;raw_constant=constant_bank;raw_index=index;raw_kind=kind;raw_payload=value;
  do @(posedge clk);while(!raw_ready);
  @(negedge clk);raw_valid=0;raw_write=0;
 end endtask
 task automatic raw_get(input bit constant_bank,input [14:0] index,input [3:0] kind,input [63:0] value);
 integer k;
 begin
  @(negedge clk);raw_valid=1;raw_write=0;raw_constant=constant_bank;raw_index=index;raw_rsp_ready=0;
  do @(posedge clk);while(!raw_ready);
  @(negedge clk);raw_valid=0;
  while(!raw_rsp_valid)@(negedge clk);
  for(k=0;k<3;k=k+1)begin
   if(!raw_rsp_valid || raw_rsp_kind!==kind || raw_rsp_payload!==value)$fatal(1,"raw response changed while stalled");
   @(negedge clk);
  end
  raw_rsp_ready=1;@(negedge clk);raw_rsp_ready=0;raw_reads=raw_reads+1;
 end endtask
 integer f,n,count,rc,i;reg [31:0] lb,li,rb,ri,ln,rn,eop,ea,eb,erkb,erkc,iw;
 reg [63:0] lv,rv,expected;reg [31:0] expected_top,initial_top;
 initial begin
  f=$fopen("build/tests/cpu-word-execute-vectors.txt","r");if(!f)$fatal(1,"vectors missing");
  rc=$fscanf(f,"%d\n",count);repeat(2)@(negedge clk);reset_n=1;
  // All representable 4-bit kinds and opaque bits round-trip through the raw
  // owner, including unusual payloads; no corrupt-state normalization.
  for(i=0;i<16;i=i+1)begin raw_put(0,i,i,64'hfedcba9876543210+i);raw_get(0,i,i,64'hfedcba9876543210+i);end
  for(n=0;n<count;n=n+1)begin
   rc=$fscanf(f,"%h %h %h %h %h %h %h %h %h %h %h %h %h %h %h %h %h %h\n",pc,prefix,body,iw,eop,ea,eb,erkb,erkc,lb,li,rb,ri,ln,lv,rn,rv,expected);
   if(rc!=18)$fatal(1,"vector %0d fields=%0d",n,rc);
   raw_put(lb[0],li[14:0],ln[0] ? 4'd3 : 4'd4,lv);
   if(eop!=34)raw_put(rb[0],ri[14:0],rn[0] ? 4'd3 : 4'd4,rv);
   wide=iw[0];initial_top=(n&1)?ea+2:0;expected_top=ea+1>initial_top?ea+1:initial_top;
   @(negedge clk);frame_load=1;load_top=initial_top;@(negedge clk);frame_load=0;
   while(!in_ready)@(negedge clk);in_valid=1;@(negedge clk);in_valid=0;
   while(!write_valid)@(negedge clk);
   if(write_index!==ea[13:0]||write_number!==expected||frame_top!==initial_top)$fatal(1,"precommit vector %0d",n);
   do @(posedge clk);while(!write_ready);
   @(negedge clk);
   if(frame_top!==expected_top || memory[ea]!=={4'd3,expected})$fatal(1,"stored result vector %0d",n);
  end
  if(!stalls||!direct_reads||!delayed_reads||!writebacks||raw_reads!=16)$fatal(1,"coverage missing");
  $display("PASS %0d actual TS/C++ decode/value vectors through typed owner and atomic slot-memory fixture; stalls=%0d immediate=%0d delayed=%0d raw-kinds=%0d",count,stalls,direct_reads,delayed_reads,raw_reads);$finish;
 end
 initial begin #100000000;$fatal(1,"timeout");end
endmodule

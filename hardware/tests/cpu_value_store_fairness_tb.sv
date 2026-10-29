`timescale 1ns/1ps
// Sustained raw, numeric-write and numeric-read contention against an atomic
// typed-slot backend. Round-robin is checked in accepted requests; arbitrary
// memory and consumer stalls mean no wall-clock latency is promised.
module cpu_value_store_fairness_tb;
 reg clk=0;always #5 clk=~clk;reg reset_n=0,run=0;
 wire raw_ready,slot_write_ready,slot_read_ready,raw_rsp_valid,slot_rsp_valid,slot_is_number;
 wire [3:0] raw_rsp_kind;wire [63:0] raw_rsp_payload,slot_payload;
 wire mem_valid,mem_write,mem_rsp_ready;wire[31:0] mem_address;wire[67:0] mem_wdata,mem_rsp_data;
 reg delayed=0;reg [67:0] delayed_data=0;integer delay_count=0,cycle=0,read_seq=0;
 integer accepted=0,raw_grants=0,write_grants=0,read_grants=0,direct=0,deferred=0,stalls=0,raw_responses=0,read_responses=0;
 wire raw_rsp_ready=(cycle%11)!=0,slot_rsp_ready=(cycle%7)!=0;
 wire mem_ready=!delayed && (cycle%5)!=0;
 wire direct_valid=mem_valid && mem_ready && !mem_write && (read_seq%2)==0;
 wire mem_rsp_valid=(delayed && delay_count==0) || direct_valid;
 assign mem_rsp_data=delayed ? delayed_data : {4'd3,32'h12345678,mem_address};
 cpu_value_store d(.clk(clk),.reset_n(reset_n),.frame_base(32'h10),.constant_base(32'h100),
  .slot_read_valid(run),.slot_read_ready(slot_read_ready),.slot_read_constant(1'b1),.slot_read_index(15'd3),
  .slot_rsp_valid(slot_rsp_valid),.slot_rsp_ready(slot_rsp_ready),.slot_rsp_is_number(slot_is_number),.slot_rsp_payload(slot_payload),
  .slot_write_valid(run),.slot_write_ready(slot_write_ready),.slot_write_index(14'd2),.slot_write_number(64'h8000000000000000),
  .raw_valid(run),.raw_ready(raw_ready),.raw_write(1'b0),.raw_constant(1'b0),.raw_index(32'd1),.raw_kind(4'd0),.raw_payload(64'd0),
  .raw_rsp_valid(raw_rsp_valid),.raw_rsp_ready(raw_rsp_ready),.raw_rsp_kind(raw_rsp_kind),.raw_rsp_payload(raw_rsp_payload),
  .mem_valid(mem_valid),.mem_ready(mem_ready),.mem_write(mem_write),.mem_address(mem_address),.mem_wdata(mem_wdata),
  .mem_rsp_valid(mem_rsp_valid),.mem_rsp_ready(mem_rsp_ready),.mem_rsp_data(mem_rsp_data),.mem_fault_valid(1'b0),.raw_fault(),.slot_write_fault(),.slot_read_fault());
 always @(posedge clk)if(reset_n)begin
  cycle<=cycle+1;
  if(mem_valid&&!mem_ready)stalls<=stalls+1;
  if(raw_rsp_valid&&raw_rsp_ready)begin
   if(raw_rsp_kind!==3 || raw_rsp_payload!==64'h1234567800000011)$fatal(1,"raw response mismatch");raw_responses<=raw_responses+1;
  end
  if(slot_rsp_valid&&slot_rsp_ready)begin
   if(!slot_is_number || slot_payload!==64'h1234567800000103)$fatal(1,"numeric response mismatch");read_responses<=read_responses+1;
  end
  if(mem_valid&&mem_ready)begin
   if({raw_ready,slot_write_ready,slot_read_ready}!==3'b100 &&
      {raw_ready,slot_write_ready,slot_read_ready}!==3'b010 &&
      {raw_ready,slot_write_ready,slot_read_ready}!==3'b001)$fatal(1,"multiple/no grants");
   case(accepted%3)
    0:begin if(!raw_ready || mem_write || mem_address!==32'h11)$fatal(1,"raw starvation/order at %d",accepted);raw_grants<=raw_grants+1;end
    1:begin if(!slot_write_ready || !mem_write || mem_address!==32'h12 || mem_wdata!==68'h38000000000000000)$fatal(1,"write starvation/order at %d",accepted);write_grants<=write_grants+1;end
    2:begin if(!slot_read_ready || mem_write || mem_address!==32'h103)$fatal(1,"read starvation/order at %d",accepted);read_grants<=read_grants+1;end
   endcase
   accepted<=accepted+1;
   if(!mem_write)begin
    read_seq<=read_seq+1;
    if(direct_valid && mem_rsp_ready)direct<=direct+1;
    else begin delayed<=1;delayed_data<={4'd3,32'h12345678,mem_address};delay_count<=1+(cycle%4);deferred<=deferred+1;end
   end
  end
  if(delayed)begin
   if(delay_count!=0)delay_count<=delay_count-1;
   else if(mem_rsp_ready)delayed<=0;
  end
 end
 initial begin repeat(2)@(negedge clk);reset_n=1;run=1;while(accepted<300)@(negedge clk);run=0;
  while(delayed || d.pending)@(negedge clk);
  if(raw_grants!=100||write_grants!=100||read_grants!=100||raw_responses!=100||read_responses!=100||!direct||!deferred||!stalls)
   $fatal(1,"coverage grants=%d/%d/%d responses=%d/%d direct/deferred/stalls=%d/%d/%d",raw_grants,write_grants,read_grants,raw_responses,read_responses,direct,deferred,stalls);
  $display("PASS bounded round-robin: 300 concurrent grants, 100 per owner, direct=%0d delayed=%0d stalls=%0d",direct,deferred,stalls);$finish;
 end
 initial begin #1000000;$fatal(1,"timeout");end
endmodule

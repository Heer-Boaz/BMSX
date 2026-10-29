`timescale 1ns/1ps
// Real typed-slot owner + three-word physical datapath. Word RAM is a fixture;
// the reservation signals model the required CORE arbitration contract.
module cpu_slot_word_store_tb;
 reg clk=0;always #5 clk=~clk;
 reg reset_n=0;
 reg raw_valid=0,raw_write=0,raw_constant=0,raw_rsp_ready=0;
 reg [31:0] raw_index=0;reg [3:0] raw_kind=0;reg [63:0] raw_payload=0;
 wire raw_ready,raw_rsp_valid,raw_fault;wire [3:0] raw_rsp_kind;wire [63:0] raw_rsp_payload;
 wire mem_valid,mem_ready,mem_write,mem_rsp_valid,mem_rsp_ready;wire [31:0] mem_address;
 wire [67:0] mem_wdata,mem_rsp_data;
 wire fault_valid,fault_timeout,fault_write;wire [31:0] fault_address,fault_code;wire [1:0] fault_words_completed;
 cpu_value_store values(.clk(clk),.reset_n(reset_n),.frame_base(32'd0),.constant_base(32'd64),
  .slot_read_valid(1'b0),.slot_read_ready(),.slot_read_constant(1'b0),.slot_read_index(15'd0),
  .slot_rsp_valid(),.slot_rsp_ready(1'b0),.slot_rsp_is_number(),.slot_rsp_payload(),
  .slot_write_valid(1'b0),.slot_write_ready(),.slot_write_index(14'd0),.slot_write_number(64'd0),
  .raw_valid(raw_valid),.raw_ready(raw_ready),.raw_write(raw_write),.raw_constant(raw_constant),.raw_index(raw_index),
  .raw_kind(raw_kind),.raw_payload(raw_payload),.raw_rsp_valid(raw_rsp_valid),.raw_rsp_ready(raw_rsp_ready),
  .raw_rsp_kind(raw_rsp_kind),.raw_rsp_payload(raw_rsp_payload),.mem_valid(mem_valid),.mem_ready(mem_ready),
  .mem_write(mem_write),.mem_address(mem_address),.mem_wdata(mem_wdata),.mem_rsp_valid(mem_rsp_valid),
  .mem_rsp_ready(mem_rsp_ready),.mem_rsp_data(mem_rsp_data),.mem_fault_valid(fault_valid),.raw_fault(raw_fault),.slot_write_fault(),.slot_read_fault());
 wire req_valid,req_write,req_hold;reg req_ready=0;
 wire [31:0] req_address,req_wdata;reg rsp_valid=0,rsp_timeout=0;reg [31:0] rsp_rdata=0,rsp_fault_code=0;
 reg [31:0] base=32'h08050000;
 cpu_slot_word_store d(.clk(clk),.reset_n(reset_n),.region_base(base),.mem_valid(mem_valid),.mem_ready(mem_ready),
  .mem_write(mem_write),.mem_address(mem_address),.mem_wdata(mem_wdata),.mem_rsp_valid(mem_rsp_valid),
  .mem_rsp_ready(mem_rsp_ready),.mem_rsp_data(mem_rsp_data),.req_valid(req_valid),.req_ready(req_ready),
  .req_write(req_write),.req_hold(req_hold),.req_address(req_address),.req_wdata(req_wdata),
  .rsp_valid(rsp_valid),.rsp_rdata(rsp_rdata),.rsp_fault_code(rsp_fault_code),.rsp_timeout(rsp_timeout),
  .fault_valid(fault_valid),.fault_address(fault_address),.fault_code(fault_code),.fault_timeout(fault_timeout),
  .fault_write(fault_write),.fault_words_completed(fault_words_completed));
 reg [31:0] words[0:1023];integer cycles=0,issued=0,waits=0;reg pending=0;
 reg inject_fault=0,inject_timeout=0;reg [1:0] inject_word=0;
 reg [31:0] addr_latch,data_latch;reg write_latch,held=0;reg [31:0] held_addr,held_data;reg held_write,held_hold;
 always @(posedge clk) begin
  if(!reset_n)begin pending<=0;rsp_valid<=0;cycles<=0;issued<=0;req_ready<=0;held<=0;end
  else begin
   cycles<=cycles+1;req_ready<=(cycles%4)!=0; rsp_valid<=0;
   if(held && (!req_valid || req_address!==held_addr || req_wdata!==held_data || req_write!==held_write || req_hold!==held_hold))$fatal(1,"word request changed under stall");
   held<=req_valid&&!req_ready;held_addr<=req_address;held_data<=req_wdata;held_write<=req_write;held_hold<=req_hold;
   if(req_valid&&!req_ready)waits<=waits+1;
   if(req_valid&&req_ready)begin
    if(pending)$fatal(1,"overlapping memory word");
    if(req_hold!==(issued%3!=2))$fatal(1,"incorrect word reservation");
    addr_latch<=req_address;data_latch<=req_wdata;write_latch<=req_write;pending<=1;issued<=issued+1;
   end else if(pending) begin
    pending<=0;rsp_valid<=1;
    if(inject_fault && addr_latch==base+{28'd0,inject_word,2'b00}) begin
     rsp_fault_code<=inject_timeout ? 0 : 32'h35;
     rsp_timeout<=inject_timeout;
    end else begin
     rsp_fault_code<=0;rsp_timeout<=0;
     if(write_latch)words[(addr_latch-base)>>2]<=data_latch;
     else rsp_rdata<=words[(addr_latch-base)>>2];
    end
   end
  end
 end
 task automatic write_slot(input [31:0] index,input [3:0] kind,input [63:0] payload);
  begin @(negedge clk);raw_valid=1;raw_write=1;raw_index=index;raw_kind=kind;raw_payload=payload;
   do @(posedge clk);while(!raw_ready);@(negedge clk);raw_valid=0;raw_write=0;end
 endtask
 task automatic read_slot(input [31:0] index,input [3:0] kind,input [63:0] payload);
  begin @(negedge clk);raw_valid=1;raw_write=0;raw_index=index;raw_rsp_ready=0;
   do @(posedge clk);while(!raw_ready);@(negedge clk);raw_valid=0;
   while(!raw_rsp_valid)@(negedge clk);
   repeat(3)begin if(!raw_rsp_valid || raw_rsp_kind!==kind || raw_rsp_payload!==payload)$fatal(1,"read response changed under stall");@(negedge clk);end
   raw_rsp_ready=1;@(negedge clk);raw_rsp_ready=0;
  end
 endtask
 task automatic fault_slot(input reg writing,input reg timeout_mode,input [1:0] failed_word);
  begin
   @(negedge clk);inject_fault=1;inject_timeout=timeout_mode;inject_word=failed_word;
   raw_valid=1;raw_write=writing;raw_index=0;raw_kind=4'hd;raw_payload=64'hfedcba9876543210;
   wait(fault_valid);@(negedge clk);
   if(!raw_fault || raw_ready || raw_rsp_valid || fault_write!==writing ||
      fault_timeout!==timeout_mode || fault_code!==(timeout_mode ? 32'd0 : 32'h35) ||
      fault_words_completed!==failed_word || fault_address!==base+{28'd0,failed_word,2'b00} ||
      issued!==failed_word+1)
    $fatal(1,"fault mismatch write=%b timeout=%b word=%d",writing,timeout_mode,failed_word);
   repeat(3) begin @(negedge clk);if(!raw_fault || raw_ready || raw_rsp_valid)$fatal(1,"fault did not remain fail-stop");end
   reset_n=0;raw_valid=0;inject_fault=0;repeat(3)@(negedge clk);reset_n=1;
  end
 endtask
 integer i,j,k;
 initial begin repeat(3)@(negedge clk);reset_n=1;
  for(i=0;i<16;i=i+1)begin write_slot(i,i,64'h89abcdef01234567^i);read_slot(i,i,64'h89abcdef01234567^i);end
  if(fault_valid || issued!=96 || !waits)$fatal(1,"word/coverage count %d",issued);
  @(negedge clk);reset_n=0;repeat(3)@(negedge clk);reset_n=1;
  for(i=0;i<2;i=i+1)for(j=0;j<2;j=j+1)for(k=0;k<3;k=k+1)fault_slot(i,j,k);
  write_slot(0,4'h9,64'h0123456789abcdef);read_slot(0,4'h9,64'h0123456789abcdef);
  if(fault_valid || issued!=6)$fatal(1,"reset did not restore slot access");
  $display("PASS 16 raw slots and all 12 read/write fault and timeout positions, reset, stable requests and retained responses; word-memory fixture");$finish;
 end
 initial begin #100000;$fatal(1,"timeout");end
endmodule

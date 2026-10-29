`timescale 1ns/1ps
module cpu_compact_slot_word_store_tb;
 reg clk=0; always #5 clk=~clk;
 reg reset_n=0, mem_valid=0, mem_write=0, mem_number=0, mem_rsp_ready=0;
 reg [31:0] mem_address=0; reg [63:0] mem_wdata=0;
 wire mem_ready,mem_rsp_valid,mem_rsp_is_number,req_valid,req_write,req_hold;
 wire [63:0] mem_rsp_data; wire [31:0] req_address,req_wdata;
 reg rsp_valid=0; reg [31:0] rsp_rdata=0,rsp_fault_code=0;
 reg inject_fault=0; wire fault_valid,fault_write,fault_timeout,fault_words_completed;
 wire [31:0] fault_address,fault_code;
 integer cycle=0, words=0, stalls=0;
 reg [31:0] memory[0:255];
 wire req_ready=(cycle%4)!=0;
 cpu_compact_slot_word_store dut(
  .clk(clk),.reset_n(reset_n),.region_base(32'd0),.mem_valid(mem_valid),.mem_ready(mem_ready),
  .mem_write(mem_write),.mem_number(mem_number),.mem_address(mem_address),.mem_wdata(mem_wdata),
  .mem_rsp_valid(mem_rsp_valid),.mem_rsp_ready(mem_rsp_ready),.mem_rsp_data(mem_rsp_data),
  .mem_rsp_is_number(mem_rsp_is_number),.req_valid(req_valid),.req_ready(req_ready),
  .req_write(req_write),.req_hold(req_hold),.req_address(req_address),.req_wdata(req_wdata),
  .rsp_valid(rsp_valid),.rsp_rdata(rsp_rdata),.rsp_fault_code(rsp_fault_code),.rsp_timeout(1'b0),
  .fault_valid(fault_valid),.fault_address(fault_address),.fault_code(fault_code),
  .fault_timeout(fault_timeout),.fault_write(fault_write),.fault_words_completed(fault_words_completed)
 );
 always @(posedge clk) begin
  cycle<=cycle+1; rsp_valid<=0; rsp_fault_code<=0;
  if(reset_n && req_valid && !req_ready) stalls<=stalls+1;
  if(reset_n && req_valid && req_ready) begin
   if(req_address[1:0]!==0 || req_address>=1024) $fatal(1,"bad word address");
   if(req_hold!==!req_address[2]) $fatal(1,"reservation not held for first word");
   words<=words+1; rsp_valid<=1;
   if(inject_fault && req_address[2]) rsp_fault_code<=32'h1234;
   else if(req_write) memory[req_address>>2]<=req_wdata;
   else rsp_rdata<=memory[req_address>>2];
  end
 end
 task automatic put(input [31:0] index,input bit numeric,input [63:0] value);
 begin
  @(negedge clk);mem_valid=1;mem_write=1;mem_number=numeric;mem_address=index;mem_wdata=value;
  do @(posedge clk); while(!mem_ready);
  @(negedge clk);mem_valid=0;mem_write=0;mem_number=0;
 end endtask
 task automatic get(input [31:0] index,input [63:0] expected,input bit number);
 integer n;
 begin
  @(negedge clk);mem_valid=1;mem_write=0;mem_address=index;mem_rsp_ready=0;
  do @(posedge clk); while(!mem_ready);
  @(negedge clk);mem_valid=0;
  for(n=0;n<3;n=n+1) begin
   if(!mem_rsp_valid || mem_rsp_data!==expected || mem_rsp_is_number!==number)
    $fatal(1,"slot %0d response %h kind %b, expected %h kind %b",index,mem_rsp_data,mem_rsp_is_number,expected,number);
   @(negedge clk);
  end
  mem_rsp_ready=1; @(negedge clk);mem_rsp_ready=0;
 end endtask
 integer i, f, rc, count, vec_number, vec_is_number; reg [63:0] vec_input,vec_expected,copy_bits;
 initial begin
  for(i=0;i<256;i=i+1) memory[i]=0;
  repeat(3)@(negedge clk);reset_n=1;
  put(0,1,64'h8000000000000000);get(0,64'h8000000000000000,1);
  put(1,1,64'h7ff0000000000000);get(1,64'h7ff0000000000000,1);
  put(2,1,64'hfff0000000000000);get(2,64'hfff0000000000000,1);
  put(3,1,64'h7ff0000000000001);get(3,64'h7ff8000000000000,1);
  put(4,1,64'hfff80000deadbeef);get(4,64'h7ff8000000000000,1);
  // Raw slot copy is not a numeric write: tagged and unusual 64-bit patterns
  // remain exact and retain their deterministic classification.
  put(5,0,64'hfff80000deadbeef);get(5,64'hfff80000deadbeef,0);
  put(6,0,64'h7ff80000deadbeef);get(6,64'h7ff80000deadbeef,1);
  f=$fopen("build/tests/cpu-compact-slot-vectors.txt","r");
  if(!f) $fatal(1,"C++ vectors missing");
  count=0;
  while(!$feof(f)) begin
   rc=$fscanf(f,"%d %h %h %d\n",vec_number,vec_input,vec_expected,vec_is_number);
   if(rc!=4) $fatal(1,"C++ vector fields=%0d",rc);
   put(7+count,vec_number[0],vec_input);get(7+count,vec_expected,vec_is_number[0]);
   count=count+1;
  end
  $fclose(f);
  if(count!=18) $fatal(1,"expected 18 real C++ vectors, got %0d",count);
  // Copy the actual raw read response to a different slot, including a bit
  // pattern that collides with a non-Number tag when interpreted.
  @(negedge clk);mem_valid=1;mem_write=0;mem_address=5;mem_rsp_ready=0;
  do @(posedge clk); while(!mem_ready);
  @(negedge clk);mem_valid=0;copy_bits=mem_rsp_data;mem_rsp_ready=1;
  @(negedge clk);mem_rsp_ready=0;
  put(31,0,copy_bits);get(31,64'hfff80000deadbeef,0);
  // A failing second word is reported; the first write remains in memory.
  memory[60]=32'h11223344;memory[61]=32'h55667788;
  @(negedge clk);mem_valid=1;mem_write=1;mem_number=0;mem_address=30;mem_wdata=64'haabbccddeeff0011;inject_fault=1;
  while(!fault_valid) @(negedge clk);
  if(mem_ready || !fault_write || fault_timeout || !fault_words_completed || fault_address!==244 || fault_code!==32'h1234 || memory[60]!==32'heeff0011 || memory[61]!==32'h55667788)
   $fatal(1,"partial fault semantics");
  if(words!=108 || stalls==0) $fatal(1,"coverage words=%0d stalls=%0d",words,stalls);
  $display("PASS compact candidate: %0d actual C++ Number/tag vectors, raw64 exact, NaN producer, held response, two-word reservation, partial fault; words=%0d stalls=%0d",count,words,stalls);
  $finish;
 end
 initial begin #500000;$fatal(1,"timeout");end
endmodule

`timescale 1ns/1ps
// Real compact value arbitration, CPU word execution and two 32-bit DRAM word
// transfers through the existing CORE, with isolated public and private banks.
// A raw producer supplies already encoded compact words; this is not a 68-bit
// conversion, allocator, complete CPU or timing qualification.
module cpu_compact_value_core_tb;
 reg clk=0;always #14.763 clk=~clk;
 reg reset_n=1,power_reset_n=1;
 reg [2:0] req_valid=0,req_write=0,req_hold=0;
 reg [95:0] req_address=0,req_wdata=0,req_access=0;
 wire [2:0] req_ready,rsp_valid,rsp_timeout;wire [95:0] rsp_rdata,rsp_fault_code;
 wire memory_ready,block_locked;tri [31:0] md,sys_ad;tri1 sys_ready_n;
 wire [9:0] ma;wire mras_n,mras_private_n,mwe_n,moe_n,moe_private_n;wire [3:0] mcas_n;
 reg fault_shared_oe=0;integer inject_shared_oe=0, quick=0;
 wire cpu_private=1'b1;
 core_memory_system core(.geo_raw_memory(1'b1),.cpu_private(cpu_private),.clk(clk),.reset_n(reset_n),.power_reset_n(power_reset_n),
  .cpu_local_withdraw(1'b0),.cpu_local_withdrawn(),.req_valid(req_valid),.req_write(req_write),.req_hold(req_hold),
  .req_ready(req_ready),.req_address(req_address),.req_wdata(req_wdata),.req_access(req_access),
  .req_size_bytes({3{3'd4}}),.req_bus_signals(24'h000100),.req_data_timeout_enable(3'd0),
  .req_be_n(12'd0),.req_data_wait_last(54'd0),.rsp_valid(rsp_valid),.rsp_timeout(rsp_timeout),
  .rsp_rdata(rsp_rdata),.rsp_fault_code(rsp_fault_code),.memory_ready(memory_ready),.block_locked(block_locked),
  .sys_bus_busy(),.sys_bus_request(),.sys_bus_owned(1'b1),.sys_ad(sys_ad),.sys_ready_n(sys_ready_n),
  .sys_as_n(),.sys_rd_n(),.sys_wr_n(),.sys_be_n(),.cs_rom_n(),.cs_io_n(),.cs_gpu_n(),.cs_pcrtc_n(),.cs_apu_n(),
  .ma(ma),.md(md),.mras_n(mras_n),.mras_private_n(mras_private_n),.mwe_n(mwe_n),.moe_n(moe_n),.moe_private_n(moe_private_n),.mcas_n(mcas_n),
  .local_valid(),.cart_valid(),.local_ready(1'b0),.cart_ready(1'b0),.local_write(),.cart_write(),
  .local_address(),.local_wdata(),.local_access(),.cart_address(),.cart_wdata(),.cart_access(),
  .cart_size_bytes(),.cart_data_timeout_enable(),.cart_data_wait_last(),.local_be_n(),.cart_be_n(),
  .local_bus_signals(),.cart_bus_signals(),.local_rsp_valid(1'b0),.cart_rsp_valid(1'b0),.cart_rsp_timeout(1'b0),
  .local_rdata(32'd0),.local_fault_code(32'd0),.cart_rdata(32'd0),.cart_fault_code(32'd0));
 is41lv16100_pair_model public_bank(.clk(clk),.power_reset_n(power_reset_n),.ma(ma),.md(md),
  .ras_n(mras_n),.cas_n(mcas_n),.we_n(mwe_n),.oe_n(moe_n));
 is41lv16100_pair_model private_bank(.clk(clk),.power_reset_n(power_reset_n),.ma(ma),.md(md),
  .ras_n(mras_private_n),.cas_n(mcas_n),.we_n(mwe_n),.oe_n(moe_private_n));
 reg raw_valid=0,raw_write=0,raw_constant=0,raw_rsp_ready=0;
 reg [31:0] raw_index=0;reg [63:0] raw_wdata=0;
 wire raw_ready,raw_rsp_valid;wire [63:0] raw_rsp_data;
 reg execute_valid=0,frame_load=0;reg [31:0] frame_load_top=0;
 reg [5:0] opcode=0;reg [13:0] a=0;reg [14:0] b=0;reg [31:0] rkb=0,rkc=0;
 wire execute_ready,execute_select;wire [31:0] frame_top;
 wire read_valid,read_ready,read_constant,rsp_valid_slot,rsp_ready_slot,rsp_number;
 wire [14:0] read_index;wire [63:0] rsp_data_slot,write_number;
 wire write_valid,write_ready;wire [13:0] write_index;
 cpu_word_frame execution(.clk(clk),.reset_n(reset_n),.frame_load(frame_load),.frame_load_top(frame_load_top),.frame_top(frame_top),
  .req_valid(execute_valid),.req_ready(execute_ready),.select(execute_select),.req_opcode(opcode),.req_a(a),.req_b(b),.req_rkb(rkb),.req_rkc(rkc),
  .slot_read_valid(read_valid),.slot_read_ready(read_ready),.slot_read_constant(read_constant),.slot_read_index(read_index),
  .slot_rsp_valid(rsp_valid_slot),.slot_rsp_ready(rsp_ready_slot),.slot_rsp_is_number(rsp_number),.slot_rsp_payload(rsp_data_slot),
  .slot_write_valid(write_valid),.slot_write_ready(write_ready),.slot_write_index(write_index),.slot_write_number(write_number));
 wire mem_valid,mem_ready,mem_write,mem_number,mem_rsp_valid,mem_rsp_ready,mem_rsp_is_number;
 wire [31:0] mem_address;wire [63:0] mem_wdata,mem_rsp_data;
 wire raw_fault,write_fault,read_fault,slot_fault;
 cpu_compact_value_store values(.clk(clk),.reset_n(reset_n),.frame_base(32'd0),.constant_base(32'd1024),
  .slot_read_valid(read_valid),.slot_read_ready(read_ready),.slot_read_constant(read_constant),.slot_read_index(read_index),
  .slot_rsp_valid(rsp_valid_slot),.slot_rsp_ready(rsp_ready_slot),.slot_rsp_is_number(rsp_number),.slot_rsp_payload(rsp_data_slot),
  .slot_write_valid(write_valid),.slot_write_ready(write_ready),.slot_write_index(write_index),.slot_write_number(write_number),
  .raw_valid(raw_valid),.raw_ready(raw_ready),.raw_write(raw_write),.raw_constant(raw_constant),.raw_index(raw_index),.raw_wdata(raw_wdata),
  .raw_rsp_valid(raw_rsp_valid),.raw_rsp_ready(raw_rsp_ready),.raw_rsp_data(raw_rsp_data),
  .mem_valid(mem_valid),.mem_ready(mem_ready),.mem_write(mem_write),.mem_number(mem_number),.mem_address(mem_address),.mem_wdata(mem_wdata),
  .mem_rsp_valid(mem_rsp_valid),.mem_rsp_ready(mem_rsp_ready),.mem_rsp_data(mem_rsp_data),.mem_rsp_is_number(mem_rsp_is_number),
  .mem_fault_valid(slot_fault),.raw_fault(raw_fault),.slot_write_fault(write_fault),.slot_read_fault(read_fault));
 wire word_valid,word_write,word_hold;wire [31:0] word_address,word_data;
 cpu_compact_slot_word_store slot(.clk(clk),.reset_n(reset_n),.region_base(32'h00040000),
  .mem_valid(mem_valid),.mem_ready(mem_ready),.mem_write(mem_write),.mem_number(mem_number),.mem_address(mem_address),.mem_wdata(mem_wdata),
  .mem_rsp_valid(mem_rsp_valid),.mem_rsp_ready(mem_rsp_ready),.mem_rsp_data(mem_rsp_data),.mem_rsp_is_number(mem_rsp_is_number),
  .req_valid(word_valid),.req_ready(req_ready[0]),.req_write(word_write),.req_hold(word_hold),.req_address(word_address),.req_wdata(word_data),
  .rsp_valid(rsp_valid[0]),.rsp_rdata(rsp_rdata[31:0]),.rsp_fault_code(rsp_fault_code[31:0]),.rsp_timeout(rsp_timeout[0]),
  .fault_valid(slot_fault),.fault_address(),.fault_code(),.fault_timeout(),.fault_write(),.fault_words_completed());
 reg dma_valid=0;integer dma_wait=0,dma_admitted_locked=0,word_count=0,raw_wait_on_cpu=0;
 always @* begin
  req_valid=0;req_write=0;req_hold=0;req_address=0;req_wdata=0;req_access=0;
  req_valid[0]=word_valid;req_write[0]=word_write;req_hold[0]=word_hold;
  req_address[31:0]=word_address;req_wdata[31:0]=word_data;
  req_valid[1]=dma_valid;req_address[63:32]=32'h08040024;
 end
 always @(posedge clk) if(reset_n)begin
  if(word_valid && req_ready[0])word_count=word_count+1;
  if(block_locked && dma_valid && !req_ready[1])dma_wait=dma_wait+1;
  if(block_locked && req_ready[1])dma_admitted_locked=dma_admitted_locked+1;
  if(raw_valid && !raw_ready && (read_valid || write_valid))raw_wait_on_cpu=raw_wait_on_cpu+1;
 end
 task automatic raw_put(input bit is_constant,input [31:0] index,input [63:0] data);
  begin @(negedge clk);raw_valid=1;raw_write=1;raw_constant=is_constant;raw_index=index;raw_wdata=data;
   do @(posedge clk);while(!raw_ready);@(negedge clk);raw_valid=0;raw_write=0;end
 endtask
 task automatic raw_get(input [31:0] index,input [63:0] expected);
  begin @(negedge clk);raw_valid=1;raw_write=0;raw_constant=0;raw_index=index;raw_rsp_ready=0;
   do @(posedge clk);while(!raw_ready);@(negedge clk);raw_valid=0;while(!raw_rsp_valid)@(negedge clk);
   repeat(2)begin if(!raw_rsp_valid || raw_rsp_data!==expected)$fatal(1,"raw output %h expected %h",raw_rsp_data,expected);@(negedge clk);end
   raw_rsp_ready=1;@(negedge clk);raw_rsp_ready=0;end
 endtask
 task automatic dma_read;
  begin @(negedge clk);dma_valid=1;do @(posedge clk);while(!req_ready[1]);
   @(negedge clk);dma_valid=0;while(!rsp_valid[1])@(negedge clk);
   if(rsp_timeout[1] || rsp_fault_code[63:32]!==0 || rsp_rdata[63:32]!==32'h11223344)$fatal(1,"DMA public read");end
 endtask
 integer f,count,n,rc,used=0,tagged_count=0,numeric=0; reg [31:0] pc,prefix,body,iw,eop,ea,eb,erkb,erkc,lb,li,rb,ri,ln,rn;
 reg [63:0] lv,rv,expected,first,second;reg [31:0] expected_top;
 initial begin
  f=$fopen("build/tests/cpu-word-execute-vectors.txt","r");if(!f)$fatal(1,"missing runtime vectors");
  rc=$fscanf(f,"%d\n",count);
  #2;power_reset_n=0;reset_n=0;#3;power_reset_n=1;repeat(3)@(negedge clk);#300000;reset_n=1;wait(memory_ready);repeat(2)@(negedge clk);
  public_bank.words[20'h10009]=32'h11223344;
  // Competing DMA waits during a real private two-word write reservation.
  fork
   raw_put(0,3,64'hfff80000deadbeef);
   begin wait(block_locked);dma_read();end
  join
  if(!dma_wait || dma_admitted_locked || slot_fault)$fatal(1,"reservation did not exclude DMA");
  raw_get(3,64'hfff80000deadbeef);
  for(n=0;n<64;n=n+1)begin
   rc=$fscanf(f,"%h %h %h %h %h %h %h %h %h %h %h %h %h %h %h %h %h %h\n",pc,prefix,body,iw,eop,ea,eb,erkb,erkc,lb,li,rb,ri,ln,lv,rn,rv,expected);
   if(rc!=18)$fatal(1,"vector fields %0d",rc);
   // The two sources could share a slot; only vectors with compatible source
   // assignments can be loaded simultaneously by this fixture.
   first=ln[0] ? lv : 64'h7ffc000000000007;
   second=rn[0] ? rv : 64'h7ffc000000000007;
   if(ln[0] && (&lv[62:52]) && (|lv[51:0]))first=64'h7ff8000000000000;
   if(rn[0] && (&rv[62:52]) && (|rv[51:0]))second=64'h7ff8000000000000;
   if(eop!=34 && lb==rb && li==ri && first!=second)$fatal(1,"conflicting fixture operands");
   raw_put(lb[0],li,first);
   if(eop!=34)raw_put(rb[0],ri,second);
   if(!ln[0] || (eop!=34 && !rn[0]))tagged_count=tagged_count+1;else numeric=numeric+1;
   opcode=eop[5:0];a=ea[13:0];b=eb[14:0];rkb=erkb;rkc=erkc;
   frame_load_top=(n&1) ? ea+2 : 0;expected_top=ea+1>frame_load_top ? ea+1 : frame_load_top;
   @(negedge clk);frame_load=1;@(negedge clk);frame_load=0;
   while(!execute_ready)@(negedge clk);execute_valid=1;@(negedge clk);execute_valid=0;
   while(!write_valid)@(negedge clk);
   if(frame_top!==frame_load_top || write_index!==ea[13:0] || write_number!==expected)$fatal(1,"vector %0d precommit",n);
   while(!write_ready)@(negedge clk);
   @(negedge clk);if(frame_top!==expected_top)$fatal(1,"vector %0d frame top",n);
   raw_get(ea,expected);used=used+1;
  end
  $fclose(f);
  // A raw client arrives while the CPU already owns a stalled operand read.
  // Both requests must finish without changing either value or the frame top.
  raw_put(0,5,64'h4008000000000000);
  opcode=34;a=6;b=5;rkb=0;rkc=0;frame_load_top=0;
  @(negedge clk);frame_load=1;@(negedge clk);frame_load=0;
  fork
   begin
    while(!execute_ready)@(negedge clk);execute_valid=1;@(negedge clk);execute_valid=0;
    while(!write_valid)@(negedge clk);
    if(frame_top!==0 || write_index!==6 || write_number!==64'hc010000000000000)$fatal(1,"contended word result");
    while(!write_ready)@(negedge clk);@(negedge clk);
    if(frame_top!==7)$fatal(1,"contended frame top");
   end
   begin wait(read_valid);raw_put(0,100,64'hfff80000deadbeef);end
  join
  raw_get(6,64'hc010000000000000);raw_get(100,64'hfff80000deadbeef);
  if(!raw_wait_on_cpu)$fatal(1,"raw client never waited on CPU operand");
  if(used<60 || !numeric || !tagged_count || raw_fault || read_fault || write_fault || dma_admitted_locked)$fatal(1,"coverage");
  $display("PASS compact real CORE/private-DRAM frame execution: %0d TS/C++ word vectors (%0d with tagged operands), two-word slots, public DMA isolation and frame top; physical words=%0d",used,tagged_count,word_count);$finish;
 end
 initial begin #50000000;$fatal(1,"timeout");end
endmodule

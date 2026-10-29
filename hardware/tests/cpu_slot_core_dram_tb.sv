`timescale 1ns/1ps
// Actual typed-slot owner -> three-word serializer -> CORE arbiter/DRAM pins.
// The chosen RAM region is test data, not a console memory reservation.
// A competing DMA-like client uses the same real CORE arbiter.
module cpu_slot_core_dram_tb;
 reg clk=0;always #14.763 clk=~clk;
 reg reset_n=0,power_reset_n=0;
 reg [2:0] req_valid=0,req_write=0,req_hold=0;
 reg [95:0] req_address=0,req_wdata=0,req_access=0;
 wire [2:0] req_ready,rsp_valid,rsp_timeout;wire [95:0] rsp_rdata,rsp_fault_code;
 wire memory_ready,block_locked;tri [31:0] md,sys_ad;tri1 sys_ready_n;
 wire [9:0] ma;wire mras_n,mwe_n,moe_n;wire [3:0] mcas_n;
 core_memory_system core(.geo_raw_memory(1'b1),.cpu_private(1'b0),.mras_private_n(),.moe_private_n(),.clk(clk),.reset_n(reset_n),.power_reset_n(power_reset_n),
  .cpu_local_withdraw(1'b0),.cpu_local_withdrawn(),.req_valid(req_valid),.req_write(req_write),.req_hold(req_hold),
  .req_ready(req_ready),.req_address(req_address),.req_wdata(req_wdata),.req_access(req_access),
  .req_size_bytes({3{3'd4}}),.req_bus_signals(24'h000100),.req_data_timeout_enable(3'd0),
  .req_be_n(12'd0),.req_data_wait_last(54'd0),.rsp_valid(rsp_valid),.rsp_timeout(rsp_timeout),
  .rsp_rdata(rsp_rdata),.rsp_fault_code(rsp_fault_code),.memory_ready(memory_ready),.block_locked(block_locked),
  .sys_bus_busy(),.sys_bus_request(),.sys_bus_owned(1'b1),.sys_ad(sys_ad),.sys_ready_n(sys_ready_n),
  .sys_as_n(),.sys_rd_n(),.sys_wr_n(),.sys_be_n(),.cs_rom_n(),.cs_io_n(),.cs_gpu_n(),.cs_pcrtc_n(),.cs_apu_n(),
  .ma(ma),.md(md),.mras_n(mras_n),.mwe_n(mwe_n),.moe_n(moe_n),.mcas_n(mcas_n),
  .local_valid(),.cart_valid(),.local_ready(1'b0),.cart_ready(1'b0),.local_write(),.cart_write(),
  .local_address(),.local_wdata(),.local_access(),.cart_address(),.cart_wdata(),.cart_access(),
  .cart_size_bytes(),.cart_data_timeout_enable(),.cart_data_wait_last(),.local_be_n(),.cart_be_n(),
  .local_bus_signals(),.cart_bus_signals(),.local_rsp_valid(1'b0),.cart_rsp_valid(1'b0),.cart_rsp_timeout(1'b0),
  .local_rdata(32'd0),.local_fault_code(32'd0),.cart_rdata(32'd0),.cart_fault_code(32'd0));
 is41lv16100_pair_model dram(.clk(clk),.power_reset_n(power_reset_n),.ma(ma),.md(md),
  .ras_n(mras_n),.cas_n(mcas_n),.we_n(mwe_n),.oe_n(moe_n));
 reg raw_valid=0,raw_write=0,raw_rsp_ready=0;reg [31:0] raw_index=0;reg [3:0] raw_kind=0;reg [63:0] raw_payload=0;
 wire raw_ready,raw_rsp_valid;wire [3:0] raw_rsp_kind;wire [63:0] raw_rsp_payload;
 reg execute_valid=0;wire execute_ready,execute_select;wire [31:0] frame_top;
 wire slot_read_valid,slot_read_ready,slot_read_constant,slot_rsp_valid,slot_rsp_ready,slot_rsp_is_number;
 wire [14:0] slot_read_index;wire [63:0] slot_rsp_payload,slot_write_number;
 wire slot_write_valid,slot_write_ready;wire [13:0] slot_write_index;
 cpu_word_frame execution(.clk(clk),.reset_n(reset_n),.frame_load(1'b0),.frame_load_top(32'd0),.frame_top(frame_top),
  .req_valid(execute_valid),.req_ready(execute_ready),.select(execute_select),.req_opcode(6'd34),.req_a(14'd6),
  .req_b(15'd5),.req_rkb(32'd0),.req_rkc(32'd0),.slot_read_valid(slot_read_valid),.slot_read_ready(slot_read_ready),
  .slot_read_constant(slot_read_constant),.slot_read_index(slot_read_index),.slot_rsp_valid(slot_rsp_valid),
  .slot_rsp_ready(slot_rsp_ready),.slot_rsp_is_number(slot_rsp_is_number),.slot_rsp_payload(slot_rsp_payload),
  .slot_write_valid(slot_write_valid),.slot_write_ready(slot_write_ready),.slot_write_index(slot_write_index),
  .slot_write_number(slot_write_number));
 wire mem_valid,mem_ready,mem_write,mem_rsp_valid,mem_rsp_ready;wire [31:0] mem_address;wire [67:0] mem_wdata,mem_rsp_data;
 wire raw_fault,slot_write_fault,slot_read_fault;
 wire fault_valid,fault_timeout,fault_write;wire [31:0] fault_address,fault_code;wire [1:0] fault_words_completed;
 cpu_value_store values(.clk(clk),.reset_n(reset_n),.frame_base(32'd0),.constant_base(32'd0),
  .slot_read_valid(slot_read_valid),.slot_read_ready(slot_read_ready),.slot_read_constant(slot_read_constant),.slot_read_index(slot_read_index),
  .slot_rsp_valid(slot_rsp_valid),.slot_rsp_ready(slot_rsp_ready),.slot_rsp_is_number(slot_rsp_is_number),.slot_rsp_payload(slot_rsp_payload),
  .slot_write_valid(slot_write_valid),.slot_write_ready(slot_write_ready),.slot_write_index(slot_write_index),.slot_write_number(slot_write_number),
  .raw_valid(raw_valid),.raw_ready(raw_ready),.raw_write(raw_write),.raw_constant(1'b0),.raw_index(raw_index),
  .raw_kind(raw_kind),.raw_payload(raw_payload),.raw_rsp_valid(raw_rsp_valid),.raw_rsp_ready(raw_rsp_ready),
  .raw_rsp_kind(raw_rsp_kind),.raw_rsp_payload(raw_rsp_payload),.mem_valid(mem_valid),.mem_ready(mem_ready),
  .mem_write(mem_write),.mem_address(mem_address),.mem_wdata(mem_wdata),.mem_rsp_valid(mem_rsp_valid),
  .mem_rsp_ready(mem_rsp_ready),.mem_rsp_data(mem_rsp_data),.mem_fault_valid(fault_valid),
  .raw_fault(raw_fault),.slot_write_fault(slot_write_fault),.slot_read_fault(slot_read_fault));
 wire word_valid,word_write,word_hold;wire [31:0] word_address,word_data;
 reg [31:0] region_base=32'h08050000;
 cpu_slot_word_store slots(.clk(clk),.reset_n(reset_n),.region_base(region_base),.mem_valid(mem_valid),.mem_ready(mem_ready),
  .mem_write(mem_write),.mem_address(mem_address),.mem_wdata(mem_wdata),.mem_rsp_valid(mem_rsp_valid),
  .mem_rsp_ready(mem_rsp_ready),.mem_rsp_data(mem_rsp_data),.req_valid(word_valid),.req_ready(req_ready[0]),
  .req_write(word_write),.req_hold(word_hold),.req_address(word_address),.req_wdata(word_data),
  .rsp_valid(rsp_valid[0]),.rsp_rdata(rsp_rdata[31:0]),.rsp_fault_code(rsp_fault_code[31:0]),.rsp_timeout(rsp_timeout[0]),
  .fault_valid(fault_valid),.fault_address(fault_address),.fault_code(fault_code),.fault_timeout(fault_timeout),
  .fault_write(fault_write),.fault_words_completed(fault_words_completed));
 reg dma_valid=0;reg [31:0] dma_address=0;integer slot_words=0,dma_during_lock=0,words_before;
 always @* begin
  req_valid=0;req_write=0;req_hold=0;req_address=0;req_wdata=0;req_access=0;
  req_valid[0]=word_valid;req_write[0]=word_write;req_hold[0]=word_hold;
  req_address[31:0]=word_address;req_wdata[31:0]=word_data;req_access[31:0]=word_write ? 32'h402 : 32'h401;
  req_valid[1]=dma_valid;req_address[63:32]=dma_address;req_access[63:32]=32'h2001;
 end
 always @(posedge clk) if(reset_n)begin
  if(word_valid&&req_ready[0])slot_words=slot_words+1;
  if(block_locked && req_ready[1])dma_during_lock=dma_during_lock+1;
 end
 task automatic raw_put(input [31:0] index,input [3:0] kind,input [63:0] data);
  begin @(negedge clk);raw_valid=1;raw_write=1;raw_index=index;raw_kind=kind;raw_payload=data;
   do @(posedge clk);while(!raw_ready);@(negedge clk);raw_valid=0;raw_write=0;end
 endtask
 task automatic raw_get(input [31:0] index,input [3:0] kind,input [63:0] data);
  begin @(negedge clk);raw_valid=1;raw_write=0;raw_index=index;raw_rsp_ready=0;
   do @(posedge clk);while(!raw_ready);@(negedge clk);raw_valid=0;while(!raw_rsp_valid)@(negedge clk);
   repeat(3)begin if(!raw_rsp_valid || raw_rsp_kind!==kind || raw_rsp_payload!==data)$fatal(1,"slot response");@(negedge clk);end
   raw_rsp_ready=1;@(negedge clk);raw_rsp_ready=0;end
 endtask
 task automatic dma_read(input [31:0] address,input [31:0] expected);
  begin @(negedge clk);dma_address=address;dma_valid=1;do @(posedge clk);while(!req_ready[1]);
   @(negedge clk);dma_valid=0;while(!rsp_valid[1])@(negedge clk);
   if(rsp_fault_code[63:32]!==0 || rsp_timeout[1] || rsp_rdata[63:32]!==expected)$fatal(1,"DMA read %h got %h fault %h",address,rsp_rdata[63:32],rsp_fault_code[63:32]);end
 endtask
 initial begin
  repeat(3)@(negedge clk);power_reset_n=1;#300000;reset_n=1;wait(memory_ready);repeat(2)@(negedge clk);
  fork
   raw_put(3,4'ha,64'h1234567889abcdef);
   begin wait(block_locked);dma_read(32'h08050024,32'h89abcdef);end
  join
  if(slot_words!=3 || dma_during_lock || fault_valid)$fatal(1,"reservation/word count");
  raw_get(3,4'ha,64'h1234567889abcdef);
  if(slot_words!=6)$fatal(1,"read did not use three words");
  // BNOT reads a Number from a real DRAM-backed slot and commits Number -4
  // to R[6]; frame top advances only at the accepted completed writeback.
  raw_put(5,4'h3,64'h4008000000000000);
  @(negedge clk);while(!execute_ready)@(negedge clk);execute_valid=1;
  @(negedge clk);execute_valid=0;
  while(!slot_write_valid)@(negedge clk);
  if(frame_top!=0 || slot_write_index!=6 || slot_write_number!==64'hc010000000000000)$fatal(1,"ALU result or premature top");
  while(!slot_write_ready)@(negedge clk);
  @(negedge clk);if(frame_top!=7)$fatal(1,"accepted writeback did not update top");
  raw_get(6,4'h3,64'hc010000000000000);
  // Reset after two new word writes: those physical writes are retained,
  // and the old third word is not replaced. No rolled-back slot is implied.
  raw_put(4,4'h7,64'h1111111122222222);words_before=slot_words;
  @(negedge clk);raw_valid=1;raw_write=1;raw_index=4;raw_kind=4'he;raw_payload=64'h5555555566666666;
  wait(slot_words==words_before+2);wait(rsp_valid[0]);@(negedge clk);
  if(raw_ready)$fatal(1,"partial slot incorrectly accepted");
  reset_n=0;raw_valid=0;repeat(3)@(negedge clk);reset_n=1;wait(memory_ready);repeat(2)@(negedge clk);
  dma_read(32'h08050030,32'h66666666);dma_read(32'h08050034,32'h55555555);dma_read(32'h08050038,32'h00000007);
  // Third word escapes installed RAM: actual CORE fault after two committed
  // writes is reported, never presented as a successful typed slot write.
  @(negedge clk);region_base=32'h083ffff8;raw_valid=1;raw_write=1;raw_index=0;raw_kind=4'hd;raw_payload=64'hfedcba9876543210;
  wait(fault_valid);@(negedge clk);
  if(raw_ready || !raw_fault || slot_read_fault || slot_write_fault || fault_timeout || !fault_write || fault_words_completed!=2 || fault_address!==32'h08400000 || fault_code==0)
   $fatal(1,"partial fault not represented");
  raw_valid=0;reset_n=0;repeat(3)@(negedge clk);reset_n=1;wait(memory_ready);repeat(2)@(negedge clk);
  dma_read(32'h083ffff8,32'h76543210);dma_read(32'h083ffffc,32'hfedcba98);
  // A CPU operand fault identifies the stalled read, not a raw operation or
  // successful instruction. The region is deliberately invalid test data.
  @(negedge clk);region_base=32'h083fffc4;execute_valid=1;
  @(negedge clk);execute_valid=0;wait(fault_valid);@(negedge clk);
  if(block_locked || !slot_read_fault || slot_write_fault || raw_fault || slot_read_ready || frame_top!=0 ||
     fault_write || fault_words_completed!=0 || fault_address!==32'h08400000 || fault_code==0)
   $fatal(1,"CPU read fault ownership/top");
  raw_valid=1;raw_write=0;raw_index=3;
  repeat(3) begin @(negedge clk);if(!slot_read_fault || raw_fault || raw_ready || execute_ready || frame_top!=0)$fatal(1,"CPU read fault owner not retained");end
  raw_valid=0;
  // CORE releases its reservation on fault: unrelated DMA can still run.
  dma_read(32'h08050024,32'h89abcdef);
  if(!slot_read_fault || frame_top!=0)$fatal(1,"CPU fault lost during DMA");
  reset_n=0;repeat(3)@(negedge clk);reset_n=1;wait(memory_ready);repeat(2)@(negedge clk);
  // Operand R5 is valid; R6 writeback crosses the end of RAM at word 3.
  // The physical first two words are committed, but frame top is unchanged.
  @(negedge clk);region_base=32'h083fffb0;
  raw_put(5,4'h3,64'h4008000000000000);
  @(negedge clk);execute_valid=1;@(negedge clk);execute_valid=0;
  wait(fault_valid);@(negedge clk);
  if(block_locked || !slot_write_fault || slot_read_fault || raw_fault || slot_write_ready || frame_top!=0 ||
     !fault_write || fault_words_completed!=2 || fault_address!==32'h08400000 || fault_code==0)
   $fatal(1,"CPU write fault ownership/top");
  repeat(3) begin @(negedge clk);if(!slot_write_fault || execute_ready || frame_top!=0)$fatal(1,"CPU write fault not retained");end
  reset_n=0;repeat(3)@(negedge clk);reset_n=1;wait(memory_ready);repeat(2)@(negedge clk);
  dma_read(32'h083ffff8,32'h00000000);dma_read(32'h083ffffc,32'hc0100000);
  $display("PASS CPU typed slots and execution through real CORE/DRAM pins: source-identified fail-stop read/write faults, frame top, reset and retained partial writes");$finish;
 end
 initial begin #3000000;$fatal(1,"timeout");end
endmodule

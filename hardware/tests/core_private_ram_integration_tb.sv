`timescale 1ns/1ps
// Real CORE RAM fabric, typed-slot serializer, and two shared-pin ISSI pairs.
// cpu_private is an internal execution-owner tag, not a guest-writable address.
// The fixed 4 MiB bank is a physical candidate, not a selected VM capacity,
// allocation policy, completed CPU top, or ASIC timing/board qualification.
module core_private_ram_integration_tb;
 reg clk=0;always #14.763 clk=~clk;
 reg reset_n=1,power_reset_n=1;
 reg [2:0] req_valid=0,req_write=0,req_hold=0;
 reg [95:0] req_address=0,req_wdata=0,req_access=0;
 wire [2:0] req_ready,rsp_valid,rsp_timeout;wire [95:0] rsp_rdata,rsp_fault_code;
 wire memory_ready,block_locked;tri [31:0] md,sys_ad;tri1 sys_ready_n;
 wire [9:0] ma;wire mras_n,mras_private_n,mwe_n,moe_n,moe_private_n;wire [3:0] mcas_n;
 reg fault_shared_oe=0;integer inject_shared_oe=0, quick=0;
 reg direct_private=0,slot_mode=0;
 wire cpu_private=slot_mode || direct_private;
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
  .ras_n(mras_private_n),.cas_n(mcas_n),.we_n(mwe_n),.oe_n(fault_shared_oe ? moe_n : moe_private_n));
 reg slot_valid=0,slot_write=0,slot_rsp_ready=0;reg [31:0] slot_index=0;
 wire slot_ready,slot_rsp_valid;
 wire word_valid,word_write,word_hold,slot_fault;wire [31:0] word_address,word_data;
`ifdef COMPACT_SLOT
 reg [63:0] slot_data=0; wire [63:0] slot_rsp_data;
 cpu_compact_slot_word_store slot(.clk(clk),.reset_n(reset_n),.region_base(32'h00040000),
  .mem_valid(slot_valid),.mem_ready(slot_ready),.mem_write(slot_write),.mem_number(1'b0),.mem_address(slot_index),.mem_wdata(slot_data),
  .mem_rsp_valid(slot_rsp_valid),.mem_rsp_ready(slot_rsp_ready),.mem_rsp_data(slot_rsp_data),.mem_rsp_is_number(),
  .req_valid(word_valid),.req_ready(req_ready[0]),.req_write(word_write),.req_hold(word_hold),
  .req_address(word_address),.req_wdata(word_data),.rsp_valid(rsp_valid[0]),.rsp_rdata(rsp_rdata[31:0]),
  .rsp_fault_code(rsp_fault_code[31:0]),.rsp_timeout(rsp_timeout[0]),.fault_valid(slot_fault),
  .fault_address(),.fault_code(),.fault_timeout(),.fault_write(),.fault_words_completed());
`else
 reg [67:0] slot_data=0; wire [67:0] slot_rsp_data;
 cpu_slot_word_store slot(.clk(clk),.reset_n(reset_n),.region_base(32'h00040000),
  .mem_valid(slot_valid),.mem_ready(slot_ready),.mem_write(slot_write),.mem_address(slot_index),.mem_wdata(slot_data),
  .mem_rsp_valid(slot_rsp_valid),.mem_rsp_ready(slot_rsp_ready),.mem_rsp_data(slot_rsp_data),
  .req_valid(word_valid),.req_ready(req_ready[0]),.req_write(word_write),.req_hold(word_hold),
  .req_address(word_address),.req_wdata(word_data),.rsp_valid(rsp_valid[0]),.rsp_rdata(rsp_rdata[31:0]),
  .rsp_fault_code(rsp_fault_code[31:0]),.rsp_timeout(rsp_timeout[0]),.fault_valid(slot_fault),
  .fault_address(),.fault_code(),.fault_timeout(),.fault_write(),.fault_words_completed());
`endif
 reg [2:0] direct_valid=0,direct_write=0;reg [95:0] direct_address=0,direct_data=0;
 integer slot_words=0,public_during_lock=0,dma_wait_during_lock=0;
 always @* begin
  req_valid=direct_valid;req_write=direct_write;req_hold=0;req_address=direct_address;req_wdata=direct_data;req_access=0;
  if(slot_mode)begin req_valid[0]=word_valid;req_write[0]=word_write;req_hold[0]=word_hold;
   req_address[31:0]=word_address;req_wdata[31:0]=word_data;end
 end
 always @(posedge clk) if(reset_n && power_reset_n)begin
  if(slot_mode && word_valid && req_ready[0])slot_words=slot_words+1;
  if(block_locked && (req_ready[1] || req_ready[2]))public_during_lock=public_during_lock+1;
  if(block_locked && direct_valid[1] && !req_ready[1])dma_wait_during_lock=dma_wait_during_lock+1;
  if(!mras_n && !mras_private_n && (mcas_n!==4'b0 || !mwe_n || !moe_n || !moe_private_n))
   $fatal(1,"both banks selected outside legal CBR");
  if(!mras_n && !mras_private_n && md!==32'bz)
   $fatal(1,"shared data bus driven during simultaneous refresh");
 end
 task automatic access(input integer client,input bit domain,input bit writing,input [31:0] address,
   input [31:0] data,input [31:0] expected);
  begin
   @(negedge clk);if(client==0)direct_private=domain;
   direct_valid[client]=1;direct_write[client]=writing;
   direct_address[client*32+:32]=address;direct_data[client*32+:32]=data;
   do @(posedge clk);while(!req_ready[client]);
   @(negedge clk);direct_valid[client]=0;direct_write[client]=0;
   if(client==0)direct_private=!domain; // prove captured tag survives a change after admission
   while(!rsp_valid[client])@(negedge clk);
   if(rsp_timeout[client] || rsp_fault_code[client*32+:32]!==0 ||
      (!writing && rsp_rdata[client*32+:32]!==expected))
    $fatal(1,"client %0d bank %0d addr %h data %h expected %h fault %h",client,domain,address,
     rsp_rdata[client*32+:32],expected,rsp_fault_code[client*32+:32]);
  end
 endtask
 task automatic slot_put;
  begin
   @(negedge clk);slot_mode=1;slot_index=3;
`ifdef COMPACT_SLOT
   slot_data=64'hfff80000deadbeef;
`else
   slot_data={4'ha,64'h1234567889abcdef};
`endif
   slot_write=1;slot_valid=1;
   do @(posedge clk);while(!slot_ready);
   @(negedge clk);slot_valid=0;slot_write=0;
  end
 endtask
 task automatic slot_get;
  begin
   @(negedge clk);slot_index=3;slot_write=0;slot_valid=1;slot_rsp_ready=0;
   do @(posedge clk);while(!slot_ready);
   @(negedge clk);slot_valid=0;while(!slot_rsp_valid)@(negedge clk);
`ifdef COMPACT_SLOT
   if(slot_rsp_data!==64'hfff80000deadbeef)$fatal(1,"private compact slot lost raw value");
`else
   if(slot_rsp_data!=={4'ha,64'h1234567889abcdef})$fatal(1,"private slot lost value");
`endif
   repeat(2)@(negedge clk);slot_rsp_ready=1;@(negedge clk);slot_rsp_ready=0;
  end
 endtask
 always @(posedge clk) if(reset_n && fault_shared_oe && !mras_n && mras_private_n && !moe_n && (^md)===1'bx)
  $fatal(1,"EDO retained output causes inter-bank data contention");
 initial begin
  if($value$plusargs("FAULT_SHARED_OE=%d",inject_shared_oe)) begin end
  if($value$plusargs("QUICK=%d",quick)) begin end
  #2;power_reset_n=0;reset_n=0;#3;power_reset_n=1;repeat(3)@(negedge clk);#300000;reset_n=1;wait(memory_ready);repeat(2)@(negedge clk);
  if(public_bank.refreshes<8 || private_bank.refreshes<8)$fatal(1,"both-bank initialization missing");
  access(0,0,1,32'h08040000,32'h13579bdf,0);
  access(0,1,1,32'h00040000,32'h2468ace0,0);
  access(0,0,0,32'h08040000,0,32'h13579bdf);
  access(0,1,0,32'h00040000,0,32'h2468ace0);
  if(inject_shared_oe)fault_shared_oe=1;
  access(1,0,0,32'h08040000,0,32'h13579bdf);
  access(2,0,0,32'h08040000,0,32'h13579bdf);
  if(public_bank.words[20'h10000]!==32'h13579bdf || private_bank.words[20'h10000]!==32'h2468ace0)
   $fatal(1,"physical bank alias");
  access(1,0,1,32'h08040024,32'h11223344,0);
  fork
   slot_put();
   begin wait(block_locked);access(1,0,0,32'h08040024,0,32'h11223344);end
  join
`ifdef COMPACT_SLOT
  if(slot_words!=2 || public_during_lock || !dma_wait_during_lock || slot_fault)$fatal(1,"compact slot reservation or public interleave");
`else
  if(slot_words!=3 || public_during_lock || slot_fault)$fatal(1,"slot word reservation or public interleave");
`endif
  slot_get();
`ifdef COMPACT_SLOT
  if(slot_words!=4 || public_during_lock || slot_fault)$fatal(1,"compact slot read reservation");
  @(negedge clk);slot_mode=0;
  access(2,0,0,32'h08040024,0,32'h11223344);
  access(0,1,0,32'h00040018,0,32'hdeadbeef);
  $display("PASS compact 2-word raw slot over actual CORE + dual DRAM pin models: public/private isolation and concurrent DMA exclusion");
  $finish;
`else
  if(slot_words!=6 || public_during_lock || slot_fault)$fatal(1,"slot read reservation");
  @(negedge clk);slot_mode=0;
  access(2,0,0,32'h08040024,0,32'h11223344);
  access(0,1,0,32'h00040024,0,32'h89abcdef);
  if(quick) begin
   $display("PASS typed 3-word fixture quick case: public/private isolation and concurrent DMA exclusion");
   $finish;
  end
`endif
  // Reset after a private write is admitted and RAS is asserted. The legal
  // physical pulse must complete; reset cancels response, not the write.
  @(negedge clk);direct_private=1;direct_valid[0]=1;direct_write[0]=1;
  direct_address[31:0]=32'h00040040;direct_data[31:0]=32'hcafed00d;
  do @(posedge clk);while(!req_ready[0]);@(negedge clk);direct_valid[0]=0;
  @(negedge mras_private_n);#2;reset_n=0;
  if(mras_private_n || rsp_valid!=0)$fatal(1,"reset truncated private word or leaked response");
  #1000;
  if(private_bank.words[20'h10010]!==32'hcafed00d)$fatal(1,"admitted private write not finished across reset");
  if(!mras_n || !mras_private_n || !moe_n || !moe_private_n || !mwe_n || md!==32'bz)$fatal(1,"not at safe idle after reset");
  #3;reset_n=1;wait(memory_ready);repeat(2)@(negedge clk);
  access(0,1,0,32'h00040040,0,32'hcafed00d);
  // Hold system reset across a complete 16ms physical retention interval.
  @(negedge clk);reset_n=0;
  begin: retention
   integer public_before,private_before;
   public_before=public_bank.refreshes;private_before=private_bank.refreshes;
   #17000000;
   if(public_bank.refreshes-public_before<1024 || private_bank.refreshes-private_before<1024)
    $fatal(1,"reset stopped a bank refresh");
  end
  #3;reset_n=1;wait(memory_ready);repeat(2)@(negedge clk);
  access(0,0,0,32'h08040000,0,32'h13579bdf);
  access(0,1,0,32'h00040000,0,32'h2468ace0);
  access(0,1,0,32'h00040040,0,32'hcafed00d);
  $display("PASS real CORE dual-bank pins: CPU/DMA/GEO isolation, 3-word VM reservation, simultaneous CBR, reset write completion and 17ms retention");
  $finish;
 end
 initial begin #25000000;$fatal(1,"watchdog");end
endmodule

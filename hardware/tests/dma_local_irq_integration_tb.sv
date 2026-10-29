`timescale 1ns/1ps
// Actual CORE local decode, DMA channel banks and IRQ pending/mask/ACK
// exercise shared ownership through the physical DRAM pin model.
module dma_local_irq_integration_tb;
    reg clk=0; always #14.763 clk=!clk;
    reg reset_n=0,power_reset_n=0;
    reg trigger_inhibit=0,admission_inhibit=1,enter_supervisor=0,leave_supervisor=0;
    wire supervisor_boundary_ready,local_boundary_ready;
    reg [15:0] request_lines=0;
    reg [31:0] external_irq_raise=0,user_irq_raise=0,port_address=0;
    wire irq_line,block_active,active_channel,owns_read_port,owns_write_port;
    wire [31:0] active_read_address,active_write_address;
    wire transport_failed,transport_write_in_doubt;
    reg cpu_local_withdraw=0,cpu_hold=0;
    wire cpu_local_withdrawn;
    reg cpu_valid=0,cpu_write=0;
    reg [31:0] cpu_address=0,cpu_wdata=0,cpu_access=0;
    reg [2:0] cpu_size=4;
    wire dma_valid,dma_write,dma_hold,dma_ready;
    wire [31:0] dma_address,dma_wdata,dma_access;
    wire [2:0] dma_size;
    wire [3:0] dma_be;
    wire [7:0] dma_signals;
    wire dma_timeout_enable;
    wire [17:0] dma_wait_last;
    wire [2:0] rsp_valid,rsp_timeout,req_ready;
    wire [95:0] rsp_rdata,rsp_fault_code;
    wire local_valid,cart_valid,local_write,cart_write;
    wire local_ready,local_rsp_valid;
    wire cart_ready=1'b0,cart_rsp_valid=1'b0,cart_rsp_timeout=1'b0;
    wire [31:0] local_address,local_wdata,local_access,local_rdata,local_fault_code,cart_address,cart_wdata,cart_access;
    wire [31:0] cart_rdata=0,cart_fault_code=0;
    wire [2:0] cart_size_bytes;
    wire cart_data_timeout_enable;
    wire [17:0] cart_data_wait_last;
    wire [3:0] local_be_n,cart_be_n;
    wire [7:0] local_bus_signals,cart_bus_signals;
    wire other_valid,other_write; wire [31:0] other_address,other_wdata,other_access;
    wire [3:0] other_be_n;wire [7:0] other_bus_signals;
    reg other_rsp_valid=0,other_rsp_pending=0,other_ready=1,other_reply_allow=1;
    integer other_commits=0,before_other;
    reg [31:0] other_rdata=0,other_fault_code=0;
    core_local_dma_irq unit (
        .clk(clk), .reset_n(reset_n && power_reset_n), .local_valid(local_valid), .local_write(local_write),
        .local_address(local_address), .local_wdata(local_wdata), .local_access(local_access),
        .local_be_n(local_be_n), .local_bus_signals(local_bus_signals),
        .local_ready(local_ready), .local_rsp_valid(local_rsp_valid), .local_rdata(local_rdata), .local_fault_code(local_fault_code),
        .other_valid(other_valid), .other_write(other_write), .other_address(other_address), .other_wdata(other_wdata),
        .other_access(other_access), .other_be_n(other_be_n), .other_bus_signals(other_bus_signals),
        .other_ready(other_ready), .other_rsp_valid(other_rsp_valid), .other_rdata(other_rdata), .other_fault_code(other_fault_code),
        .system_valid(),.system_write(),.system_address(),.system_wdata(),
        .system_ready(1'b0),.system_rsp_valid(1'b0),.system_rdata(32'd0),.system_fault_code(32'd0),
        .external_irq_raise(external_irq_raise), .user_irq_raise(user_irq_raise), .irq_line(irq_line), .trigger_inhibit(trigger_inhibit),
        .admission_inhibit(admission_inhibit), .enter_supervisor(enter_supervisor),
        .leave_supervisor(leave_supervisor), .supervisor_boundary_ready(supervisor_boundary_ready),
        .local_boundary_ready(local_boundary_ready),
        .request_lines(request_lines), .port_address(port_address),
        .owns_read_port(owns_read_port), .owns_write_port(owns_write_port), .block_active(block_active),
        .active_channel(active_channel), .active_read_address(active_read_address), .active_write_address(active_write_address),
        .transport_failed(transport_failed), .transport_write_in_doubt(transport_write_in_doubt),
        .req_valid(dma_valid), .req_ready(dma_ready), .req_write(dma_write), .req_hold(dma_hold),
        .req_address(dma_address), .req_wdata(dma_wdata), .req_access(dma_access),
        .req_size_bytes(dma_size), .req_be_n(dma_be), .req_bus_signals(dma_signals),
        .req_data_timeout_enable(dma_timeout_enable), .req_data_wait_last(dma_wait_last),
        .rsp_valid(rsp_valid[1]), .rsp_timeout(rsp_timeout[1]), .rsp_rdata(rsp_rdata[63:32]));
    assign dma_ready=req_ready[1];
    always @(posedge clk) begin
        other_rsp_valid<=0;
        if(other_valid && other_ready) begin
            other_rsp_pending<=1;other_commits<=other_commits+1;
            if(other_address!==32'h08000024 || other_be_n!==0 || other_bus_signals!==0)
                $fatal(1,"non-DMA local payload changed");
            other_rdata<=32'h1234abcd;other_fault_code<=0;
        end
        if(other_rsp_pending && other_reply_allow) begin
            other_rsp_valid<=1;other_rsp_pending<=0;
        end
    end
    wire [2:0] req_valid={1'b0,dma_valid,cpu_valid},req_write={1'b0,dma_write,cpu_write},
        req_hold={1'b0,dma_hold,cpu_hold};
    wire [95:0] req_address={32'd0,dma_address,cpu_address},req_wdata={32'd0,dma_wdata,cpu_wdata},
        req_access={32'd0,dma_access,cpu_access};
    wire [8:0] req_size_bytes={3'd4,dma_size,cpu_size};
    wire [23:0] req_bus_signals={8'd0,dma_signals,8'd0};
    wire [2:0] req_data_timeout_enable={1'b0,dma_timeout_enable,1'b0};
    wire [11:0] req_be_n={4'd0,dma_be,4'd0};
    wire [53:0] req_data_wait_last={18'd0,dma_wait_last,18'd0};
    wire memory_ready,block_locked,sys_bus_busy,sys_bus_request;
    wire sys_bus_owned=1'b1;
    tri [31:0] sys_ad,md;
    tri1 sys_ready_n,sys_as_n,sys_rd_n,sys_wr_n;
    tri1 [3:0] sys_be_n;
    wire cs_rom_n,cs_io_n,cs_gpu_n,cs_pcrtc_n,cs_apu_n;
    wire [9:0] ma;
    wire mras_n,mwe_n,moe_n;
    wire [3:0] mcas_n;
    core_memory_system core(.geo_raw_memory(1'b1),.cpu_private(1'b0),.mras_private_n(),.moe_private_n(),.*);
    is41lv16100_pair_model memory(.clk(clk),.power_reset_n(power_reset_n),.ma(ma),.md(md),
        .ras_n(mras_n),.cas_n(mcas_n),.we_n(mwe_n),.oe_n(moe_n));

    integer blocks=0,transactions=0,cycles=0,other_owner_verified=0;
    reg prev_active=0;
    reg [3:0] block_order=0;
    always @(posedge clk) if(reset_n && power_reset_n) begin
        prev_active<=block_active;
        if(block_active && !prev_active) begin
            block_order<={block_order[2:0],active_channel}; blocks<=blocks+1;
            if(active_channel && !request_lines[11]) $fatal(1,"Channel 1 bypassed request gate");
        end
        if(dma_valid && dma_ready) transactions<=transactions+1;
        if(rsp_valid[1] && (rsp_fault_code[63:32]!=0 || rsp_timeout[1]))
            $fatal(1,"Unexpected DMA fabric fault/timeout");
    end
    task automatic transfer(input bit writing, input [31:0] addr,data,
                            input [2:0] size, input [31:0] expected_data,expected_fault);
        begin
            @(negedge clk);cpu_valid=1;cpu_write=writing;cpu_address=addr;cpu_wdata=data;
            cpu_size=size;cpu_access=writing ? 32'h402 : 32'h401;
            do @(posedge clk);while(!req_ready[0]);
            @(negedge clk);cpu_valid=0;
            while(!rsp_valid[0]) @(negedge clk);
            if(rsp_timeout[0] || rsp_fault_code[31:0]!==expected_fault || (!writing && rsp_rdata[31:0]!==expected_data))
                $fatal(1,"CPU access %h data %h fault %h expected %h %h",addr,rsp_rdata[31:0],rsp_fault_code[31:0],expected_data,expected_fault);
        end
    endtask
    task automatic wr(input bit ch,input [2:0] idx,input [31:0] data);
        transfer(1,(ch ? 32'h080103e4 : 32'h0800000c)+4*idx,data,4,0,0);
    endtask
    task automatic rd(input bit ch,input [2:0] idx,input [31:0] value);
        transfer(0,(ch ? 32'h080103e4 : 32'h0800000c)+4*idx,0,4,value,0);
    endtask
    integer k;
    initial begin #5000000; $fatal(1,"Integration watchdog"); end
    initial begin
        #1;
        for(k=0;k<4;k=k+1) begin
            memory.words[20'h08000+k]=32'h12340000+k;
            memory.words[20'h08400+k]=32'h56780000+k;
            memory.words[20'h0c000+k]=32'hffffffff;
            memory.words[20'h0c400+k]=32'hffffffff;
        end
        repeat(8) @(negedge clk);power_reset_n=1;reset_n=1;
        wait(memory_ready);
        wr(0,0,32'h08020000);wr(0,1,32'h08030000);wr(0,2,4);wr(0,3,32'h403);
        wr(1,0,32'h08021000);wr(1,1,32'h08031000);wr(1,2,4);wr(1,3,32'h42f);
        wr(1,5,1);rd(1,4,1);
        admission_inhibit=0;
        repeat(8) @(negedge clk);
        if(blocks!=0 || block_active) $fatal(1,"Closed request gate admitted channel 1");
        admission_inhibit=1;
        wr(0,5,1);
        rd(0,4,1);rd(1,4,1);
        repeat(6) @(negedge clk);if(blocks!=0) $fatal(1,"Admission inhibit ignored");
        admission_inhibit=0;
        wait(block_active);if(active_channel!==0) $fatal(1,"Gated channel admitted first");
        repeat(4) @(negedge clk);
        if(blocks!=1 || active_channel!==0) $fatal(1,"Request gate did not hold second channel");
        request_lines[11]=1;
        cycles=0;
        while(unit.pending[0]!==1 || unit.pending[8]!==1) begin
            @(negedge clk);cycles=cycles+1;
            if(cycles>4000) $fatal(1,"DMA channels did not finish");
        end
        if(blocks!=4 || block_order!==4'b0101 || transactions!=16 || transport_failed || transport_write_in_doubt)
            $fatal(1,"Block order/count/failure %0d %b %0d",blocks,block_order,transactions);
        rd(0,0,32'h08020010);rd(0,1,32'h08030010);rd(0,2,0);rd(0,4,2);
        rd(1,0,32'h08021010);rd(1,1,32'h08031010);rd(1,2,0);rd(1,4,2);
        for(k=0;k<4;k=k+1) begin
            if(memory.words[20'h08000+k]!==32'h12340000+k || memory.words[20'h0c000+k]!==32'h12340000+k ||
               memory.words[20'h08400+k]!==32'h56780000+k || memory.words[20'h0c400+k]!==32'h56780000+k)
                $fatal(1,"DMA RAM result mismatch index %0d: %h %h %h %h",k, memory.words[20'h08000+k],memory.words[20'h0c000+k],memory.words[20'h08400+k],memory.words[20'h0c400+k]);
        end
        transfer(0,32'h08000000,0,4,32'h101,0);
        if(irq_line) $fatal(1,"masked pending raised IRQ line");
        transfer(1,32'h08000008,32'h101,4,0,0);
        if(!irq_line) $fatal(1,"enabling pending DMA interrupts did not assert line");
        transfer(1,32'h08000004,1,4,0,0);
        transfer(0,32'h08000000,0,4,32'h100,0);
        if(!irq_line) $fatal(1,"selective ACK erased other pending source");
        transfer(1,32'h08000004,32'h100,4,0,0);
        if(irq_line) $fatal(1,"all enabled pending sources acknowledged");
        transfer(0,32'h08000004,0,4,0,0);
        transfer(1,32'h08000000,32'hffffffff,4,0,3);
        transfer(1,32'h0800001c,32'hffffffff,4,0,3);
        transfer(0,32'h08000008,0,1,1,0);
        transfer(1,32'h08000008,0,1,0,2);
        transfer(0,32'h08000024,0,4,32'h1234abcd,0);
        // Newly raised events must survive a simultaneous ACK on the same edge.
        @(negedge clk);external_irq_raise=32'h80000040;
        @(negedge clk);external_irq_raise=0;
        transfer(0,32'h08000000,0,4,32'h80000040,0);
        transfer(1,32'h08000008,32'h80000040,4,0,0);
        fork
            transfer(1,32'h08000004,32'h80000040,4,0,0);
            begin
                wait(local_valid && local_address==32'h08000004);
                @(negedge clk);external_irq_raise=32'h80000040;
                @(negedge clk);external_irq_raise=0;
            end
        join
        transfer(0,32'h08000000,0,4,32'h80000040,0);
        if(!irq_line) $fatal(1,"concurrent raise lost to ACK");
        transfer(1,32'h08000004,32'hffffffff,4,0,0);
        if(irq_line) $fatal(1,"ACK did not clear full pending word");
        // The DMA datapath itself writes a local IRQ register via CORE, not
        // a testbench shortcut. Its completion still raises its own IRQ.
        wr(0,0,32'h08020000);wr(0,1,32'h08000008);wr(0,2,1);wr(0,3,1);wr(0,5,1);
        cycles=0;
        while(!unit.pending[0]) begin
            @(negedge clk);cycles=cycles+1;if(cycles>1000) $fatal(1,"DMA local destination stalled");
        end
        transfer(0,32'h08000008,0,4,32'h12340000,0);
        transfer(0,32'h08000000,0,4,1,0);
        transfer(1,32'h08000004,1,4,0,0);
        // A stalled CPU TRIGGER cannot monopolize LOCAL while an already
        // admitted DMA block still needs LOCAL to write its destination.
        admission_inhibit=1;trigger_inhibit=0;
        wr(0,0,32'h08020000);wr(0,1,32'h08000008);wr(0,2,1);wr(0,3,1);wr(0,5,1);
        trigger_inhibit=1;
        @(negedge clk);cpu_hold=1;cpu_valid=1;cpu_write=1;cpu_address=32'h080103f8;cpu_wdata=1;cpu_access=32'h402;cpu_size=4;
        do @(posedge clk);while(!req_ready[0]);
        @(negedge clk);cpu_valid=0;
        wait(local_valid && local_address==32'h080103f8 && !local_ready);
        if(!block_locked || core.locked_owner!=0) $fatal(1,"CPU held request did not reserve CORE");
        admission_inhibit=0;wait(block_active);
        @(negedge clk);admission_inhibit=1;cpu_local_withdraw=1;
        @(posedge clk);#1;
        if(!cpu_local_withdrawn || rsp_valid[0]) $fatal(1,"withdraw did not cancel only unaccepted CPU write");
        if(block_locked) $fatal(1,"withdrawn CPU write retained its reservation");
        @(negedge clk);cpu_local_withdraw=0;cpu_hold=0;
        cycles=0;
        while(!unit.pending[0]) begin
            @(negedge clk);cycles=cycles+1;
            if(rsp_valid[0]) $fatal(1,"withdrawn CPU store unexpectedly completed");
            if(cycles>1000) $fatal(1,"DMA blocked by withdrawn CPU TRIGGER");
        end
        transfer(0,32'h08000008,0,4,32'h12340000,0);
        transfer(0,32'h080103f4,0,4,2,0); // prior channel-1 DONE was not restarted
        transfer(1,32'h08000004,1,4,0,0);
        // A successful CPU withdrawal must not clear a different client's
        // existing DMA block reservation.
        admission_inhibit=1;trigger_inhibit=0;
        wr(0,0,32'h08020000);wr(0,1,32'h08000008);wr(0,2,1);wr(0,3,1);wr(0,5,1);
        trigger_inhibit=1;
        @(negedge clk);cpu_valid=1;cpu_write=1;cpu_address=32'h080103f8;cpu_wdata=1;cpu_access=32'h402;
        do @(posedge clk);while(!req_ready[0]);
        @(negedge clk);cpu_valid=0;
        wait(local_valid && local_address==32'h080103f8 && !local_ready);
        admission_inhibit=0;wait(block_locked && core.locked_owner==1);
        @(negedge clk);admission_inhibit=1;cpu_local_withdraw=1;
        @(posedge clk);#1;
        if(!cpu_local_withdrawn || !block_locked || core.locked_owner!=1)
            $fatal(1,"CPU withdrawal released a distinct DMA reservation");
        @(negedge clk);cpu_local_withdraw=0;
        cycles=0;
        while(!unit.pending[0]) begin
            @(negedge clk);cycles=cycles+1;
            if(cycles>1000) $fatal(1,"DMA failed after CPU withdrawal");
        end
        transfer(1,32'h08000004,1,4,0,0);
        // Consumer acceptance on the withdrawal edge wins and completes once.
        other_ready=0;before_other=other_commits;
        @(negedge clk);cpu_valid=1;cpu_write=1;cpu_address=32'h08000024;cpu_wdata=32'hdeadbeef;cpu_access=32'h402;
        do @(posedge clk);while(!req_ready[0]);
        @(negedge clk);cpu_valid=0;
        wait(other_valid);@(negedge clk);other_ready=1;cpu_local_withdraw=1;
        @(posedge clk);#1;if(cpu_local_withdrawn) $fatal(1,"accepted write was withdrawn");
        @(negedge clk);cpu_local_withdraw=0;
        while(!rsp_valid[0]) @(negedge clk);
        if(rsp_fault_code[31:0]!=0 || rsp_timeout[0]) $fatal(1,"accepted write did not complete");
        repeat(3) @(negedge clk);
        if(other_commits!=before_other+1) $fatal(1,"accepted write was replayed");
        // A continuously asserted withdrawn CPU candidate cannot starve a
        // simultaneously offered DMA request before the block is reserved.
        admission_inhibit=1;trigger_inhibit=0;
        wr(0,0,32'h08020000);wr(0,1,32'h08000008);wr(0,2,1);wr(0,3,1);wr(0,5,1);
        @(negedge clk);cpu_valid=1;cpu_write=1;cpu_address=32'h080103f8;cpu_wdata=1;
        cpu_local_withdraw=1;admission_inhibit=0;
        cycles=0;
        while(!unit.pending[0]) begin
            @(negedge clk);cycles=cycles+1;
            if(req_ready[0] || rsp_valid[0]) $fatal(1,"withdrawn CPU candidate was readmitted");
            if(block_locked && core.locked_owner==1 && !dma_write && !other_owner_verified) begin
                @(negedge clk);
                if(!block_locked || core.locked_owner!=1) $fatal(1,"withdraw released DMA reservation");
                other_owner_verified=1;
            end
            if(cycles>1000) $fatal(1,"withdrawn CPU candidate starved DMA");
        end
        if(!other_owner_verified) $fatal(1,"DMA reservation was not exercised during withdrawal");
        @(negedge clk);cpu_valid=0;cpu_local_withdraw=0;admission_inhibit=1;
        transfer(1,32'h08000004,1,4,0,0);
        // An old LOCAL request must drain both endpoint backpressure and its
        // accepted, delayed response before SYSTEM may exchange contexts.
        trigger_inhibit=1;admission_inhibit=1;other_ready=0;other_reply_allow=0;
        fork
            transfer(0,32'h08000024,0,4,32'h1234abcd,0);
            begin
                wait(other_valid);
                @(negedge clk);
                if(local_boundary_ready || supervisor_boundary_ready) $fatal(1,"unaccepted LOCAL request did not block boundary");
                other_ready=1;wait(other_rsp_pending);
                @(negedge clk);
                if(local_boundary_ready || supervisor_boundary_ready) $fatal(1,"accepted LOCAL request awaiting response did not block boundary");
                other_reply_allow=1;
            end
        join
        wait(supervisor_boundary_ready);
        // IRQ and DMA context switch share the SYSTEM edge. An event from
        // the retained user producer can arrive during supervisor service.
        transfer(1,32'h08000008,4,4,0,0);
        @(negedge clk);external_irq_raise=4;
        @(negedge clk);external_irq_raise=0;trigger_inhibit=1;admission_inhibit=1;
        wait(supervisor_boundary_ready);
        @(negedge clk);enter_supervisor=1;external_irq_raise=16;user_irq_raise=8;
        @(negedge clk);enter_supervisor=0;external_irq_raise=0;user_irq_raise=0;
        transfer(0,32'h08000000,0,4,0,0);
        transfer(0,32'h08000008,0,4,0,0);
        @(negedge clk);external_irq_raise=32'h240;user_irq_raise=32;
        @(negedge clk);external_irq_raise=0;user_irq_raise=0;
        transfer(0,32'h08000000,0,4,32'h240,0);
        transfer(1,32'h08000008,64,4,0,0);
        if(!irq_line) $fatal(1,"supervisor IRQ did not assert");
        @(negedge clk);leave_supervisor=1;external_irq_raise=128;user_irq_raise=256;
        @(negedge clk);leave_supervisor=0;external_irq_raise=0;user_irq_raise=0;
        transfer(0,32'h08000000,0,4,32'h1bc,0);
        transfer(0,32'h08000008,0,4,4,0);
        if(!irq_line) $fatal(1,"retained user IRQ/mask not restored");
        transfer(1,32'h08000004,32'hffffffff,4,0,0);
        if(irq_line) $fatal(1,"restored IRQ ACK did not clear line");
        $display("PASS CORE DMA/IRQ mapped banks -> DRAM, event/ACK, user/supervisor banking and other local path; %0d scalar transfers",transactions);
        $finish;
    end
endmodule

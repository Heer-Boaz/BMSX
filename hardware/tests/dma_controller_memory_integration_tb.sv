`timescale 1ns/1ps
// Channel programming and arbitration through the actual CORE scalar DRAM
// owner and external DRAM pin model. CPU I/O decode and the IRQ bank are not
// part of this fixture; the register port and IRQ pulse are exercised directly.
module dma_controller_memory_integration_tb;
    reg clk=0; always #14.763 clk=!clk;
    reg reset_n=0,power_reset_n=0;
    reg access_valid=0,access_write=0,access_channel=0;
    reg [2:0] access_index=0;
    reg [31:0] access_wdata=0;
    wire access_ready;
    wire [31:0] access_rdata,access_fault;
    reg trigger_inhibit=0,admission_inhibit=1;
    reg [15:0] request_lines=0;
    wire [1:0] irq_raise;
    wire block_active,active_channel;
    wire [31:0] active_read_address,active_write_address;
    reg [31:0] port_address=0;
    wire owns_read_port,owns_write_port,transport_failed,transport_write_in_doubt;
    wire dma_valid,dma_write,dma_hold,dma_ready;
    wire [31:0] dma_address,dma_wdata,dma_access;
    wire [2:0] dma_size;
    wire [3:0] dma_be;
    wire [7:0] dma_signals;
    wire dma_timeout_enable;
    wire [17:0] dma_wait_last;
    wire [2:0] rsp_valid,rsp_timeout,req_ready;
    wire [95:0] rsp_rdata,rsp_fault_code;
    dma_channel_controller dma (
        .clk(clk),.reset_n(reset_n && power_reset_n),.access_valid(access_valid),
        .access_write(access_write),.access_channel(access_channel),.access_index(access_index),
        .access_wdata(access_wdata),.access_ready(access_ready),.access_rdata(access_rdata),
        .access_fault(access_fault),.trigger_inhibit(trigger_inhibit),.admission_inhibit(admission_inhibit),
        .enter_supervisor(1'b0),.leave_supervisor(1'b0),.supervisor_boundary_ready(),
        .request_lines(request_lines),.irq_raise(irq_raise),.block_active(block_active),
        .active_channel(active_channel),.active_read_address(active_read_address),
        .active_write_address(active_write_address),.port_address(port_address),
        .owns_read_port(owns_read_port),.owns_write_port(owns_write_port),
        .transport_failed(transport_failed),.transport_write_in_doubt(transport_write_in_doubt),
        .req_valid(dma_valid),.req_ready(dma_ready),.req_write(dma_write),.req_hold(dma_hold),
        .req_address(dma_address),.req_wdata(dma_wdata),.req_access(dma_access),
        .req_size_bytes(dma_size),.req_be_n(dma_be),.req_bus_signals(dma_signals),
        .req_data_timeout_enable(dma_timeout_enable),.req_data_wait_last(dma_wait_last),
        .rsp_valid(rsp_valid[1]),.rsp_timeout(rsp_timeout[1]),.rsp_rdata(rsp_rdata[63:32]));
    assign dma_ready=req_ready[1];
    // A CPU-like bus producer, not a complete CPU or an instruction-timing model.
    reg cpu_valid=0,cpu_write=0,must_begin_dma_locked=0;
    reg [31:0] cpu_address=0,cpu_wdata=0,cpu_access=0;
    reg [2:0] cpu_size=4;
    wire [2:0] req_valid={1'b0,dma_valid,cpu_valid},req_write={1'b0,dma_write,cpu_write},
        req_hold={1'b0,dma_hold,1'b0};
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
    wire local_valid,cart_valid,local_write,cart_write;
    wire local_ready=1'b0,cart_ready=1'b0;
    wire local_rsp_valid=1'b0,cart_rsp_valid=1'b0,cart_rsp_timeout=1'b0;
    wire [31:0] local_address,local_wdata,local_access,cart_address,cart_wdata,cart_access;
    wire [31:0] local_rdata=0,local_fault_code=0,cart_rdata=0,cart_fault_code=0;
    wire [2:0] cart_size_bytes;
    wire cart_data_timeout_enable;
    wire [17:0] cart_data_wait_last;
    wire [3:0] local_be_n,cart_be_n;
    wire [7:0] local_bus_signals,cart_bus_signals;
    wire cpu_local_withdrawn;
    wire cpu_local_withdraw=1'b0;
    core_memory_system core(.geo_raw_memory(1'b1),.cpu_private(1'b0),.mras_private_n(),.moe_private_n(),.*);
    is41lv16100_pair_model memory(.clk(clk),.power_reset_n(power_reset_n),.ma(ma),.md(md),
        .ras_n(mras_n),.cas_n(mcas_n),.we_n(mwe_n),.oe_n(moe_n));

    integer blocks=0,transactions=0,irq0=0,irq1=0,cycles=0,clock_count=0,dma_start_clock=0;
    integer last_cpu_admission_wait=0,last_cpu_submitted=0,last_cpu_response_elapsed=0;
    reg prev_active=0;
    reg [3:0] block_order=0;
    always @(posedge clk) if(reset_n && power_reset_n) begin
        clock_count<=clock_count+1;
        prev_active<=block_active;
        if(block_active && !prev_active) begin
            if(blocks==0) dma_start_clock=clock_count;
            block_order<={block_order[2:0],active_channel}; blocks<=blocks+1;
            if(active_channel && !request_lines[11]) $fatal(1,"Channel 1 bypassed its request gate");
        end
        if(dma_valid && dma_ready) transactions<=transactions+1;
        if(rsp_valid[1] && (rsp_fault_code[63:32]!=0 || rsp_timeout[1]))
            $fatal(1,"Unexpected fabric fault/timeout");
        if(local_valid || cart_valid || sys_bus_request) $fatal(1,"RAM copy selected external device");
        if(irq_raise[0]) begin
            $display("RAM_CHARACTERIZE candidate=CORE_closed_page workload=dma_channel0_two_blocks_with_cpu_and_channel1 words=4 read_and_write=8 first_block_to_irq_clocks=%0d",clock_count-dma_start_clock);
            if(dma.status[0]!==2 || dma.count[0]!==0 || dma.read_address[0]!==32'h08020010 ||
                dma.write_address[0]!==32'h08030010) $fatal(1,"Channel 0 IRQ before publication");
            irq0<=irq0+1;
        end
        if(irq_raise[1]) begin
            if(dma.status[1]!==2 || dma.count[1]!==0 || dma.read_address[1]!==32'h08021010 ||
                dma.write_address[1]!==32'h08031010) $fatal(1,"Channel 1 IRQ before publication");
            irq1<=irq1+1;
        end
    end
    // Clock counts span producer assertion to observed response. They include
    // this fixture's sequential handshakes and any refresh/arbitration; they
    // are not a measured CPU-instruction latency or a proposed guest tariff.
    task automatic cpu_scalar(input bit writing,input [2:0] size,input [31:0] address,
                              input [31:0] value,input [31:0] expected);
        integer submitted;
        begin
            @(negedge clk);
            submitted=clock_count;
            last_cpu_submitted=submitted;
            cpu_valid=1;cpu_write=writing;cpu_size=size;cpu_address=address;cpu_wdata=value;
            if(must_begin_dma_locked && !(block_locked && core.locked_owner==1))
                $fatal(1,"CPU request was not submitted while DMA owned CORE");
            cpu_access=(writing ? 32'h2 : 32'h1) | (size==1 ? 32'h100 : size==2 ? 32'h200 : 32'h400);
            do @(posedge clk); while(!req_ready[0]);
            if(must_begin_dma_locked && block_locked && core.locked_owner==1)
                $fatal(1,"CORE admitted CPU while DMA held the block");
            @(negedge clk);cpu_valid=0;
            must_begin_dma_locked=0;
            last_cpu_admission_wait=clock_count-submitted;
            while(!rsp_valid[0]) @(negedge clk);
            last_cpu_response_elapsed=clock_count-submitted;
            if(rsp_fault_code[31:0]!==0 || rsp_timeout[0] || (!writing && rsp_rdata[31:0]!==expected))
                $fatal(1,"CPU scalar addr=%h size=%0d write=%b data=%h fault=%h",address,size,writing,rsp_rdata[31:0],rsp_fault_code[31:0]);
        end
    endtask
    task automatic cpu_words(input integer words);
        integer i,start,refresh_start,span_start,transaction_clocks,span;
        begin
            start=clock_count;refresh_start=memory.refreshes;span_start=start;transaction_clocks=0;
            for(i=0;i<words;i=i+1) begin
                cpu_scalar(1,4,32'h080c0000+4*i,32'hcafe0000+i,0);
                if(i==0) span_start=last_cpu_submitted;
                transaction_clocks=transaction_clocks+last_cpu_response_elapsed;
            end
            span=words==0 ? 0 : clock_count-span_start;
            $display("RAM_CHARACTERIZE candidate=CORE_closed_page workload=cpu_sequential_u32_write words=%0d fixture_elapsed=%0d first_assertion_to_last_response=%0d transaction_clocks=%0d producer_gaps=%0d refreshes=%0d",words,clock_count-start,span,transaction_clocks,span-transaction_clocks,memory.refreshes-refresh_start);
            for(i=0;i<words;i=i+1)
                cpu_scalar(0,4,32'h080c0000+4*i,0,32'hcafe0000+i);
        end
    endtask
    task automatic wr(input bit ch,input [2:0] idx,input [31:0] data);
        begin
            @(negedge clk);access_valid=1;access_write=1;access_channel=ch;access_index=idx;access_wdata=data;
            do @(posedge clk);while(!access_ready);
            if(access_fault!=0) $fatal(1,"Unexpected register write fault");
            @(negedge clk);access_valid=0;access_write=0;
        end
    endtask
    task automatic rd(input bit ch,input [2:0] idx,input [31:0] expected);
        begin
            @(negedge clk);access_valid=1;access_write=0;access_channel=ch;access_index=idx;#1;
            if(access_rdata!==expected) $fatal(1,"Channel %0d register %0d: %h != %h",ch,idx,access_rdata,expected);
            @(negedge clk);access_valid=0;
        end
    endtask
    integer k,start,refresh_start;
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
        start=clock_count;
        cpu_scalar(1,1,32'h080c0020,32'hab,0);
        $display("RAM_CHARACTERIZE candidate=CORE_closed_page workload=cpu_u8_write fixture_elapsed=%0d assertion_to_response=%0d",clock_count-start,last_cpu_response_elapsed);start=clock_count;
        cpu_scalar(0,1,32'h080c0020,0,32'hab);
        $display("RAM_CHARACTERIZE candidate=CORE_closed_page workload=cpu_u8_read fixture_elapsed=%0d assertion_to_response=%0d",clock_count-start,last_cpu_response_elapsed);start=clock_count;
        cpu_scalar(1,2,32'h080c0022,32'hcdef,0);
        $display("RAM_CHARACTERIZE candidate=CORE_closed_page workload=cpu_u16_write fixture_elapsed=%0d assertion_to_response=%0d",clock_count-start,last_cpu_response_elapsed);start=clock_count;
        cpu_scalar(0,2,32'h080c0022,0,32'hcdef);
        $display("RAM_CHARACTERIZE candidate=CORE_closed_page workload=cpu_u16_read fixture_elapsed=%0d assertion_to_response=%0d",clock_count-start,last_cpu_response_elapsed);start=clock_count;
        cpu_scalar(1,4,32'h080c0028,32'h12345678,0);
        $display("RAM_CHARACTERIZE candidate=CORE_closed_page workload=cpu_u32_write fixture_elapsed=%0d assertion_to_response=%0d",clock_count-start,last_cpu_response_elapsed);start=clock_count;
        cpu_scalar(0,4,32'h080c0028,0,32'h12345678);
        $display("RAM_CHARACTERIZE candidate=CORE_closed_page workload=cpu_u32_read fixture_elapsed=%0d assertion_to_response=%0d",clock_count-start,last_cpu_response_elapsed);
        // Raw bus capability only: BLua aligned scalar instructions reject
        // these addresses before issuing a request.
        start=clock_count;
        cpu_scalar(1,2,32'h080c0023,32'hcdef,0);
        cpu_scalar(0,2,32'h080c0023,0,32'hcdef);
        cpu_scalar(1,4,32'h080c0029,32'h12345678,0);
        cpu_scalar(0,4,32'h080c0029,0,32'h12345678);
        $display("RAM_CHARACTERIZE candidate=CORE_closed_page workload=raw_unaligned_u16_u32_write_read operations=4 fixture_elapsed=%0d",clock_count-start);
        // This represents the public F64 transport as two x32 bus requests;
        // there is no integrated F64 CPU instruction producer in this fixture.
        start=clock_count;
        cpu_scalar(1,4,32'h080c0100,32'h00000000,0);
        cpu_scalar(1,4,32'h080c0104,32'h40310000,0);
        $display("RAM_CHARACTERIZE candidate=CORE_closed_page workload=f64_pair_write words=2 fixture_elapsed=%0d",clock_count-start);start=clock_count;
        cpu_scalar(0,4,32'h080c0100,0,32'h00000000);
        cpu_scalar(0,4,32'h080c0104,0,32'h40310000);
        $display("RAM_CHARACTERIZE candidate=CORE_closed_page workload=f64_pair_read words=2 fixture_elapsed=%0d",clock_count-start);
        cpu_words(0);cpu_words(1);cpu_words(4);cpu_words(16);cpu_words(256);
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
        fork
            begin
                wait(block_locked && core.locked_owner==1);
                must_begin_dma_locked=1;
                start=clock_count;refresh_start=memory.refreshes;
                cpu_scalar(0,4,32'h080c0000,0,32'hcafe0000);
                $display("RAM_CHARACTERIZE candidate=CORE_closed_page workload=cpu_read_contending_dma fixture_elapsed=%0d assertion_to_response=%0d admission_wait=%0d refreshes=%0d",clock_count-start,last_cpu_response_elapsed,last_cpu_admission_wait,memory.refreshes-refresh_start);
            end
            begin
                repeat(4) @(negedge clk);
                if(blocks!=1 || active_channel!==0) $fatal(1,"Request gate did not hold second channel");
                request_lines[11]=1;
            end
        join
        cycles=0;
        while(irq0!=1 || irq1!=1) begin
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
        repeat(6) @(negedge clk);
        if(irq0!=1 || irq1!=1) $fatal(1,"Repeated completion interrupt");
        $display("PASS DMA channel controller -> CORE -> DRAM pins: two 2-word blocks per channel, request gate, round robin, writeback and IRQ ordering; %0d scalar transfers",transactions);
        $finish;
    end
endmodule

`timescale 1ns/1ps
// Actual block engine -> CORE request owner -> shared CAD arbiter -> U51 ->
// independent socket peers.  Cards expose finite ROM/RAM and mailbox behavior;
// this is not an implementation of DMA's two register banks or IRQ scheduler.
module dma_block_integration_tb;
    reg clk=0;
    always #14.763 clk=!clk;
    reg reset_n=1,power_reset_n=1,block_valid=0;
    reg cpu_valid=0,geo_valid=0,sys_model_enable=0,watch_reservation=0;
    reg watch_ram_only=0;
    reg [31:0] block_read_address=0,block_write_address=0,block_transfer_count=0,block_control=0;
    wire block_ready,result_valid,result_timeout,result_write_in_doubt;
    wire [31:0] result_read_address,result_write_address,result_transfer_count;
    wire dma_valid,dma_write,dma_hold,dma_ready;
    wire [31:0] dma_address,dma_wdata,dma_access;
    wire [2:0] dma_size;
    wire [3:0] dma_be;
    wire [7:0] dma_signals;
    wire dma_timed;
    wire [17:0] dma_last;
    wire [2:0] req_valid={geo_valid,dma_valid,cpu_valid},req_write={1'b0,dma_write,1'b0},
        req_hold={1'b0,dma_hold,1'b0};
    wire [2:0] req_ready,rsp_valid,rsp_timeout;
    wire [95:0] req_address={32'h10000000,dma_address,32'h10000000},req_wdata={32'd0,dma_wdata,32'd0},
        req_access={32'h401,dma_access,32'h401};
    wire [95:0] rsp_rdata,rsp_fault_code;
    wire [8:0] req_size_bytes={3'd4,dma_size,3'd4};
    wire [23:0] req_bus_signals={8'd0,dma_signals,8'd0};
    wire [2:0] req_data_timeout_enable={1'b0,dma_timed,1'b0};
    wire [11:0] req_be_n={4'd0,dma_be,4'd0};
    wire [53:0] req_data_wait_last={18'd0,dma_last,18'd0};
    assign dma_ready=req_ready[1];
    dma_block_transfer dma (
        .clk(clk),.reset_n(reset_n),.block_valid(block_valid),.block_ready(block_ready),
        .block_read_address(block_read_address),.block_write_address(block_write_address),
        .block_transfer_count(block_transfer_count),.block_control(block_control),
        .result_valid(result_valid),.result_read_address(result_read_address),
        .result_write_address(result_write_address),.result_transfer_count(result_transfer_count),
        .result_timeout(result_timeout),.result_write_in_doubt(result_write_in_doubt),
        .req_valid(dma_valid),.req_write(dma_write),.req_hold(dma_hold),.req_ready(dma_ready),
        .req_address(dma_address),.req_wdata(dma_wdata),.req_access(dma_access),
        .req_size_bytes(dma_size),.req_be_n(dma_be),.req_bus_signals(dma_signals),
        .req_data_timeout_enable(dma_timed),.req_data_wait_last(dma_last),
        .rsp_valid(rsp_valid[1]),.rsp_timeout(rsp_timeout[1]),.rsp_rdata(rsp_rdata[63:32]));

    wire memory_ready,block_locked,sys_bus_busy,sys_bus_request;
    wire sys_bus_owned=sys_model_enable;
    tri [31:0] sys_ad,md;
    // A data-stage response followed by an absent RESPONSE handshake exercises
    // the physical transport timeout without a DMA DATA deadline.
    wire sys_ready_n=!(sys_model_enable && sys_as_n && !sys_rd_n && sys_wr_n);
    assign sys_ad = sys_model_enable && sys_as_n && !sys_rd_n && sys_wr_n ? 32'h12345678 : 32'hzzzzzzzz;
    tri sys_as_n,sys_rd_n,sys_wr_n;
    tri [3:0] sys_be_n;
    wire cs_rom_n,cs_io_n,cs_gpu_n,cs_pcrtc_n,cs_apu_n;
    wire [9:0] ma;
    wire mras_n,mwe_n,moe_n;
    wire [3:0] mcas_n;
    wire local_valid,cart_valid,local_write,cart_write,cart_ready,cart_rsp_valid;
    wire local_ready=1,local_rsp_valid=0;
    wire [31:0] local_address,local_wdata,local_access,cart_address,cart_wdata,cart_access;
    wire [31:0] local_rdata=0,local_fault_code=0;
    wire [31:0] cart_rdata,cart_fault_code;
    wire [3:0] local_be_n,cart_be_n;
    wire [7:0] local_bus_signals,cart_bus_signals;
    wire [2:0] cart_size_bytes;
    wire cart_data_timeout_enable,cart_rsp_timeout;
    wire [17:0] cart_data_wait_last;
    wire cpu_local_withdrawn;
    wire cpu_local_withdraw=1'b0;
    core_memory_system core(.geo_raw_memory(1'b1),.cpu_private(1'b0),.mras_private_n(),.moe_private_n(),.*);
    is41lv16100_pair_model memory(.clk(clk),.power_reset_n(power_reset_n),.ma(ma),.md(md),
        .ras_n(mras_n),.cas_n(mcas_n),.we_n(mwe_n),.oe_n(moe_n));

    tri [15:0] cad,card_cad;
    wire cal_lo,cal_hi,cart_clk,crd_n,cwr_n,cart_dir,cart_oe_n;
    wire [1:0] cbe_n,cs_cart_n,cart_ready_n;
    wire drive_to_card,drive_to_core;
    reg [1:0] stalled_cards=0;
    wire [1:0] cad_req_ready,cad_rsp_valid,cad_rsp_timeout;
    wire [63:0] cad_rsp_data,cad_rsp_fault;
    assign cart_ready=cad_req_ready[0];
    assign cart_rsp_valid=cad_rsp_valid[0];
    assign cart_rdata=cad_rsp_data[31:0];
    assign cart_fault_code=cad_rsp_fault[31:0];
    assign cart_rsp_timeout=cad_rsp_timeout[0];
    cart_rom_arbiter bridge (
        .clk(clk),.reset_n(reset_n && power_reset_n),.req_valid({1'b0,cart_valid}),
        .req_cancel(2'b00),.req_ready(cad_req_ready),.req_address({32'd0,cart_address}),
        .req_write({1'b0,cart_write}),.req_size_bytes({3'd4,cart_size_bytes}),
        .req_wdata({32'd0,cart_wdata}),.req_bus_signals({8'd0,cart_bus_signals}),
        .selected_socket(1'b0),.req_data_timeout_enable({1'b0,cart_data_timeout_enable}),
        .req_data_wait_last({18'd0,cart_data_wait_last}),.rsp_valid(cad_rsp_valid),
        .rsp_data(cad_rsp_data),.rsp_fault_code(cad_rsp_fault),.rsp_timeout(cad_rsp_timeout),
        .cad(cad),.cart_ready_n(cart_ready_n),.cart_present_n(2'b00),
        .cal_lo(cal_lo),.cal_hi(cal_hi),.cart_clk(cart_clk),.crd_n(crd_n),.cwr_n(cwr_n),
        .cbe_n(cbe_n),.cs_cart_n(cs_cart_n),.cart_dir(cart_dir),.cart_oe_n(cart_oe_n));
    cart_bus_buffer_model buffer(.reset_n(reset_n),.oe_n(cart_oe_n),.dir(cart_dir),
        .cad_core(cad),.cad_card(card_cad),.drive_to_card(drive_to_card),.drive_to_core(drive_to_core));
    wire [1:0] irq_n,dreq_r,dreq_w;
    genvar s;
    generate for(s=0;s<2;s=s+1) begin: cards
        cart_scalar_card_peer #(.RAM_BYTES(12),.ROM_BYTES(12)) card (
            .clk(clk),.reset_n(reset_n),.cs_n(cs_cart_n[s]),.cal_lo(cal_lo),.cal_hi(cal_hi),
            .rd_n(crd_n),.wr_n(cwr_n),.be_n(cbe_n),.stall(stalled_cards[s]),
            .cad(card_cad),.ready_n(cart_ready_n[s]),.irq_n(irq_n[s]),
            .dreq_read(dreq_r[s]),.dreq_write(dreq_w[s]));
    end endgenerate

    integer requests=0, faults=0, competitors=0;
    reg dma_last_write=0;
    always @(posedge clk) if(reset_n) begin
        if(drive_to_card && drive_to_core) $fatal(1,"CAD contention");
        if(watch_ram_only && (local_valid || cart_valid || sys_bus_request ||
           !cs_io_n || !cs_gpu_n || !cs_pcrtc_n || !cs_apu_n || !cs_rom_n))
            $fatal(1,"RAM-only DMA incorrectly selected an I/O or other external target");
        if(rsp_valid[1] && (rsp_timeout[1] || dma_last_write)) watch_reservation=0;
        if((req_ready[0] && cpu_valid) || (req_ready[2] && geo_valid)) begin
            if(watch_reservation) $fatal(1,"DMA reservation lost before final write or timeout");
            if(req_ready[0]) cpu_valid<=0;
            if(req_ready[2]) geo_valid<=0;
            competitors=competitors+1;
        end
        if(rsp_valid[1] && rsp_fault_code[63:32]!=0) faults=faults+1;
        if(dma_valid && dma_ready) begin
            requests=requests+1;
            dma_last_write=dma_write && dma_signals[1];
            if(dma_size!==4 || dma_be!==0 || dma_timed!==0 || dma_access!==(dma_write ? 32'h402 : 32'h401))
                $fatal(1,"DMA request representation");
        end
    end
    task automatic submit(input [31:0] src,dst,count,ctrl);
        begin
            @(negedge clk);block_read_address=src;block_write_address=dst;
            block_transfer_count=count;block_control=ctrl;block_valid=1;
            do @(posedge clk);while(!block_ready);
            @(negedge clk);block_valid=0;
            // Changes after admission must not modify the active block.
            block_read_address=0;block_write_address=0;block_transfer_count=0;block_control=0;
        end
    endtask
    task automatic finish(input [31:0] rd,wr,count);
        integer clocks;
        begin
            clocks=0;
            while(!result_valid) begin @(negedge clk);clocks=clocks+1;
                if(clocks>2000) $fatal(1,"DMA block timeout");
            end
            if(result_timeout || result_write_in_doubt || result_read_address!==rd ||
               result_write_address!==wr || result_transfer_count!==count)
                $fatal(1,"DMA writeback actual %h %h %h expected %h %h %h",result_read_address,result_write_address,result_transfer_count,rd,wr,count);
        end
    endtask
    integer before_requests,before_faults,before_competitors,cycles;
    initial begin
        #2;reset_n=0;power_reset_n=0;repeat(20) @(negedge clk);power_reset_n=1;reset_n=1;
        wait(memory_ready);repeat(4) @(negedge clk);
        before_requests=requests;
        submit(32'h10000001,32'h30000001,0,32'h260);
        finish(32'h10000001,32'h30000001,0);
        if(requests!=before_requests) $fatal(1,"zero block issued a bus operation");
        // Odd source and destination remain one raw U32 scalar; selectors
        // independently override source socket 0 and destination socket 1.
        submit(32'h10000001,32'h30000001,1,32'h260);
        finish(32'h10000001,32'h30000001,0);
        if(cards[1].card.ram[1]!==8'h11 || cards[1].card.ram[2]!==8'h12 ||
           cards[1].card.ram[3]!==8'h13 || cards[1].card.ram[4]!==8'h14)
            $fatal(1,"odd card-to-card copy or socket override");
        // A two-word block out of a four-word count writes back only two.
        submit(32'h10000000,32'h30000000,4,32'h663);
        finish(32'h10000008,32'h30000008,2);
        if(cards[1].card.ram[0]!==8'h10 || cards[1].card.ram[7]!==8'h17)
            $fatal(1,"incrementing two-word block");
        // Real DMA requests retain their unaligned U32 addresses.  The RAM
        // owner splits each into native cycles without overwriting neighbors.
        memory.words[20'h08000]=32'h11223344;
        memory.words[20'h08001]=32'h55667788;
        memory.words[20'h08002]=32'h99aabbcc;
        memory.words[20'h0c000]=32'haabbccdd;
        memory.words[20'h0c001]=32'heeff0011;
        memory.words[20'h0c002]=32'h22334455;
        before_requests=requests;before_faults=faults;watch_ram_only=1;
        submit(32'h08020001,32'h08030002,2,32'h403);
        finish(32'h08020009,32'h0803000a,0);
        if(requests-before_requests!=4 || faults!=before_faults ||
           memory.words[20'h08000]!==32'h11223344 || memory.words[20'h08001]!==32'h55667788 ||
           memory.words[20'h08002]!==32'h99aabbcc || memory.words[20'h0c000]!==32'h2233ccdd ||
           memory.words[20'h0c001]!==32'h66778811 || memory.words[20'h0c002]!==32'h2233cc55)
            $fatal(1,"unaligned incrementing RAM-to-RAM block changed data or neighbors");

        // The complete four-byte extent crosses the I/O aperture end.  It is
        // therefore raw main RAM rather than a partial register operation.
        memory.words[20'h0410f]=32'h11223344;
        memory.words[20'h04110]=32'h55667788;
        memory.words[20'h10000]=32'haabbccdd;
        memory.words[20'h10001]=32'heeff0011;
        before_requests=requests;
        submit(32'h0801043e,32'h08040001,1,32'h003);
        finish(32'h08010442,32'h08040005,0);
        if(requests-before_requests!=2 || faults!=before_faults ||
           memory.words[20'h0410f]!==32'h11223344 || memory.words[20'h04110]!==32'h55667788 ||
           memory.words[20'h10000]!==32'h881122dd || memory.words[20'h10001]!==32'heeff0077)
            $fatal(1,"DMA read across I/O aperture end did not use main RAM");
        before_requests=requests;
        submit(32'h08040001,32'h0801043f,1,32'h003);
        finish(32'h08040005,32'h08010443,0);
        if(requests-before_requests!=2 || faults!=before_faults ||
           memory.words[20'h0410f]!==32'h22223344 || memory.words[20'h04110]!==32'h55778811 ||
           memory.words[20'h10000]!==32'h881122dd || memory.words[20'h10001]!==32'heeff0077)
            $fatal(1,"DMA write across I/O aperture end did not use main RAM");
        watch_ram_only=0;
        // Read fault still issues the destination write and completes count.
        before_requests=requests;
        submit(32'h31000000,32'h30000000,1,32'h240);
        finish(32'h31000000,32'h30000000,0);
        if(requests-before_requests!=2 || faults!=1 ||
           cards[1].card.ram[0]!==0 || cards[1].card.ram[1]!==0 ||
           cards[1].card.ram[2]!==0 || cards[1].card.ram[3]!==0)
            $fatal(1,"faulted read failed to supply zero and continue");
        // Competing CPU/GEO requests remain parked across each read fault and
        // the following destination, until the whole admitted block completes.
        before_faults=faults;before_competitors=competitors;
        fork
            begin
                submit(32'h31000000,32'h30000000,2,32'h640);
                finish(32'h31000000,32'h30000000,0);
            end
            begin
                wait(dma_valid && dma_ready && !dma_write);
                @(posedge clk);@(negedge clk);watch_reservation=1;cpu_valid=1;geo_valid=1;
            end
        join
        cycles=0;while(competitors-before_competitors!=2) begin @(negedge clk);cycles=cycles+1;
            if(cycles>1000) $fatal(1,"read-fault reservation did not release");end
        if(faults-before_faults!=2) $fatal(1,"read-fault block did not continue");
        // The same guarantee holds if the first destination write faults.
        before_faults=faults;before_competitors=competitors;
        fork
            begin
                submit(32'h10000000,32'h31000000,2,32'h420);
                finish(32'h10000000,32'h31000000,0);
            end
            begin
                wait(dma_valid && dma_ready && !dma_write);
                @(posedge clk);@(negedge clk);watch_reservation=1;cpu_valid=1;geo_valid=1;
            end
        join
        cycles=0;while(competitors-before_competitors!=2) begin @(negedge clk);cycles=cycles+1;
            if(cycles>1000) $fatal(1,"write-fault reservation did not release");end
        if(faults-before_faults!=2) $fatal(1,"write-fault block did not continue");
        // A transport timeout, unlike a mapped fault, releases the reservation.
        sys_model_enable=1;before_competitors=competitors;
        fork
            begin
                submit(32'h00000000,32'h30000000,1,32'h240);
                cycles=0;while(!result_valid) begin @(negedge clk);cycles=cycles+1;
                    if(cycles>1000) $fatal(1,"transport timeout absent");end
                if(!result_timeout || result_write_in_doubt || result_transfer_count!==1)
                    $fatal(1,"read timeout was not published distinctly");
            end
            begin
                wait(dma_valid && dma_ready && !dma_write);
                @(posedge clk);@(negedge clk);watch_reservation=1;cpu_valid=1;geo_valid=1;
            end
        join
        cycles=0;while(competitors-before_competitors!=2) begin @(negedge clk);cycles=cycles+1;
            if(cycles>1000) $fatal(1,"timeout reservation did not release");end
        $display("PASS real DMA block -> CORE -> RAM/CAD: unaligned RAM, I/O-boundary scalars, socket override, writeback and fault continuation; %0d bus operations",requests);
        $finish;
    end
endmodule

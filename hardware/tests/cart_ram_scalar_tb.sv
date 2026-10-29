`timescale 1ns/1ps
module cart_ram_scalar_tb;
    localparam real PERIOD=29.5257;
    localparam integer CAPACITY=13;
    reg clk=0;
    always #(PERIOD/2) clk=!clk;
    reg power_reset_n=0,reset_n=0,req_valid=0,req_write=1;
    reg [31:0] offset=0,wdata=0;
    reg [2:0] size=1;
    wire req_ready,rsp_valid,init_done,busy;
    wire [31:0] rsp_rdata;
    wire [3:0] addr;
    tri [15:0] data;
    wire ce_n,oe_n,we_n;
    wire [1:0] be_n;
    wire part_drive;
    integer pulses=0,responses=0,tests=0;
    reg zero_valid=0,zero_write_enable=1;
    reg [31:0] zero_offset=0;
    reg [2:0] zero_size=1;
    wire zero_ready,zero_rsp,zero_init,zero_busy,zero_ce,zero_oe,zero_we,zero_part_drive;
    wire [31:0] zero_rdata;
    wire [1:0] zero_be;
    wire [3:0] zero_addr;
    tri [15:0] zero_data;
    integer zero_pulses=0;
    reg [7:0] expected [0:CAPACITY-1];
    cart_ram_scalar #(.ADDRESS_WIDTH(4),.CAPACITY_BYTES(CAPACITY)) dut (
        .clk(clk),.power_reset_n(power_reset_n),.reset_n(reset_n),
        .req_valid(req_valid),.req_ready(req_ready),.req_write(req_write),.rsp_rdata(rsp_rdata),.req_offset(offset),
        .req_size_bytes(size),.req_wdata(wdata),.rsp_valid(rsp_valid),
        .init_done(init_done),.busy(busy),.mem_data(data),.mem_address(addr),
        .mem_ce_n(ce_n),.mem_oe_n(oe_n),.mem_we_n(we_n),.mem_be_n(be_n)
    );
    issi_bll_pin_model #(.ADDRESS_WIDTH(4)) ram (
        .address(addr),.data(data),.ce_n(ce_n),.oe_n(oe_n),.we_n(we_n),
        .be_n(be_n),.drive_active(part_drive)
    );
    cart_ram_scalar #(.ADDRESS_WIDTH(4),.CAPACITY_BYTES(0)) no_ram (
        .clk(clk),.power_reset_n(power_reset_n),.reset_n(reset_n),
        .req_valid(zero_valid),.req_ready(zero_ready),.req_write(zero_write_enable),.rsp_rdata(zero_rdata),.req_offset(zero_offset),
        .req_size_bytes(zero_size),.req_wdata(32'h87654321),.rsp_valid(zero_rsp),
        .init_done(zero_init),.busy(zero_busy),.mem_data(zero_data),.mem_address(zero_addr),
        .mem_ce_n(zero_ce),.mem_oe_n(zero_oe),.mem_we_n(zero_we),.mem_be_n(zero_be)
    );
    issi_bll_pin_model #(.ADDRESS_WIDTH(4)) absent_part (
        .address(zero_addr),.data(zero_data),.ce_n(zero_ce),.oe_n(zero_oe),
        .we_n(zero_we),.be_n(zero_be),.drive_active(zero_part_drive)
    );
    always @(negedge we_n) if(power_reset_n) pulses=pulses+1;
    always @(negedge zero_we) if(power_reset_n) zero_pulses=zero_pulses+1;
    always @(posedge clk) if(rsp_valid) responses=responses+1;
    always @(posedge clk) if(power_reset_n && !we_n && part_drive)
        $fatal(1,"SRAM read/write driver contention");
    task automatic check_memory;
        integer i;
        reg [7:0] actual;
        begin
            for(i=0;i<CAPACITY;i=i+1) begin
                actual=i[0] ? ram.words[i>>1][15:8] : ram.words[i>>1][7:0];
                if(actual!==expected[i])
                    $fatal(1,"byte %0d actual=%h expected=%h",i,actual,expected[i]);
            end
        end
    endtask
    task automatic zero_write(input [2:0] n,input [31:0] a);
        integer clocks;
        begin
            @(negedge clk);zero_valid=1;zero_size=n;zero_offset=a;clocks=0;
            do begin @(posedge clk);clocks=clocks+1;
                if(clocks>20) $fatal(1,"zero-capacity admission timeout");
            end while(!zero_ready);
            @(negedge clk);zero_valid=0;clocks=0;
            do begin @(posedge clk);clocks=clocks+1;
                if(clocks>20) $fatal(1,"zero-capacity response timeout");
            end while(!zero_rsp);
            @(negedge clk);
            if(zero_pulses!=0 || !zero_init || !zero_ce || !zero_oe || !zero_we || zero_part_drive)
                $fatal(1,"zero-capacity SRAM was accessed");
            if(!zero_write_enable && zero_rdata!==0) $fatal(1,"zero-capacity read was not zero");
        end
    endtask
    task automatic read_check(input [31:0] a,input [2:0] n);
        integer i,before_pulses;
        reg [31:0] expected_word;
        begin
            expected_word=0;before_pulses=pulses;
            for(i=0;i<n;i=i+1)
                if(({1'b0,a}+i)<CAPACITY) expected_word[i*8+:8]=expected[a+i];
            req_write=0;issue(a,n,0);finish();req_write=1;
            if(rsp_rdata!==expected_word || pulses!=before_pulses)
                $fatal(1,"read %h/%d got %h expected %h or unexpected write",a,n,rsp_rdata,expected_word);
        end
    endtask
    task automatic issue(input [31:0] a,input [2:0] n,input [31:0] value);
        integer clocks;
        begin
            @(negedge clk);offset=a;size=n;wdata=value;req_valid=1;clocks=0;
            do begin @(posedge clk);clocks=clocks+1;
                if(clocks>100) $fatal(1,"commit admission timeout");
            end while(!req_ready);
            @(negedge clk);req_valid=0;
        end
    endtask
    task automatic finish;
        integer clocks;
        begin
            clocks=0;
            do begin @(posedge clk);clocks=clocks+1;
                if(clocks>100) $fatal(1,"commit response timeout");
            end while(!rsp_valid);
            @(negedge clk);tests=tests+1;
        end
    endtask
    task automatic write_check(input [31:0] a,input [2:0] n,input [31:0] value);
        integer i,before_pulses;
        begin
            before_pulses=pulses;
            issue(a,n,value);finish();
            if(({1'b0,a}+n)<=CAPACITY) begin
                for(i=0;i<n;i=i+1) expected[a+i]=value[i*8+:8];
            end else if(pulses!=before_pulses)
                $fatal(1,"partial-tail write issued SRAM pulse");
            check_memory();
        end
    endtask
    integer i,n,before_pulses,before_responses,cycle,reset_pulse;
    initial begin
        for(i=0;i<CAPACITY;i=i+1) expected[i]=0;
        repeat(3) @(posedge clk);@(negedge clk);power_reset_n=1;
        // Clearing must proceed while board reset is asserted.
        cycle=0;
        while(!init_done) begin @(posedge clk);cycle=cycle+1;
            if(cycle>100) $fatal(1,"power-on clear did not complete");
        end
        @(negedge clk);check_memory();
        if(pulses!=7) $fatal(1,"odd capacity clear word count=%0d",pulses);
        if(zero_pulses!=0 || !zero_init) $fatal(1,"zero-capacity card performed a clear");
        reset_n=1;repeat(3) @(posedge clk);
        zero_write(1,0);zero_write(2,0);zero_write(4,0);zero_write(4,32'hffffffff);
        zero_write_enable=0;zero_write(1,0);zero_write(2,0);zero_write(4,32'hffffffff);zero_write_enable=1;
        // All alignments and all whole-tail outcomes for the installed capacity.
        for(n=1;n<=4;n=n*2)
            for(i=0;i<=CAPACITY;i=i+1)
                write_check(i,n,32'hcba98765 ^ (i*32'h1020304));
        for(n=1;n<=4;n=n*2)
            for(i=0;i<=CAPACITY+1;i=i+1)
                read_check(i,n);
        read_check(32'hffffffff,4);
        // A warm reset during an active read suppresses its old response;
        // the owner still drains its current SRAM cycle and accepts new work.
        before_responses=responses;before_pulses=pulses;
        req_write=0;issue(1,4,0);wait(!oe_n);#1;reset_n=0;
        repeat(2) @(negedge clk);reset_n=1;wait(!busy);repeat(4) @(negedge clk);
        if(responses!=before_responses || pulses!=before_pulses)
            $fatal(1,"reset read emitted a stale response or a write pulse");
        req_write=1;write_check(1,4,32'hcafebeef);read_check(1,4);read_check(3,4);
        before_pulses=pulses;
        write_check(32'hffffffff,4,32'h12345678);
        if(pulses!=before_pulses) $fatal(1,"overflowing address aliased SRAM");
        // Reset in turn during each of the three real physical WE pulses.
        for(reset_pulse=1;reset_pulse<=3;reset_pulse=reset_pulse+1) begin
            before_pulses=pulses;before_responses=responses;
            issue(1,4,32'h11223344);
            wait(pulses==before_pulses+reset_pulse);#1;reset_n=0;
            repeat(2) @(posedge clk);@(negedge clk);reset_n=1;
            wait(!busy);repeat(4) @(posedge clk);@(negedge clk);
            expected[1]=8'h44;expected[2]=8'h33;expected[3]=8'h22;expected[4]=8'h11;
            check_memory();
            if(pulses-before_pulses!=3) $fatal(1,"warm reset did not drain all writes");
            if(responses!=before_responses) $fatal(1,"abandoned response was published");
        end
        write_check(0,4,32'hdeadbeef);
        $display("PASS cartridge x16 SRAM: %0d scalar transactions, tails, overflow, cold clear and three-pulse warm-reset drain",tests);
        $finish;
    end
endmodule

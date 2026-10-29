`timescale 1ns/1ps
module cart_rom_scalar_tb;
    localparam real PERIOD=1000000000.0/33868800.0;
    reg clk=0;
    always #(PERIOD/2) clk=!clk;
    reg reset_n=0,req_valid=0;
    reg [31:0] req_offset=0;
    reg [2:0] req_size_bytes=1;
    wire req_ready,rsp_valid,rom_ce_n,rom_oe_n;
    wire [31:0] rsp_rdata;
    wire [3:0] rom_address;
    tri [15:0] rom_data;
    wire [7:0] rom_low=8'h10+{rom_address,1'b0};
    wire [7:0] rom_high=8'h11+{rom_address,1'b0};
    wire [15:0] rom_word={rom_high,rom_low};
    integer reads=0,cases=0;
    realtime start_read=0,end_read=0,reset_rise=0;
    assign #(70,70,20) rom_data=!rom_ce_n && !rom_oe_n ? rom_word : 16'bz;
    cart_rom_scalar #(.ADDRESS_WIDTH(4),.CAPACITY_BYTES(13)) dut (.*);
    always @(posedge reset_n) reset_rise=$realtime;
    always @(negedge rom_ce_n) begin
        if($realtime-reset_rise<50) $fatal(1,"ROM reset recovery shorter than 50 ns");
        if(end_read && $realtime-end_read<20) $fatal(1,"ROM release gap too short");
        start_read=$realtime;reads=reads+1;
    end
    always @(posedge rom_ce_n) if(start_read) begin
        if(reset_n && $realtime-start_read<70) $fatal(1,"ROM read shortened below access time");
        end_read=$realtime;start_read=0;
    end
    task automatic read_check(input [31:0] address,input [2:0] width);
        integer i,guard,previous_reads,expected_reads,valid_bytes;
        reg [31:0] expected;
        begin
            expected=0;valid_bytes=0;previous_reads=reads;
            for(i=0;i<width;i=i+1) begin
                if(({1'b0,address}+i)<13) begin
                    expected[i*8+:8]=8'h10+address+i;valid_bytes=valid_bytes+1;
                end
            end
            expected_reads=valid_bytes==0 ? 0 : (valid_bytes+address[0]+1)/2;
            @(negedge clk);req_offset=address;req_size_bytes=width;req_valid=1;guard=0;
            do begin @(posedge clk);guard=guard+1;if(guard>20)$fatal(1,"admission timeout");end while(!req_ready);
            @(negedge clk);req_valid=0;guard=0;
            do begin @(posedge clk);guard=guard+1;if(guard>100)$fatal(1,"read timeout");end while(!rsp_valid);
            if(rsp_rdata!==expected || reads-previous_reads!=expected_reads)
                $fatal(1,"ROM %h/%d got %h expected %h, reads=%d/%d",address,width,rsp_rdata,expected,reads-previous_reads,expected_reads);
            cases=cases+1;@(negedge clk);
        end
    endtask
    integer i,w;
    initial begin
        repeat(3) @(posedge clk);@(negedge clk);reset_n=1;
        for(w=1;w<=4;w=w*2)
            for(i=0;i<=14;i=i+1) read_check(i,w);
        read_check(32'hffffffff,4);
        @(negedge clk);req_offset=1;req_size_bytes=4;req_valid=1;
        @(posedge clk);@(negedge clk);req_valid=0;
        wait(!rom_ce_n);#10;reset_n=0;#1;
        if(!rom_ce_n || !rom_oe_n || rsp_valid) $fatal(1,"reset failed to cancel ROM access");
        repeat(5) @(posedge clk);@(negedge clk);reset_n=1;
        read_check(1,4);
        $display("PASS cartridge x16 ROM: %0d scalar reads, all byte lanes, zero tails and reset cancellation",cases);
        $finish;
    end
endmodule

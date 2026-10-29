`timescale 1ns/1ps
// Native initiator, production INPUT endpoint and production accessories. The
// only modeled inputs are keyboard observations and accessory sensor words.
module io_bus_tb;
    reg clk=0;
    always #5 clk=!clk;
    reg reset_n=1, cs_io_n=0, vblank_begin=0, supervisor_request=0;
    reg [255:0] keyboard_words=0;
    wire snapshot_taken, supervisor_edge;
    reg req_valid=0, req_write=0;
    wire req_ready, rsp_valid;
    reg [31:0] req_addr=0, req_wdata=0, req_meta=32'hffffffff;
    reg [3:0] req_be_n=0;
    reg [17:0] req_data_wait_last=18'd15;
    wire [31:0] rsp_rdata, rsp_fault_code, master_out, endpoint_out;
    wire rsp_timeout, master_oe, endpoint_oe, ready_low;
    wire bus_as_n, bus_rd_n, bus_wr_n;
    wire [3:0] bus_be_n;
    tri [31:0] bus_ad;
    tri1 bus_ready_n;
    assign bus_ad=master_oe ? master_out : 32'bz;
    assign bus_ad=endpoint_oe ? endpoint_out : 32'bz;
    assign bus_ready_n=ready_low ? 1'b0 : 1'bz;
    system_bus_master master (
        .req_header_be_n(4'hf), .bus_busy(),
        .clk(clk),.reset_n(reset_n),.req_valid(req_valid),.req_ready(req_ready),
        .req_write(req_write),.req_addr(req_addr),.req_wdata(req_wdata),.req_be_n(req_be_n),
        .req_meta(req_meta),.req_data_timeout_enable(1'b1),
        .req_data_wait_last(req_data_wait_last),.rsp_valid(rsp_valid),
        .rsp_rdata(rsp_rdata),.rsp_fault_code(rsp_fault_code),.rsp_timeout(rsp_timeout),
        .bus_ad_in(bus_ad),.bus_ad_out(master_out),.bus_ad_oe(master_oe),
        .bus_as_n(bus_as_n),.bus_rd_n(bus_rd_n),.bus_wr_n(bus_wr_n),
        .bus_be_n(bus_be_n),.bus_ready_n(bus_ready_n)
    );
    wire pad_clk;
    wire [3:0] pad_cmd,pad_select_n,pad_data,accessory_data,accessory_oe;
    wire [3:0] packet_valid,link_error;
    wire dispatch_done;
    wire [31:0] dispatch_tag;
    reg replies_connected=1;
    assign pad_data=replies_connected ? accessory_data : 4'hf;
    io_controller dut (
        .clk(clk),.reset_n(reset_n),.cs_io_n(cs_io_n),
        .bus_ad_in(bus_ad),.bus_ad_out(endpoint_out),.bus_ad_oe(endpoint_oe),
        .bus_as_n(bus_as_n),.bus_rd_n(bus_rd_n),.bus_wr_n(bus_wr_n),
        .bus_be_n(bus_be_n),.bus_ready_drive_low(ready_low),
        .vblank_begin(vblank_begin),.supervisor_request(supervisor_request),
        .keyboard_words(keyboard_words),.snapshot_taken(snapshot_taken),.supervisor_edge(supervisor_edge),
        .display_context_valid(1'b0),.display_width(16'd0),.display_height(16'd0),.display_epoch(32'd0),
        .pad_clk(pad_clk),.pad_cmd(pad_cmd),
        .pad_select_n(pad_select_n),.pad_data(pad_data),.packet_valid(packet_valid),
        .link_error(link_error),.dispatch_done(dispatch_done),.dispatch_tag(dispatch_tag)
    );
    reg [895:0] sensor_pads=0;
    reg [511:0] sensor_pointers=0;
    wire [3:0] apply_accepted;
    wire [127:0] intensity,duration;
    wire [67:0] motor_level;
    integer apply_count[0:3];
    genvar lane;
    generate for(lane=0;lane<4;lane=lane+1) begin: peripherals
        pad_accessory #(.FEATURES(lane==1 || lane==3 ? 8'h03 : 8'h01),
            .CAPABILITY((32'h1000000f << lane) | 32'd1),.STANDARD_POINTER(0)) accessory (
            .clk(clk),.reset_n(reset_n),.pad_clk(pad_clk),.pad_select_n(pad_select_n[lane]),
            .pad_command(pad_cmd[lane]),.pad_data(accessory_data[lane]),.pad_data_oe(accessory_oe[lane]),
            .pad_words(sensor_pads[lane*224 +:224]),.pointer_words(sensor_pointers[lane*128 +:128]),
            .apply_accepted(apply_accepted[lane]),.requested_intensity(intensity[lane*32 +:32]),
            .requested_duration_ms(duration[lane*32 +:32]),.motor_level_q16(motor_level[lane*17 +:17]),
            .request_accepted(),.last_apply_tag(),.remaining_ms(),.context_valid(),
            .display_width(),.display_height(),.display_epoch()
        );
    end endgenerate
    integer transfers=0, apply_admissions=0, max_wait=0, data_clocks=0;
    reg [31:0] active_address=0, result=0;
    reg address_next=0;
    always @(posedge clk) if (reset_n) begin
        for(integer p=0;p<4;p=p+1) if(apply_accepted[p]) apply_count[p]=apply_count[p]+1;
        if(master_oe && !bus_as_n) begin
            if(address_next) active_address=bus_ad;
            else data_clocks=0;
            address_next=!address_next;
        end else address_next=0;
        if (bus_as_n && bus_rd_n && !bus_wr_n && master_oe) begin
            data_clocks=data_clocks+1;
            if(active_address==32'h0800011c && bus_ad==1 && !bus_ready_n) begin
                if(pad_select_n!==4'hf) $fatal(1,"APPLY ACK preceded frame admission boundary");
                if(data_clocks>81920) $fatal(1,"APPLY exceeded initiator DATA budget");
                apply_admissions=apply_admissions+1;
                if(data_clocks>max_wait) max_wait=data_clocks;
            end
        end
        if(master_oe && endpoint_oe) $fatal(1,"SYS_AD contention");
        if(!bus_ready_n && bus_as_n && bus_rd_n && bus_wr_n) $fatal(1,"READY driven in turnaround/release");
    end
    task automatic tick; @(posedge clk); #1; endtask
    task automatic transfer(input bit writing,input [31:0] address,input [31:0] value,
        input [3:0] be,input [17:0] budget,input [31:0] fault,input bit timeout);
        @(negedge clk); while(!req_ready) @(negedge clk);
        req_valid=1;req_write=writing;req_addr=address;req_wdata=value;
        req_be_n=be;req_data_wait_last=budget;
        tick(); @(negedge clk); req_valid=0;
        while(!rsp_valid) tick();
        if(rsp_timeout!==timeout || rsp_fault_code!==fault)
            $fatal(1,"Completion address=%h fault=%h/%h timeout=%b/%b",address,rsp_fault_code,fault,rsp_timeout,timeout);
        result=rsp_rdata;transfers=transfers+1;
    endtask
    task automatic store(input [31:0] address,input [31:0] value);
        transfer(1,address,value,0,address==32'h0800011c && value==1 ? 18'd81919 : 18'd15,0,0);
    endtask
    task automatic expect_word(input [31:0] address,input [31:0] expected);
        transfer(0,address,0,0,18'd15,0,0);
        if(result!==expected) $fatal(1,"Read %h got %h expected %h",address,result,expected);
    endtask
    task automatic blank;
        @(negedge clk);vblank_begin=1;tick();@(negedge clk);vblank_begin=0;
    endtask
    initial begin
        for(integer p=0;p<4;p=p+1) begin
            apply_count[p]=0;
            sensor_pointers[p*128 +:128]={32'hffffffff,32'h80000001,32'h7fffffff,32'hdead0000+p};
            for(integer w=0;w<7;w=w+1) sensor_pads[p*224+w*32 +:32]=32'hcaf00000+p*7+w;
        end
        keyboard_words={8{32'hffffffff}};
        #2;reset_n=0;tick();tick();reset_n=1;tick();tick();
        expect_word(32'h08000068,0);
        while(packet_valid!=4'hf) tick();
        expect_word(32'h0800009c,0); // acquisition is not publication
        store(32'h08000064,1);blank();
        expect_word(32'h08000068,1);
        for(integer w=0;w<8;w=w+1) expect_word(32'h0800006c+w*4,32'hffffffff);
        for(integer w=0;w<28;w=w+1) expect_word(32'h0800009c+w*4,32'hcaf00000+w);
        expect_word(32'h0800008c,32'hdead0001);
        expect_word(32'h08000090,32'h7fffffff);
        expect_word(32'h08000094,32'h80000001);
        expect_word(32'h08000098,32'hffffffff);
        expect_word(32'h08000118,32'hf000007f);
        // Read-only stores return public fault3, not a transport timeout.
        transfer(1,32'h0800009c,0,0,15,3,0);expect_word(32'h0800009c,32'hcaf00000);
        transfer(1,32'h08000118,0,0,15,3,0);expect_word(32'h08000118,32'hf000007f);
        transfer(1,32'h0800010d,0,0,15,2,0);
        transfer(1,32'h0800010c,0,4'b1110,15,2,0);
        store(32'h0800010c,32'hffffffff);store(32'h08000110,32'hffffffff);store(32'h08000114,32'hffffffff);
        // Whole-word exact1: other values are acknowledged without admission.
        store(32'h0800011c,3);expect_word(32'h0800011c,0);
        if(apply_admissions!=0) $fatal(1,"Nonexact APPLY dispatched");
        store(32'h0800011c,1);
        if(apply_count[3]!=0) $fatal(1,"APPLY acknowledgement waited until actuation");
        // Accepted operands are independent of subsequent parameter writes and
        // INPUT RESET. Neither operation may terminate the frame or send STOP.
        store(32'h0800010c,0);store(32'h08000110,0);store(32'h08000114,0);
        store(32'h08000064,2);
        if(pad_select_n!==0) $fatal(1,"INPUT RESET aborted transport");
        while(apply_count[3]!=1) tick();
        if(intensity[96 +:32]!==32'hffffffff || duration[96 +:32]!==32'hffffffff || motor_level[51 +:17]!==17'h10000)
            $fatal(1,"INPUT RESET changed admitted raw operands/effect");
        expect_word(32'h0800010c,0);expect_word(32'h08000110,0);expect_word(32'h08000114,0);
        expect_word(32'h08000118,0);expect_word(32'h08000068,0);
        store(32'h08000064,1);blank();expect_word(32'h0800009c,32'hcaf00000);
        expect_word(32'h08000118,32'hf000007f);
        store(32'h0800010c,3);store(32'h08000110,32'hffffffff);store(32'h08000114,32'hffffffff);
        store(32'h0800011c,1);store(32'h0800011c,1);
        while(apply_count[3]!=3) tick();
        if(apply_admissions!=3 || max_wait<=16) $fatal(1,"APPLY lost/coalesced or did not exercise backpressure");
        for(integer p=0;p<3;p=p+1) if(apply_count[p]!=0) $fatal(1,"APPLY selected another socket");
        // Failed electrical exchanges retain the last complete source banks.
        replies_connected=0;while(link_error!=4'hf) tick();
        store(32'h08000064,1);blank();expect_word(32'h0800009c,32'hcaf00000);
        expect_word(32'h08000098,32'hffffffff);
        cs_io_n=1;transfer(0,32'h08000068,0,0,15,0,1);cs_io_n=0;
        transfer(0,32'h08000120,0,0,15,0,1);
        expect_word(32'h08000068,2);
        $display("PASS io_bus transfers=%0d raw_words=41 APPLYs=%0d max_DATA_wait=%0d",transfers,apply_admissions,max_wait);
        $finish;
    end
    initial begin #20000000;$fatal(1,"Native INPUT bus watchdog");end
endmodule

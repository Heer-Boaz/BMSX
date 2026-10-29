`timescale 1ns/1ps
module io_system_pins_tb;
    reg clk=0, reset_n=0;
    always #14.763 clk=~clk;
    reg cs_io_n=0, cs_rom_n=0, vblank_evt=0, supervisor_raw_n=1;
    reg ps2_kbd_clk=1, ps2_kbd_data=1;
    tri [31:0] sys_ad;
    tri1 sys_ready_n, supervisor_n;
    wire sys_as_n, sys_rd_n, sys_wr_n;
    wire [3:0] sys_be_n;
    wire pad_clk;
    wire [3:0] pad_cmd, pad_select_n;
    wire [3:0] pad_data=4'hf;
    wire display_context=1;
    wire [21:0] rom_address;
    wire rom_ce_n, rom_oe_n;
    wire [15:0] rom_data;
    // External NOR contents are a lane-distinct word at each halfword address.
    // Data appears only after the selected 70 ns access grade.
    assign #(70,70,20) rom_data = !rom_ce_n && !rom_oe_n
        ? (rom_address[15:0] ^ 16'ha639) : 16'bz;
    reg req_valid=0, req_write=0;
    wire req_ready, rsp_valid;
    reg [31:0] req_addr=0, req_wdata=0;
    wire [31:0] master_data, rsp_rdata, rsp_fault_code;
    wire master_oe, rsp_timeout;
    integer requests=0, supervisor_pulses=0;
    reg [31:0] result;
    assign sys_ad=master_oe ? master_data : 32'bz;
    io_system_pins dut(.*);
    system_bus_master master (
        .req_header_be_n(4'hf), .bus_busy(),
        .clk(clk),.reset_n(reset_n),.req_valid(req_valid),.req_ready(req_ready),
        .req_write(req_write),.req_addr(req_addr),.req_wdata(req_wdata),
        .req_be_n(4'b0000),.req_meta(32'b0),.req_data_timeout_enable(1'b1),
        .req_data_wait_last(18'd15),
        .rsp_valid(rsp_valid),.rsp_rdata(rsp_rdata),.rsp_fault_code(rsp_fault_code),
        .rsp_timeout(rsp_timeout),.bus_ad_in(sys_ad),.bus_ad_out(master_data),
        .bus_ad_oe(master_oe),.bus_as_n(sys_as_n),.bus_rd_n(sys_rd_n),
        .bus_wr_n(sys_wr_n),.bus_be_n(sys_be_n),.bus_ready_n(sys_ready_n)
    );
    always @(posedge clk) if(reset_n) begin
        if((master_oe && (dut.bus_ad_oe || dut.rom_bus_ad_oe)) ||
           (dut.bus_ad_oe && dut.rom_bus_ad_oe)) $fatal(1,"multiple SYS data drivers");
        if(dut.bus_ready_drive_low && dut.rom_bus_ready_drive_low)
            $fatal(1,"multiple SYS acknowledgements");
    end
    always @(negedge supervisor_n) if (reset_n) supervisor_pulses=supervisor_pulses+1;
    task automatic transfer(input reg writing,input [31:0] address,input [31:0] word,
                            input [31:0] fault,input reg timeout);
        begin
            @(negedge clk);
            while (!req_ready) @(negedge clk);
            req_valid=1; req_write=writing; req_addr=address; req_wdata=word;
            @(negedge clk); req_valid=0;
            while (!rsp_valid) @(negedge clk);
            if (rsp_fault_code!==fault || rsp_timeout!==timeout)
                $fatal(1,"pin-level bus completion %h fault %h timeout %b",address,rsp_fault_code,rsp_timeout);
            result=rsp_rdata; requests=requests+1;
        end
    endtask
    task automatic blank;
        begin #3; vblank_evt=~vblank_evt; repeat (8) @(negedge clk); end
    endtask
    task automatic bit_wire(input reg value);
        begin ps2_kbd_data=value; #20000; ps2_kbd_clk=0; #40000; ps2_kbd_clk=1; #20000; end
    endtask
    task automatic byte_wire(input [7:0] value);
        integer i;
        begin
            bit_wire(0);for(i=0;i<8;i=i+1) bit_wire(value[i]);
            bit_wire(~^value);bit_wire(1);ps2_kbd_data=1;#20000;
        end
    endtask
    initial begin
        #1000;reset_n=1;repeat(8) @(negedge clk);
        transfer(0,32'h08000068,0,0,0);
        if(result!==0) $fatal(1,"cold input sequence");
        transfer(0,32'h00000000,0,0,0);
        if(result!==32'ha638a639) $fatal(1,"flash halfwords/lane order at shared pads");
        transfer(0,32'h007ffffc,0,0,0);
        if(result!==32'h59c659c7) $fatal(1,"last physical flash word");
        transfer(0,32'h00800000,0,0,0);
        if(result!==0 || !rom_ce_n || !rom_oe_n) $fatal(1,"upper ROM mirrors selected flash");
        transfer(1,32'h00000000,32'h12345678,1,0);
        transfer(0,32'h00000000,0,0,0);
        if(result!==32'ha638a639) $fatal(1,"ROM write changed read data");
        byte_wire(8'h1c); // A reaches bitmap through actual PS/2 pads
        transfer(0,32'h0800006c,0,0,0);
        if(result!==0) $fatal(1,"keyboard bypassed ARM snapshot latch");
        transfer(1,32'h08000064,1,0,0);blank();
        transfer(0,32'h08000068,0,0,0);
        if(result!==1) $fatal(1,"first toggle publication");
        transfer(0,32'h0800006c,0,0,0);
        if(result!==16) $fatal(1,"PS/2 to native SYS keyboard snapshot");
        blank();transfer(0,32'h08000068,0,0,0);
        if(result!==1) $fatal(1,"unarmed toggle republished");
        byte_wire(8'hf1); // language key has no physical break sequence
        transfer(1,32'h08000064,1,0,0);blank();
        transfer(0,32'h0800007c,0,0,0);
        if(result!==32'h00020000) $fatal(1,"make-only key lost before publication");
        transfer(1,32'h08000064,1,0,0);blank();
        transfer(0,32'h0800007c,0,0,0);
        if(result!==0) $fatal(1,"producer did not release make-only key after publication");
        transfer(1,32'h08000068,32'hffffffff,3,0);
        // Physical supervisor front button is independent of ARM/publication.
        #7;supervisor_raw_n=0;repeat(8) @(negedge clk);blank();
        if(supervisor_pulses!==1 || supervisor_n!==1) $fatal(1,"open-drain supervisor pulse/release");
        transfer(1,32'h08000064,2,0,0);blank();
        if(supervisor_pulses!==1) $fatal(1,"INPUT RESET rearmed a held supervisor button");
        // INPUT RESET clears publication, not the physically held A key.
        transfer(1,32'h08000064,1,0,0);blank();
        transfer(0,32'h0800006c,0,0,0);
        if(result!==16) $fatal(1,"INPUT RESET cleared external keyboard producer");
        #7;supervisor_raw_n=1;repeat(8) @(negedge clk);blank();
        #7;supervisor_raw_n=0;repeat(8) @(negedge clk);blank();
        if(supervisor_pulses!==2) $fatal(1,"new supervisor press lost");
        // The keyboard chord is evaluated from the live Set-2 bitmap, not an
        // armed input snapshot. Both modifier sides and the external input
        // feed the same VBlank-observed request level.
        #7;supervisor_raw_n=1;repeat(8) @(negedge clk);blank();
        byte_wire(8'h14); byte_wire(8'h11); byte_wire(8'h07); // left Ctrl+Alt+F12
        blank();
        if(supervisor_pulses!==3) $fatal(1,"unarmed keyboard chord did not request supervisor");
        blank();
        if(supervisor_pulses!==3) $fatal(1,"held chord repeated supervisor request");
        transfer(1,32'h08000064,2,0,0);blank();
        if(supervisor_pulses!==3) $fatal(1,"INPUT RESET rearmed held chord");
        transfer(1,32'h08000064,1,0,0);blank();
        transfer(0,32'h08000074,0,0,0);
        if((result & 32'h20)!==32'h20) $fatal(1,"F12 missing from guest snapshot");
        transfer(0,32'h08000088,0,0,0);
        if((result & 32'h5)!==32'h5) $fatal(1,"modifiers missing from guest snapshot");
        byte_wire(8'hf0);byte_wire(8'h14);blank();
        byte_wire(8'he0);byte_wire(8'h14);blank(); // right Ctrl
        if(supervisor_pulses!==4) $fatal(1,"right Ctrl chord not recognised");
        byte_wire(8'hf0);byte_wire(8'h11);blank();
        byte_wire(8'he0);byte_wire(8'h11);blank(); // right Alt
        if(supervisor_pulses!==5) $fatal(1,"right Alt chord not recognised");
        byte_wire(8'hf0);byte_wire(8'h07);blank();
        #7;supervisor_raw_n=0;repeat(8) @(negedge clk);blank();
        if(supervisor_pulses!==6) $fatal(1,"external supervisor source lost");
        byte_wire(8'h07);blank();
        #7;supervisor_raw_n=1;repeat(8) @(negedge clk);blank();
        if(supervisor_pulses!==6) $fatal(1,"combined held sources emitted another edge");
        byte_wire(8'hf0);byte_wire(8'h07);blank();
        #7;supervisor_raw_n=0;repeat(8) @(negedge clk);blank();
        if(supervisor_pulses!==7) $fatal(1,"combined sources did not rearm after sampled release");
        cs_io_n=1;
        transfer(0,32'h08000068,0,0,1);
        if(sys_ready_n!==1) $fatal(1,"deselected U7 retained READY");
        cs_io_n=0;
        transfer(0,32'h08000068,0,0,0);
        if(result!==1) $fatal(1,"endpoint did not recover after chip deselection");
        // Physical reset during an active flash access releases both bus and
        // flash drivers immediately. A new transaction follows normal release.
        @(negedge clk);
        while (!req_ready) @(negedge clk);
        req_addr=32'h00000000; req_write=0; req_valid=1;
        @(negedge clk); req_valid=0;
        wait(!rom_ce_n && !rom_oe_n); #7; reset_n=0; #1;
        if(rom_ce_n!==1 || rom_oe_n!==1 || dut.bus_ad_oe || dut.rom_bus_ad_oe || sys_ready_n!==1)
            $fatal(1,"reset did not release actual U7/flash pins");
        #1000; reset_n=1; repeat(8) @(negedge clk);
        transfer(0,32'h00000000,0,0,0);
        if(result!==32'ha638a639) $fatal(1,"flash recovery after reset");
        transfer(0,32'h08000068,0,0,0);
        if(result!==0) $fatal(1,"shared reset did not reset INPUT");
        $display("PASS U7 system pins: %0d SYS transfers, physical PS/2 publication, make-only lifetime, CS, keyboard chord and supervisor CDC/open-drain",requests);
        $finish;
    end
    initial begin #40000000;$fatal(1,"U7 pin test watchdog");end
endmodule

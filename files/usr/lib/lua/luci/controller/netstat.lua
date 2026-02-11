module("luci.controller.netstat", package.seeall)

function index()
    entry({"admin", "tools"}, firstchild(), _("Tools"), 50).dependent = false
    entry({"admin", "tools", "netstat_config"}, cbi("netstat/config"), _("Netstat Config"), 20).leaf = true
    entry({"admin", "tools", "vnstat"}, template("vnstat"), _("VnStats"), 30)
    entry({"admin", "tools", "get_netdev_stats"}, call("getNetdevStats"), nil).sysauth = false
end

function getNetdevStats()
    local f = io.open("/proc/net/dev", "r")
    if not f then
        luci.http.prepare_content("application/json")
        luci.http.write('{"stats":{}, "ip":"N/A", "status":"Disconnected"}')
        return
    end
    
    local content = f:read("*a")
    f:close()
    
    local stats = {}
    for line in content:gmatch("[^\n]+") do
        local iface, values = line:match("^%s*([^:]+):%s+(.*)$")
        if iface and values then
            local nums = {}
            for num in values:gmatch("%d+") do
                table.insert(nums, tonumber(num))
            end
            if #nums >= 9 then
                stats[iface] = {
                    rx = nums[1],
                    tx = nums[9]
                }
            end
        end
    end
    
    -- Quick connectivity check - just check if we have packets flowing
    local status = "Disconnected"
    for iface, data in pairs(stats) do
        if iface ~= "lo" and (data.rx > 0 or data.tx > 0) then
            status = "Connected"
            break
        end
    end
    
    -- Get public IP using curl api.ipify.org with timeout
    local ip = "N/A"
    local cmd = "curl -s --max-time 3 'https://api.ipify.org?format=text' 2>/dev/null"
    local f_ip = io.popen(cmd)
    if f_ip then
        local ip_result = f_ip:read("*l")
        if ip_result and ip_result ~= "" and string.len(ip_result) < 20 then
            ip = ip_result
        end
        f_ip:close()
    end
    
    local response = {
        stats = stats,
        ip = ip,
        status = status
    }
    
    luci.http.prepare_content("application/json")
    luci.http.write_json(response)
end

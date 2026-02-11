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
        luci.http.write('{"error": "Cannot read /proc/net/dev"}')
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
    
    luci.http.prepare_content("application/json")
    luci.http.write_json(stats)
end

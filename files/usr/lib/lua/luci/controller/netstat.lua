module("luci.controller.netstat", package.seeall)

function index()
    entry({"admin", "tools"}, firstchild(), _("Tools"), 50).dependent = false
    entry({"admin", "tools", "netstat_config"}, cbi("netstat/config"), _("Netstat Config"), 20).leaf = true
    entry({"admin", "tools", "vnstat"}, template("vnstat"), _("VnStats"), 30)
end

# luci-app-netstat

<div align="center">

![Dashboard Preview](images/dash.png)

**A professional network statistics application for OpenWrt LuCI**

[![License: GPL-3.0](https://img.shields.io/badge/License-GPL%203.0-blue.svg)](LICENSE)
[![Version](https://img.shields.io/badge/Version-1.0.0-success.svg)](Makefile)
![OpenWrt Compatible](https://img.shields.io/badge/OpenWrt-Compatible-brightgreen)

[Features](#features) • [Installation](#installation) • [Usage](#usage) • [Development](#development) • [License](#license)

</div>

---

## Overview

**luci-app-netstat** is a modern, feature-rich LuCI application that provides comprehensive network traffic statistics and monitoring for OpenWrt routers. It leverages `vnstat` for accurate traffic monitoring and presents the data through an intuitive web interface.

The application offers real-time network statistics, historical data visualization, and detailed traffic analysis to help you understand your network usage patterns.

## Features

✨ **Core Features:**
- 📊 **Real-time Network Monitoring** - Track network traffic with live statistics
- 📈 **Traffic Visualization** - Interactive charts powered by Chart.js
- 📅 **Historical Data** - Monitor trends over days, weeks, months, and years
- 🎨 **Dark Mode Support** - Professional dark theme for comfortable usage
- 📱 **Responsive Design** - Works seamlessly on desktop and mobile devices
- ⚙️ **Easy Configuration** - Simple UCI-based configuration system
- 🔄 **Automatic Updates** - Uses vnstat for continuous data collection

## Requirements

- OpenWrt with LuCI installed
- `vnstat` package (required dependency)
- Modern web browser (Chrome, Firefox, Safari, Edge)

## Installation

### Automatic Installation

Clone the repository and install using the OpenWrt build system:

```bash
git clone https://github.com/dotycat/luci-app-netstat.git
cd luci-app-netstat
make
```

### Manual Installation

1. Download the latest `.ipk` package from [Releases](../../releases)
2. Upload to your router via SCP:
   ```bash
   scp luci-app-netstat_*.ipk root@<router-ip>:/tmp/
   ```
3. Install via SSH:
   ```bash
   ssh root@<router-ip>
   opkg install /tmp/luci-app-netstat_*.ipk
   ```
4. Navigate to **LuCI Web Interface** → **Status** → **Network Statistics**

## Configuration

### UCI Configuration

The application configuration is managed via UCI. Edit `/etc/config/netstats` to customize:

```
config netstat
    option enabled '1'
    option interface 'wan'
    option update_interval '60'
```

### vnstat Integration

Ensure vnstat is properly configured and running:

```bash
opkg install vnstat
service vnstat start
service vnstat enable
```

## Usage

### Dashboard

1. Log into your OpenWrt LuCI web interface
2. Navigate to **Status** → **Network Statistics**
3. View traffic statistics for your network interfaces

### Available Data

- **Current Usage** - Real-time traffic rates
- **Daily Statistics** - Traffic breakdown by day
- **Weekly Reports** - Weekly traffic patterns
- **Monthly Analysis** - Monthly usage overview
- **Yearly Trends** - Yearly traffic history

## Project Structure

```
luci-app-netstat/
├── files/
│   ├── etc/
│   │   ├── config/
│   │   │   ├── netstats      # Default configuration
│   │   │   └── vnstat        # vnstat config
│   │   └── uci-defaults/
│   │       └── 99-vnstat     # UCI defaults setup
│   └── usr/
│       ├── lib/lua/luci/
│       │   ├── controller/netstat.lua    # LuCI controller
│       │   ├── model/cbi/netstat/        # CBI models
│       │   └── view/vnstat.htm           # View template
│       └── libexec/rpcd/                 # RPC daemon interface
├── www/
│   └── luci-static/
│       └── resources/
│           ├── netstat/
│           │   ├── chart.js              # Chart visualization
│           │   ├── netstat.css           # Stylesheet
│           │   └── netstat_dark.css      # Dark theme
│           └── view/status/include/08_stats.js
├── Makefile                  # OpenWrt package definition
└── README.md                 # This file
```

## Development

### Building from Source

```bash
# Clone repository
git clone https://github.com/dotycat/luci-app-netstat.git
cd luci-app-netstat

# Install dependencies (if using npm utilities)
npm install

# Build the package
make

# Watch for changes (optional)
npm run dev
```

### Customization

- **Styling**: Modify CSS files in `www/luci-static/resources/netstat/`
- **Charts**: Adjust chart.js configuration in `www/luci-static/resources/netstat/chart.js`
- **Logic**: Update LuCI controller in `files/usr/lib/lua/luci/controller/netstat.lua`

## Troubleshooting

### Statistics not showing
- Ensure vnstat is installed and running: `service vnstat status`
- Check vnstat database: `vnstat -i wan`
- Verify correct interface name in UCI config

### CSS not loading
- Clear browser cache (Ctrl+Shift+Delete)
- Restart LuCI: `service uhttpd restart`

### Performance issues
- Increase vnstat update interval in configuration
- Check router system resources: `free` / `top`

## Credits

- **Original Development**: [SMALLPROGRAM](https://github.com/smallprogram)
- **Maintenance**: [dotycat](https://github.com/dotycat)
- **Chart.js**: [Chart.js Contributors](https://www.chartjs.org/)
- **vnstat**: [Teemu Toivola](https://humdi.net/vnstat/)

## License

This project is licensed under the **GNU General Public License v3.0** - see the [LICENSE](LICENSE) file for details.

```
luci-app-netstat is free software: you can redistribute it and/or modify
it under the terms of the GNU General Public License as published by
the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.
```

## Contributing

Contributions are welcome! Please feel free to:
- Report bugs and issues
- Submit feature requests
- Create pull requests with improvements
- Improve documentation

## Support

For support, issues, or questions:
- Open an [Issue](../../issues) on GitHub
- Check existing [Discussions](../../discussions)
- Contact: support@dotycat.com

---

<div align="center">

**Made with ❤️ for the OpenWrt Community**

[⬆ Back to top](#luci-app-netstat)

</div>

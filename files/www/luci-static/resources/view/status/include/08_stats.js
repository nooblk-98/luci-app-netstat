'use strict';
'require baseclass';
'require uci';

let prev = {};
let last_time = Date.now();

(function loadDynamicCSS() {
	let lastLoadedCss = null;

	function isDarkMode() {
		try {
			const bgColor = getComputedStyle(document.body).backgroundColor;
			if (!bgColor || bgColor === 'transparent') return false;
			const rgb = bgColor.match(/\d+/g);
			if (!rgb || rgb.length < 3) return false;
			const [r, g, b] = rgb.map(Number);
			const luminance = (r * 299 + g * 587 + b * 114) / 1000;
			const isDark = luminance < 100;
			return isDark;
		} catch (e) {
			return false;
		}
	}

	function loadCSS() {
		const dark = isDarkMode();
		const cssFile = dark ? 'netstat_dark.css' : 'netstat.css';
		
		// Skip only if we just loaded this exact CSS
		if (lastLoadedCss === cssFile) {
			return;
		}
		
		lastLoadedCss = cssFile;

		// Remove old CSS
		document.querySelectorAll('link[href*="netstat.css"]').forEach(link => {
			if (link.parentNode) link.parentNode.removeChild(link);
		});

		// Load new CSS
		const link = document.createElement('link');
		link.rel = 'stylesheet';
		link.href = '/luci-static/resources/netstat/' + cssFile + '?t=' + Date.now();
		document.head.appendChild(link);
	}

	// Initial load with short delay
	setTimeout(() => {
		loadCSS();
	}, 100);

	// Poll every 500ms
	setInterval(() => {
		loadCSS();
	}, 500);
})();

function parseNetdev(raw) {
	const stats = {};
	const lines = raw.split('\n');
	
	for (let i = 0; i < lines.length; i++) {
		const line = lines[i].trim();
		if (!line || line.startsWith('face') || line.startsWith('|')) continue;
		
		const match = line.match(/^([^:]+):\s+(.*)$/);
		if (!match) continue;
		
		const iface = match[1].trim();
		const values = match[2].trim().split(/\s+/).map(v => parseInt(v) || 0);
		
		if (values.length >= 9) {
			stats[iface] = {
				rx: values[0],
				tx: values[8]
			};
		}
	}
	
	return stats;
}

function getBestWAN(stats, preferred) {
	for (const iface of preferred) {
		if (stats[iface]) return iface;
	}

	const dynamic = Object.keys(stats).find(i =>
		/^(wwan|usb|ppp|lte|qmi|modem)/.test(i) && i.includes('_')
	);
	if (dynamic) return dynamic;

	const fallback = ['pppoe-wan', 'lte0', 'usb0', 'wan', 'eth1', 'tun0', 'wg0'];
	for (const iface of fallback) {
		if (stats[iface]) return iface;
	}

	const nonLo = Object.keys(stats).filter(k => k !== 'lo');
	return nonLo[0] || 'wwan0_1';
}

function formatRate(bits) {
	const units = ['Bps', 'Kbps', 'Mbps', 'Gbps'];
	let i = 0;
	while (bits >= 1000 && i < units.length - 1) {
		bits /= 1000;
		i++;
	}
	return { number: bits.toFixed(i > 0 ? 1 : 0), unit: units[i] + '/s' };
}

function formatBytes(bytes) {
	const units = ['B', 'KB', 'MB', 'GB', 'TB'];
	let i = 0;
	while (bytes >= 1024 && i < units.length - 1) {
		bytes /= 1024;
		i++;
	}
	return { number: bytes.toFixed(i > 0 ? 2 : 0), unit: units[i] };
}

function createSpeedMeter(label, speed, unit, color, icon, totalBytes, totalLabel) {
	// Scale: 0 Mbps = 0%, 100 Mbps = 100%
	let percentage = 0;
	if (unit === 'Mbps/s') {
		percentage = Math.min(100, (parseFloat(speed) / 100) * 100);
	} else if (unit === 'Gbps/s') {
		percentage = Math.min(100, (parseFloat(speed) / 1) * 100);
	} else if (unit === 'Kbps/s') {
		percentage = Math.min(100, (parseFloat(speed) / 1000) * 100);
	}

	const formattedTotal = formatBytes(totalBytes);

	return E('div', { style: 'display: flex; flex-direction: column; gap: 6px; padding: 10px 12px; background: linear-gradient(135deg, rgba(245,245,245,0.8) 0%, rgba(255,255,255,0.5) 100%); border-radius: 8px; border-left: 5px solid ' + color + '; height: 100%;' }, [
		// Label
		E('span', { style: 'font-weight: 700; font-size: 11px; text-transform: uppercase; color: #333; letter-spacing: 0.6px;' }, label),
		
		// Progress bar and total - horizontal layout
		E('div', { style: 'display: flex; align-items: center; gap: 8px;' }, [
			// Progress bar
			E('div', { 
				style: 'flex: 1 1 0; min-width: 0; height: 10px; background: linear-gradient(90deg, rgba(200,200,200,0.25) 0%, rgba(200,200,200,0.15) 100%); border-radius: 5px; overflow: hidden; box-shadow: inset 0 2px 4px rgba(0,0,0,0.08);' 
			}, [
				E('div', { 
					style: 'height: 100%; background: linear-gradient(90deg, ' + color + ' 0%, ' + color + '85 100%); width: ' + percentage + '%; transition: width 0.4s cubic-bezier(0.25, 0.46, 0.45, 0.94); box-shadow: 0 0 6px ' + color + '50;' 
				}, [])
			]),
			
			// Vertical separator
			E('div', { style: 'width: 2px; height: 24px; background: ' + color + '; border-radius: 1px; opacity: 0.35; flex-shrink: 0;' }),
			
			// Total with large text
			E('div', { style: 'display: flex; flex-direction: column; align-items: flex-end; gap: 2px; flex-shrink: 0; width: 110px;' }, [
				E('span', { style: 'font-size: 8px; font-weight: 600; color: #999; text-transform: uppercase; letter-spacing: 0.3px; white-space: nowrap;' }, totalLabel),
				E('div', { style: 'display: flex; align-items: baseline; gap: 3px;' }, [
					E('span', { style: 'font-weight: 800; font-size: clamp(22px, 6vw, 30px); color: ' + color + '; text-shadow: 0 2px 6px rgba(0,0,0,0.1); line-height: 1;' }, formattedTotal.number),
					E('span', { style: 'font-size: 11px; font-weight: 700; color: ' + color + '; opacity: 0.85;' }, formattedTotal.unit)
				])
			])
		]),
		
		// Speed number
		E('div', { style: 'display: flex; align-items: baseline; gap: 4px; margin-top: 2px;' }, [
			E('span', { style: 'font-weight: 800; font-size: clamp(24px, 7vw, 32px); color: ' + color + '; text-shadow: 0 2px 6px rgba(0,0,0,0.1); line-height: 1;' }, speed),
			E('span', { style: 'font-size: 12px; font-weight: 700; color: ' + color + '; opacity: 0.85;' }, unit)
		])
	]);
}

function createStatusContainer(status, ip) {
	const isConnected = status === 'Connected';
	const statusColor = isConnected ? '#4CAF50' : '#FF5252';
	const dotColor = isConnected ? '#4CAF50' : '#FF5252';
	
	return E('div', { style: 'display: flex; flex-direction: column; justify-content: center; align-items: center; gap: 14px; padding: 12px 16px; background: linear-gradient(135deg, rgba(245,245,245,0.8) 0%, rgba(255,255,255,0.5) 100%); border-radius: 8px; border-left: 5px solid #9C27B0;' }, [
		// Internet Status
		E('div', { style: 'display: flex; flex-direction: column; gap: 6px; align-items: center; width: 100%;' }, [
			E('span', { style: 'font-size: 9px; font-weight: 700; color: #999; text-transform: uppercase; letter-spacing: 0.6px;' }, _('INTERNET STATUS')),
			E('div', { style: 'display: flex; align-items: center; gap: 8px;' }, [
				E('span', { style: 'width: 10px; height: 10px; background: ' + dotColor + '; border-radius: 50%; display: inline-block; box-shadow: 0 0 6px ' + dotColor + '80;' }),
				E('span', { style: 'font-weight: 800; font-size: clamp(18px, 5vw, 22px); color: ' + statusColor + '; text-shadow: 0 2px 6px rgba(0,0,0,0.1);' }, status)
			])
		]),
		// Horizontal separator
		E('div', { style: 'width: 70%; height: 2px; background: linear-gradient(90deg, transparent, #9C27B0, transparent); border-radius: 1px; opacity: 0.35;' }),
		// Public IP
		E('div', { style: 'display: flex; flex-direction: column; gap: 6px; align-items: center; width: 100%;' }, [
			E('span', { style: 'font-size: 9px; font-weight: 700; color: #999; text-transform: uppercase; letter-spacing: 0.6px;' }, _('PUBLIC IP')),
			E('span', { style: 'font-weight: 800; font-size: clamp(16px, 4.5vw, 18px); color: ' + statusColor + '; font-family: monospace; text-align: center; word-break: break-all; text-shadow: 0 2px 6px rgba(0,0,0,0.1);' }, ip)
		])
	]);
}

return baseclass.extend({
	title: _(''),

	load: function () {
		// Direct call to getNetdevStats function via HTTP
		return L.resolveDefault(
			fetch('/cgi-bin/luci/admin/tools/get_netdev_stats')
				.then(res => res.json())
				.catch(() => ({ stats: {}, ip: 'N/A', status: 'Disconnected' })),
			{ stats: {}, ip: 'N/A', status: 'Disconnected' }
		).then(result => {
			const stats = (result && result.stats) || result || {};
			const ip = (result && result.ip) || 'N/A';
			const status = (result && result.status) || 'Disconnected';
			return {
				stats: stats,
				ip: ip,
				status: status,
				preferred: []
			};
		}).catch(() => {
			return {
				stats: {},
				ip: 'N/A',
				status: 'Disconnected',
				preferred: []
			};
		});
	},

	render: function (data) {
		const now = Date.now();
		const dt = Math.max(0.1, (now - last_time) / 1000);
		last_time = now;

		const stats = data.stats;
		if (!stats || typeof stats !== 'object' || Array.isArray(stats)) {
			return E('div', { style: 'padding: 20px; text-align: center; color: #999; font-size: 13px;' }, 
				_('Loading network stats...')
			);
		}

		const preferred = data.preferred || [];
		const iface = getBestWAN(stats, preferred);
		const curr = stats[iface] || { rx: 0, tx: 0 };
		
		// Ensure values are numbers
		curr.rx = parseInt(curr.rx) || 0;
		curr.tx = parseInt(curr.tx) || 0;
		
		const prevStat = prev[iface] || { rx: curr.rx, tx: curr.tx };

		let rxSpeed = Math.max(0, (curr.rx - prevStat.rx) / dt);
		let txSpeed = Math.max(0, (curr.tx - prevStat.tx) / dt);

		prev[iface] = { rx: curr.rx, tx: curr.tx };

		const rxRate = formatRate(rxSpeed * 8);
		const txRate = formatRate(txSpeed * 8);

		// Create container with better styling
		const container = E('div', { style: 'padding: 10px; background: #f8f9fa; box-sizing: border-box;' });
		
		// Add header section
		const header = E('div', { style: 'display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px; padding-bottom: 8px; border-bottom: 1px solid rgba(0,0,0,0.08); gap: 10px; flex-wrap: wrap;' }, [
			E('span', { style: 'font-weight: 700; font-size: 12px; text-transform: uppercase; color: #555; letter-spacing: 0.8px;' }, _('Network Status')),
			E('span', { style: 'font-size: 10px; color: #999;' }, iface)
		]);
		container.appendChild(header);
		
		// Get status and IP
		const status = data.status || 'Disconnected';
		const ip = data.ip || 'N/A';
		
		// Create grid layout: speed meters on left, status on right
		const gridContainer = E('div', { style: 'display: grid; grid-template-columns: 1fr; gap: 8px; align-items: stretch;' }, [
			// Speed meters
			E('div', { style: 'display: flex; flex-direction: column; gap: 8px;' }, [
				createSpeedMeter(_('DOWNLOAD'), rxRate.number, rxRate.unit, '#4CAF50', null, curr.rx, _('TOTAL DOWNLOAD')),
				createSpeedMeter(_('UPLOAD'), txRate.number, txRate.unit, '#2196F3', null, curr.tx, _('TOTAL UPLOAD'))
			]),
			// Status container
			createStatusContainer(status, ip)
		]);
		
		container.appendChild(gridContainer);

		// Set up polling for real-time updates
		L.Poll.add(() => {
			return L.resolveDefault(
				fetch('/cgi-bin/luci/admin/tools/get_netdev_stats')
					.then(res => res.json())
					.catch(() => ({ stats: {}, ip: 'N/A', status: 'Disconnected' })),
				{ stats: {}, ip: 'N/A', status: 'Disconnected' }
			).then(result => {
				const newStats = (result && result.stats) || {};
				const newIP = (result && result.ip) || 'N/A';
				const newStatus = (result && result.status) || 'Disconnected';
				return this.render({ stats: newStats, ip: newIP, status: newStatus, preferred: preferred });
			}).catch((e) => {
				console.error('Fetch error:', e);
				return container;
			});
		}, 1000);

		return container;
	}
});
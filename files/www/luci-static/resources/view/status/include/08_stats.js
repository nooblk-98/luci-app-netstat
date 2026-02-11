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
			console.log('[NetStat] Body bg color:', bgColor);
			
			if (!bgColor || bgColor === 'transparent') return false;
			const rgb = bgColor.match(/\d+/g);
			if (!rgb || rgb.length < 3) return false;
			const [r, g, b] = rgb.map(Number);
			const luminance = (r * 299 + g * 587 + b * 114) / 1000;
			const isDark = luminance < 100;
			console.log('[NetStat] RGB:', r, g, b, 'Luminance:', luminance, 'isDark:', isDark);
			return isDark;
		} catch (e) {
			console.error('[NetStat] Error detecting dark mode:', e);
			return false;
		}
	}

	function loadCSS() {
		const dark = isDarkMode();
		const cssFile = dark ? 'netstat_dark.css' : 'netstat.css';
		
		console.log('[NetStat] loadCSS - current dark:', dark, 'last loaded:', lastLoadedCss);
		
		// Skip only if we just loaded this exact CSS
		if (lastLoadedCss === cssFile) {
			console.log('[NetStat] CSS already loaded, skipping');
			return;
		}
		
		console.log('[NetStat] Loading CSS:', cssFile);
		lastLoadedCss = cssFile;

		// Remove old CSS
		document.querySelectorAll('link[href*="netstat.css"]').forEach(link => {
			console.log('[NetStat] Removing old CSS:', link.href);
			if (link.parentNode) link.parentNode.removeChild(link);
		});

		// Load new CSS
		const link = document.createElement('link');
		link.rel = 'stylesheet';
		link.href = '/luci-static/resources/netstat/' + cssFile + '?t=' + Date.now();
		
		link.onload = function() {
			console.log('[NetStat] ✓ CSS loaded:', link.href);
		};
		link.onerror = function() {
			console.error('[NetStat] ✗ CSS failed to load:', link.href);
		};
		
		console.log('[NetStat] Adding link to head:', link.href);
		document.head.appendChild(link);
	}

	// Initial load with short delay
	setTimeout(() => {
		console.log('[NetStat] Initial load');
		loadCSS();
	}, 100);

	// Poll every 500ms
	setInterval(() => {
		loadCSS();
	}, 500);
	
	console.log('[NetStat] CSS loader initialized');
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

function createSpeedMeter(label, speed, unit, color, icon) {
	// Scale: 0 Mbps = 0%, 100 Mbps = 100%
	let percentage = 0;
	if (unit === 'Mbps/s') {
		percentage = Math.min(100, (parseFloat(speed) / 100) * 100);
	} else if (unit === 'Gbps/s') {
		percentage = Math.min(100, (parseFloat(speed) / 1) * 100);
	} else if (unit === 'Kbps/s') {
		percentage = Math.min(100, (parseFloat(speed) / 1000) * 100);
	}

	return E('div', { style: 'display: flex; flex-direction: column; gap: 12px; padding: 18px 14px; background: linear-gradient(135deg, rgba(245,245,245,0.8) 0%, rgba(255,255,255,0.5) 100%); border-radius: 8px; border-left: 5px solid ' + color + ';' }, [
		// Label and bar section
		E('div', { style: 'display: flex; flex-direction: column; gap: 10px;' }, [
			E('span', { style: 'font-weight: 700; font-size: 11px; text-transform: uppercase; color: #333; letter-spacing: 0.6px;' }, label),
			E('div', { 
				style: 'width: 100%; height: 14px; background: linear-gradient(90deg, rgba(200,200,200,0.25) 0%, rgba(200,200,200,0.15) 100%); border-radius: 7px; overflow: hidden; box-shadow: inset 0 2px 4px rgba(0,0,0,0.08);' 
			}, [
				E('div', { 
					style: 'height: 100%; background: linear-gradient(90deg, ' + color + ' 0%, ' + color + '85 100%); width: ' + percentage + '%; transition: width 0.4s cubic-bezier(0.25, 0.46, 0.45, 0.94); box-shadow: 0 0 8px ' + color + '50;' 
				}, [])
			])
		]),
		// Speed number
		E('div', { style: 'display: flex; flex-direction: column; align-items: flex-start; gap: 4px;' }, [
			E('div', { style: 'display: flex; align-items: baseline; gap: 6px; flex-wrap: wrap;' }, [
				E('span', { style: 'font-weight: 800; font-size: 36px; color: ' + color + '; text-shadow: 0 2px 6px rgba(0,0,0,0.12); line-height: 1;' }, speed),
				E('span', { style: 'font-size: 12px; font-weight: 700; color: ' + color + '; opacity: 0.85;' }, unit)
			])
		])
	]);
}

function createStatusCard(status, ip) {
	const isConnected = status === 'Connected';
	const statusColor = isConnected ? '#4CAF50' : '#FF5252';
	const statusBg = isConnected ? 'rgba(76, 175, 80, 0.1)' : 'rgba(255, 82, 82, 0.1)';
	const dotColor = isConnected ? '#4CAF50' : '#FF5252';
	
	return E('div', { class: 'ip-card', style: 'display: flex; flex-direction: column; gap: 14px; padding: 20px 16px; background: ' + statusBg + '; border-radius: 8px; border-left: 5px solid ' + statusColor + '; margin-top: 10px;' }, [
		// Status and IP - stacked on mobile, side by side on desktop
		E('div', { style: 'display: flex; flex-direction: column; gap: 20px; width: 100%;' }, [
			// Status (top/left)
			E('div', { style: 'display: flex; flex-direction: column; gap: 8px; text-align: center;' }, [
				E('div', { style: 'font-weight: 600; font-size: 11px; text-transform: uppercase; color: #555; letter-spacing: 0.6px;' }, _('INTERNET STATUS')),
				E('div', { style: 'display: flex; align-items: center; justify-content: center; gap: 10px;' }, [
					E('span', { style: 'width: 12px; height: 12px; background: ' + dotColor + '; border-radius: 50%; display: inline-block; animation: pulse 2s infinite;' }, []),
					E('span', { style: 'font-weight: 700; font-size: 20px; color: ' + statusColor + ';' }, status)
				])
			]),
			// IP (bottom/right)
			E('div', { style: 'display: flex; flex-direction: column; gap: 8px; text-align: center;' }, [
				E('div', { style: 'font-weight: 600; font-size: 11px; text-transform: uppercase; color: #555; letter-spacing: 0.6px;' }, _('PUBLIC IP')),
				E('span', { style: 'font-weight: 800; font-size: 24px; color: ' + statusColor + '; font-family: monospace; text-shadow: 0 2px 6px rgba(0,0,0,0.12); word-break: break-all;' }, ip)
			])
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
		const container = E('div', { class: 'stats-grid', style: 'display: flex; flex-direction: column; gap: 12px; padding: 14px; background: #f8f9fa; box-sizing: border-box;' });
		
		// Add header section
		const header = E('div', { style: 'display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px; padding-bottom: 10px; border-bottom: 1px solid rgba(0,0,0,0.08); gap: 10px; flex-wrap: wrap;' }, [
			E('span', { style: 'font-weight: 700; font-size: 12px; text-transform: uppercase; color: #555; letter-spacing: 0.8px;' }, _('Network Status')),
			E('span', { style: 'font-size: 10px; color: #999;' }, iface)
		]);
		container.appendChild(header);
		
		// Add speed meters
		container.appendChild(createSpeedMeter(_('DOWNLOAD'), rxRate.number, rxRate.unit, '#4CAF50'));
		container.appendChild(createSpeedMeter(_('UPLOAD'), txRate.number, txRate.unit, '#2196F3'));
		
		// Add internet status with IP
		const status = data.status || 'Disconnected';
		const ip = data.ip || 'N/A';
		container.appendChild(createStatusCard(status, ip));

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
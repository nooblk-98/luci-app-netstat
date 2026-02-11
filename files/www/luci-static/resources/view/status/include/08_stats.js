'use strict';
'require baseclass';
'require uci';

let prev = {};
let last_time = Date.now();

(function loadDynamicCSS() {
	function isDarkMode() {
		try {
			const bgColor = getComputedStyle(document.body).backgroundColor;
			if (!bgColor) return false;
			const rgb = bgColor.match(/\d+/g);
			if (!rgb) return false;
			const [r, g, b] = rgb.map(Number);
			return (r * 299 + g * 587 + b * 114) / 1000 < 100;
		} catch (e) {
			console.error('Error detecting dark mode:', e);
			return false;
		}
	}

	try {
		const dark = isDarkMode();
		const link = document.createElement('link');
		link.rel = 'stylesheet';
		link.href = dark
			? '/luci-static/resources/netstat/netstat_dark.css'
			: '/luci-static/resources/netstat/netstat.css';
		document.head.appendChild(link);
	} catch (e) {
		console.error('Error loading CSS:', e);
	}
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

function createSpeedMeter(label, speed, unit, color) {
	// Scale: 0 Mbps = 0%, 100 Mbps = 100%
	let percentage = 0;
	if (unit === 'Mbps/s') {
		percentage = Math.min(100, (parseFloat(speed) / 100) * 100);
	} else if (unit === 'Gbps/s') {
		percentage = Math.min(100, (parseFloat(speed) / 1) * 100);
	} else if (unit === 'Kbps/s') {
		percentage = Math.min(100, (parseFloat(speed) / 1000) * 100);
	}

	return E('div', { class: 'speed-card', style: 'display: flex; flex-direction: column; gap: 8px; padding: 16px; background: rgba(208,224,227,0.3); border-radius: 4px;' }, [
		E('div', { style: 'display: flex; justify-content: space-between; align-items: center;' }, [
			E('span', { style: 'font-weight: bold; font-size: 12px; text-transform: uppercase; color: #333;' }, label),
			E('span', { style: 'font-weight: bold; font-size: 16px; color: ' + color + ';' }, [
				E('span', {}, speed),
				E('span', { style: 'font-size: 12px; margin-left: 4px;' }, unit)
			])
		]),
		E('div', { 
			style: 'width: 100%; height: 8px; background-color: rgba(200,200,200,0.3); border-radius: 4px; overflow: hidden;' 
		}, [
			E('div', { 
				style: 'height: 100%; background: linear-gradient(90deg, ' + color + ' 0%, ' + color + '99 100%); width: ' + percentage + '%; transition: width 0.3s ease;' 
			}, [])
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
				.catch(() => ({})),
			{}
		).then(result => {
			return {
				stats: result || {},
				preferred: []
			};
		}).catch(() => {
			return {
				stats: {},
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
			return E('div', { style: 'padding: 14px; text-align: center; color: #666;' }, 
				'Loading network stats...'
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

		// Create container
		const container = E('div', { style: 'display: flex; flex-direction: column; gap: 16px; padding: 14px;' });
		
		// Add speed meters
		container.appendChild(createSpeedMeter(_('DOWNLOAD'), rxRate.number, rxRate.unit, '#4CAF50'));
		container.appendChild(createSpeedMeter(_('UPLOAD'), txRate.number, txRate.unit, '#2196F3'));

		// Set up polling for real-time updates
		L.Poll.add(() => {
			return L.resolveDefault(
				fetch('/cgi-bin/luci/admin/tools/get_netdev_stats')
					.then(res => res.json())
					.catch(() => ({})),
				{}
			).then(result => {
				let newStats = result || {};
				return this.render({ stats: newStats, preferred: preferred });
			}).catch((e) => {
				console.error('Fetch error:', e);
				return container;
			});
		}, 1000);

		return container;
	}
});
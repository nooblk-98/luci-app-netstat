'use strict';
'require baseclass';
'require fs';

let prev = {};
let last_time = Date.now();
let ipVisible = localStorage.getItem('ipVisible') !== 'false';
let currentIface = '';

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

function parseStats(raw) {
	try {
		const lines = raw.trim().split('\n');
		const stats = {};
		lines.forEach(line => {
			const parts = line.trim().split(':');
			if (parts.length < 2) return;
			const iface = parts[0].trim();
			const values = parts[1].trim().split(/\s+/);
			stats[iface] = {
				rx: parseInt(values[0]) || 0,
				tx: parseInt(values[8]) || 0
			};
		});
		return stats;
	} catch (e) {
		console.error('parseStats error:', e);
		return {};
	}
}

function getPublicIP() {
	return fs.exec('/usr/bin/curl', [
		'-sL', '--connect-timeout', '2', '--max-time', '3', 'https://ip.guide'
	])
		.then(res => {
			try {
				return JSON.parse(res.stdout);
			} catch {
				return { ip: 'Unavailable', network: { autonomous_system: { name: 'Unknown' } } };
			}
		})
		.catch(() => ({ ip: 'Unavailable', network: { autonomous_system: { name: 'Unknown' } } }));
}

function getPreferredInterfaces() {
	return fs.exec('/sbin/uci', ['get', 'netstats.@config[0].prefer'])
		.then(res => res.stdout.trim().split(/\s+/).filter(Boolean))
		.catch(() => []);
}

async function getMode() {
	try {
		const backendRes = await fs.exec('/sbin/uci', ['get', 'netstats.@config[0].backend']);
		const backend = backendRes.stdout.trim().toLowerCase();
		if (backend !== 'vnstat') return '';

		const modeRes = await fs.exec('/sbin/uci', ['get', 'netstats.@config[0].mode']);
		const val = modeRes.stdout.trim().toLowerCase();
		return (val === 'daily' || val === 'monthly') ? val : 'daily';
	} catch {
		return '';
	}
}

function getBackend() {
	return fs.exec('/sbin/uci', ['get', 'netstats.@config[0].backend'])
		.then(res => {
			const val = res.stdout.trim().toLowerCase();
			return (val === 'vnstat') ? 'vnstat' : 'normal';
		})
		.catch(() => 'normal');
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

function formatSize(bytes) {
	const units = ['B', 'KB', 'MB', 'GB'];
	let i = 0;
	while (bytes >= 1024 && i < units.length - 1) {
		bytes /= 1024;
		i++;
	}
	return { number: bytes.toFixed(i > 0 ? 1 : 0), unit: units[i] };
}

function createStatCard(label, valueNum, valueUnit, color, iface) {
	return E('div', { class: 'stats-card', style: 'box-shadow: none;' }, [
		E('div', { class: 'stat-label' }, label),
		E('div', { class: 'stat-value' }, [
			E('span', { class: 'stat-number' }, valueNum),
			E('br'),
			E('span', { class: 'stat-unit' }, valueUnit)
		]),
		E('span', {
			class: 'iface-badge',
			style: `margin-top: 6px; display: inline-block; padding: 2px 6px; font-size: 10px; border-radius: 4px; background-color: ${color}; color: white;`
		}, iface)
	]);
}

function createIPCard(ip, org) {
	const ipVal = E('div', { class: 'ip-value', id: 'ip-value' }, ipVisible ? ip : '**********');
	const eyeIcon = E('img', {
		src: ipVisible
			? '/luci-static/resources/netstat/eye-outline.svg'
			: '/luci-static/resources/netstat/eye-off-outline.svg',
		width: 18,
		height: 18,
		style: 'vertical-align: middle;'
	});
	const eye = E('span', {
		class: 'eye-icon',
		title: _('Show/Hide IP'),
		style: 'cursor: pointer; vertical-align: middle; margin-left: 6px;'
	}, [eyeIcon]);

	eye.addEventListener('click', function () {
		ipVisible = !ipVisible;
		localStorage.setItem('ipVisible', ipVisible);
		ipVal.textContent = ipVisible ? ip : '**********';
		eyeIcon.src = ipVisible
			? '/luci-static/resources/netstat/eye-outline.svg'
			: '/luci-static/resources/netstat/eye-off-outline.svg';
	});

	return E('div', { class: 'ip-card full-width', style: 'box-shadow: none;' }, [
		E('div', { class: 'ip-line' }, [ipVal, eye]),
		E('div', { class: 'ip-org' }, org),
		E('div', { class: 'bubble yellow' })
	]);
}

return baseclass.extend({
	title: _(''),

	load: function () {
		return Promise.all([
			fs.read_direct('/proc/net/dev').then(parseStats).catch(() => ({})),
			getPublicIP(),
			getPreferredInterfaces(),
			getMode(),
			getBackend()
		]).then(async ([netStats, ipData, preferred, mode, backend]) => {
			const iface = getBestWAN(netStats, preferred);
			let vnstatRx = 0, vnstatTx = 0;

			if (backend === 'vnstat') {
				try {
					const res = await fs.exec('/usr/bin/vnstat', ['-i', iface, '--json']);
					const json = JSON.parse(res.stdout);
					const key = mode === 'daily' ? 'days' : (mode === 'monthly' ? 'months' : 'days');
					const trafficArr = json.interfaces?.[0]?.traffic?.[key];

					if (Array.isArray(trafficArr) && trafficArr.length > 0) {
						const today = new Date();
						let matchEntry;

						if (mode === 'monthly') {
							matchEntry = trafficArr.find(e =>
								e.date &&
								e.date.year === today.getFullYear() &&
								e.date.month === today.getMonth() + 1
							);
						} else {
							matchEntry = trafficArr.find(e =>
								e.date &&
								e.date.year === today.getFullYear() &&
								e.date.month === today.getMonth() + 1 &&
								e.date.day === today.getDate()
							);
						}

						if (matchEntry) {
							vnstatRx = matchEntry.rx * 1024;
							vnstatTx = matchEntry.tx * 1024;
						} else {
							const lastEntry = trafficArr[trafficArr.length - 1];
							if (lastEntry) {
								vnstatRx = lastEntry.rx * 1024;
								vnstatTx = lastEntry.tx * 1024;
							} else {
								const total = json.interfaces?.[0]?.traffic?.total;
								if (total) {
									vnstatRx = total.rx * 1024;
									vnstatTx = total.tx * 1024;
								}
							}
						}
					} else {
						const total = json.interfaces?.[0]?.traffic?.total;
						if (total) {
							vnstatRx = total.rx * 1024;
							vnstatTx = total.tx * 1024;
						}
					}
				} catch (e) {
					console.warn('vnstat error:', e);
				}
			} else {
				vnstatRx = netStats[iface]?.rx || 0;
				vnstatTx = netStats[iface]?.tx || 0;
			}

			return { netStats, ipData, preferred, vnstatRx, vnstatTx, mode, backend };
		});
	},

	render: function (data) {
		const now = Date.now();
		const dt = Math.max(0.1, (now - last_time) / 1000);
		last_time = now;

		const stats = Object.fromEntries(
			Object.entries(data.netStats).filter(([k]) => !['lo', 'br-lan', 'docker0'].includes(k))
		);

		const iface = getBestWAN(stats, data.preferred);
		const curr = stats[iface] || { rx: 0, tx: 0 };
		const prevStat = prev[iface] || curr;

		let rxSpeed = (curr.rx - prevStat.rx) / dt;
		let txSpeed = (curr.tx - prevStat.tx) / dt;

		prev[iface] = curr;

		const rxRate = formatRate(rxSpeed * 8);
		const txRate = formatRate(txSpeed * 8);

		const rxTotal = formatSize(data.backend === 'vnstat' ? data.vnstatRx : curr.rx);
		const txTotal = formatSize(data.backend === 'vnstat' ? data.vnstatTx : curr.tx);

		const rxIfaceLabel = data.backend === 'vnstat' ? 'vnstat' : iface;
		const txIfaceLabel = data.backend === 'vnstat' ? 'vnstat' : iface;

		let rxLabel, txLabel;
		if (data.backend === 'vnstat') {
			if (data.mode === 'daily') {
				rxLabel = _('Daily RX');
				txLabel = _('Daily TX');
			} else if (data.mode === 'monthly') {
				rxLabel = _('Monthly RX');
				txLabel = _('Monthly TX');
			} else {
				rxLabel = _('Total RX');
				txLabel = _('Total TX');
			}
		} else {
			rxLabel = _('Total RX');
			txLabel = _('Total TX');
		}

		const grid = E('div', { class: 'stats-grid' });
		grid.appendChild(createStatCard(_('DOWNLOAD'), rxRate.number, rxRate.unit, '#4CAF50', iface));
		grid.appendChild(createStatCard(_('UPLOAD'), txRate.number, txRate.unit, '#2196F3', iface));
		grid.appendChild(createStatCard(rxLabel, rxTotal.number, rxTotal.unit, '#FF9800', rxIfaceLabel));
		grid.appendChild(createStatCard(txLabel, txTotal.number, txTotal.unit, '#9C27B0', txIfaceLabel));
		grid.appendChild(createIPCard(data.ipData?.ip || 'Unavailable', data.ipData?.network?.autonomous_system?.name || 'Unknown'));

		let vnstatLastUpdate = 0;

		L.Poll.add(() => {
			const now = Date.now();
			if (now - vnstatLastUpdate > 120000) {
				vnstatLastUpdate = now;
				fs.exec('/usr/bin/vnstat', ['--update'])
					.catch(e => console.warn('vnstat update error:', e));
			}

			return fs.read_direct('/proc/net/dev')
				.then(raw => {
					const updated = parseStats(raw);
					return this.render({
						netStats: updated,
						ipData: data.ipData,
						preferred: data.preferred,
						vnstatRx: data.vnstatRx,
						vnstatTx: data.vnstatTx,
						mode: data.mode,
						backend: data.backend
					});
				});

		}, 1000);

		return E('div', {}, [grid]);
	}
});

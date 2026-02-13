/**
 * LCOE & PPA Calculator - Main Application Script
 * Handles UI interactions, events, and rendering.
 */

class SolarCalculator {
    constructor() {
        if (typeof Chart !== 'undefined' && typeof ChartDataLabels !== 'undefined') {
            Chart.register(ChartDataLabels);
        }
        if (typeof Chart !== 'undefined' && typeof ChartZoom !== 'undefined') {
            Chart.register(ChartZoom);
        }

        // Configuration
        this.VIEW_MODES = window.APP_CONSTANTS.VIEW_MODES;
        this.currentViewMode = this.VIEW_MODES.OVERVIEW;

        this.ProjectCount = window.APP_CONSTANTS.DEFAULT_PROJECT_COUNT;

        // Load Defaults from Config
        const config = window.SolarConfig || { global: {}, suppliers: [] };

        this.defaultGlobal = config.global || {
            period: 20, wacc: 6.0,
            degradation: 0.5, tariffEscalation: 2.0, opexInflation: 2.0
        };

        this.defaultSuppliers = config.suppliers || [];

        this.suppliers = JSON.parse(JSON.stringify(this.defaultSuppliers));
        this.global = JSON.parse(JSON.stringify(this.defaultGlobal));
        this.sharedProjectTab = this.suppliers[0]?.activeTab ?? 0;
        this.charts = {};

        this.init();
    }


    init() {
        this.migrateLegacyData();
        this.loadInputs();
        this.renderSuppliers();
        this.renderViewControls();
        this.calculateAndRender();
        this.attachGlobalListeners();
        if (window.lucide) lucide.createIcons();
    }

    // --- Persistence & Migration ---

    migrateLegacyData() {
        const legacyTariff = Number.isFinite(this.global.utilityTariff) ? this.global.utilityTariff : 4.5;

        this.suppliers.forEach(supplier => {
            supplier.projects.forEach(project => {
                if (!Number.isFinite(project.utilityTariff)) project.utilityTariff = legacyTariff;
            });
        });

        delete this.global.utilityTariff;
        delete this.global.ppaDiscount;
    }

    loadInputs() {
        // Sync inputs (Populate DOM with current in-memory defaults)
        const setVal = (id, val) => {
            const el = document.getElementById(id);
            if (el) el.value = val;
        };
        Object.keys(this.global).forEach(k => {
            const id = this.getGlobalInputId(k);
            if (id) setVal(id, this.global[k]);
        });
    }

    getGlobalInputId(key) {
        const map = {
            period: 'project-period', wacc: 'wacc', degradation: 'degradation',
            tariffEscalation: 'tariff-escalation', opexInflation: 'opex-inflation'
        };
        return map[key];
    }

    saveInputs() {
        // Persistence Disabled (v2.9 requirement)
    }

    exportData() {
        const data = {
            version: APP_CONSTANTS.VERSION,
            savedAt: new Date().toISOString(),
            global: this.global,
            suppliers: this.suppliers
        };
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `solar_calc_data_${new Date().toISOString().slice(0, 10)}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }

    importData(input) {
        const file = input.files[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = (e) => {
            try {
                const data = JSON.parse(e.target.result);
                if (!data.global || !data.suppliers) throw new Error("Invalid file format");

                if (confirm("Importing this file will overwrite your current data. Continue?")) {
                    this.global = data.global;
                    this.suppliers = data.suppliers;
                    this.migrateLegacyData();
                    this.sharedProjectTab = this.suppliers[0]?.activeTab ?? 0;
                    this.saveInputs(); // Save to local storage
                    this.calculateAndRender();
                    this.renderSuppliers(); // Refresh UI
                    this.loadInputs(); // Re-populate global inputs DOM
                    alert("Data loaded successfully!");
                }
            } catch (err) {
                alert("Error importing file: " + err.message);
            }
            // Reset input so same file can be selected again if needed
            input.value = '';
        };
        reader.readAsText(file);
    }

    resetDefaults() {
        if (confirm('Reset all data? This cannot be undone.')) {
            localStorage.clear();
            location.reload();
        }
    }

    // --- Core Logic Injection ---

    calculateAndRender() {
        // Use the external Calculator
        this.results = this.suppliers.map(s => window.Calculator.calculateSupplier(s, this.global));
        this.renderSummaryTable();
        this.renderCharts();
        this.renderYearTableSelector();
        this.renderYearTable();
        this.renderSummaryReportPage();
    }

    // --- UI Rendering ---

    attachGlobalListeners() {
        // Global Inputs
        ['project-period', 'wacc', 'degradation', 'tariff-escalation', 'opex-inflation'].forEach(id => {
            const el = document.getElementById(id);
            if (el) {
                el.onchange = (e) => {
                    const map = { 'project-period': 'period', 'tariff-escalation': 'tariffEscalation', 'opex-inflation': 'opexInflation' };
                    this.updateConfig(map[id] || id, e.target.value);
                };
            }
        });
        const yearTableSelector = document.getElementById('year-table-selector');
        if (yearTableSelector) {
            yearTableSelector.onchange = () => this.renderYearTable();
        }
        const exportCsvBtn = document.getElementById('export-csv-btn');
        if (exportCsvBtn) {
            exportCsvBtn.onclick = () => this.exportCSV();
        }
    }

    switchTab(id, btn) {
        document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
        // Only target main nav buttons to avoid conflict with sub-tabs
        document.querySelectorAll('#main-nav .tab-btn').forEach(b => b.classList.remove('active'));

        document.getElementById(id).classList.add('active');
        if (btn) btn.classList.add('active');

        if (id === 'results-tab' || id === 'payback-tab' || id === 'investment-report-tab') this.renderCharts();
    }

    renderSummaryTable() {
        const head = document.getElementById('summary-header-row');
        const tbody = document.querySelector('#summary-table tbody');
        if (!head || !tbody) return;

        head.innerHTML = '<th>Metric</th>';
        tbody.innerHTML = '';

        const activeS = this.suppliers.filter(s => s.enabled);

        let cols = [];
        if (this.currentViewMode === this.VIEW_MODES.OVERVIEW) {
            cols = activeS.map((s, i) => ({ label: s.name, res: this.results ? this.results[this.suppliers.indexOf(s)] : null }));
        } else {
            // Breakdown: Add col for each project
            activeS.forEach(s => {
                const res = this.results[this.suppliers.indexOf(s)];
                if (res) {
                    res.projects.forEach((pres, pIdx) => {
                        if (pres) cols.push({ label: `${s.name} (${pres.meta.name})`, res: pres });
                    });
                }
            });
        }

        cols.forEach(c => head.innerHTML += `<th>${c.label}</th>`);

        const metrics = [
            { label: 'LCOE (THB/kWh)', key: 'lcoe', fmt: v => v.toFixed(2) },
            { label: 'Avg Tariff (THB)', key: 'avgTariff', fmt: v => v.toFixed(2) },
            { label: 'Profit Margin', key: 'profitMargin', fmt: v => `<span style="color:${v >= 0 ? 'green' : 'red'}">${v.toFixed(2)}</span>` },
            { label: 'Payback (Yrs)', key: 'payback', fmt: v => v > this.global.period ? '> ' + this.global.period : v.toFixed(1) },
            { label: 'IRR (%)', key: 'irr', fmt: v => v.toFixed(2) + '%' },
            { label: 'NPV (M THB)', key: 'npv', fmt: v => (v / 1e6).toFixed(2) },
            { label: 'ROI (%)', key: 'roi', fmt: v => v.toFixed(2) + '%' },
            { label: 'MIRR (%)', key: 'mirr', fmt: v => v.toFixed(2) + '%' }
        ];

        metrics.forEach(m => {
            let row = `<tr><td>${m.label}</td>`;
            cols.forEach(c => {
                row += `<td>${c.res ? m.fmt(c.res[m.key] || 0) : '-'}</td>`;
            });
            row += '</tr>';
            tbody.innerHTML += row;
        });
    }

    renderCharts() {
        if (typeof Chart === 'undefined') return;

        // Prepare Data based on Mode
        const activeS = this.suppliers.filter(s => s.enabled);
        let labels = [];
        let dataR = [];

        if (this.currentViewMode === this.VIEW_MODES.OVERVIEW) {
            activeS.forEach(s => {
                labels.push(s.name);
                dataR.push(this.results[this.suppliers.indexOf(s)]);
            });
        } else {
            activeS.forEach(s => {
                const res = this.results[this.suppliers.indexOf(s)];
                if (res) {
                    res.projects.forEach((pRes, pIdx) => {
                        if (pRes) {
                            labels.push(`${s.name} - ${pRes.meta.name}`);
                            dataR.push(pRes);
                        }
                    });
                }
            });
        }

        Chart.defaults.font.size = 13;
        Chart.defaults.font.family = "'Inter', 'Prompt', sans-serif";
        Chart.defaults.color = '#334155';
        Chart.defaults.devicePixelRatio = 2;

        const common = {
            responsive: true,
            maintainAspectRatio: false,
            animation: { duration: 450, easing: 'easeOutQuart' },
            plugins: {
                legend: {
                    position: 'top',
                    labels: { boxWidth: 14, boxHeight: 14, padding: 14, usePointStyle: true, pointStyle: 'rectRounded' }
                },
                tooltip: {
                    displayColors: true,
                    backgroundColor: 'rgba(15, 23, 42, 0.95)',
                    titleColor: '#f8fafc',
                    bodyColor: '#e2e8f0',
                    padding: 10,
                    borderColor: '#1e293b',
                    borderWidth: 1
                }
            }
        };

        // 1. LCOE
        const lcoeCanvas = document.getElementById('lcoeChart');
        if (lcoeCanvas) {
            if (this.charts.lcoe) this.charts.lcoe.destroy();
            this.charts.lcoe = new Chart(lcoeCanvas, {
                type: 'bar',
                data: {
                    labels,
                    datasets: [
                        { label: 'Capex', data: dataR.map(r => r ? r.lcoeCapex : 0), backgroundColor: '#ef4444', stack: '0' },
                        { label: 'Opex', data: dataR.map(r => r ? r.lcoeOpex : 0), backgroundColor: '#facc15', stack: '0' },
                        { label: 'Profit', data: dataR.map(r => r ? r.profitMargin : 0), backgroundColor: '#22c55e', stack: '0' }
                    ]
                },
                options: {
                    ...common,
                    scales: {
                        x: { stacked: true },
                        y: {
                            stacked: true,
                            title: { display: true, text: 'THB/kWh' },
                            afterFit: (axis) => { axis.width = 80; },
                            grace: '15%'
                        }
                    },
                    plugins: {
                        datalabels: {
                            display: (ctx) => ctx.datasetIndex === 2,
                            font: { size: 11, weight: 'bold' },
                            formatter: (v, ctx) => {
                                if (ctx.datasetIndex === 2) { // Profit Top
                                    const total = dataR[ctx.dataIndex] ? dataR[ctx.dataIndex].avgTariff : 0;
                                    return `T: ${total.toFixed(2)}\nP: ${v.toFixed(2)}`;
                                }
                                return v > 0.1 ? v.toFixed(2) : '';
                            },
                            anchor: (ctx) => ctx.datasetIndex === 2 ? 'end' : 'center',
                            align: (ctx) => ctx.datasetIndex === 2 ? 'top' : 'center',
                            offset: (ctx) => ctx.datasetIndex === 2 ? -5 : 0
                        }
                    }
                }
            });
        }

        // 2. Gen
        const genCanvas = document.getElementById('genChart');
        if (genCanvas) {
            if (this.charts.gen) this.charts.gen.destroy();
            this.charts.gen = new Chart(genCanvas, {
                type: 'bar',
                data: {
                    labels,
                    datasets: [{
                        label: 'Year 1 Generation (kWh)',
                        data: dataR.map(r => r ? r.yearlyData[0].energy : 0),
                        backgroundColor: '#2563eb',
                        borderRadius: 6,
                        maxBarThickness: 56
                    }]
                },
                options: {
                    ...common,
                    plugins: {
                        ...common.plugins,
                        datalabels: {
                            display: true,
                            formatter: (value) => value.toLocaleString(undefined, { maximumFractionDigits: 0 }),
                            anchor: 'end',
                            align: 'top',
                            offset: -5,
                            font: { size: 10 }
                        },
                        tooltip: {
                            callbacks: {
                                label: function (context) {
                                    let label = context.dataset.label || '';
                                    if (label) {
                                        label += ': ';
                                    }
                                    if (context.parsed.y !== null) {
                                        label += context.parsed.y.toLocaleString(undefined, { maximumFractionDigits: 0 }) + ' kWh';
                                    }
                                    return label;
                                }
                            }
                        }
                    },
                    scales: {
                        x: { ticks: { maxRotation: 0, minRotation: 0 } },
                        y: {
                            afterFit: (axis) => { axis.width = 88; },
                            grace: '12%',
                            ticks: { callback: (value) => Number(value).toLocaleString(undefined, { maximumFractionDigits: 0 }) }
                        }
                    }
                }
            });
        }

        // 3. Payback Chart
        const paybackCanvas = document.getElementById('paybackChart');
        if (paybackCanvas) {
            if (this.charts.payback) this.charts.payback.destroy();

            const modeSel = document.getElementById('payback-mode-selector');
            const paybackMode = modeSel ? modeSel.value : 'overview';

            const datasets = [];

            if (paybackMode === 'overview') {
                activeS.forEach((s, i) => {
                    const res = this.results[this.suppliers.indexOf(s)];
                    if (res) {
                        datasets.push({
                            label: s.name,
                            data: res.yearlyData.map(d => d.cumulativeCF),
                            borderColor: this.getChartColor(i),
                            backgroundColor: this.getChartColor(i),
                            fill: false,
                            tension: 0.4,
                            pointRadius: 2,
                            pointHoverRadius: 5,
                            borderWidth: 2.5
                        });
                    }
                });
            } else {
                // Breakdown
                activeS.forEach((s, sIdx) => {
                    const res = this.results[this.suppliers.indexOf(s)];
                    if (res) {
                        res.projects.forEach((pRes, pIdx) => {
                            if (pRes) {
                                datasets.push({
                                    label: `${s.name} - ${pRes.meta.name}`,
                                    data: pRes.yearlyData.map(d => d.cumulativeCF),
                                    borderColor: this.getChartColor(sIdx),
                                    backgroundColor: this.getChartColor(sIdx),
                                    borderDash: pIdx === 0 ? [] : [5, 5],
                                    fill: false,
                                    tension: 0.4,
                                    pointRadius: 2,
                                    pointHoverRadius: 5,
                                    borderWidth: 2.2
                                });
                            }
                        });
                    }
                });
            }

            // Add Breakeven Line (Zero Line)
            datasets.unshift({
                label: 'Breakeven',
                data: Array(this.global.period).fill(0),
                borderColor: '#64748b',
                borderWidth: 1,
                borderDash: [2, 2],
                pointRadius: 0,
                fill: false,
                order: 999
            });

            this.charts.payback = new Chart(paybackCanvas, {
                type: 'line',
                data: {
                    labels: Array.from({ length: this.global.period }, (_, i) => `Yr ${i + 1}`),
                    datasets: datasets
                },
                options: {
                    ...common,
                    maintainAspectRatio: false,
                    layout: {
                        padding: { top: 20, right: 30, bottom: 10, left: 10 }
                    },
                    interaction: {
                        mode: 'index',
                        intersect: false,
                    },
                    plugins: {
                        legend: {
                            position: 'bottom',
                            labels: {
                                usePointStyle: true,
                                boxWidth: 8,
                                padding: 20,
                                font: { size: 12, family: "'Inter', sans-serif" }
                            }
                        },
                        datalabels: { display: false },
                        tooltip: {
                            backgroundColor: 'rgba(255, 255, 255, 0.95)',
                            titleColor: '#1e293b',
                            bodyColor: '#475569',
                            borderColor: '#e2e8f0',
                            borderWidth: 1,
                            padding: 10,
                            boxPadding: 4,
                            usePointStyle: true,
                            callbacks: {
                                label: function (context) {
                                    let label = context.dataset.label || '';
                                    if (label) {
                                        label += ': ';
                                    }
                                    if (context.parsed.y !== null) {
                                        label += (context.parsed.y / 1e6).toFixed(2) + ' M THB';
                                    }
                                    return label;
                                }
                            }
                        },
                        zoom: {
                            pan: {
                                enabled: true,
                                mode: 'y'
                            },
                            zoom: {
                                wheel: { enabled: true },
                                pinch: { enabled: true },
                                mode: 'y'
                            }
                        }
                    },
                    scales: {
                        x: {
                            grid: { display: false },
                            ticks: { font: { size: 11 } }
                        },
                        y: {
                            title: { display: true, text: 'Cumulative CF (M THB)', font: { weight: '600' } },
                            grid: {
                                color: (ctx) => ctx.tick.value === 0 ? '#94a3b8' : '#e2e8f0',
                                lineWidth: (ctx) => ctx.tick.value === 0 ? 2 : 1
                            },
                            ticks: {
                                callback: function (value) {
                                    return (value / 1e6).toFixed(1) + 'M';
                                },
                                font: { size: 11 }
                            }
                        }
                    }
                }
            });
        }
    }

    getChartColor(idx, subIdx = 0) {
        const colors = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6'];
        return colors[idx % colors.length];
    }

    renderYearTableSelector() {
        const sel = document.getElementById('year-table-selector');
        if (!sel) return;

        // Save current selection if possible
        const currentVal = sel.value;
        sel.innerHTML = '';

        this.suppliers.forEach((s, sIdx) => {
            if (s.enabled) {
                // Supplier Overview Option
                const opt = document.createElement('option');
                opt.value = `S${sIdx}`;
                opt.text = `${s.name} (Overview)`;
                sel.appendChild(opt);

                // Individual Project Options
                s.projects.forEach((p, pIdx) => {
                    if (p.enabled) {
                        const pOpt = document.createElement('option');
                        pOpt.value = `S${sIdx}-P${pIdx}`;
                        pOpt.text = `  └ ${s.name} - ${p.name}`;
                        sel.appendChild(pOpt);
                    }
                });
            }
        });

        // Restore selection if valid, otherwise default to first
        if (currentVal && Array.from(sel.options).some(o => o.value === currentVal)) {
            sel.value = currentVal;
        }
    }

    renderYearTable() {
        const sel = document.getElementById('year-table-selector');
        if (!sel || !sel.value) return;

        const val = sel.value;
        let res = null;

        if (val.startsWith('S') && !val.includes('P')) {
            // Overview: S0
            const sIdx = parseInt(val.substring(1));
            res = this.results[sIdx];
        } else if (val.includes('P')) {
            // Project: S0-P1
            const parts = val.split('-');
            const sIdx = parseInt(parts[0].substring(1));
            const pIdx = parseInt(parts[1].substring(1));
            res = this.results[sIdx] ? this.results[sIdx].projects[pIdx] : null;
        }

        const tbody = document.querySelector('#year-table tbody');
        if (!tbody || !res) return;
        tbody.innerHTML = '';

        res.yearlyData.forEach(d => {
            tbody.innerHTML += `
        <tr>
            <td>${d.year}</td>
            <td>${d.energy.toLocaleString(undefined, { maximumFractionDigits: 0 })}</td>
            <td>${d.tariff.toFixed(2)}</td>
            <td>${d.revenue.toLocaleString(undefined, { maximumFractionDigits: 0 })}</td>
            <td>${d.opex.toLocaleString(undefined, { maximumFractionDigits: 0 })}</td>
            <td>${d.netCF.toLocaleString(undefined, { maximumFractionDigits: 0 })}</td>
            <td>${(d.cumulativeCF / 1e6).toFixed(2)}M</td>
        </tr>
    `;
        });
    }
    exportCSV() {
        const sel = document.getElementById('year-table-selector');
        if (!sel || !sel.value) return;

        const val = sel.value;
        let res = null;
        let filename = 'solar_cashflow.csv';

        if (val.startsWith('S') && !val.includes('P')) {
            const sIdx = parseInt(val.substring(1));
            res = this.results[sIdx];
            filename = `cashflow_${this.suppliers[sIdx].name.replace(/\s+/g, '_')}_overview.csv`;
        } else if (val.includes('P')) {
            const parts = val.split('-');
            const sIdx = parseInt(parts[0].substring(1));
            const pIdx = parseInt(parts[1].substring(1));
            res = this.results[sIdx] ? this.results[sIdx].projects[pIdx] : null;
            if (res) filename = `cashflow_${this.suppliers[sIdx].name.replace(/\s+/g, '_')}_${res.meta.name.replace(/\s+/g, '_')}.csv`;
        }

        if (!res) {
            alert('No data to export');
            return;
        }

        // Generate CSV Content
        const lines = ["Year,Energy (kWh),Tariff (THB),Revenue (THB),OPEX (THB),Net CF (THB),Cumulative (THB)"];
        res.yearlyData.forEach(d => {
            lines.push(`${d.year},${d.energy},${d.tariff},${d.revenue},${d.opex},${d.netCF},${d.cumulativeCF}`);
        });
        const csv = lines.join('\n');

        // Trigger Download
        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
        const link = document.createElement("a");
        if (link.download !== undefined) {
            const url = URL.createObjectURL(blob);
            link.setAttribute("href", url);
            link.setAttribute("download", filename);
            link.style.visibility = 'hidden';
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
        }
    }

    getTimestampSuffix() {
        const now = new Date();
        const pad = (v) => String(v).padStart(2, '0');
        return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}`;
    }

    buildExportFilename(filename, preset) {
        const base = filename.endsWith('.png') ? filename.slice(0, -4) : filename;
        return `${base}_${preset}_${this.getTimestampSuffix()}.png`;
    }

    buildExportCanvas(chart, preset = 'ppt') {
        const canvas = chart.canvas;
        const presets = {
            ppt: { width: 1920, height: 1080, padding: 64, titleSize: 36, subtitleSize: 20 },
            report: { width: 1600, height: 1200, padding: 60, titleSize: 34, subtitleSize: 18 },
            native: { width: canvas.width, height: canvas.height, padding: 24, titleSize: 26, subtitleSize: 16 }
        };

        const cfg = presets[preset] || presets.ppt;
        const exportCanvas = document.createElement('canvas');
        exportCanvas.width = cfg.width;
        exportCanvas.height = cfg.height;
        const ctx = exportCanvas.getContext('2d');

        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, cfg.width, cfg.height);

        const chartTitle = chart.options?.plugins?.title?.text || chart.canvas.closest('.chart-card')?.querySelector('h3')?.textContent || chart.canvas.closest('.card')?.querySelector('h3')?.textContent || 'Chart Export';
        const now = new Date();
        const subtitle = `Generated ${now.toLocaleDateString()} ${now.toLocaleTimeString()}`;

        ctx.fillStyle = '#0f172a';
        ctx.font = `700 ${cfg.titleSize}px Inter, Prompt, sans-serif`;
        ctx.fillText(chartTitle, cfg.padding, cfg.padding);

        ctx.fillStyle = '#64748b';
        ctx.font = `500 ${cfg.subtitleSize}px Inter, Prompt, sans-serif`;
        ctx.fillText(subtitle, cfg.padding, cfg.padding + cfg.subtitleSize + 12);

        const topOffset = cfg.padding + cfg.subtitleSize + 40;
        const drawW = cfg.width - (cfg.padding * 2);
        const drawH = cfg.height - topOffset - cfg.padding;

        ctx.drawImage(canvas, cfg.padding, topOffset, drawW, drawH);
        return exportCanvas;
    }

    exportChart(chartKey, filename = 'chart.png', presetSelectorId = 'export-preset-results') {
        const chart = this.charts[chartKey];
        if (!chart || !chart.canvas) return;

        const preset = document.getElementById(presetSelectorId)?.value || 'ppt';
        const exportCanvas = this.buildExportCanvas(chart, preset);

        const link = document.createElement('a');
        link.href = exportCanvas.toDataURL('image/png');
        link.download = this.buildExportFilename(filename, preset);
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    }

    async copyChartToClipboard(chartKey, presetSelectorId = 'export-preset-results') {
        const chart = this.charts[chartKey];
        if (!chart || !chart.canvas) return;

        const preset = document.getElementById(presetSelectorId)?.value || 'ppt';

        if (!navigator.clipboard || !window.ClipboardItem) {
            alert('Clipboard API is not supported in this browser. Please use Export PNG instead.');
            return;
        }

        try {
            const exportCanvas = this.buildExportCanvas(chart, preset);
            const blob = await new Promise(resolve => exportCanvas.toBlob(resolve, 'image/png'));
            if (!blob) throw new Error('Failed to create chart image blob.');

            await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
            alert('Chart copied to clipboard. You can paste into PowerPoint now.');
        } catch (err) {
            console.error('Copy chart failed:', err);
            alert('Unable to copy chart to clipboard in this environment. Please use Export PNG.');
        }
    }

    updateConfig(key, val) {
        this.global[key] = parseFloat(val);
        this.saveInputs();
        this.calculateAndRender();

    }

    getProjectUtilityTariff(project) {
        return Number.isFinite(project.utilityTariff) ? project.utilityTariff : 4.5;
    }

    updateProjectUtilityTariffDisplay(sIdx, pIdx) {
        const project = this.suppliers[sIdx]?.projects[pIdx];
        const displayEl = document.getElementById(`ppa-price-y1-display-${sIdx}-${pIdx}`);
        if (!project || !displayEl) return;

        const tariff = this.getProjectUtilityTariff(project);
        const ppaY1 = tariff * (1 - (project.ppaDiscount / 100));
        displayEl.textContent = ppaY1.toFixed(2);
    }

    // --- UI Rendering ---

    renderViewControls() {
        // Add toggle to Results Tab
        this.renderToggle('#results-tab .section-header div', 'view-toggle-results');
        this.renderToggle('#investment-report-tab .section-header div', 'view-toggle-report');
    }

    renderToggle(selector, id) {
        const container = document.querySelector(selector);
        if (container && !document.getElementById(id)) {
            const div = document.createElement('div');
            div.id = id;
            div.className = 'view-mode-toggle-group';
            div.style.marginTop = '1rem';
            div.innerHTML = `
                <div class="tabs" style="margin:0; justify-content:flex-start;">
                    <button class="tab-btn ${this.currentViewMode === 'overview' ? 'active' : ''}" onclick="app.setViewMode('overview')">Overview</button>
                    <button class="tab-btn ${this.currentViewMode === 'breakdown' ? 'active' : ''}" onclick="app.setViewMode('breakdown')">Project Breakdown</button>
                </div>
            `;
            container.appendChild(div);
        }
    }

    setViewMode(mode) {
        this.currentViewMode = mode;
        // Update all view toggles
        document.querySelectorAll('.view-mode-toggle-group .tab-btn').forEach(b => {
            if (b.textContent.toLowerCase().includes(mode)) b.classList.add('active');
            else b.classList.remove('active');
        });
        this.renderCharts();
        this.renderSummaryTable();
        this.renderSummaryReportPage();
    }

    renderSuppliers() {
        const container = document.getElementById('supplier-container');
        if (!container) return;

        container.innerHTML = ''; // Clear previous content

        this.suppliers.forEach((s, sIdx) => {
            const card = document.createElement('div');
            card.className = `supplier-card ${s.enabled ? '' : 'disabled'}`;

            // Header
            let html = `
        <div class="card-actions">
            <label class="toggle-switch">
                <input type="checkbox" ${s.enabled ? 'checked' : ''} onchange="app.toggleSupplier(${sIdx})">
                <span>Active</span>
            </label>
        </div>
        <input type="text" class="supplier-name-input" value="${s.name}" onchange="app.updateSupplierName(${sIdx}, this.value)" placeholder="Supplier Name">
    `;

            // Tabs
            html += `<div class="project-tabs">`;
            html += `<button class="project-tab-btn ${this.sharedProjectTab === 0 ? 'active' : ''}" onclick="app.switchProjectTab(${sIdx}, 0)">Overview</button>`;
            s.projects.forEach((p, pIdx) => {
                html += `<button class="project-tab-btn ${this.sharedProjectTab === (pIdx + 1) ? 'active' : ''}" onclick="app.switchProjectTab(${sIdx}, ${pIdx + 1})">Proj ${pIdx + 1}</button>`;
            });
            html += `</div>`;

            // Overview Content (Read Only)
            const agg = this.results ? this.results[sIdx] : null;
            html += `
        <div class="project-content ${this.sharedProjectTab === 0 ? 'active' : ''}">
            <div class="overview-stats">
                <div class="stat-box"><h4>Total kWp</h4><div class="val">${agg ? agg.totalKwp.toLocaleString() : '-'}</div></div>
                <div class="stat-box"><h4>Total CAPEX</h4><div class="val">${agg ? (agg.totalCapex / 1e6).toFixed(2) + 'M' : '-'}</div></div>
                <div class="stat-box"><h4>Avg LCOE</h4><div class="val">${agg ? agg.lcoe.toFixed(2) : '-'}</div></div>
                <div class="stat-box"><h4>IRR</h4><div class="val">${agg ? agg.irr.toFixed(2) + '%' : '-'}</div></div>
            </div>
            <p style="font-size:0.8rem; color:#64748b; text-align:center; margin-top:1rem;">Select a Project tab to edit details.</p>
        </div>
    `;

            // Project Contents
            s.projects.forEach((p, pIdx) => {
                const isActive = this.sharedProjectTab === (pIdx + 1);
                html += `
            <div class="project-content ${isActive ? 'active' : ''}">
                <div style="display:flex; justify-content:space-between; margin-bottom:0.5rem;">
                    <input type="text" value="${p.name}" onchange="app.updateProject(${sIdx}, ${pIdx}, 'name', this.value)" 
                           style="font-weight:600; font-size:0.9rem; width:60%; border:1px solid #e2e8f0; padding:0.2rem;">
                    <label><input type="checkbox" ${p.enabled ? 'checked' : ''} onchange="app.toggleProject(${sIdx}, ${pIdx})"> Enable</label>
                </div>

                ${!p.enabled ? '<p style="color:red; font-size:0.8rem;">Project Disabled</p>' : ''}
                
                <div class="grid-inputs small-grid">
                    <div class="input-group">
                        <label>kWp</label>
                        <input type="number" value="${p.kwp}" onchange="app.updateProject(${sIdx}, ${pIdx}, 'kwp', this.value)">
                    </div>
                    <div class="input-group">
                        <label>Prod Hour</label>
                        <input type="number" step="0.01" value="${p.prodHour}" onchange="app.updateProject(${sIdx}, ${pIdx}, 'prodHour', this.value)">
                    </div>
                    <div class="input-group">
                        <label>Utility Tariff (THB/kWh)</label>
                        <input type="number" step="0.01" value="${this.getProjectUtilityTariff(p)}" onchange="app.updateProject(${sIdx}, ${pIdx}, 'utilityTariff', this.value)">
                    </div>
                     <div class="input-group">
                        <label>Discount (%)</label>
                        <input type="number" step="0.1" value="${p.ppaDiscount}" onchange="app.updateProject(${sIdx}, ${pIdx}, 'ppaDiscount', this.value)">
                    </div>
                    <div class="input-group highlight">
                        <label>PPA Price Year 1 (THB)</label>
                        <div id="ppa-price-y1-display-${sIdx}-${pIdx}" class="highlight-val">-</div>
                    </div>
                    <div class="input-group">
                        <label>CAPEX</label>
                        <input type="number" value="${p.capex}" onchange="app.updateProject(${sIdx}, ${pIdx}, 'capex', this.value)">
                    </div>
                </div>

                <div class="opex-builder">
                    <label style="font-size:0.85rem; font-weight:600; color:#475569;">OPEX</label>
                    <div class="opex-list" id="opex-list-${sIdx}-${pIdx}"></div>
                    <button class="btn secondary add-opex-btn" onclick="app.addOpexItem(${sIdx}, ${pIdx})">
                        <i data-lucide="plus"></i> เพิ่มรายการ
                    </button>
                </div>
            </div>
        `;
            });

            card.innerHTML = html;
            container.appendChild(card);

            // Render OPEX for each project
            s.projects.forEach((p, pIdx) => {
                this.renderOpexItems(sIdx, pIdx);
                this.updateProjectUtilityTariffDisplay(sIdx, pIdx);
            });
        });
        if (window.lucide) lucide.createIcons();
    }

    renderOpexItems(sIdx, pIdx) {
        const container = document.getElementById(`opex-list-${sIdx}-${pIdx}`);
        container.innerHTML = '';

        this.suppliers[sIdx].projects[pIdx].opex.forEach((item, oIdx) => {
            const row = document.createElement('div');
            row.className = 'opex-row';
            row.innerHTML = `
        <div class="opex-index">${oIdx + 1}.</div>
        <input type="text" value="${item.name}" class="opex-name">
        <select class="opex-type">
            <option value="per_kwp" ${item.type == 'per_kwp' ? 'selected' : ''}>/kWp</option>
            <option value="flat" ${item.type == 'flat' ? 'selected' : ''}>Flat</option>
            <option value="per_kwh" ${item.type == 'per_kwh' ? 'selected' : ''}>/kWh</option>
        </select>
        <input type="number" value="${item.unit}" class="opex-unit">
        <input type="number" value="${item.freq || 1}" class="opex-freq">
        <button class="remove">ลบ</button>
     `;

            // Bind events
            row.querySelector('.opex-name').onchange = (e) => this.updateOpex(sIdx, pIdx, oIdx, 'name', e.target.value);
            row.querySelector('.opex-type').onchange = (e) => this.updateOpex(sIdx, pIdx, oIdx, 'type', e.target.value);
            row.querySelector('.opex-unit').onchange = (e) => this.updateOpex(sIdx, pIdx, oIdx, 'unit', parseFloat(e.target.value));
            row.querySelector('.opex-freq').onchange = (e) => this.updateOpex(sIdx, pIdx, oIdx, 'freq', parseFloat(e.target.value));
            row.querySelector('.remove').onclick = () => {
                this.suppliers[sIdx].projects[pIdx].opex.splice(oIdx, 1);
                this.saveInputs();
                this.renderOpexItems(sIdx, pIdx);
                this.calculateAndRender();
            };

            container.appendChild(row);
        });

        // Force Lucide to render icons in this container
        if (window.lucide) {
            lucide.createIcons({
                root: container,
                nameAttr: 'data-lucide'
            });
        }
    }

    switchProjectTab(sIdx, tabIdx) {
        this.sharedProjectTab = tabIdx;
        this.suppliers.forEach(supplier => supplier.activeTab = tabIdx);
        this.renderSuppliers(); // Re-render to update UI state
    }

    // --- Updates ---

    toggleSupplier(idx) {
        this.suppliers[idx].enabled = !this.suppliers[idx].enabled;
        this.saveInputs();
        this.calculateAndRender();
        this.renderSuppliers(); // Re-render to show disabled state
    }

    updateSupplierName(idx, val) {
        this.suppliers[idx].name = val;
        this.saveInputs();
        this.calculateAndRender();
    }

    toggleProject(sIdx, pIdx) {
        const nextEnabled = !this.suppliers[sIdx].projects[pIdx].enabled;

        this.suppliers.forEach(supplier => {
            if (supplier.projects[pIdx]) supplier.projects[pIdx].enabled = nextEnabled;
        });

        this.saveInputs();
        this.calculateAndRender();
        this.renderSuppliers(); // Re-render for synced state
    }

    updateProject(sIdx, pIdx, key, val) {
        if (key !== 'name') val = parseFloat(val);
        this.suppliers[sIdx].projects[pIdx][key] = val;
        this.saveInputs();
        this.calculateAndRender();

        if (key === 'capex' || key === 'kwp') {
            this.renderSuppliers(); // Update overview stats
            return;
        }

        if (key === 'ppaDiscount' || key === 'utilityTariff') {
            this.updateProjectUtilityTariffDisplay(sIdx, pIdx);
        }
    }

    updateOpex(sIdx, pIdx, oIdx, key, val) {
        this.suppliers[sIdx].projects[pIdx].opex[oIdx][key] = val;
        this.saveInputs();
        this.calculateAndRender();
    }

    addOpexItem(sIdx, pIdx) {
        this.suppliers[sIdx].projects[pIdx].opex.push({ name: "Cost", type: "per_kwp", unit: 0, freq: 1 });
        this.saveInputs();
        this.renderOpexItems(sIdx, pIdx);
        this.calculateAndRender();
    }


    renderSummaryReportPage() {
        const container = document.getElementById('summary-cards-container');
        if (!container) return;
        container.innerHTML = '';

        const activeS = this.suppliers.filter(s => s.enabled);

        if (activeS.length === 0) {
            container.innerHTML = '<p style="text-align:center; width:100%; color:#64748b;">No active suppliers selected.</p>';
            return;
        }

        // DATA PREPARATION
        let items = [];
        if (this.currentViewMode === this.VIEW_MODES.OVERVIEW) {
            // Mode: Overview (Supplier Level)
            items = activeS.map(s => ({
                name: s.name,
                res: this.results[this.suppliers.indexOf(s)],
                colorIndex: this.suppliers.indexOf(s)
            }));
        } else {
            // Mode: Breakdown (Project Level)
            activeS.forEach((s, sIdx) => {
                const res = this.results[this.suppliers.indexOf(s)];
                if (res) {
                    res.projects.forEach((pres, pIdx) => {
                        if (pres) {
                            items.push({
                                name: `${s.name} - ${pres.meta.name}`,
                                res: pres,
                                colorIndex: this.suppliers.indexOf(s) // Keep supplier color
                            });
                        }
                    });
                }
            });
        }

        items.forEach((item) => {
            const res = item.res;
            if (!res) return;

            // Year 1 Data for "Current" Impact
            const y1 = res.yearlyData[0];
            if (!y1) return;

            // 1. Investor Profit (Net CF) - From Investor Perspective
            const profitYear = y1.netCF;
            const profitMonth = profitYear / 12;
            const profitDay = profitYear / 365;

            // 2. Customer Savings - From Customer Perspective
            // Grid Cost = Energy * UtilityTariff
            // Solar Cost (Revenue) = Energy * PPA Price
            // Savings = Grid Cost - Solar Cost
            let gridCost = 0;
            if (item.res.meta) {
                const tariffY1 = this.getProjectUtilityTariff(item.res.meta);
                gridCost = y1.energy * tariffY1;
            } else if (item.res.projects) {
                gridCost = item.res.projects.reduce((sum, projectRes) => {
                    if (!projectRes || !projectRes.meta || !projectRes.yearlyData || !projectRes.yearlyData[0]) return sum;
                    const tariffY1 = this.getProjectUtilityTariff(projectRes.meta);
                    return sum + (projectRes.yearlyData[0].energy * tariffY1);
                }, 0);
            } else {
                gridCost = y1.energy * 4.5;
            }

            const solarCost = y1.revenue;
            const savingsYear = gridCost - solarCost;

            const savingsMonth = savingsYear / 12;
            const savingsDay = savingsYear / 365;

            // 3. Environmental Impact using external constants
            const co2Year = res.env ? res.env.co2Year : 0;
            const treesYear = res.env ? res.env.treesYear : 0;

            const card = document.createElement('div');
            card.className = 'card';
            card.style.borderTop = `4px solid ${this.getChartColor(item.colorIndex)}`;
            card.style.display = 'flex';
            card.style.flexDirection = 'column';

            const fmt = (v) => v.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 });

            card.innerHTML = `
                <div class="card-header" style="margin-bottom:1rem; border-bottom:1px solid #f1f5f9; padding-bottom:0.5rem;">
                    <h3 style="font-size:1.2rem; color:#1e293b; margin:0;">${item.name}</h3>
                    <span style="font-size:0.8rem; color:#64748b;">Year 1 Projections</span>
                </div>
                
                <div style="margin-bottom:1.5rem;">
                    <h4 style="font-size:0.85rem; color:#64748b; margin-bottom:0.8rem; text-transform:uppercase; letter-spacing:0.05em; font-weight:700;">
                        <i data-lucide="wallet" style="width:14px; vertical-align:middle; margin-right:4px;"></i> Investment Cost (เงินลงทุนรวม)
                    </h4>
                    <div style="background:#fff7ed; padding:1rem; border-radius:8px; border:1px solid #ffedd5; text-align:center;">
                        <div style="font-weight:700; color:#c2410c; font-size:1.5rem;">${fmt(res.totalCapex)} <span style="font-size:1rem; font-weight:500;">THB</span></div>
                    </div>
                </div>

                <div style="display:flex; gap:1rem; margin-bottom:1.5rem;">
                     <div style="flex:1;">
                        <h4 style="font-size:0.85rem; color:#64748b; margin-bottom:0.8rem; text-transform:uppercase; letter-spacing:0.05em; font-weight:700;">
                            <i data-lucide="leaf" style="width:14px; vertical-align:middle; margin-right:4px;"></i> Environmental Impact
                        </h4>
                        <div style="background:#f0fdf4; padding:0.8rem; border-radius:8px; border:1px solid #dcfce7; height:100%;">
                            <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:0.5rem;">
                                <span style="font-size:0.8rem; color:#166534;">CO<sub>2</sub> Reduction</span>
                                <b style="color:#15803d;">${fmt(co2Year)} kg</b>
                            </div>
                            <div style="display:flex; align-items:center; justify-content:space-between;">
                                <span style="font-size:0.8rem; color:#166534;">Equivalent Trees</span>
                                <b style="color:#15803d;">${fmt(treesYear)} 🌳</b>
                            </div>
                        </div>
                     </div>
                </div>

                <div style="margin-bottom:1.5rem; flex:1;">
                    <h4 style="font-size:0.85rem; color:#64748b; margin-bottom:0.8rem; text-transform:uppercase; letter-spacing:0.05em; font-weight:700;">
                        <i data-lucide="coins" style="width:14px; vertical-align:middle; margin-right:4px;"></i> Investor Profit (กำไรผู้ลงทุน)
                    </h4>
                    <div style="display:grid; grid-template-columns: 1fr 1fr 1fr; gap:0.5rem; text-align:center;">
                        <div style="background:#f0fdf4; padding:0.8rem 0.5rem; border-radius:8px; border:1px solid #dcfce7;">
                            <div style="font-size:0.7rem; color:#166534; text-transform:uppercase; font-weight:600;">Day</div>
                            <div style="font-weight:700; color:#15803d; font-size:1.1rem; margin-top:0.2rem;">${fmt(profitDay)}</div>
                        </div>
                        <div style="background:#f0fdf4; padding:0.8rem 0.5rem; border-radius:8px; border:1px solid #dcfce7;">
                            <div style="font-size:0.7rem; color:#166534; text-transform:uppercase; font-weight:600;">Month</div>
                            <div style="font-weight:700; color:#15803d; font-size:1.1rem; margin-top:0.2rem;">${fmt(profitMonth)}</div>
                        </div>
                        <div style="background:#f0fdf4; padding:0.8rem 0.5rem; border-radius:8px; border:1px solid #dcfce7;">
                            <div style="font-size:0.7rem; color:#166534; text-transform:uppercase; font-weight:600;">Year</div>
                            <div style="font-weight:700; color:#15803d; font-size:1.1rem; margin-top:0.2rem;">${fmt(profitYear)}</div>
                        </div>
                    </div>
                </div>

                <div style="flex:1;">
                    <h4 style="font-size:0.85rem; color:#64748b; margin-bottom:0.8rem; text-transform:uppercase; letter-spacing:0.05em; font-weight:700;">
                        <i data-lucide="piggy-bank" style="width:14px; vertical-align:middle; margin-right:4px;"></i> Customer Savings (ส่วนลดค่าไฟ)
                    </h4>
                     <div style="display:grid; grid-template-columns: 1fr 1fr 1fr; gap:0.5rem; text-align:center;">
                        <div style="background:#eff6ff; padding:0.8rem 0.5rem; border-radius:8px; border:1px solid #dbeafe;">
                            <div style="font-size:0.7rem; color:#1e40af; text-transform:uppercase; font-weight:600;">Day</div>
                            <div style="font-weight:700; color:#2563eb; font-size:1.1rem; margin-top:0.2rem;">${fmt(savingsDay)}</div>
                        </div>
                        <div style="background:#eff6ff; padding:0.8rem 0.5rem; border-radius:8px; border:1px solid #dbeafe;">
                            <div style="font-size:0.7rem; color:#1e40af; text-transform:uppercase; font-weight:600;">Month</div>
                            <div style="font-weight:700; color:#2563eb; font-size:1.1rem; margin-top:0.2rem;">${fmt(savingsMonth)}</div>
                        </div>
                        <div style="background:#eff6ff; padding:0.8rem 0.5rem; border-radius:8px; border:1px solid #dbeafe;">
                            <div style="font-size:0.7rem; color:#1e40af; text-transform:uppercase; font-weight:600;">Year</div>
                            <div style="font-weight:700; color:#2563eb; font-size:1.1rem; margin-top:0.2rem;">${fmt(savingsYear)}</div>
                        </div>
                    </div>
                </div>
            `;
            container.appendChild(card);
        });

        if (window.lucide) lucide.createIcons();
    }
}

try {
    window.app = new SolarCalculator();
    console.log('App initialized successfully (v2.10)');
} catch (err) {
    console.error('Critical Error initializing app:', err);
    alert('Critical Error: ' + err.message);
}

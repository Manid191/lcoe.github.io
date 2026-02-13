/**
 * LCOE & PPA Calculator - Calculation Engine
 * Pure functions for financial and technical calculations.
 */

window.Calculator = {
    /**
     * Calculate a single Project's financial metrics
     * @param {Object} project - Project data object
     * @param {Object} global - Global settings object (wacc, period, etc.)
     * @returns {Object} Calculated results
     */
    calculateProject(project, global) {
        if (!project.enabled) return null;

        const results = {
            yearlyData: [],
            pvEnergy: 0,
            pvOpex: 0, // PV of OPEX
            pvRevenue: 0,
            cashflows: [-project.capex],
            totalCapex: project.capex,
            totalRevenue: 0,
            totalOpexNominal: 0
        };

        const e1 = project.kwp * project.prodHour * 365;
        const utilityTariff = Number.isFinite(project.utilityTariff) ? project.utilityTariff : global.utilityTariff;
        const sellY1 = utilityTariff * (1 - (project.ppaDiscount / 100));

        const r = global.wacc / 100;
        const deg = global.degradation / 100;
        const esc = global.tariffEscalation / 100;
        const inf = global.opexInflation / 100;

        for (let t = 1; t <= global.period; t++) {
            const df = 1 / Math.pow(1 + r, t);

            // Energy
            const annualEnergy = e1 * Math.pow(1 - deg, t - 1);
            results.pvEnergy += annualEnergy * df;

            // OPEX
            let annualOpex = 0;
            project.opex.forEach(item => {
                let val = 0;
                if (item.type === 'per_kwp') val = item.unit * project.kwp * (item.freq || 1);
                else if (item.type === 'flat') val = item.unit;
                else if (item.type === 'per_kwh') val = item.unit * annualEnergy;
                annualOpex += val * Math.pow(1 + inf, t - 1);
            });
            results.pvOpex += annualOpex * df;
            results.totalOpexNominal += annualOpex;

            // Revenue
            const currentTariff = sellY1 * Math.pow(1 + esc, t - 1);
            const annualRevenue = annualEnergy * currentTariff;
            results.pvRevenue += annualRevenue * df;
            results.totalRevenue += annualRevenue;

            const netCF = annualRevenue - annualOpex;
            results.cashflows.push(netCF);

            results.yearlyData.push({
                year: t,
                energy: annualEnergy,
                tariff: currentTariff,
                revenue: annualRevenue,
                opex: annualOpex,
                netCF: netCF,
                pvNetCF: netCF * df
            });
        }

        // Calculate Cumulative for Project
        let cumulative = results.cashflows[0]; // Year 0 (Capex)
        results.yearlyData.forEach(d => {
            cumulative += d.netCF;
            d.cumulativeCF = cumulative;
        });

        // Add Extended Calculations (LCOE, etc.)
        this.calculateFinancials(results, global);

        return results;
    },

    /**
     * Aggregate Projects for a Supplier
     * @param {Object} supplier - Supplier data object
     * @param {Object} global - Global settings
     * @returns {Object} Aggregated results
     */
    calculateSupplier(supplier, global) {
        if (!supplier.enabled) return null;

        const projResults = supplier.projects.map(p => this.calculateProject(p, global));
        const activeProjResults = projResults.filter(r => r !== null);

        if (activeProjResults.length === 0) return null; // No active projects

        // Aggregate Defaults
        const agg = {
            name: supplier.name,
            totalKwp: 0,
            totalCapex: 0,
            pvEnergy: 0,
            pvOpex: 0,
            pvRevenue: 0,
            totalRevenue: 0,
            totalOpexNominal: 0,
            cashflows: new Array(global.period + 1).fill(0),
            yearlyData: new Array(global.period).fill(null).map((_, i) => ({
                year: i + 1, energy: 0, revenue: 0, opex: 0, netCF: 0, cumulativeCF: 0
            }))
        };

        // Summation
        activeProjResults.forEach(r => {
            agg.totalCapex += r.totalCapex;
            agg.pvEnergy += r.pvEnergy;
            agg.pvOpex += r.pvOpex;
            agg.pvRevenue += r.pvRevenue;
            agg.totalRevenue += r.totalRevenue;
            agg.totalOpexNominal += r.totalOpexNominal;

            r.cashflows.forEach((cf, t) => agg.cashflows[t] += cf);

            r.yearlyData.forEach((yd, i) => {
                agg.yearlyData[i].energy += yd.energy;
                agg.yearlyData[i].revenue += yd.revenue;
                agg.yearlyData[i].opex += yd.opex;
                agg.yearlyData[i].netCF += yd.netCF;
                agg.yearlyData[i].tariff = yd.tariff; // Same for all usually, or avg? Taking one is simplified
            });
        });

        // Add kWp
        supplier.projects.forEach(p => { if (p.enabled) agg.totalKwp += p.kwp; });

        // Calculate Metrics based on Aggregates
        let cumulative = 0;
        let paybackFound = false;
        agg.payback = global.period + 1;

        agg.yearlyData.forEach((d, i) => {
            // Year 0 is cashflows[0]
            if (i === 0) cumulative += agg.cashflows[0];

            const prev = cumulative;
            cumulative += d.netCF;
            d.cumulativeCF = cumulative;

            if (!paybackFound && cumulative >= 0) {
                const fraction = Math.abs(prev) / d.netCF;
                agg.payback = (d.year - 1) + fraction;
                paybackFound = true;
            }
        });

        this.calculateFinancials(agg, global);

        // Attach Project Results for Breakdown View
        agg.projects = projResults.map((r, i) => {
            if (!r) return null;
            return { ...r, meta: supplier.projects[i] };
        });

        return agg;
    },

    calculateFinancials(res, global) {
        if (res.pvEnergy > 0) {
            res.lcoeCapex = res.totalCapex / res.pvEnergy;
            res.lcoeOpex = res.pvOpex / res.pvEnergy;
            res.lcoe = res.lcoeCapex + res.lcoeOpex;
            res.avgTariff = res.pvRevenue / res.pvEnergy;
            res.profitMargin = res.avgTariff - res.lcoe;
        } else {
            res.lcoeCapex = 0;
            res.lcoeOpex = 0;
            res.lcoe = 0;
            res.avgTariff = 0;
            res.profitMargin = 0;
        }

        res.irr = this.calculateIRR(res.cashflows);
        res.npv = res.pvRevenue - (res.totalCapex + res.pvOpex);
        res.roi = this.calculateROI(res.totalRevenue, res.totalOpexNominal, res.totalCapex);
        res.mirr = this.calculateMIRR(res.cashflows, global);

        // Environmental Impact Calculations (Integrated into Results)
        if (res.yearlyData && res.yearlyData.length > 0) {
            const y1 = res.yearlyData[0];
            res.env = {
                co2Year: y1.energy * window.ENV_FACTORS.CO2_FACTOR,
                treesYear: (y1.energy * window.ENV_FACTORS.CO2_FACTOR) / window.ENV_FACTORS.TREE_FACTOR
            };
        }
    },

    calculateROI(totalRevenue, totalOpex, totalCapex) {
        const netProfit = totalRevenue - totalOpex - totalCapex;
        if (totalCapex === 0) return 0;
        return (netProfit / totalCapex) * 100;
    },

    calculateMIRR(cashflows, global) {
        const r = global.wacc / 100;
        const n = global.period;

        let fvPos = 0;
        let pvNeg = 0;

        cashflows.forEach((cf, t) => {
            if (cf >= 0) {
                fvPos += cf * Math.pow(1 + r, n - t);
            } else {
                pvNeg += Math.abs(cf) / Math.pow(1 + r, t);
            }
        });

        if (pvNeg === 0) return 0;
        return (Math.pow(fvPos / pvNeg, 1 / n) - 1) * 100;
    },

    calculateIRR(cashflows) {
        let guess = 0.1;
        for (let i = 0; i < 100; i++) {
            let npv = 0, dnpv = 0;
            for (let t = 0; t < cashflows.length; t++) {
                const f = Math.pow(1 + guess, t);
                npv += cashflows[t] / f;
                dnpv -= t * cashflows[t] / (f * (1 + guess));
            }
            if (Math.abs(dnpv) < 1e-6) break;
            let val = guess - npv / dnpv;
            if (Math.abs(val - guess) < 1e-5) return val * 100;
            guess = val;
        }
        return 0;
    }
};

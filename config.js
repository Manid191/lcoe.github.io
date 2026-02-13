/**
 * LCOE & PPA Calculator - Configuration
 * Default values for Global Settings and Suppliers.
 */
window.SolarConfig = {
    // Global Financial & Technical Settings
    global: {
        period: 20,
        wacc: 6.0,
        degradation: 0.5,
        tariffEscalation: 2.0,
        opexInflation: 2.0
    },

    // Default Supplier Data
    suppliers: [
        {
            id: 1,
            name: "Supplier A",
            enabled: true,
            activeTab: 0,
            projects: createDefaultProjects(3, true)
        },
        {
            id: 2,
            name: "Supplier B",
            enabled: true,
            activeTab: 0,
            projects: createDefaultProjects(3, false)
        },
        {
            id: 3,
            name: "Supplier C",
            enabled: false,
            activeTab: 0,
            projects: createDefaultProjects(3, false)
        }
    ]
};

// Helper function to create default project structure (used by config only)
function createDefaultProjects(count, firstEnabled) {
    return Array.from({ length: count }, (_, i) => ({
        id: i + 1,
        name: `Project ${i + 1}`,
        kwp: 100,
        prodHour: 3.65,
        capex: 3500000,
        utilityTariff: 4.5,
        ppaDiscount: 10.0,
        enabled: i === 0 && firstEnabled, // First project of first supplier enabled
        opex: [{ name: "O&M", type: "per_kwp", unit: 500, freq: 1 }]
    }));
}

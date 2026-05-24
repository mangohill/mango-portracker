// =======================================
// Mango Mango 2.0 – Full Logic + UI Core
// (Defensive DOM checks – won't crash)
// =======================================

document.addEventListener("DOMContentLoaded", () => {

    // =========================
    // 1. APP STATE & CONSTANTS
    // =========================

    const STORAGE_KEY_DATA = "mango_mango_portfolios";
    const STORAGE_KEY_SETTINGS = "mango_mango_settings";

    let appState = {
        portfolios: [],
        activePortfolioId: null
    };

    let settingsState = {
        gistId: "",
        gistToken: "",
        workerUrl: ""
    };

    const demoData = {
        portfolios: [
            {
                id: "core",
                name: "Core Portfolio",
                holdings: [
                    { ticker: "VAS", name: "Vanguard Australian Shares", units: 120, price: 95.2, dayChange: -0.4, costBase: 10000, sector: "Equities" },
                    { ticker: "VGS", name: "Vanguard Intl Shares", units: 80, price: 120.5, dayChange: 0.8, costBase: 8000, sector: "International" },
                    { ticker: "AAA", name: "Betashares High Interest", units: 500, price: 50.1, dayChange: 0.1, costBase: 25000, sector: "Cash" }
                ],
                trades: [
                    { date: "2025-01-10", ticker: "VAS", type: "BUY", units: 50, price: 92.5, fees: 9.95 },
                    { date: "2025-02-02", ticker: "VGS", type: "BUY", units: 30, price: 118.0, fees: 9.95 },
                    { date: "2025-03-15", ticker: "AAA", type: "BUY", units: 200, price: 49.8, fees: 9.95 }
                ],
                dividends: [
                    { date: "2025-03-31", ticker: "VAS", amount: 320.5, franking: 0.8 },
                    { date: "2025-04-15", ticker: "VGS", amount: 210.0, franking: 0.0 },
                    { date: "2025-05-01", ticker: "AAA", amount: 95.2, franking: 0.0 }
                ],
                property: [],
                super: [],
                tax: []
            }
        ],
        activePortfolioId: "core"
    };

    // =========================
    // 2. DOM ELEMENTS
    // =========================

    const sidebar = document.getElementById("sidebar");
    const collapseBtn = document.getElementById("toggleSidebar");
    const mobileMenu = document.getElementById("mobileMenu");
    const darkToggle = document.getElementById("darkModeToggle");
    const links = document.querySelectorAll(".sidebar-nav a");
    const sections = document.querySelectorAll(".page-section");
    const pageTitle = document.getElementById("pageTitle");

    const portfolioSelector = document.getElementById("portfolioSelector");
    const exportJsonBtn = document.getElementById("exportJson");

    const totalValueEl = document.getElementById("totalValue");
    const dailyChangeEl = document.getElementById("dailyChange");
    const ytdReturnEl = document.getElementById("ytdReturn");
    const incomeFYEl = document.getElementById("incomeFY");

    const holdingsTable = document.getElementById("holdingsTable");
    const tradesTable = document.getElementById("tradesTable");
    const dividendsTable = document.getElementById("dividendsTable");

    const gistIdInput = document.getElementById("gistId");
    const gistTokenInput = document.getElementById("gistToken");
    const workerUrlInput = document.getElementById("workerUrl");
    const testWorkerBtn = document.getElementById("testWorkerBtn");

    // =========================
    // 3. STORAGE HELPERS
    // =========================

    function loadState() {
        try {
            const raw = localStorage.getItem(STORAGE_KEY_DATA);
            appState = raw ? JSON.parse(raw) : demoData;
        } catch {
            appState = demoData;
        }

        try {
            const rawSettings = localStorage.getItem(STORAGE_KEY_SETTINGS);
            settingsState = rawSettings ? JSON.parse(rawSettings) : settingsState;
        } catch {
            // keep defaults
        }

        // Ensure we always have an active portfolio
        if (!appState.activePortfolioId && appState.portfolios.length > 0) {
            appState.activePortfolioId = appState.portfolios[0].id;
        }
    }

    function saveState() {
        try {
            localStorage.setItem(STORAGE_KEY_DATA, JSON.stringify(appState));
        } catch (e) {
            console.warn("Failed to save app state:", e);
        }
    }

    function saveSettings() {
        try {
            localStorage.setItem(STORAGE_KEY_SETTINGS, JSON.stringify(settingsState));
        } catch (e) {
            console.warn("Failed to save settings:", e);
        }
    }

    // =========================
    // 4. CALCULATIONS
    // =========================

    function calcPortfolioSummary(portfolio) {
        if (!portfolio) return { totalValue: 0, dailyChange: 0, ytdReturnPct: 0, incomeFY: 0 };

        let totalValue = 0;
        let dailyChange = 0;
        let costBaseTotal = 0;

        (portfolio.holdings || []).forEach(h => {
            const value = (h.units || 0) * (h.price || 0);
            totalValue += value;
            dailyChange += value * ((h.dayChange || 0) / 100);
            costBaseTotal += h.costBase || 0;
        });

        const ytdReturnPct = costBaseTotal > 0
            ? ((totalValue - costBaseTotal) / costBaseTotal) * 100
            : 0;

        const now = new Date();
        const fyStart = new Date(now.getFullYear(), 6, 1);
        let incomeFY = 0;

        (portfolio.dividends || []).forEach(d => {
            const dDate = new Date(d.date);
            if (!isNaN(dDate) && dDate >= fyStart && dDate <= now) {
                incomeFY += d.amount || 0;
            }
        });

        return { totalValue, dailyChange, ytdReturnPct, incomeFY };
    }

    // =========================
    // 5. RENDER HELPERS
    // =========================

    const formatCurrency = v =>
        (v || 0).toLocaleString("en-AU", { style: "currency", currency: "AUD", maximumFractionDigits: 0 });

    const formatCurrency2 = v =>
        (v || 0).toLocaleString("en-AU", { style: "currency", currency: "AUD", maximumFractionDigits: 2 });

    const formatPercent = v => `${(v || 0).toFixed(2)}%`;

    function getActivePortfolio() {
        return appState.portfolios.find(p => p.id === appState.activePortfolioId) || appState.portfolios[0];
    }

    function renderDashboard() {
        if (!totalValueEl || !dailyChangeEl || !ytdReturnEl || !incomeFYEl) return;

        const p = getActivePortfolio();
        const s = calcPortfolioSummary(p);

        totalValueEl.textContent = formatCurrency(s.totalValue);
        dailyChangeEl.textContent = formatCurrency2(s.dailyChange);
        ytdReturnEl.textContent = formatPercent(s.ytdReturnPct);
        incomeFYEl.textContent = formatCurrency2(s.incomeFY);
    }

    function renderHoldings() {
        if (!holdingsTable) return;
        const p = getActivePortfolio();
        const holdings = p?.holdings || [];

        const rows = holdings.map(h => {
            const value = (h.units || 0) * (h.price || 0);
            const gain = value - (h.costBase || 0);
            const gainPct = (h.costBase || 0) > 0 ? (gain / h.costBase) * 100 : 0;

            return `
                <tr>
                    <td>${h.ticker || ""}</td>
                    <td>${h.name || ""}</td>
                    <td>${h.units || 0}</td>
                    <td>${formatCurrency2(h.price || 0)}</td>
                    <td>${formatCurrency2(value)}</td>
                    <td>${(h.dayChange || 0).toFixed(2)}%</td>
                    <td>${formatCurrency2(h.costBase || 0)}</td>
                    <td>${formatCurrency2(gain)} (${gainPct.toFixed(2)}%)</td>
                    <td>${h.sector || ""}</td>
                </tr>
            `;
        }).join("");

        holdingsTable.innerHTML = `
            <thead>
                <tr>
                    <th>Ticker</th><th>Name</th><th>Units</th><th>Price</th>
                    <th>Value</th><th>Day %</th><th>Cost Base</th><th>Gain</th><th>Sector</th>
                </tr>
            </thead>
            <tbody>
                ${rows || "<tr><td colspan='9'>No holdings</td></tr>"}
            </tbody>
        `;
    }

    function renderTrades() {
        if (!tradesTable) return;
        const p = getActivePortfolio();
        const trades = p?.trades || [];

        const rows = trades.map(t => `
            <tr>
                <td>${t.date || ""}</td>
                <td>${t.ticker || ""}</td>
                <td>${t.type || ""}</td>
                <td>${t.units || 0}</td>
                <td>${formatCurrency2(t.price || 0)}</td>
                <td>${formatCurrency2(t.fees || 0)}</td>
            </tr>
        `).join("");

        tradesTable.innerHTML = `
            <thead>
                <tr>
                    <th>Date</th><th>Ticker</th><th>Type</th><th>Units</th><th>Price</th><th>Fees</th>
                </tr>
            </thead>
            <tbody>
                ${rows || "<tr><td colspan='6'>No trades</td></tr>"}
            </tbody>
        `;
    }

    function renderDividends() {
        if (!dividendsTable) return;
        const p = getActivePortfolio();
        const dividends = p?.dividends || [];

        const rows = dividends.map(d => `
            <tr>
                <td>${d.date || ""}</td>
                <td>${d.ticker || ""}</td>
                <td>${formatCurrency2(d.amount || 0)}</td>
                <td>${((d.franking || 0) * 100).toFixed(0)}%</td>
            </tr>
        `).join("");

        dividendsTable.innerHTML = `
            <thead>
                <tr>
                    <th>Date</th><th>Ticker</th><th>Amount</th><th>Franking</th>
                </tr>
            </thead>
            <tbody>
                ${rows || "<tr><td colspan='4'>No dividends</td></tr>"}
            </tbody>
        `;
    }

    function renderPortfolioSelector() {
        if (!portfolioSelector) return;

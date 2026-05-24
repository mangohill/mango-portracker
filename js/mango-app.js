// =======================================
// Mango Mango 2.0 – Full Logic + UI Core
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

    // Default demo data
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
        } catch {}
    }

    function saveState() {
        localStorage.setItem(STORAGE_KEY_DATA, JSON.stringify(appState));
    }

    function saveSettings() {
        localStorage.setItem(STORAGE_KEY_SETTINGS, JSON.stringify(settingsState));
    }

    // =========================
    // 4. CALCULATIONS
    // =========================

    function calcPortfolioSummary(portfolio) {
        if (!portfolio) return { totalValue: 0, dailyChange: 0, ytdReturnPct: 0, incomeFY: 0 };

        let totalValue = 0;
        let dailyChange = 0;
        let costBaseTotal = 0;

        portfolio.holdings.forEach(h => {
            const value = h.units * h.price;
            totalValue += value;
            dailyChange += value * (h.dayChange / 100);
            costBaseTotal += h.costBase || 0;
        });

        const ytdReturnPct = costBaseTotal > 0
            ? ((totalValue -

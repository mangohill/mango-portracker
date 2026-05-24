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

    // Default demo data (you can replace this with your real data later)
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
            if (raw) {
                appState = JSON.parse(raw);
            } else {
                appState = demoData;
                saveState();
            }
        } catch (e) {
            console.error("Failed to load app state, using demo:", e);
            appState = demoData;
        }

        try {
            const rawSettings = localStorage.getItem(STORAGE_KEY_SETTINGS);
            if (rawSettings) {
                settingsState = JSON.parse(rawSettings);
            }
        } catch (e) {
            console.error("Failed to load settings:", e);
        }
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
        if (!portfolio) return {
            totalValue: 0,
            dailyChange: 0,
            ytdReturnPct: 0,
            incomeFY: 0
        };

        let totalValue = 0;
        let dailyChange = 0;
        let costBaseTotal = 0;

        portfolio.holdings.forEach(h => {
            const value = h.units * h.price;
            totalValue += value;
            dailyChange += value * (h.dayChange / 100);
            costBaseTotal += h.costBase || 0;
        });

        // Simple YTD return approximation
        const ytdReturnPct = costBaseTotal > 0
            ? ((totalValue - costBaseTotal) / costBaseTotal) * 100
            : 0;

        // Income FY = sum of dividends in current FY
        const now = new Date();
        const fyStart = new Date(now.getFullYear(), 6, 1); // 1 July
        let incomeFY = 0;

        portfolio.dividends.forEach(d => {
            const dDate = new Date(d.date);
            if (dDate >= fyStart && dDate <= now) {
                incomeFY += d.amount;
            }
        });

        return {
            totalValue,
            dailyChange,
            ytdReturnPct,
            incomeFY
        };
    }

    // =========================
    // 5. RENDER HELPERS
    // =========================

    function formatCurrency(value) {
        return value.toLocaleString("en-AU", {
            style: "currency",
            currency: "AUD",
            maximumFractionDigits: 0
        });
    }

    function formatCurrency2(value) {
        return value.toLocaleString("en-AU", {
            style: "currency",
            currency: "AUD",
            maximumFractionDigits: 2
        });
    }

    function formatPercent(value) {
        return `${value.toFixed(2)}%`;
    }

    function renderDashboard() {
        const portfolio = appState.portfolios.find(p => p.id === appState.activePortfolioId);
        const summary = calcPortfolioSummary(portfolio);

        if (totalValueEl) totalValueEl.textContent = formatCurrency(summary.totalValue);
        if (dailyChangeEl) dailyChangeEl.textContent = formatCurrency2(summary.dailyChange);
        if (ytdReturnEl) ytdReturnEl.textContent = formatPercent(summary.ytdReturnPct);
        if (incomeFYEl) incomeFYEl.textContent = formatCurrency2(summary.incomeFY);
    }

    function renderHoldings() {
        const portfolio = appState.portfolios.find(p => p.id === appState.activePortfolioId);
        if (!portfolio || !holdingsTable) return;

        const rows = portfolio.holdings.map(h => {
            const value = h.units * h.price;
            const gain = value - (h.costBase || 0);
            const gainPct = (h.costBase || 0) > 0 ? (gain / h.costBase) * 100 : 0;

            return `
                <tr>
                    <td>${h.ticker}</td>
                    <td>${h.name}</td>
                    <td>${h.units}</td>
                    <td>${formatCurrency2(h.price)}</td>
                    <td>${formatCurrency2(value)}</td>
                    <td>${h.dayChange.toFixed(2)}%</td>
                    <td>${formatCurrency2(h.costBase || 0)}</td>
                    <td>${formatCurrency2(gain)} (${gainPct.toFixed(2)}%)</td>
                    <td>${h.sector || ""}</td>
                </tr>
            `;
        }).join("");

        holdingsTable.innerHTML = `
            <thead>
                <tr>
                    <th>Ticker</th>
                    <th>Name</th>
                    <th>Units</th>
                    <th>Price</th>
                    <th>Value</th>
                    <th>Day %</th>
                    <th>Cost Base</th>
                    <th>Gain</th>
                    <th>Sector</th>
                </tr>
            </thead>
            <tbody>
                ${rows || "<tr><td colspan='9'>No holdings</td></tr>"}
            </tbody>
        `;
    }

    function renderTrades() {
        const portfolio = appState.portfolios.find(p => p.id === appState.activePortfolioId);
        if (!portfolio || !tradesTable) return;

        const rows = portfolio.trades.map(t => `
            <tr>
                <td>${t.date}</td>
                <td>${t.ticker}</td>
                <td>${t.type}</td>
                <td>${t.units}</td>
                <td>${formatCurrency2(t.price)}</td>
                <td>${formatCurrency2(t.fees || 0)}</td>
            </tr>
        `).join("");

        tradesTable.innerHTML = `
            <thead>
                <tr>
                    <th>Date</th>
                    <th>Ticker</th>
                    <th>Type</th>
                    <th>Units</th>
                    <th>Price</th>
                    <th>Fees</th>
                </tr>
            </thead>
            <tbody>
                ${rows || "<tr><td colspan='6'>No trades</td></tr>"}
            </tbody>
        `;
    }

    function renderDividends() {
        const portfolio = appState.portfolios.find(p => p.id === appState.activePortfolioId);
        if (!portfolio || !dividendsTable) return;

        const rows = portfolio.dividends.map(d => `
            <tr>
                <td>${d.date}</td>
                <td>${d.ticker}</td>
                <td>${formatCurrency2(d.amount)}</td>
                <td>${(d.franking * 100).toFixed(0)}%</td>
            </tr>
        `).join("");

        dividendsTable.innerHTML = `
            <thead>
                <tr>
                    <th>Date</th>
                    <th>Ticker</th>
                    <th>Amount</th>
                    <th>Franking</th>
                </tr>
            </thead>
            <tbody>
                ${rows || "<tr><td colspan='4'>No dividends</td></tr>"}
            </tbody>
        `;
    }

    function renderPortfolioSelector() {
        if (!portfolioSelector) return;

        portfolioSelector.innerHTML = appState.portfolios.map(p => `
            <option value="${p.id}" ${p.id === appState.activePortfolioId ? "selected" : ""}>
                ${p.name}
            </option>
        `).join("");
    }

    function renderSettings() {
        if (gistIdInput) gistIdInput.value = settingsState.gistId || "";
        if (gistTokenInput) gistTokenInput.value = settingsState.gistToken || "";
        if (workerUrlInput) workerUrlInput.value = settingsState.workerUrl || "";
    }

    function renderAll() {
        renderPortfolioSelector();
        renderDashboard();
        renderHoldings();
        renderTrades();
        renderDividends();
        renderSettings();
    }

    // =========================
    // 6. UI BEHAVIOUR
    // =========================

    // Sidebar collapse
    if (collapseBtn && sidebar) {
        collapseBtn.addEventListener("click", () => {
            sidebar.classList.toggle("collapsed");
        });
    }

    // Mobile menu
    if (mobileMenu && sidebar) {
        mobileMenu.addEventListener("click", () => {
            sidebar.classList.toggle("open");
        });
    }

    // Dark mode
    if (darkToggle) {
        darkToggle.addEventListener("click", () => {
            document.body.classList.toggle("dark-mode");
            const mode = document.body.classList.contains("dark-mode") ? "dark" : "light";
            localStorage.setItem("theme", mode);
        });

        const savedTheme = localStorage.getItem("theme");
        if (savedTheme === "dark") {
            document.body.classList.add("dark-mode");
        }
    }

    // Navigation
    links.forEach(link => {
        link.addEventListener("click", (e) => {
            e.preventDefault();
            const target = link.getAttribute("href").replace("#", "");

            sections.forEach(sec => sec.classList.add("hidden"));
            const page = document.getElementById(target);
            if (page) page.classList.remove("hidden");

            links.forEach(l => l.classList.remove("active"));
            link.classList.add("active");

            if (pageTitle) {
                pageTitle.textContent = link.textContent.replace(/[^A-Za-z ]/g, "").trim();
            }
        });
    });

    // Portfolio selector change
    if (portfolioSelector) {
        portfolioSelector.addEventListener("change", () => {
            appState.activePortfolioId = portfolioSelector.value;
            saveState();
            renderAll();
        });
    }

    // Export JSON
    if (exportJsonBtn) {
        exportJsonBtn.addEventListener("click", () => {
            const dataStr = JSON.stringify(appState, null, 2);
            const blob = new Blob([dataStr], { type: "application/json" });
            const url = URL.createObjectURL(blob);

            const a = document.createElement("a");
            a.href = url;
            a.download = "mango-mango-export.json";
            a.click();

            URL.revokeObjectURL(url);
        });
    }

    // Settings inputs
    if (gistIdInput) {
        gistIdInput.addEventListener("change", () => {
            settingsState.gistId = gistIdInput.value.trim();
            saveSettings();
        });
    }

    if (gistTokenInput) {
        gistTokenInput.addEventListener("change", () => {
            settingsState.gistToken = gistTokenInput.value.trim();
            saveSettings();
        });
    }

    if (workerUrlInput) {
        workerUrlInput.addEventListener("change", () => {
            settingsState.workerUrl = workerUrlInput.value.trim();
            saveSettings();
        });
    }

    // Test Worker button (simple ping)
    if (testWorkerBtn) {
        testWorkerBtn.addEventListener("click", async () => {
            const url = (workerUrlInput && workerUrlInput.value.trim()) || settingsState.workerUrl;
            if (!url) {
                alert("Please enter a Worker URL first.");
                return;
            }

            try {
                const res = await fetch(url, { method: "GET" });
                if (!res.ok) throw new Error(`HTTP ${res.status}`);
                const text = await res.text();
                alert("Worker responded:\n" + text.slice(0, 200));
            } catch (e) {
                console.error("Worker test failed:", e);
                alert("Worker test failed: " + e.message);
            }
        });
    }

    // =========================
    // 7. INIT
    // =========================

    loadState();
    renderAll();
});

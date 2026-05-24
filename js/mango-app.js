// Demo data (replace with real storage/import later)
const demoData = {
    trades: [
        { ticker: "VAS", date: "2024-01-10", quantity: 100, price: 90.5, type: "Buy" },
        { ticker: "A200", date: "2024-02-15", quantity: 50, price: 120.1, type: "Buy" },
        { ticker: "VAS", date: "2024-03-20", quantity: -50, price: 95.0, type: "Sell" }
    ],
    dividends: [
        { ticker: "VAS", date: "2024-03-31", amount: 120.5 },
        { ticker: "A200", date: "2024-04-15", amount: 80.0 }
    ]
};

let cardsAnimated = false;

// Holdings aggregation
function computeHoldings(trades) {
    const map = {};
    trades.forEach(t => {
        map[t.ticker] = map[t.ticker] || { ticker: t.ticker, quantity: 0, avgPrice: 0 };
        const h = map[t.ticker];
        if (t.quantity > 0) {
            const totalCost = h.avgPrice * h.quantity + (t.price ?? 0) * t.quantity;
            h.quantity += t.quantity;
            h.avgPrice = h.quantity ? totalCost / h.quantity : 0;
        } else {
            h.quantity += t.quantity;
        }
        h.quantity = Math.max(0, h.quantity);
    });
    return Object.values(map);
}

// Render helpers
function renderHoldings() {
    const table = document.getElementById("holdingsTable");
    const holdings = computeHoldings(demoData.trades);

    table.innerHTML = `
        <thead>
            <tr>
                <th>Ticker</th>
                <th>Quantity</th>
                <th>Avg Price</th>
            </tr>
        </thead>
        <tbody>
            ${holdings.map(h => `
                <tr>
                    <td>${h.ticker}</td>
                    <td>${h.quantity}</td>
                    <td>${(h.avgPrice ?? 0).toFixed(2)}</td>
                </tr>
            `).join("")}
        </tbody>
    `;
}

function renderTrades() {
    const table = document.getElementById("tradesTable");

    demoData.trades.sort((a,b) => new Date(b.date) - new Date(a.date));

    table.innerHTML = `
        <thead>
            <tr>
                <th>Date</th>
                <th>Ticker</th>
                <th>Type</th>
                <th>Quantity</th>
                <th>Price</th>
            </tr>
        </thead>
        <tbody>
            ${demoData.trades.map(t => `
                <tr>
                    <td>${t.date}</td>
                    <td>${t.ticker}</td>
                    <td>${t.type}</td>
                    <td>${t.quantity}</td>
                    <td>${(t.price ?? 0).toFixed(2)}</td>
                </tr>
            `).join("")}
        </tbody>
    `;
}

function renderDividends() {
    const table = document.getElementById("dividendsTable");

    demoData.dividends.sort((a,b) => new Date(b.date) - new Date(a.date));

    table.innerHTML = `
        <thead>
            <tr>
                <th>Date</th>
                <th>Ticker</th>
                <th>Amount</th>
            </tr>
        </thead>
        <tbody>
            ${demoData.dividends.map(d => `
                <tr>
                    <td>${d.date}</td>
                    <td>${d.ticker}</td>
                    <td>${(d.amount ?? 0).toFixed(2)}</td>
                </tr>
            `).join("")}
        </tbody>
    `;
}

function renderDashboard() {
    const holdings = computeHoldings(demoData.trades);
    const totalValue = holdings.reduce((sum, h) => sum + h.quantity * (h.avgPrice ?? 0), 0);
    const incomeFY = demoData.dividends.reduce((sum, d) => sum + (d.amount ?? 0), 0);

    document.getElementById("totalValue").textContent = "$" + totalValue.toFixed(2);
    document.getElementById("dailyChange").textContent = "$0.00";
    document.getElementById("ytdReturn").textContent = "0%";
    document.getElementById("incomeFY").textContent = "$" + incomeFY.toFixed(2);

    if (!cardsAnimated) {
        document.querySelectorAll(".card").forEach((c, i) => {
            c.style.opacity = 0;
            c.style.transform = "translateY(12px)";
            c.style.animation = `cardIn .5s ease forwards`;
            c.style.animationDelay = `${i * 0.08}s`;
        });
        cardsAnimated = true;
    }
}

// Layout + navigation
function initLayout() {
    const sidebar = document.getElementById("sidebar");
    const mobileMenu = document.getElementById("mobileMenu");
    const topbar = document.getElementById("topbar");

    document.getElementById("toggleSidebar").onclick = () => {
        sidebar.classList.toggle("collapsed");
    };

    mobileMenu.onclick = () => {
        sidebar.classList.toggle("open");
    };

    document.addEventListener("click", e => {
        if (!sidebar.contains(e.target) && !mobileMenu.contains(e.target) && !topbar.contains(e.target)) {
            sidebar.classList.remove("open");
        }
    });

    document.querySelectorAll(".sidebar-nav a").forEach(link => {
        link.onclick = e => {
            e.preventDefault();

            document.querySelectorAll(".sidebar-nav a")
                .forEach(a => a.classList.remove("active"));
            link.classList.add("active");

            const target = link.getAttribute("href").substring(1);

            document.querySelectorAll(".page-section")
                .forEach(sec => sec.classList.remove("active"));

            document.getElementById(target).classList.add("active");

            const label = link.textContent.replace(/^[^\w]+/, "").trim();
            document.getElementById("pageTitle").textContent = label;

            sidebar.classList.remove("open");
        };
    });

    document.querySelectorAll(".page-section").forEach(sec => sec.classList.remove("active"));
    document.getElementById("dashboard").classList.add("active");
}

// Dark mode
function initDarkMode() {
    const btn = document.getElementById("darkModeToggle");
    const saved = localStorage.getItem("mangoTheme");
    if (saved) {
        document.documentElement.setAttribute("data-theme", saved);
    }

    btn.onclick = () => {
        const cur = document.documentElement.getAttribute("data-theme") || "light";
        const next = cur === "light" ? "dark" : "light";
        document.documentElement.setAttribute("data-theme", next);
        localStorage.setItem("mangoTheme", next);
    };
}

// Portfolio selector + export
function initPortfolioSelector() {
    const sel = document.getElementById("portfolioSelector");
    ["Default"].forEach(name => {
        const opt = document.createElement("option");
        opt.value = name;
        opt.textContent = name;
        sel.appendChild(opt);
    });

    sel.onchange =

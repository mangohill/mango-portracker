// ===============================
// Mango Mango 2.0 – Matching HTML
// ===============================

document.addEventListener("DOMContentLoaded", () => {

    // ---------------------------
    // SIDEBAR COLLAPSE
    // ---------------------------
    const collapseBtn = document.getElementById("toggleSidebar");
    const sidebar = document.getElementById("sidebar");

    if (collapseBtn && sidebar) {
        collapseBtn.addEventListener("click", () => {
            sidebar.classList.toggle("collapsed");
        });
    }

    // ---------------------------
    // MOBILE MENU
    // ---------------------------
    const mobileMenu = document.getElementById("mobileMenu");

    if (mobileMenu && sidebar) {
        mobileMenu.addEventListener("click", () => {
            sidebar.classList.toggle("open");
        });
    }

    // ---------------------------
    // DARK MODE
    // ---------------------------
    const darkToggle = document.getElementById("darkModeToggle");

    if (darkToggle) {
        darkToggle.addEventListener("click", () => {
            document.body.classList.toggle("dark-mode");

            const mode = document.body.classList.contains("dark-mode")
                ? "dark"
                : "light";

            localStorage.setItem("theme", mode);
        });

        // Load saved theme
        const saved = localStorage.getItem("theme");
        if (saved === "dark") {
            document.body.classList.add("dark-mode");
        }
    }

    // ---------------------------
    // PAGE NAVIGATION
    // ---------------------------
    const links = document.querySelectorAll(".sidebar-nav a");
    const sections = document.querySelectorAll(".page-section");

    links.forEach(link => {
        link.addEventListener("click", () => {
            const target = link.getAttribute("href").replace("#", "");

            // Hide all sections
            sections.forEach(sec => sec.classList.add("hidden"));

            // Show target section
            const page = document.getElementById(target);
            if (page) page.classList.remove("hidden");

            // Update active link
            links.forEach(l => l.classList.remove("active"));
            link.classList.add("active");

            // Update topbar title
            const title = document.getElementById("pageTitle");
            if (title) title.textContent = link.textContent.replace(/[^A-Za-z ]/g, "").trim();
        });
    });

});

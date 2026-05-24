// ===============================
// Mango Portfolio Tracker JS Core
// ===============================

// Sidebar toggle
document.addEventListener("DOMContentLoaded", () => {
    const sidebar = document.querySelector(".sidebar");
    const toggleBtn = document.querySelector(".toggle-btn");

    if (toggleBtn) {
        toggleBtn.addEventListener("click", () => {
            sidebar.classList.toggle("collapsed");
        });
    }

    // Navigation handling
    const navLinks = document.querySelectorAll(".nav-link");
    const pages = document.querySelectorAll(".page");

    navLinks.forEach(link => {
        link.addEventListener("click", () => {
            const target = link.getAttribute("data-target");

            pages.forEach(page => page.classList.add("hidden"));
            document.getElementById(target).classList.remove("hidden");

            navLinks.forEach(n => n.classList.remove("active"));
            link.classList.add("active");
        });
    });

    // Dark mode toggle
    const themeToggle = document.getElementById("theme-toggle");

    if (themeToggle) {
        themeToggle.addEventListener("click", () => {
            document.body.classList.toggle("dark-mode");

            const mode = document.body.classList.contains("dark-mode")
                ? "dark"
                : "light";

            localStorage.setItem("theme", mode);
        });

        // Load saved theme
        const savedTheme = localStorage.getItem("theme");
        if (savedTheme === "dark") {
            document.body.classList.add("dark-mode");
        }
    }

    // Dashboard animation
    const counters = document.querySelectorAll(".counter");

    const animateCounters = () => {
        counters.forEach(counter => {
            const target = +counter.getAttribute("data-target");
            const speed = 20;

            const update = () => {
                const value = +counter.innerText;
                const increment = Math.ceil(target / speed);

                if (value < target) {
                    counter.innerText = value + increment;
                    setTimeout(update, 20);
                } else {
                    counter.innerText = target;
                }
            };

            update();
        });
    };

    animateCounters();
});

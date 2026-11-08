const $ = (selector) => document.querySelector(selector);
const money = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
let budgetChart = null;

let debtChart = null;



function renderChart(income, expenses) {

    const canvas = document.getElementById("budgetChart");

    if (!canvas) return;

    if (budgetChart) {
        budgetChart.destroy();
        budgetChart = null;
    }

    income = Math.max(0, Number(income) || 0);
    expenses = Math.max(0, Number(expenses) || 0);

    budgetChart = new Chart(canvas, {

        type: "doughnut",

        data: {
            labels: ["Income", "Expenses"],

            datasets: [{
                data: [income, expenses],

                backgroundColor: [
                    "#22c55e",
                    "#ef4444"
                ],

                borderWidth: 0,
                hoverOffset: 8
            }]
        },

        options: {

            responsive: true,
            maintainAspectRatio: false,

            cutout: "65%",

            plugins: {

                legend: {
                    position: "bottom",

                    labels: {
                        padding: 20,
                        usePointStyle: true
                    }
                },

                tooltip: {
                    callbacks: {

                        label: function(context) {

                            return context.label + ": " +
                                money.format(context.raw);

                        }
                    }
                }
            }
        }
    });
}



function updateSavingsGoal (currentSavings, targetGoal) {
  const percent = targetGoal > 0
  ? Math.min((currentSavings / targetGoal) * 100, 100)
  : 0;
  $("#goalDisplay").textContent=`Goal: ${money.format(targetGoal)}`;
  $("#savings").textContent = money.format(currentSavings);
  $("#savingsFill").style.width = `${percent}%`;
  $("#savingsPercent").textContent = `${Math.round(percent)}% Complete`;
}

async function api(url, options = {}) {
  const response = await fetch(url, { headers: { "Content-Type": "application/json" }, ...options });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "Request failed.");
  return data;
}

function showToast(message, error = false) {
  const toast = $("#toast"); toast.textContent = message; toast.className = error ? "show error" : "show";
  setTimeout(() => { toast.className = ""; }, 3000);
}

function formData(form) { return Object.fromEntries(new FormData(form).entries()); }
function setToday() { document.querySelectorAll('input[type="date"]').forEach((input) => { if (!input.value) input.valueAsDate = new Date(); }); }

async function checkHealth() {
  try { await api("/api/health"); $("#dbStatus").textContent = "MySQL connected"; $("#dbDot").classList.add("online"); }
  catch { $("#dbStatus").textContent = "MySQL not connected"; }
}

async function showDashboard(user) {
  $("#firstName").textContent = user.firstName || user.first_name || "User";
  $("#authView").classList.add("hidden"); $("#dashboardView").classList.remove("hidden");
  await Promise.all([loadCategories(), loadSummary()]); setToday();
}

async function loadCategories() {
  const categories = await api("/api/categories");
  $("#categorySelect").innerHTML = categories.map((c) => `<option value="${c.category_id}">${escapeHtml(c.category_name)}</option>`).join("");
}

let savingsGoal = Number(localStorage.getItem("savingsGoal")) || 5000;



const saveGoalButton = $("#saveGoalButton");

if (saveGoalButton) {

    saveGoalButton.addEventListener("click", async () => {

        const value = Number($("#goalAmount").value);

        if (!Number.isFinite(value) || value <= 0) {
            showToast("Please enter a valid savings goal.", true);
            return;
        }

        savingsGoal = value;

        localStorage.setItem("savingsGoal", value);

        await loadSummary();

        showToast("Savings goal updated successfully!");

        $("#goalAmount").value = "";

    });
}




async function loadSummary() {
    try {
        const data = await api("/api/dashboard/summary");

        // Get income and expense totals
        const income = Number(data.totalIncome) || 0;
        const expenses = Number(data.totalExpenses) || 0;
        const remaining = income - expenses;

        // Update dashboard summary cards
        $("#totalIncome").textContent = money.format(income);
        $("#totalExpenses").textContent = money.format(expenses);
        $("#remaining").textContent = money.format(remaining);
        $("#totalDebt").textContent = money.format(data.totalDebt || 0);

        // UPDATE INCOME VS EXPENSES CHART
        renderChart(income, expenses);

        // Update cash flow progress
        const spentPercent = income > 0
            ? Math.min((expenses / income) * 100, 100)
            : 0;

        $("#remainingPercent").textContent =
            `${Math.round(100 - spentPercent)}%`;

        $("#progressBar").style.width =
            `${100 - spentPercent}%`;

        $("#spentLabel").textContent =
            `${money.format(expenses)} spent`;

        $("#incomeLabel").textContent =
            `${money.format(income)} income`;

        // Update debt projection
        renderDebtProjection(
            data.totalDebt,
            remaining
        );

        // Calculate financial health score
        let score = 0;

        if (income > 0) {
            score = ((income - expenses) / income) * 100;
        }

        score = Math.round(
            Math.max(0, Math.min(100, score))
        );

        const scoreElement = $("#healthScore");
        const statusElement = $("#healthStatus");

        scoreElement.textContent = `${score}/100`;

        if (income <= 0) {

            statusElement.textContent =
                "Add income to calculate";

            scoreElement.style.color = "#68766f";
            statusElement.style.color = "#68766f";

        } else if (score >= 70) {

            statusElement.textContent =
                "Healthy financial standing";

            scoreElement.style.color = "#176b51";
            statusElement.style.color = "#176b51";

        } else if (score >= 40) {

            statusElement.textContent =
                "Moderate financial standing";

            scoreElement.style.color = "#a85e16";
            statusElement.style.color = "#a85e16";

        } else {

            statusElement.textContent =
                "Needs improvement";

            scoreElement.style.color = "#a83f3f";
            statusElement.style.color = "#a83f3f";
        }

    } catch (error) {
        console.error("Dashboard summary error:", error);
        showToast("Unable to load dashboard summary.", true);
    }
}


function escapeHtml(value) { const node = document.createElement("div"); node.textContent = String(value); return node.innerHTML; }

document.querySelectorAll(".tab").forEach((tab) => tab.addEventListener("click", () => {
  document.querySelectorAll(".tab,.form-panel").forEach((item) => item.classList.remove("active"));
  tab.classList.add("active"); $(`#${tab.dataset.tab}Form`).classList.add("active");
}));

$("#loginForm").addEventListener("submit", async (event) => { event.preventDefault(); try { const result = await api("/api/login", { method: "POST", body: JSON.stringify(formData(event.target)) }); showToast(result.message); await showDashboard(result.user); } catch (e) { showToast(e.message, true); } });
$("#registerForm").addEventListener("submit", async (event) => { event.preventDefault(); try { const result = await api("/api/register", { method: "POST", body: JSON.stringify(formData(event.target)) }); showToast(result.message); await showDashboard(result.user); } catch (e) { showToast(e.message, true); } });
$("#logoutButton").addEventListener("click", async () => { await api("/api/logout", { method: "POST" }); location.reload(); });
$("#incomeForm").addEventListener("submit", async (event) => { event.preventDefault(); try { const result = await api("/api/income", { method: "POST", body: JSON.stringify(formData(event.target)) }); showToast(result.message); event.target.reset(); setToday(); await loadSummary(); } catch (e) { showToast(e.message, true); } });
$("#expenseForm").addEventListener("submit", async (event) => { event.preventDefault(); try { const result = await api("/api/expenses", { method: "POST", body: JSON.stringify(formData(event.target)) }); showToast(result.message); event.target.reset(); setToday(); await loadSummary(); } catch (e) { showToast(e.message, true); } });
$("#calculatorForm").addEventListener("submit", async (event) => { event.preventDefault(); try { const result = await api("/api/calculator/debt-payoff", { method: "POST", body: JSON.stringify(formData(event.target)) }); const box = $("#calculatorResult"); box.classList.remove("hidden"); box.innerHTML = `<span>Estimated payoff</span><strong>${result.monthsToPayoff} months</strong><small>${result.yearsToPayoff} years · ${money.format(result.totalInterest)} interest</small>`; } catch (e) { showToast(e.message, true); } });

$("#monthLabel").textContent = new Date().toLocaleDateString("en-US", { month: "long", year: "numeric" });
checkHealth(); setToday();
api("/api/me").then((result) => showDashboard(result.user)).catch(() => {});




function renderDebtProjection(totalDebt, remaining) {

    const canvas = document.getElementById("debtProjectionChart");

    if (!canvas) return;

    if (debtChart) {
        debtChart.destroy();
        debtChart = null;
    }

    totalDebt = Math.max(0, Number(totalDebt) || 0);
    remaining = Number(remaining) || 0;

    // Estimate 30% of positive remaining cash flow
    const payment = remaining * 0.30;

    const labels = ["Today"];
    const values = [totalDebt];

    if (totalDebt === 0) {

        labels.push("Debt-free");
        values.push(0);

    } else if (payment <= 0) {

        labels.push("No projected reduction");
        values.push(totalDebt);

    } else {

        let balance = totalDebt;
        let month = 1;

        while (balance > 0 && month <= 120) {

            balance = Math.max(0, balance - payment);

            labels.push(`Month ${month}`);
            values.push(balance);

            month++;
        }
    }

    debtChart = new Chart(canvas, {

        type: "line",

        data: {
            labels: labels,

            datasets: [{
                label: "Projected Debt",

                data: values,

                borderColor: "#7352a3",
                backgroundColor: "rgba(115, 82, 163, 0.12)",

                borderWidth: 3,
                pointRadius: 3,
                pointBackgroundColor: "#7352a3",

                fill: true,
                tension: 0.3
            }]
        },

        options: {
            responsive: true,
            maintainAspectRatio: false,

            plugins: {

                legend: {
                    display: true,
                    position: "bottom"
                },

                tooltip: {
                    callbacks: {
                        label: function(context) {
                            return "Balance: " +
                                money.format(context.parsed.y);
                        }
                    }
                }
            },

            scales: {

                y: {
                    beginAtZero: true,

                    ticks: {
                        callback: function(value) {
                            return money.format(value);
                        }
                    }
                },

                x: {
                    title: {
                        display: true,
                        text: "Time"
                    }
                }
            }
        }
    });
}


document.querySelectorAll(".nav-tab").forEach((tab)=> {
    tab.addEventListener("click", () =>{
        // remove active class from all nav buttons
        document.querySelectorAll(".nav-tab").forEach((item) => {
            item.classList.remove("active");
        });
        
        // hide all panels
        document.querySelectorAll(".page-panel").forEach((panel) => {
          panel.classList.remove("active");
        });
        
        //activate selected button
        tab.classList.add("active");

        //display selected
        const selectedPage = document.getElementById(
          `page-${tab.dataset.page}`
        );

        if (selectedPage) {
          selectedPage.classList.add("active");
        }
    });
})
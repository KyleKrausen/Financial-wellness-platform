const { describe, it, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { app, requireLogin, isValidEmail, normalizeEmail, isValidIsoDate, parsePositiveNumber, parsePositiveInteger } = require("../server.js");
const { spawnSync } = require("node:child_process");
const path = require("node:path");

// FR1  User Registration and Auth
function routeHandler(method, path) {
    const layer = app.router.stack.find(
        (l) => l.route && l.route.path === path && l.route.methods[method]
    );
    return layer.route.stack[layer.route.stack.length - 1].handle;
}

async function callRoute(method, path, body = {}, params = {}, query = {}) {
    const res = fakeResponse();
    await routeHandler(method, path)({ body, params, query, session: { userId: 1 } }, res, () => {});
    return { status: res.statusCode ?? 200, body: res.body };
}

describe("FR1 User Registration and Auth", () => {
    const validUser = {
        firstName: "First", lastName: "Last", email: "firstlast@example.com",
        username: "test1", password: "Password1!"
    }

    it("FR1_Test1 Accepts a valid email", () => {
        assert.equal(isValidEmail("user@example.com"), true);
    });

    it("FR1_Test2 Rejects an email with no dot in domain", () => {
        assert.equal(isValidEmail("user@examplecom"), false);
    });

    it("FR1_Test3 Reject an email with bad spacing", () => {
        assert.equal(isValidEmail("us er@example.com"), false);
    });

    it("FR1_Test4 Rejects an empty email input", () => {
        assert.equal(isValidEmail(""), false);
    });

    it("FR1_Test5 normalize valid emails", () => {
        assert.equal(normalizeEmail(" User@Example.COM "), "user@example.com");
    });

    it("FR1_Test6 register rejects missing fields", async () => {
        assert.deepEqual(await callRoute("post", "/api/register", { ...validUser, password: ""}),
            { status: 400, body: { error: "All fields are required." } 
        });
    });

    it ("FR1_Test7 register rejects too short usernames", async () => {
        assert.deepEqual(await callRoute("post", "/api/register", { ...validUser, username: "te" }),
            { status: 400, body: { error: "Username must be between 3 and 50 characters." } 
        });
    });

    it ("FR1_Test8 register rejects too short passwords", async () => {
        assert.deepEqual(await callRoute("post", "/api/register", { ...validUser, password: "Pass123" }),
            { status: 400, body: { error: "Password must be at least 8 characters." } 
        });
    });

    it ("FR1_Test9 register rejects invalid emails", async () => {
        assert.deepEqual(await callRoute("post", "/api/register", { ...validUser, email: "userexample.com" }),
            { status: 400, body: { error: "Please enter a valid email address." } 
        });
    });

    it ("FR1_Test10 login rejects empty email and password", async () => {
        assert.deepEqual(await callRoute("post", "/api/login", { email: "", password: "" }),
            { status: 400, body: { error: "Email and password are required." } 
        });
    });

    it ("FR1_Test11 login rejects empty email but good password", async () => {
        assert.deepEqual(await callRoute("post", "/api/login", { email: "", password: "Password1!" }),
            { status: 400, body: { error: "Email and password are required." } 
        });
    });

    it ("FR1_Test12 login rejects empty password but good email", async () => {
        assert.deepEqual(await callRoute("post", "/api/login", { email: "user@example.com", password: "" }),
            { status: 400, body: { error: "Email and password are required." } 
        });
    });

    it("FR1_Test13 login rejects bad email", async () => {
        assert.deepEqual(await callRoute("post", "/api/login", { email: "userexample.com", password: "passworD1!" }),
            { status: 400, body: { error: "Please enter a valid email address." }
        });
    });

    it("FR1_Test14 register rejects a 51-character username", async () => {
        assert.deepEqual(await callRoute("post", "/api/register", { ...validUser, username: "a".repeat(51) }),
            { status: 400, body: { error: "Username must be between 3 and 50 characters." } 
        });
    });

    it("FR1_Test16 register rejects a first name over 50 characters", async () => {
        assert.deepEqual(await callRoute("post", "/api/register", { ...validUser, firstName: "a".repeat(51) }),
            { status: 400, body: { error: "First and last names must be 50 characters or fewer." } });
    });
});

// FR2 Authenticated Session and Profile Access
function fakeResponse() {
    return {
        statusCode: null,
        body: null,
        status(code) { this.statusCode = code; return this; },
        json(data) { this.body = data; return this; }
    };
}

describe("FR2 Authenticated Session and Profile Access", () => {
    it("FR2_Test1 let logged-in user access", () => {
        const req = { session: { userId: 3 } };
        const res = fakeResponse();
        let nextCalled = false;

        requireLogin(req, res, () => { nextCalled = true; });
        assert.equal(nextCalled, true);
        assert.equal(res.statusCode, null);
    });
});


// FR3 Income Tracking
describe("FR3 Income Tracking", () => {
    const valideIncome = {
        source: "Paycheck", amount: "2000", incomeType: "Salary", incomeDate: "2026-10-28", description: "got paid"
    };

    it("FR3_Test1 accepts a positive amount as text", () => {
        assert.equal(parsePositiveNumber("1934.50"), 1934.5);
    });

    it("FR3_Test2 rejects negative amount", () => {
        assert.equal(parsePositiveNumber("-2"), null);
    });

    it("FR3_Test3 rejects non-numbers", () => {
        assert.equal(parsePositiveNumber("hello"), null);
    });

    it("FR3_Test4 accepts a valid YYYY-MM-DD date", () => {
        assert.equal(isValidIsoDate("2026-10-28"), true);
    });

    it("FR3_Test5 rejects an invalid YYYY-MM-DD date", () => {
        assert.equal(isValidIsoDate("2026-13-01"), false);
    });

    it("FR3_Test6 rejects dates in the wrong format", () => {
        assert.equal(isValidIsoDate("10/28/2026"), false);
    });

    it ("FR3_Test7 income route rejects only spaces", async () => {
        assert.deepEqual(await callRoute("post", "/api/income", { ...valideIncome, source: "   " }),
            { status: 400, body: { error: "Income source is required." } 
        });
    });

    it ("FR3_Test8 income route rejects 0", async () => {
        assert.deepEqual(await callRoute("post", "/api/income", { ...valideIncome, amount: "0" }),
            { status: 400, body: { error: "Income amount must be a valid number greater than 0." } 
        });
    });

    it ("FR3_Test9 income route rejects invalid dates", async () => {
        assert.deepEqual(await callRoute("post", "/api/income", { ...valideIncome, incomeDate: "2026-10-32" }),
            { status: 400, body: { error: "Income date must be a valid date in YYYY-MM-DD format." } 
        });
    });

    it("FR3_Test10 income rejects source names over 100 characters", async () => {
        assert.deepEqual(await callRoute("post", "/api/income", { ...valideIncome, source: "a".repeat(101) }),
            { status: 400, body: { error: "Income source must be 100 characters or fewer." } });
    });

    it("FR3_Test11 editing income rejects an invalid income ID", async () => {
        assert.deepEqual(await callRoute("put", "/api/income/:incomeId", valideIncome, { incomeId: "abc" }),
            { status: 400, body: { error: "A valid income ID is required." } });
    });

    it("FR3_Test12 income rejects start dates after the end date", async () => {
        assert.deepEqual(await callRoute("get", "/api/income", {}, {}, { startDate: "2026-11-30", endDate: "2026-11-01" }),
            { status: 400, body: { error: "startDate cannot be after endDate." } });
    });
});

// FR4 Expense Tracking
describe("FR4 Expense Tracking", () => {
    const validExpense = {
        categoryId: "3", amount: "85.20", expenseDate: "2026-10-27", merchant: "Amazon", description: "pickles"
    };

    it("FR4_Test1 accepts a whole number category ID as text", () => {
        assert.equal(parsePositiveInteger("3"), 3);
    });

    it("FR4_Test2 rejects decimal category ID", () => {
        assert.equal(parsePositiveInteger("3.14"), null);
    });

    it("FR4_Test3 rejects zero category ID", () => {
        assert.equal(parsePositiveInteger(0), null);
    });

    it("FR4_Test4 expense route rejects a blank category", async () => {
        assert.deepEqual(await callRoute("post", "/api/expenses", { ...validExpense, categoryId: "" }),
            { status: 400, body: { error: "A valid expense category is required." } 
        });
    });

    it("FR4_Test5 expense route rejects a negative amount", async () => {
        assert.deepEqual(await callRoute("post", "/api/expenses", { ...validExpense, amount: "-10.00" }),
            { status: 400, body: { error: "Expense amount must be a valid number greater than 0." } 
        });
    });

    it("FR4_Test6 expense route rejects wrong date format", async () => {
        assert.deepEqual(await callRoute("post", "/api/expenses", { ...validExpense, expenseDate: "10/27/2026" }),
            { status: 400, body: { error: "Expense date must be a valid date in YYYY-MM-DD format."} 
        });
    });

    it("FR4_Test7 expense route rejects a merchant name over 100 characters", async () => {
        assert.deepEqual(await callRoute("post", "/api/expenses", { ...validExpense, merchant: "a".repeat(101) }),
            { status: 400, body: { error: "Merchant must be 100 characters or fewer." } });
    });

    it("FR4_Test8 editing an expense rejects ID 0", async () => {
        assert.deepEqual(await callRoute("put", "/api/expenses/:expenseId", validExpense, { expenseId: "0" }),
            { status: 400, body: { error: "A valid expense ID is required." } });
    });

    it("FR4_Test9 expense filter rejects a non-number categories", async () => {
        assert.deepEqual(await callRoute("get", "/api/expenses", {}, {}, { categoryId: "abc" }),
            { status: 400, body: { error: "categoryId must be a positive integer." } });
    });
});

// FR6 Debt Payoff Calculator
function postDebtPayoff(balance, interestRate, monthlyPayment) {
    const req = { body: { balance, interestRate, monthlyPayment }, session: { userId: 1 } };
    const res = fakeResponse();
    routeHandler("post", "/api/calculator/debt-payoff")(req, res);
    return { status: res.statusCode ?? 200, body: res.body };
}

describe("FR6 Debt Payoff Calculator", () => {
    it("FR6_Test1 accepts zero interest", () => {
        assert.deepEqual(postDebtPayoff(1000, 0, 100),
            { status: 200, body: { monthsToPayoff: 10, yearsToPayoff: 0.8, totalInterest: 0 } 
        });
    });

    it("FR6_Test2 calculates normal interest payoff", () => {
        assert.deepEqual(postDebtPayoff(1000, 12, 100),
            {status: 200, body: { monthsToPayoff: 11, yearsToPayoff: 0.9, totalInterest: 58.98 } 
        });
    });

    it("FR6_Test3 calculates a high interest payoff from text input", () => {
        assert.deepEqual(postDebtPayoff("1000", "30", "100"),
            {status: 200, body: { monthsToPayoff: 12, yearsToPayoff: 1, totalInterest: 165.33 } 
        });
    });

    it("FR6_Test4 pay off in 1 month when payoff is greater than balance", () => {
        assert.deepEqual(postDebtPayoff(1000, 12, 2000),
            {status: 200, body: { monthsToPayoff: 1, yearsToPayoff: 0.1, totalInterest: 10 } 
        });
    });

    it("FR6_Test5 reject payment equal to just monthly interest", () => {
        assert.deepEqual(postDebtPayoff(1000, 12, 10),
            {status: 400, body: { error: "The payment must be greater than the monthly interest." } 
        });
    });

    it("FR6_Test6 reject payment below monthly interest", () => {
        assert.deepEqual(postDebtPayoff(1000, 12, 5),
            {status: 400, body: { error: "The payment must be greater than the monthly interest." } 
        });
    });

    it("FR6_Test7 reject debt that takes over 100 years to pay off", () => {
        assert.deepEqual(postDebtPayoff(100000, 12, 1000.001),
            {status: 400, body: { error: "The debt would not be paid off within 100 years with these inputs." } 
        });
    });

    it("FR6_Test8 reject zero balance", () => { 
        assert.deepEqual(postDebtPayoff(0, 12, 100),
            {status: 400, body: { error: "Balance must be greater than 0." } 
        });
    });

    it("FR6_Test9 reject negative interest rate", () => {
        assert.deepEqual(postDebtPayoff(1000, -12, 100),
            {status: 400, body: { error: "Interest rate cannot be negative." } 
        });
    });

    it("FR6_Test10 reject zero payment", () => {
        assert.deepEqual(postDebtPayoff(1000, 12, 0),
            {status: 400, body: { error: "Monthly payment must be greater than 0." } 
        });
    });

    it("FR6_Test11 reject input that is not a number", () => {
        assert.deepEqual(postDebtPayoff(1000, 12, "abc"),
            {status: 400, body: { error: "Balance, interest rate, and monthly payment must be valid numbers." } 
        });
    });
});

// FR7 Budget and Debt Record Management
describe("FR7 Budget and Debt Record Management", () => {
    const validBudget = { budgetMonth: 11, budgetYear: 2026, items: [{ categoryId: 1, budgetAmount: 300 }] };
    const validDebt = { debtName: "Car loan", debtType: "Auto", currentBalance: "5000", interestRate: "6", minimumPayment: "150", paymentDueDate: "2026-12-01"
};  

    it("FR7_Test1 budget rejects months over 12", async () => {
        assert.deepEqual(await callRoute("post", "/api/budgets", { ...validBudget, budgetMonth: 13 }),
            { status: 400, body: { error: "budgetMonth must be an integer from 1 through 12." }
        });
    });
        it("FR7_Test2 budget rejects year 1999", async () => {
        assert.deepEqual(await callRoute("post", "/api/budgets", { ...validBudget, budgetYear: 1999 }),
            { status: 400, body: { error: "budgetYear must be an integer from 2000 through 2200." } });
    });

    it("FR7_Test3 budget rejects a category amount of 0", async () => {
        assert.deepEqual(await callRoute("post", "/api/budgets", { ...validBudget, items: [{ categoryId: 1, budgetAmount: 0 }] }),
            { status: 400, body: { error: "Each budget item must have a budgetAmount greater than 0." } });
    });

    it("FR7_Test4 budget rejects the same category twice", async () => {
        assert.deepEqual(await callRoute("post", "/api/budgets", { ...validBudget,
            items: [{ categoryId: 1, budgetAmount: 100 }, { categoryId: 1, budgetAmount: 50 }] }),
            { status: 400, body: { error: "A category can only appear once in the same budget." } });
    });

    it("FR7_Test5 debt requires a name", async () => {
        assert.deepEqual(await callRoute("post", "/api/debts", { ...validDebt, debtName: "" }),
            { status: 400, body: { error: "Debt name is required and must be 100 characters or fewer." } });
    });

    it("FR7_Test6 debt rejects a negative balance", async () => {
        assert.deepEqual(await callRoute("post", "/api/debts", { ...validDebt, currentBalance: "-1" }),
            { status: 400, body: { error: "Current balance must be a valid number of 0 or greater." } });
    });

    it("FR7_Test7 debt rejects a wrongly formatted due date", async () => {
        assert.deepEqual(await callRoute("post", "/api/debts", { ...validDebt, paymentDueDate: "12/01/2026" }),
            { status: 400, body: { error: "Payment due date must be a valid date in YYYY-MM-DD format." } });
    });
});
    

describe("HTTP Integration Tests", () => {
    let server;
    let url;

    before(async () => {
        await new Promise((resolve) => { server = app.listen(0, resolve); });
        url = `http://127.0.0.1:${server.address().port}`;
    });

    after(async () => {
        await new Promise((resolve) => server.close(resolve));
    });

    it("FR1_Test15 logout is successful", async () => {
        const response = await fetch(`${url}/api/logout`, { method: "POST" });
        assert.equal(response.status, 200);
        assert.deepEqual(await response.json(), { message: "Signed out."});
    });

    const publicRoutes = ["/api/health", "/api/register", "/api/login", "/api/logout"];
    const protectedRoutes = app.router.stack
        .filter((l) => l.route && l.route.path.startsWith("/api/") && !publicRoutes.includes(l.route.path))
        .flatMap((l) => Object.keys(l.route.methods).map((m) => [m.toUpperCase(), l.route.path.replace(/:\w+/g, "1")]));

    for (const [method, path] of protectedRoutes) {
        it(`FR2_Test2 ${method} ${path} returns 401 when logged out`, async () => {
            const response = await fetch(`${url}${path}`, { method });
            assert.equal(response.status, 401);
            assert.deepEqual(await response.json(), { error: "Please log in." });
        });
    }

    it("NFR3_Test1 unknown API route returns 404", async () => {
        const response = await fetch(`${url}/api/badrouteexample`);
        assert.equal(response.status, 404);
        assert.deepEqual(await response.json(), { error: "API endpoint not found." });
    });

    it("NFR3_Test2 handle 100 concurrent requests", async () => {
        const start = performance.now();
        const responses = await Promise.all(Array.from({ length: 100}, () => fetch(`${url}/api/me`))
        );
        const elapsed = performance.now() - start;
        assert.equal(responses.every((r) => r.status === 401), true);
        assert.ok(elapsed < 2000, `took ${Math.round(elapsed)} ms`);
    });

    it("NFR4_Test2 logged-out request does not receive session cookie", async () => {
        const response = await fetch(`${url}/api/me`);
        assert.equal(response.headers.get("set-cookie"), null);
    });

    it("NFR4_Test3 bad request does not leak errors", async () => {
        const response = await fetch(`${url}/api/login`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: "bad json"
        });
        const text = await response.text();
        assert.equal(text.includes("SyntaxError"), false);
        assert.equal(text.includes("node_modules"), false);
        assert.equal(typeof JSON.parse(text).error, "string");
    });

    it("NFR4_Test4 no secrets served", async () => {
        for (const file of ["/.env", "/server.js", "/db.js", "/%2e%2e/.env"]) {
            const text = await (await fetch(`${url}${file}`)).text();
            assert.equal(text.includes("SESSION_SECRET"), false, file);
            assert.equal(text.includes("require("), false, file);
        }
    });

    it("NFR4_Test5 responses include security headers", async () => {
        const response = await fetch(`${url}/`);
        assert.equal(response.headers.get("x-content-type-options"), "nosniff");
        assert.equal(response.headers.get("x-frame-options"), "DENY");
    });

    it("FR1_Test17 login blocked after 10 failed attempts", async () => {
        const attempt = () => fetch(`${url}/api/login`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ email: "", password: "" })
        });
        for (let i = 0; i < 10; i++) {
            assert.equal((await attempt()).status, 400);
        }
        const blocked = await attempt();
        assert.equal(blocked.status, 429);
        assert.deepEqual(await blocked.json(), { error: "Too many authentication attempts. Please try again later." });
    });
});

describe("NFR3 Performance", () => {
    it("NFR3_Test3 1,000 worst-case debt calculations finish within 1 second", () => {
        const start = performance.now();
        for (let i = 0; i < 1000; i++) {
            postDebtPayoff(100000, 12, 1000.001);
        }
        const elapsed = performance.now() - start;
        assert.ok(elapsed < 1000, `took ${Math.round(elapsed)} ms`);
    });
});

describe("NFR4 Security", () => {
    it("NFR4_Test1 server refuses to start without SESSION_SECRET", () => {
        const result = spawnSync(process.execPath, [path.join(__dirname, "..", "server.js")], {
            env: { ...process.env, SESSION_SECRET: "" },
            encoding: "utf8",
            timeout: 10000
        });
        assert.notEqual(result.status, 0);
        assert.equal(result.stderr.includes("SESSION_SECRET is required"), true);
    });
});

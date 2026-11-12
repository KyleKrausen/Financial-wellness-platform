const path = require("path");
const express = require("express");
const session = require("express-session");
const bcrypt = require("bcrypt");
require("dotenv").config();
const db = require("./db");

const app = express();

const isProduction = process.env.NODE_ENV === "production";
const SESSION_COOKIE_NAME = "financialWellness.sid";
const SESSION_MAX_AGE_MS = 1000 * 60 * 60 * 4;
const MAX_DEBT_PAYOFF_MONTHS = 1200;

const AUTH_RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000;
const AUTH_RATE_LIMIT_MAX_ATTEMPTS = 10;
const MAX_LIST_RESULTS = 250;

if (!process.env.SESSION_SECRET) {
  throw new Error("SESSION_SECRET is required in the .env file.");
}

if (isProduction) {
  // Allows secure cookies to work correctly behind a typical HTTPS reverse proxy.
  app.set("trust proxy", 1);
}

app.use(express.json({ limit: "100kb" }));
app.use(express.urlencoded({ extended: false, limit: "100kb" }));

// Lightweight security headers without adding a new dependency to package.json.
app.use((_req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader(
    "Permissions-Policy",
    "camera=(), microphone=(), geolocation=()"
  );
  res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
  next();
});

app.use(
  session({
    name: SESSION_COOKIE_NAME,
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      secure: isProduction,
      sameSite: "lax",
      maxAge: SESSION_MAX_AGE_MS
    }
  })
);

app.use(express.static(path.join(__dirname, "public")));

function requireLogin(req, res, next) {
  if (!req.session.userId) {
    return res.status(401).json({ error: "Please log in." });
  }

  next();
}

function regenerateSession(req) {
  return new Promise((resolve, reject) => {
    req.session.regenerate((error) => {
      if (error) {
        reject(error);
      } else {
        resolve();
      }
    });
  });
}

function saveSession(req) {
  return new Promise((resolve, reject) => {
    req.session.save((error) => {
      if (error) {
        reject(error);
      } else {
        resolve();
      }
    });
  });
}

function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

function normalizeText(value) {
  return String(value || "").trim();
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function isValidIsoDate(value) {
  const dateText = normalizeText(value);

  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateText)) {
    return false;
  }

  const [year, month, day] = dateText.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));

  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

function toIsoDate(value) {
  if (!value) {
    return null;
  }

  if (value instanceof Date) {
    return value.toISOString().slice(0, 10);
  }

  return String(value).slice(0, 10);
}

function parsePositiveNumber(value) {
  const number = Number(value);

  if (!Number.isFinite(number) || number <= 0) {
    return null;
  }

  return number;
}

function parseNonNegativeNumber(value) {
  if (normalizeText(value) === "") {
    return null;
  }

  const number = Number(value);

  if (!Number.isFinite(number) || number < 0) {
    return null;
  }

  return number;
}

function parsePositiveInteger(value) {
  const number = Number(value);

  if (!Number.isInteger(number) || number <= 0) {
    return null;
  }

  return number;
}

function parseBoundedInteger(value, minimum, maximum) {
  const number = Number(value);

  if (
    !Number.isInteger(number) ||
    number < minimum ||
    number > maximum
  ) {
    return null;
  }

  return number;
}

function parseListLimit(value) {
  if (value === undefined || value === null || value === "") {
    return 100;
  }

  const number = Number(value);

  if (!Number.isInteger(number) || number <= 0) {
    return 100;
  }

  return Math.min(number, MAX_LIST_RESULTS);
}

function hasOwn(object, property) {
  return Object.prototype.hasOwnProperty.call(object, property);
}

function validateDateRange(startDate, endDate) {
  if (startDate && !isValidIsoDate(startDate)) {
    return "startDate must be a valid date in YYYY-MM-DD format.";
  }

  if (endDate && !isValidIsoDate(endDate)) {
    return "endDate must be a valid date in YYYY-MM-DD format.";
  }

  if (startDate && endDate && startDate > endDate) {
    return "startDate cannot be after endDate.";
  }

  return null;
}

function mapUserRow(row) {
  return {
    userId: row.user_id,
    firstName: row.first_name,
    lastName: row.last_name,
    email: row.email,
    username: row.username
  };
}

function mapIncomeRow(row) {
  return {
    incomeId: row.income_id,
    source: row.source,
    amount: Number(row.amount),
    incomeType: row.income_type || "Other",
    incomeDate: toIsoDate(row.income_date),
    description: row.description || "",
    createdAt: row.created_at || null
  };
}

function mapExpenseRow(row) {
  return {
    expenseId: row.expense_id,
    categoryId: row.category_id,
    categoryName: row.category_name || null,
    amount: Number(row.amount),
    expenseDate: toIsoDate(row.expense_date),
    merchant: row.merchant || "",
    description: row.description || "",
    createdAt: row.created_at || null
  };
}

function mapDebtRow(row) {
  return {
    debtId: row.debt_id,
    debtName: row.debt_name,
    debtType: row.debt_type || "",
    originalBalance:
      row.original_balance === null ? null : Number(row.original_balance),
    currentBalance: Number(row.current_balance),
    interestRate:
      row.interest_rate === null ? 0 : Number(row.interest_rate),
    minimumPayment:
      row.minimum_payment === null ? 0 : Number(row.minimum_payment),
    paymentDueDate: toIsoDate(row.payment_due_date),
    createdAt: row.created_at || null
  };
}

function getBudgetThreshold(percentUsed) {
  if (percentUsed > 100) {
    return "OVER_BUDGET";
  }

  if (percentUsed >= 90) {
    return "90_PERCENT";
  }

  if (percentUsed >= 75) {
    return "75_PERCENT";
  }

  if (percentUsed >= 50) {
    return "50_PERCENT";
  }

  return "ON_TRACK";
}

function groupBudgetRows(rows) {
  const budgets = new Map();

  for (const row of rows) {
    let budget = budgets.get(row.budget_id);

    if (!budget) {
      budget = {
        budgetId: row.budget_id,
        budgetMonth: row.budget_month,
        budgetYear: row.budget_year,
        createdAt: row.created_at || null,
        totalBudget: 0,
        totalSpent: 0,
        remaining: 0,
        percentUsed: 0,
        status: "ON_TRACK",
        items: []
      };

      budgets.set(row.budget_id, budget);
    }

    if (row.budget_item_id !== null) {
      const budgetAmount = Number(row.budget_amount || 0);
      const spent = Number(row.spent || 0);
      const remaining = budgetAmount - spent;
      const percentUsed =
        budgetAmount > 0 ? Number(((spent / budgetAmount) * 100).toFixed(1)) : 0;

      budget.items.push({
        budgetItemId: row.budget_item_id,
        categoryId: row.category_id,
        categoryName: row.category_name,
        budgetAmount,
        spent,
        remaining,
        percentUsed,
        status: getBudgetThreshold(percentUsed)
      });

      budget.totalBudget += budgetAmount;
      budget.totalSpent += spent;
    }
  }

  for (const budget of budgets.values()) {
    budget.totalBudget = Number(budget.totalBudget.toFixed(2));
    budget.totalSpent = Number(budget.totalSpent.toFixed(2));
    budget.remaining = Number(
      (budget.totalBudget - budget.totalSpent).toFixed(2)
    );
    budget.percentUsed =
      budget.totalBudget > 0
        ? Number(((budget.totalSpent / budget.totalBudget) * 100).toFixed(1))
        : 0;
    budget.status = getBudgetThreshold(budget.percentUsed);
  }

  return Array.from(budgets.values());
}

function validateBudgetItems(items) {
  if (!Array.isArray(items)) {
    return { error: "Budget items must be provided as an array." };
  }

  const normalizedItems = [];
  const categoryIds = new Set();

  for (const item of items) {
    const categoryId = parsePositiveInteger(item.categoryId);
    const budgetAmount = parsePositiveNumber(item.budgetAmount);

    if (categoryId === null) {
      return { error: "Each budget item must have a valid categoryId." };
    }

    if (budgetAmount === null) {
      return {
        error: "Each budget item must have a budgetAmount greater than 0."
      };
    }

    if (categoryIds.has(categoryId)) {
      return {
        error: "A category can only appear once in the same budget."
      };
    }

    categoryIds.add(categoryId);
    normalizedItems.push({ categoryId, budgetAmount });
  }

  return { items: normalizedItems };
}

async function replaceBudgetItems(connection, budgetId, items) {
  await connection.execute(
    "DELETE FROM budget_items WHERE budget_id=?",
    [budgetId]
  );

  for (const item of items) {
    await connection.execute(
      "INSERT INTO budget_items (budget_id,category_id,budget_amount) VALUES (?,?,?)",
      [budgetId, item.categoryId, item.budgetAmount]
    );
  }
}

// Simple local-prototype rate limiter that requires no new npm dependency.
// A shared store should replace this for multi-instance production deployment.
const rateLimitBuckets = new Map();

function authRateLimit(req, res, next) {
  const now = Date.now();
  const key = `${req.ip}:${req.path}`;
  let bucket = rateLimitBuckets.get(key);

  if (!bucket || now >= bucket.resetAt) {
    bucket = {
      count: 0,
      resetAt: now + AUTH_RATE_LIMIT_WINDOW_MS
    };
    rateLimitBuckets.set(key, bucket);
  }

  bucket.count += 1;

  if (rateLimitBuckets.size > 1000) {
    for (const [storedKey, storedBucket] of rateLimitBuckets.entries()) {
      if (now >= storedBucket.resetAt) {
        rateLimitBuckets.delete(storedKey);
      }
    }
  }

  if (bucket.count > AUTH_RATE_LIMIT_MAX_ATTEMPTS) {
    const retryAfterSeconds = Math.max(
      1,
      Math.ceil((bucket.resetAt - now) / 1000)
    );

    res.setHeader("Retry-After", String(retryAfterSeconds));

    return res.status(429).json({
      error: "Too many authentication attempts. Please try again later."
    });
  }

  next();
}

app.get("/api/health", async (_req, res) => {
  try {
    await db.query("SELECT 1");
    res.json({ ok: true });
  } catch {
    res.status(500).json({
      ok: false,
      error: "MySQL is not connected."
    });
  }
});

app.post("/api/register", authRateLimit, async (req, res, next) => {
  let { firstName, lastName, email, username, password } = req.body;

  firstName = normalizeText(firstName);
  lastName = normalizeText(lastName);
  email = normalizeEmail(email);
  username = normalizeText(username);
  password = String(password || "");

  if (!firstName || !lastName || !email || !username || !password) {
    return res.status(400).json({
      error: "All fields are required."
    });
  }

  if (firstName.length > 50 || lastName.length > 50) {
    return res.status(400).json({
      error: "First and last names must be 50 characters or fewer."
    });
  }

  if (!isValidEmail(email) || email.length > 150) {
    return res.status(400).json({
      error: "Please enter a valid email address."
    });
  }

  if (username.length < 3 || username.length > 50) {
    return res.status(400).json({
      error: "Username must be between 3 and 50 characters."
    });
  }

  if (password.length < 8) {
    return res.status(400).json({
      error: "Password must be at least 8 characters."
    });
  }

  try {
    const passwordHash = await bcrypt.hash(password, 12);

    const connection = await db.getConnection();

    try {
      await connection.beginTransaction();

      const [result] = await connection.execute(
        "INSERT INTO users (first_name,last_name,email,username,password_hash) VALUES (?,?,?,?,?)",
        [firstName, lastName, email, username, passwordHash]
      );

      await connection.execute(
        "INSERT INTO user_roles (user_id,role_id) SELECT ?,role_id FROM roles WHERE role_name='USER'",
        [result.insertId]
      );

      await connection.commit();

      await regenerateSession(req);
      req.session.userId = result.insertId;
      await saveSession(req);

      res.status(201).json({
        message: "Account created.",
        user: {
          userId: result.insertId,
          firstName,
          lastName,
          email,
          username
        }
      });
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  } catch (error) {
    if (error.code === "ER_DUP_ENTRY") {
      return res.status(409).json({
        error: "That email or username is already registered."
      });
    }

    next(error);
  }
});

app.post("/api/login", authRateLimit, async (req, res, next) => {
  const email = normalizeEmail(req.body.email);
  const password = String(req.body.password || "");

  if (!email || !password) {
    return res.status(400).json({
      error: "Email and password are required."
    });
  }

  if (!isValidEmail(email) || email.length > 150) {
    return res.status(400).json({
      error: "Please enter a valid email address."
    });
  }

  try {
    const [rows] = await db.execute(
      "SELECT user_id,first_name,last_name,email,username,password_hash,account_status FROM users WHERE email=?",
      [email]
    );

    const user = rows[0];

    if (
      !user ||
      user.account_status !== "ACTIVE" ||
      !(await bcrypt.compare(password, user.password_hash))
    ) {
      return res.status(401).json({
        error: "Invalid email or password."
      });
    }

    await regenerateSession(req);
    req.session.userId = user.user_id;
    await saveSession(req);

    res.json({
      message: "Login successful.",
      user: mapUserRow(user)
    });
  } catch (error) {
    next(error);
  }
});

app.post("/api/logout", (req, res, next) => {
  req.session.destroy((error) => {
    if (error) {
      return next(error);
    }

    res.clearCookie(SESSION_COOKIE_NAME, {
      httpOnly: true,
      secure: isProduction,
      sameSite: "lax"
    });

    res.json({
      message: "Signed out."
    });
  });
});

app.get("/api/me", requireLogin, async (req, res) => {
  const [rows] = await db.execute(
    "SELECT user_id,first_name,last_name,email,username FROM users WHERE user_id=?",
    [req.session.userId]
  );

  if (!rows[0]) {
    return res.status(401).json({
      error: "Please log in."
    });
  }

  res.json({
    user: mapUserRow(rows[0])
  });
});

app.get("/api/categories", requireLogin, async (_req, res) => {
  const [rows] = await db.query(
    "SELECT category_id,category_name FROM expense_categories ORDER BY category_name"
  );

  // Keep legacy snake_case aliases so the current frontend does not need changes.
  res.json(
    rows.map((row) => ({
      categoryId: row.category_id,
      categoryName: row.category_name,
      category_id: row.category_id,
      category_name: row.category_name
    }))
  );
});

// ------------------------------
// Income CRUD
// ------------------------------

app.get("/api/income", requireLogin, async (req, res) => {
  const source = normalizeText(req.query.source);
  const incomeType = normalizeText(req.query.incomeType);
  const startDate = normalizeText(req.query.startDate);
  const endDate = normalizeText(req.query.endDate);
  const limit = parseListLimit(req.query.limit);

  const dateError = validateDateRange(startDate, endDate);

  if (dateError) {
    return res.status(400).json({ error: dateError });
  }

  const conditions = ["user_id=?"];
  const values = [req.session.userId];

  if (source) {
    conditions.push("source LIKE ?");
    values.push(`%${source}%`);
  }

  if (incomeType) {
    conditions.push("LOWER(income_type)=LOWER(?)");
    values.push(incomeType);
  }

  if (startDate) {
    conditions.push("income_date>=?");
    values.push(startDate);
  }

  if (endDate) {
    conditions.push("income_date<=?");
    values.push(endDate);
  }

  values.push(limit);

  const [rows] = await db.execute(
    `SELECT income_id,source,amount,income_type,income_date,description,created_at
     FROM income
     WHERE ${conditions.join(" AND ")}
     ORDER BY income_date DESC, income_id DESC
     LIMIT ?`,
    values
  );

  res.json({
    income: rows.map(mapIncomeRow)
  });
});

app.get("/api/income/:incomeId", requireLogin, async (req, res) => {
  const incomeId = parsePositiveInteger(req.params.incomeId);

  if (incomeId === null) {
    return res.status(400).json({
      error: "A valid income ID is required."
    });
  }

  const [rows] = await db.execute(
    `SELECT income_id,source,amount,income_type,income_date,description,created_at
     FROM income
     WHERE income_id=? AND user_id=?`,
    [incomeId, req.session.userId]
  );

  if (!rows[0]) {
    return res.status(404).json({
      error: "Income record not found."
    });
  }

  res.json({
    income: mapIncomeRow(rows[0])
  });
});

app.post("/api/income", requireLogin, async (req, res) => {
  const source = normalizeText(req.body.source);
  const amount = parsePositiveNumber(req.body.amount);
  const incomeType = normalizeText(req.body.incomeType) || "Other";
  const incomeDate = normalizeText(req.body.incomeDate);
  const description = normalizeText(req.body.description);

  if (!source) {
    return res.status(400).json({
      error: "Income source is required."
    });
  }

  if (source.length > 100) {
    return res.status(400).json({
      error: "Income source must be 100 characters or fewer."
    });
  }

  if (amount === null) {
    return res.status(400).json({
      error: "Income amount must be a valid number greater than 0."
    });
  }

  if (incomeType.length > 50) {
    return res.status(400).json({
      error: "Income type must be 50 characters or fewer."
    });
  }

  if (!isValidIsoDate(incomeDate)) {
    return res.status(400).json({
      error: "Income date must be a valid date in YYYY-MM-DD format."
    });
  }

  if (description.length > 255) {
    return res.status(400).json({
      error: "Income description must be 255 characters or fewer."
    });
  }

  const [result] = await db.execute(
    "INSERT INTO income (user_id,source,amount,income_type,income_date,description) VALUES (?,?,?,?,?,?)",
    [
      req.session.userId,
      source,
      amount,
      incomeType,
      incomeDate,
      description
    ]
  );

  res.status(201).json({
    message: "Income added.",
    incomeId: result.insertId
  });
});

app.put("/api/income/:incomeId", requireLogin, async (req, res) => {
  const incomeId = parsePositiveInteger(req.params.incomeId);

  if (incomeId === null) {
    return res.status(400).json({
      error: "A valid income ID is required."
    });
  }

  const [rows] = await db.execute(
    `SELECT income_id,source,amount,income_type,income_date,description
     FROM income
     WHERE income_id=? AND user_id=?`,
    [incomeId, req.session.userId]
  );

  if (!rows[0]) {
    return res.status(404).json({
      error: "Income record not found."
    });
  }

  const existing = rows[0];

  const source = hasOwn(req.body, "source")
    ? normalizeText(req.body.source)
    : existing.source;

  const amount = hasOwn(req.body, "amount")
    ? parsePositiveNumber(req.body.amount)
    : Number(existing.amount);

  const incomeType = hasOwn(req.body, "incomeType")
    ? normalizeText(req.body.incomeType) || "Other"
    : existing.income_type || "Other";

  const incomeDate = hasOwn(req.body, "incomeDate")
    ? normalizeText(req.body.incomeDate)
    : toIsoDate(existing.income_date);

  const description = hasOwn(req.body, "description")
    ? normalizeText(req.body.description)
    : existing.description || "";

  if (!source || source.length > 100) {
    return res.status(400).json({
      error: "Income source is required and must be 100 characters or fewer."
    });
  }

  if (amount === null) {
    return res.status(400).json({
      error: "Income amount must be a valid number greater than 0."
    });
  }

  if (incomeType.length > 50) {
    return res.status(400).json({
      error: "Income type must be 50 characters or fewer."
    });
  }

  if (!isValidIsoDate(incomeDate)) {
    return res.status(400).json({
      error: "Income date must be a valid date in YYYY-MM-DD format."
    });
  }

  if (description.length > 255) {
    return res.status(400).json({
      error: "Income description must be 255 characters or fewer."
    });
  }

  await db.execute(
    `UPDATE income
     SET source=?,amount=?,income_type=?,income_date=?,description=?
     WHERE income_id=? AND user_id=?`,
    [
      source,
      amount,
      incomeType,
      incomeDate,
      description,
      incomeId,
      req.session.userId
    ]
  );

  res.json({
    message: "Income updated.",
    incomeId
  });
});

app.delete("/api/income/:incomeId", requireLogin, async (req, res) => {
  const incomeId = parsePositiveInteger(req.params.incomeId);

  if (incomeId === null) {
    return res.status(400).json({
      error: "A valid income ID is required."
    });
  }

  const [result] = await db.execute(
    "DELETE FROM income WHERE income_id=? AND user_id=?",
    [incomeId, req.session.userId]
  );

  if (result.affectedRows === 0) {
    return res.status(404).json({
      error: "Income record not found."
    });
  }

  res.json({
    message: "Income deleted.",
    incomeId
  });
});

// ------------------------------
// Expense CRUD
// ------------------------------

app.get("/api/expenses", requireLogin, async (req, res) => {
  const categoryId =
    req.query.categoryId === undefined || req.query.categoryId === ""
      ? null
      : parsePositiveInteger(req.query.categoryId);

  const merchant = normalizeText(req.query.merchant);
  const startDate = normalizeText(req.query.startDate);
  const endDate = normalizeText(req.query.endDate);
  const limit = parseListLimit(req.query.limit);

  if (
    req.query.categoryId !== undefined &&
    req.query.categoryId !== "" &&
    categoryId === null
  ) {
    return res.status(400).json({
      error: "categoryId must be a positive integer."
    });
  }

  const dateError = validateDateRange(startDate, endDate);

  if (dateError) {
    return res.status(400).json({ error: dateError });
  }

  const conditions = ["e.user_id=?"];
  const values = [req.session.userId];

  if (categoryId !== null) {
    conditions.push("e.category_id=?");
    values.push(categoryId);
  }

  if (merchant) {
    conditions.push("e.merchant LIKE ?");
    values.push(`%${merchant}%`);
  }

  if (startDate) {
    conditions.push("e.expense_date>=?");
    values.push(startDate);
  }

  if (endDate) {
    conditions.push("e.expense_date<=?");
    values.push(endDate);
  }

  values.push(limit);

  const [rows] = await db.execute(
    `SELECT
       e.expense_id,
       e.category_id,
       ec.category_name,
       e.amount,
       e.expense_date,
       e.merchant,
       e.description,
       e.created_at
     FROM expenses e
     JOIN expense_categories ec ON ec.category_id=e.category_id
     WHERE ${conditions.join(" AND ")}
     ORDER BY e.expense_date DESC, e.expense_id DESC
     LIMIT ?`,
    values
  );

  res.json({
    expenses: rows.map(mapExpenseRow)
  });
});

app.get("/api/expenses/:expenseId", requireLogin, async (req, res) => {
  const expenseId = parsePositiveInteger(req.params.expenseId);

  if (expenseId === null) {
    return res.status(400).json({
      error: "A valid expense ID is required."
    });
  }

  const [rows] = await db.execute(
    `SELECT
       e.expense_id,
       e.category_id,
       ec.category_name,
       e.amount,
       e.expense_date,
       e.merchant,
       e.description,
       e.created_at
     FROM expenses e
     JOIN expense_categories ec ON ec.category_id=e.category_id
     WHERE e.expense_id=? AND e.user_id=?`,
    [expenseId, req.session.userId]
  );

  if (!rows[0]) {
    return res.status(404).json({
      error: "Expense record not found."
    });
  }

  res.json({
    expense: mapExpenseRow(rows[0])
  });
});

app.post("/api/expenses", requireLogin, async (req, res) => {
  const categoryId = parsePositiveInteger(req.body.categoryId);
  const amount = parsePositiveNumber(req.body.amount);
  const expenseDate = normalizeText(req.body.expenseDate);
  const merchant = normalizeText(req.body.merchant);
  const description = normalizeText(req.body.description);

  if (categoryId === null) {
    return res.status(400).json({
      error: "A valid expense category is required."
    });
  }

  if (amount === null) {
    return res.status(400).json({
      error: "Expense amount must be a valid number greater than 0."
    });
  }

  if (!isValidIsoDate(expenseDate)) {
    return res.status(400).json({
      error: "Expense date must be a valid date in YYYY-MM-DD format."
    });
  }

  if (merchant.length > 100) {
    return res.status(400).json({
      error: "Merchant must be 100 characters or fewer."
    });
  }

  if (description.length > 255) {
    return res.status(400).json({
      error: "Expense description must be 255 characters or fewer."
    });
  }

  const [result] = await db.execute(
    "INSERT INTO expenses (user_id,category_id,amount,expense_date,merchant,description) VALUES (?,?,?,?,?,?)",
    [
      req.session.userId,
      categoryId,
      amount,
      expenseDate,
      merchant,
      description
    ]
  );

  res.status(201).json({
    message: "Expense added.",
    expenseId: result.insertId
  });
});

app.put("/api/expenses/:expenseId", requireLogin, async (req, res) => {
  const expenseId = parsePositiveInteger(req.params.expenseId);

  if (expenseId === null) {
    return res.status(400).json({
      error: "A valid expense ID is required."
    });
  }

  const [rows] = await db.execute(
    `SELECT expense_id,category_id,amount,expense_date,merchant,description
     FROM expenses
     WHERE expense_id=? AND user_id=?`,
    [expenseId, req.session.userId]
  );

  if (!rows[0]) {
    return res.status(404).json({
      error: "Expense record not found."
    });
  }

  const existing = rows[0];

  const categoryId = hasOwn(req.body, "categoryId")
    ? parsePositiveInteger(req.body.categoryId)
    : existing.category_id;

  const amount = hasOwn(req.body, "amount")
    ? parsePositiveNumber(req.body.amount)
    : Number(existing.amount);

  const expenseDate = hasOwn(req.body, "expenseDate")
    ? normalizeText(req.body.expenseDate)
    : toIsoDate(existing.expense_date);

  const merchant = hasOwn(req.body, "merchant")
    ? normalizeText(req.body.merchant)
    : existing.merchant || "";

  const description = hasOwn(req.body, "description")
    ? normalizeText(req.body.description)
    : existing.description || "";

  if (categoryId === null) {
    return res.status(400).json({
      error: "A valid expense category is required."
    });
  }

  if (amount === null) {
    return res.status(400).json({
      error: "Expense amount must be a valid number greater than 0."
    });
  }

  if (!isValidIsoDate(expenseDate)) {
    return res.status(400).json({
      error: "Expense date must be a valid date in YYYY-MM-DD format."
    });
  }

  if (merchant.length > 100) {
    return res.status(400).json({
      error: "Merchant must be 100 characters or fewer."
    });
  }

  if (description.length > 255) {
    return res.status(400).json({
      error: "Expense description must be 255 characters or fewer."
    });
  }

  await db.execute(
    `UPDATE expenses
     SET category_id=?,amount=?,expense_date=?,merchant=?,description=?
     WHERE expense_id=? AND user_id=?`,
    [
      categoryId,
      amount,
      expenseDate,
      merchant,
      description,
      expenseId,
      req.session.userId
    ]
  );

  res.json({
    message: "Expense updated.",
    expenseId
  });
});

app.delete("/api/expenses/:expenseId", requireLogin, async (req, res) => {
  const expenseId = parsePositiveInteger(req.params.expenseId);

  if (expenseId === null) {
    return res.status(400).json({
      error: "A valid expense ID is required."
    });
  }

  const [result] = await db.execute(
    "DELETE FROM expenses WHERE expense_id=? AND user_id=?",
    [expenseId, req.session.userId]
  );

  if (result.affectedRows === 0) {
    return res.status(404).json({
      error: "Expense record not found."
    });
  }

  res.json({
    message: "Expense deleted.",
    expenseId
  });
});

// ------------------------------
// Budget CRUD + progress
// ------------------------------

async function queryBudgets(userId, filters = {}) {
  const conditions = ["b.user_id=?"];
  const values = [userId];

  if (filters.budgetId !== undefined) {
    conditions.push("b.budget_id=?");
    values.push(filters.budgetId);
  }

  if (filters.budgetMonth !== undefined) {
    conditions.push("b.budget_month=?");
    values.push(filters.budgetMonth);
  }

  if (filters.budgetYear !== undefined) {
    conditions.push("b.budget_year=?");
    values.push(filters.budgetYear);
  }

  const [rows] = await db.execute(
    `SELECT
       b.budget_id,
       b.budget_month,
       b.budget_year,
       b.created_at,
       bi.budget_item_id,
       bi.category_id,
       ec.category_name,
       bi.budget_amount,
       COALESCE(SUM(e.amount),0) spent
     FROM budgets b
     LEFT JOIN budget_items bi
       ON bi.budget_id=b.budget_id
     LEFT JOIN expense_categories ec
       ON ec.category_id=bi.category_id
     LEFT JOIN expenses e
       ON e.user_id=b.user_id
      AND e.category_id=bi.category_id
      AND YEAR(e.expense_date)=b.budget_year
      AND MONTH(e.expense_date)=b.budget_month
     WHERE ${conditions.join(" AND ")}
     GROUP BY
       b.budget_id,
       b.budget_month,
       b.budget_year,
       b.created_at,
       bi.budget_item_id,
       bi.category_id,
       ec.category_name,
       bi.budget_amount
     ORDER BY b.budget_year DESC,b.budget_month DESC,bi.budget_item_id ASC`,
    values
  );

  return groupBudgetRows(rows);
}

app.get("/api/budgets", requireLogin, async (req, res) => {
  const filters = {};

  if (req.query.month !== undefined && req.query.month !== "") {
    const budgetMonth = parseBoundedInteger(req.query.month, 1, 12);

    if (budgetMonth === null) {
      return res.status(400).json({
        error: "month must be an integer from 1 through 12."
      });
    }

    filters.budgetMonth = budgetMonth;
  }

  if (req.query.year !== undefined && req.query.year !== "") {
    const budgetYear = parseBoundedInteger(req.query.year, 2000, 2200);

    if (budgetYear === null) {
      return res.status(400).json({
        error: "year must be an integer from 2000 through 2200."
      });
    }

    filters.budgetYear = budgetYear;
  }

  const budgets = await queryBudgets(req.session.userId, filters);

  res.json({ budgets });
});

app.get("/api/budgets/:budgetId", requireLogin, async (req, res) => {
  const budgetId = parsePositiveInteger(req.params.budgetId);

  if (budgetId === null) {
    return res.status(400).json({
      error: "A valid budget ID is required."
    });
  }

  const budgets = await queryBudgets(req.session.userId, { budgetId });

  if (!budgets[0]) {
    return res.status(404).json({
      error: "Budget not found."
    });
  }

  res.json({
    budget: budgets[0]
  });
});

app.post("/api/budgets", requireLogin, async (req, res, next) => {
  const budgetMonth = parseBoundedInteger(req.body.budgetMonth, 1, 12);
  const budgetYear = parseBoundedInteger(req.body.budgetYear, 2000, 2200);
  const itemResult = validateBudgetItems(req.body.items || []);

  if (budgetMonth === null) {
    return res.status(400).json({
      error: "budgetMonth must be an integer from 1 through 12."
    });
  }

  if (budgetYear === null) {
    return res.status(400).json({
      error: "budgetYear must be an integer from 2000 through 2200."
    });
  }

  if (itemResult.error) {
    return res.status(400).json({
      error: itemResult.error
    });
  }

  const connection = await db.getConnection();

  try {
    await connection.beginTransaction();

    const [result] = await connection.execute(
      "INSERT INTO budgets (user_id,budget_month,budget_year) VALUES (?,?,?)",
      [req.session.userId, budgetMonth, budgetYear]
    );

    await replaceBudgetItems(
      connection,
      result.insertId,
      itemResult.items
    );

    await connection.commit();

    res.status(201).json({
      message: "Budget created.",
      budgetId: result.insertId
    });
  } catch (error) {
    await connection.rollback();

    if (error.code === "ER_DUP_ENTRY") {
      return res.status(409).json({
        error: "A budget already exists for that month and year."
      });
    }

    next(error);
  } finally {
    connection.release();
  }
});

app.put("/api/budgets/:budgetId", requireLogin, async (req, res, next) => {
  const budgetId = parsePositiveInteger(req.params.budgetId);

  if (budgetId === null) {
    return res.status(400).json({
      error: "A valid budget ID is required."
    });
  }

  const [rows] = await db.execute(
    `SELECT budget_id,budget_month,budget_year
     FROM budgets
     WHERE budget_id=? AND user_id=?`,
    [budgetId, req.session.userId]
  );

  if (!rows[0]) {
    return res.status(404).json({
      error: "Budget not found."
    });
  }

  const existing = rows[0];

  const budgetMonth = hasOwn(req.body, "budgetMonth")
    ? parseBoundedInteger(req.body.budgetMonth, 1, 12)
    : existing.budget_month;

  const budgetYear = hasOwn(req.body, "budgetYear")
    ? parseBoundedInteger(req.body.budgetYear, 2000, 2200)
    : existing.budget_year;

  if (budgetMonth === null) {
    return res.status(400).json({
      error: "budgetMonth must be an integer from 1 through 12."
    });
  }

  if (budgetYear === null) {
    return res.status(400).json({
      error: "budgetYear must be an integer from 2000 through 2200."
    });
  }

  let normalizedItems = null;

  if (hasOwn(req.body, "items")) {
    const itemResult = validateBudgetItems(req.body.items);

    if (itemResult.error) {
      return res.status(400).json({
        error: itemResult.error
      });
    }

    normalizedItems = itemResult.items;
  }

  const connection = await db.getConnection();

  try {
    await connection.beginTransaction();

    await connection.execute(
      `UPDATE budgets
       SET budget_month=?,budget_year=?
       WHERE budget_id=? AND user_id=?`,
      [budgetMonth, budgetYear, budgetId, req.session.userId]
    );

    if (normalizedItems !== null) {
      await replaceBudgetItems(connection, budgetId, normalizedItems);
    }

    await connection.commit();

    res.json({
      message: "Budget updated.",
      budgetId
    });
  } catch (error) {
    await connection.rollback();

    if (error.code === "ER_DUP_ENTRY") {
      return res.status(409).json({
        error: "A budget already exists for that month and year."
      });
    }

    next(error);
  } finally {
    connection.release();
  }
});

app.delete("/api/budgets/:budgetId", requireLogin, async (req, res) => {
  const budgetId = parsePositiveInteger(req.params.budgetId);

  if (budgetId === null) {
    return res.status(400).json({
      error: "A valid budget ID is required."
    });
  }

  const [result] = await db.execute(
    "DELETE FROM budgets WHERE budget_id=? AND user_id=?",
    [budgetId, req.session.userId]
  );

  if (result.affectedRows === 0) {
    return res.status(404).json({
      error: "Budget not found."
    });
  }

  res.json({
    message: "Budget deleted.",
    budgetId
  });
});

// ------------------------------
// Debt CRUD
// ------------------------------

app.get("/api/debts", requireLogin, async (req, res) => {
  const [rows] = await db.execute(
    `SELECT
       debt_id,
       debt_name,
       debt_type,
       original_balance,
       current_balance,
       interest_rate,
       minimum_payment,
       payment_due_date,
       created_at
     FROM debts
     WHERE user_id=?
     ORDER BY current_balance DESC,debt_id DESC`,
    [req.session.userId]
  );

  res.json({
    debts: rows.map(mapDebtRow)
  });
});

app.get("/api/debts/:debtId", requireLogin, async (req, res) => {
  const debtId = parsePositiveInteger(req.params.debtId);

  if (debtId === null) {
    return res.status(400).json({
      error: "A valid debt ID is required."
    });
  }

  const [rows] = await db.execute(
    `SELECT
       debt_id,
       debt_name,
       debt_type,
       original_balance,
       current_balance,
       interest_rate,
       minimum_payment,
       payment_due_date,
       created_at
     FROM debts
     WHERE debt_id=? AND user_id=?`,
    [debtId, req.session.userId]
  );

  if (!rows[0]) {
    return res.status(404).json({
      error: "Debt record not found."
    });
  }

  res.json({
    debt: mapDebtRow(rows[0])
  });
});

app.post("/api/debts", requireLogin, async (req, res) => {
  const debtName = normalizeText(req.body.debtName);
  const debtType = normalizeText(req.body.debtType);
  const currentBalance = parseNonNegativeNumber(req.body.currentBalance);

  const originalBalance =
    req.body.originalBalance === undefined ||
    req.body.originalBalance === null ||
    req.body.originalBalance === ""
      ? currentBalance
      : parseNonNegativeNumber(req.body.originalBalance);

  const interestRate =
    req.body.interestRate === undefined ||
    req.body.interestRate === null ||
    req.body.interestRate === ""
      ? 0
      : parseNonNegativeNumber(req.body.interestRate);

  const minimumPayment =
    req.body.minimumPayment === undefined ||
    req.body.minimumPayment === null ||
    req.body.minimumPayment === ""
      ? 0
      : parseNonNegativeNumber(req.body.minimumPayment);

  const paymentDueDate = normalizeText(req.body.paymentDueDate);

  if (!debtName || debtName.length > 100) {
    return res.status(400).json({
      error: "Debt name is required and must be 100 characters or fewer."
    });
  }

  if (debtType.length > 50) {
    return res.status(400).json({
      error: "Debt type must be 50 characters or fewer."
    });
  }

  if (currentBalance === null) {
    return res.status(400).json({
      error: "Current balance must be a valid number of 0 or greater."
    });
  }

  if (originalBalance === null) {
    return res.status(400).json({
      error: "Original balance must be a valid number of 0 or greater."
    });
  }

  if (interestRate === null) {
    return res.status(400).json({
      error: "Interest rate must be a valid number of 0 or greater."
    });
  }

  if (minimumPayment === null) {
    return res.status(400).json({
      error: "Minimum payment must be a valid number of 0 or greater."
    });
  }

  if (paymentDueDate && !isValidIsoDate(paymentDueDate)) {
    return res.status(400).json({
      error: "Payment due date must be a valid date in YYYY-MM-DD format."
    });
  }

  const [result] = await db.execute(
    `INSERT INTO debts (
       user_id,
       debt_name,
       debt_type,
       original_balance,
       current_balance,
       interest_rate,
       minimum_payment,
       payment_due_date
     ) VALUES (?,?,?,?,?,?,?,?)`,
    [
      req.session.userId,
      debtName,
      debtType || null,
      originalBalance,
      currentBalance,
      interestRate,
      minimumPayment,
      paymentDueDate || null
    ]
  );

  res.status(201).json({
    message: "Debt added.",
    debtId: result.insertId
  });
});

app.put("/api/debts/:debtId", requireLogin, async (req, res) => {
  const debtId = parsePositiveInteger(req.params.debtId);

  if (debtId === null) {
    return res.status(400).json({
      error: "A valid debt ID is required."
    });
  }

  const [rows] = await db.execute(
    `SELECT
       debt_id,
       debt_name,
       debt_type,
       original_balance,
       current_balance,
       interest_rate,
       minimum_payment,
       payment_due_date
     FROM debts
     WHERE debt_id=? AND user_id=?`,
    [debtId, req.session.userId]
  );

  if (!rows[0]) {
    return res.status(404).json({
      error: "Debt record not found."
    });
  }

  const existing = rows[0];

  const debtName = hasOwn(req.body, "debtName")
    ? normalizeText(req.body.debtName)
    : existing.debt_name;

  const debtType = hasOwn(req.body, "debtType")
    ? normalizeText(req.body.debtType)
    : existing.debt_type || "";

  const currentBalance = hasOwn(req.body, "currentBalance")
    ? parseNonNegativeNumber(req.body.currentBalance)
    : Number(existing.current_balance);

  const originalBalance = hasOwn(req.body, "originalBalance")
    ? normalizeText(req.body.originalBalance) === ""
      ? currentBalance
      : parseNonNegativeNumber(req.body.originalBalance)
    : existing.original_balance === null
      ? currentBalance
      : Number(existing.original_balance);

  const interestRate = hasOwn(req.body, "interestRate")
    ? normalizeText(req.body.interestRate) === ""
      ? 0
      : parseNonNegativeNumber(req.body.interestRate)
    : existing.interest_rate === null
      ? 0
      : Number(existing.interest_rate);

  const minimumPayment = hasOwn(req.body, "minimumPayment")
    ? normalizeText(req.body.minimumPayment) === ""
      ? 0
      : parseNonNegativeNumber(req.body.minimumPayment)
    : existing.minimum_payment === null
      ? 0
      : Number(existing.minimum_payment);

  const paymentDueDate = hasOwn(req.body, "paymentDueDate")
    ? normalizeText(req.body.paymentDueDate)
    : toIsoDate(existing.payment_due_date) || "";

  if (!debtName || debtName.length > 100) {
    return res.status(400).json({
      error: "Debt name is required and must be 100 characters or fewer."
    });
  }

  if (debtType.length > 50) {
    return res.status(400).json({
      error: "Debt type must be 50 characters or fewer."
    });
  }

  if (originalBalance === null) {
    return res.status(400).json({
      error: "Original balance must be a valid number of 0 or greater."
    });
  }

  if (currentBalance === null) {
    return res.status(400).json({
      error: "Current balance must be a valid number of 0 or greater."
    });
  }

  if (interestRate === null) {
    return res.status(400).json({
      error: "Interest rate must be a valid number of 0 or greater."
    });
  }

  if (minimumPayment === null) {
    return res.status(400).json({
      error: "Minimum payment must be a valid number of 0 or greater."
    });
  }

  if (paymentDueDate && !isValidIsoDate(paymentDueDate)) {
    return res.status(400).json({
      error: "Payment due date must be a valid date in YYYY-MM-DD format."
    });
  }

  await db.execute(
    `UPDATE debts
     SET
       debt_name=?,
       debt_type=?,
       original_balance=?,
       current_balance=?,
       interest_rate=?,
       minimum_payment=?,
       payment_due_date=?
     WHERE debt_id=? AND user_id=?`,
    [
      debtName,
      debtType || null,
      originalBalance,
      currentBalance,
      interestRate,
      minimumPayment,
      paymentDueDate || null,
      debtId,
      req.session.userId
    ]
  );

  res.json({
    message: "Debt updated.",
    debtId
  });
});

app.delete("/api/debts/:debtId", requireLogin, async (req, res) => {
  const debtId = parsePositiveInteger(req.params.debtId);

  if (debtId === null) {
    return res.status(400).json({
      error: "A valid debt ID is required."
    });
  }

  const [result] = await db.execute(
    "DELETE FROM debts WHERE debt_id=? AND user_id=?",
    [debtId, req.session.userId]
  );

  if (result.affectedRows === 0) {
    return res.status(404).json({
      error: "Debt record not found."
    });
  }

  res.json({
    message: "Debt deleted.",
    debtId
  });
});

// ------------------------------
// Dashboard
// ------------------------------

app.get("/api/dashboard/summary", requireLogin, async (req, res) => {
  const userId = req.session.userId;

  const [summary] = await db.execute(
    `SELECT
      (SELECT COALESCE(SUM(amount),0)
       FROM income
       WHERE user_id=?
         AND YEAR(income_date)=YEAR(CURDATE())
         AND MONTH(income_date)=MONTH(CURDATE())) total_income,
      (SELECT COALESCE(SUM(amount),0)
       FROM expenses
       WHERE user_id=?
         AND YEAR(expense_date)=YEAR(CURDATE())
         AND MONTH(expense_date)=MONTH(CURDATE())) total_expenses,
      (SELECT COALESCE(SUM(current_balance),0)
       FROM debts
       WHERE user_id=?) total_debt`,
    [userId, userId, userId]
  );

  const [activity] = await db.execute(
    `(SELECT
        income_id id,
        source label,
        amount,
        income_date item_date,
        'income' kind
      FROM income
      WHERE user_id=?
      ORDER BY income_date DESC
      LIMIT 6)
    UNION ALL
    (SELECT
        expense_id id,
        COALESCE(NULLIF(merchant,''),ec.category_name) label,
        e.amount,
        expense_date item_date,
        'expense' kind
      FROM expenses e
      JOIN expense_categories ec ON ec.category_id=e.category_id
      WHERE e.user_id=?
      ORDER BY expense_date DESC
      LIMIT 6)
    ORDER BY item_date DESC
    LIMIT 6`,
    [userId, userId]
  );

  const item = summary[0];
  const totalIncome = Number(item.total_income || 0);
  const totalExpenses = Number(item.total_expenses || 0);
  const totalDebt = Number(item.total_debt || 0);

  const normalizedActivity = activity.map((entry) => ({
    id: entry.id,
    label: entry.label,
    amount: Number(entry.amount),
    itemDate: toIsoDate(entry.item_date),
    // Backward-compatible alias used by the existing frontend.
    item_date: entry.item_date,
    kind: entry.kind
  }));

  res.json({
    totalIncome,
    totalExpenses,
    remaining: Number((totalIncome - totalExpenses).toFixed(2)),
    totalDebt,
    activity: normalizedActivity
  });
});

// ------------------------------
// Debt payoff calculator
// ------------------------------

app.post("/api/calculator/debt-payoff", requireLogin, (req, res) => {
  let balance = Number(req.body.balance);
  const rate = Number(req.body.interestRate);
  const payment = Number(req.body.monthlyPayment);

  if (
    !Number.isFinite(balance) ||
    !Number.isFinite(rate) ||
    !Number.isFinite(payment)
  ) {
    return res.status(400).json({
      error: "Balance, interest rate, and monthly payment must be valid numbers."
    });
  }

  if (balance <= 0) {
    return res.status(400).json({
      error: "Balance must be greater than 0."
    });
  }

  if (rate < 0) {
    return res.status(400).json({
      error: "Interest rate cannot be negative."
    });
  }

  if (payment <= 0) {
    return res.status(400).json({
      error: "Monthly payment must be greater than 0."
    });
  }

  const monthlyRate = rate / 100 / 12;
  const firstMonthInterest = balance * monthlyRate;

  if (monthlyRate > 0 && payment <= firstMonthInterest) {
    return res.status(400).json({
      error: "The payment must be greater than the monthly interest."
    });
  }

  let months = 0;
  let totalInterest = 0;

  while (balance > 0 && months < MAX_DEBT_PAYOFF_MONTHS) {
    const interest = balance * monthlyRate;

    totalInterest += interest;
    balance = Math.max(0, balance + interest - payment);
    months += 1;
  }

  if (balance > 0) {
    return res.status(400).json({
      error: "The debt would not be paid off within 100 years with these inputs."
    });
  }

  res.json({
    monthsToPayoff: months,
    yearsToPayoff: Number((months / 12).toFixed(1)),
    totalInterest: Number(totalInterest.toFixed(2))
  });
});

// Return JSON for unknown API routes instead of Express's default HTML 404 page.
app.use("/api", (_req, res) => {
  res.status(404).json({
    error: "API endpoint not found."
  });
});

// Single-page-app fallback. Keep this after the API routes.
app.use((req, res, next) => {
  if (req.method === "GET" && !req.path.startsWith("/api/")) {
    return res.sendFile(path.join(__dirname, "public", "index.html"));
  }

  next();
});

// Centralized error handling for unexpected backend failures.
app.use((error, _req, res, next) => {
  if (res.headersSent) {
    return next(error);
  }

  console.error("Unhandled server error:", error);

  if (error.code === "ER_DUP_ENTRY") {
    return res.status(409).json({
      error: "That record conflicts with an existing record."
    });
  }

  if (error.code === "ER_NO_REFERENCED_ROW_2") {
    return res.status(400).json({
      error: "A referenced record does not exist."
    });
  }

  if (
    error.code === "ER_DATA_TOO_LONG" ||
    error.code === "ER_WARN_DATA_OUT_OF_RANGE"
  ) {
    return res.status(400).json({
      error: "One or more submitted values are outside the allowed range."
    });
  }

  res.status(500).json({
    error: "An unexpected server error occurred."
  });
});

const port = Number(process.env.PORT || 3000);

if (require.main === module) {
  app.listen(port, async () => {
    console.log(`Financial Wellness running at http://localhost:${port}`);

    try {
      await db.query("SELECT 1");
      console.log("Connected to XAMPP MySQL.");
    } catch (error) {
      console.error(
        "MySQL connection failed. Start MySQL in XAMPP and check .env."
      );
    }
  });
}

module.exports = {
  app,
  requireLogin,
  normalizeEmail,
  normalizeText,
  isValidEmail,
  isValidIsoDate,
  parsePositiveNumber,
  parsePositiveInteger
};

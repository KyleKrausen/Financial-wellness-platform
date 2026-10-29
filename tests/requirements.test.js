const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { requireLogin, isValidEmail, normalizeEmail, isValidIsoDate, parsePositiveNumber, parsePositiveInteger } = require("../server.js");

// FR1  User Registration and Auth
describe("FR1 User Registration and Auth", () => {
    it("FR1_Test1 Accepts a valid email", () => {
        assert.equal(isValidEmail("user@example.com"), true);
    });

    it("FR1_Test2 Rejects an email with no dot in domain", () => {
        assert.equal(isValidEmail("user@examplecom"), false);
    });

    it("FR1_Test3 Reject an email with no @ symbol", () => {
        assert.equal(isValidEmail("userexample.com"), false);
    });

    it("FR1_Test4 Reject an email with bad spacing", () => {
        assert.equal(isValidEmail("us er@example.com"), false);
    });

    it("FR1_Test5 Rejects an empty email input", () => {
        assert.equal(isValidEmail(""), false);
    });

    it("FR1_Test6 normalize valid emails", () => {
        assert.equal(normalizeEmail(" User@Example.COM "), "user@example.com");
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
    it("FR2_Test1 blocks a request with no logged-in user", () => {
        const req = { session: {} };
        const res = fakeResponse();
        let nextCalled = false;
        requireLogin(req, res, () => { nextCalled = true; });
        assert.equal(res.statusCode, 401);
        assert.deepEqual(res.body, { error: "Please log in." });
        assert.equal(nextCalled, false);
    });

    it("FR2_Test2 let logged-in user access", () => {
        const req = { session: { userId: 3 } };
        const res = fakeResponse();
        let nextCalled = false;

        requireLogin(req, res, () => { nextCalled = true; });
        assert.equal(nextCalled, true);
        assert.equal(res.statusCode, null);
    });
});


// FR3 Income Tracking


// FR4 Expense Tracking

// FR5 Budgeting

// FR6 Reporting and Analytics
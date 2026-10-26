const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { isValidEmail, normalizeEmail, isValidIsoDate, parsePositiveNumber, parsePositiveInteger } = require("../server.js");

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
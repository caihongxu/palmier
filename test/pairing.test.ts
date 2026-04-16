import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { generatePairingCode, PAIRING_EXPIRY_MS } from "../src/commands/pair.js";

describe("generatePairingCode", () => {
  it("generates a 6-character code", () => {
    const code = generatePairingCode();
    assert.equal(code.length, 6);
  });

  it("only contains allowed characters (no O/0/I/1/L)", () => {
    const allowed = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
    for (let i = 0; i < 50; i++) {
      const code = generatePairingCode();
      for (const ch of code) {
        assert.ok(allowed.includes(ch), `Character '${ch}' is not in allowed set`);
      }
    }
  });

  it("generates unique codes", () => {
    const codes = new Set<string>();
    for (let i = 0; i < 100; i++) {
      codes.add(generatePairingCode());
    }
    // With 30^6 ≈ 729M possibilities, 100 codes should all be unique
    assert.equal(codes.size, 100);
  });
});

describe("PAIRING_EXPIRY_MS", () => {
  it("is 1 minute", () => {
    assert.equal(PAIRING_EXPIRY_MS, 60 * 1000);
  });
});

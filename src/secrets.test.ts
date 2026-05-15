import { describe, it, expect, beforeEach } from "vitest";
import {
  resolveSecrets,
  generateBootstrap,
  SecretsScrubber,
  type SecretsConfig,
} from "./secrets.js";

// ─── resolveSecrets ─────────────────────────────────────────────────────────

describe("resolveSecrets", () => {
  it("returns empty maps when no config", () => {
    const result = resolveSecrets(undefined);
    expect(result.expose.size).toBe(0);
    expect(result.broker.size).toBe(0);
  });

  it("shorthand string[] reads from process.env", () => {
    process.env.TEST_SECRET_A = "secret-a-value";
    process.env.TEST_SECRET_B = "secret-b-value";

    try {
      const result = resolveSecrets(["TEST_SECRET_A", "TEST_SECRET_B"]);
      expect(result.expose.get("TEST_SECRET_A")).toBe("secret-a-value");
      expect(result.expose.get("TEST_SECRET_B")).toBe("secret-b-value");
      expect(result.broker.size).toBe(0);
    } finally {
      delete process.env.TEST_SECRET_A;
      delete process.env.TEST_SECRET_B;
    }
  });

  it("shorthand skips missing env vars silently", () => {
    delete process.env.DOES_NOT_EXIST;
    const result = resolveSecrets(["DOES_NOT_EXIST"]);
    expect(result.expose.size).toBe(0);
  });

  it("full config: expose as string[]", () => {
    process.env.TEST_EXPOSE_KEY = "expose-value";

    try {
      const result = resolveSecrets({
        expose: ["TEST_EXPOSE_KEY"],
      });
      expect(result.expose.get("TEST_EXPOSE_KEY")).toBe("expose-value");
    } finally {
      delete process.env.TEST_EXPOSE_KEY;
    }
  });

  it("full config: expose as Record<string, string>", () => {
    const result = resolveSecrets({
      expose: {
        API_KEY: "explicit-api-key-value",
        DB_URL: "postgres://localhost/db",
      },
    });
    expect(result.expose.get("API_KEY")).toBe("explicit-api-key-value");
    expect(result.expose.get("DB_URL")).toBe("postgres://localhost/db");
  });

  it("full config: broker maps origins to headers", () => {
    const result = resolveSecrets({
      broker: {
        "https://api.github.com": {
          Authorization: "Bearer ghp_test123456",
          "User-Agent": "piebox",
        },
        "https://registry.npmjs.org": {
          Authorization: "Bearer npm_test789",
        },
      },
    });

    expect(result.broker.get("https://api.github.com")).toEqual({
      Authorization: "Bearer ghp_test123456",
      "User-Agent": "piebox",
    });
    expect(result.broker.get("https://registry.npmjs.org")).toEqual({
      Authorization: "Bearer npm_test789",
    });
  });

  it("full config: expose + broker together", () => {
    const result = resolveSecrets({
      expose: { OPENAI_KEY: "sk-test-value-long-enough" },
      broker: {
        "https://api.github.com": {
          Authorization: "Bearer ghp_token12345",
        },
      },
    });

    expect(result.expose.get("OPENAI_KEY")).toBe("sk-test-value-long-enough");
    expect(result.broker.has("https://api.github.com")).toBe(true);
  });
});

// ─── SecretsScrubber ────────────────────────────────────────────────────────

describe("SecretsScrubber", () => {
  let scrubber: SecretsScrubber;

  beforeEach(() => {
    scrubber = new SecretsScrubber();
  });

  it("is inactive when no secrets registered", () => {
    expect(scrubber.active).toBe(false);
    expect(scrubber.size).toBe(0);
  });

  it("replaces secret values with [NAME]", () => {
    scrubber.register("API_KEY", "sk-supersecretkey123");
    expect(scrubber.scrub("My key is sk-supersecretkey123 here")).toBe(
      "My key is [API_KEY] here",
    );
  });

  it("replaces multiple occurrences", () => {
    scrubber.register("TOKEN", "ghp_longtoken12345");
    const input = "first ghp_longtoken12345 and second ghp_longtoken12345";
    expect(scrubber.scrub(input)).toBe("first [TOKEN] and second [TOKEN]");
  });

  it("scrubs multiple different secrets", () => {
    scrubber.register("API_KEY", "sk-key-value-here");
    scrubber.register("TOKEN", "ghp_token-value-here");
    const input = "key=sk-key-value-here token=ghp_token-value-here";
    expect(scrubber.scrub(input)).toBe("key=[API_KEY] token=[TOKEN]");
  });

  it("skips secrets shorter than 8 characters", () => {
    scrubber.register("SHORT", "abc");
    expect(scrubber.active).toBe(false);
    expect(scrubber.scrub("abc is here")).toBe("abc is here");
  });

  it("registers secrets with exactly 8 characters", () => {
    scrubber.register("EXACT", "12345678");
    expect(scrubber.active).toBe(true);
    expect(scrubber.scrub("value is 12345678")).toBe("value is [EXACT]");
  });

  it("handles regex special characters in secret values", () => {
    scrubber.register("SPECIAL", "abc+def.ghi*jkl");
    expect(scrubber.scrub("found abc+def.ghi*jkl here")).toBe(
      "found [SPECIAL] here",
    );
  });

  it("checkUrl throws when secret found in URL", () => {
    scrubber.register("TOKEN", "ghp_longtoken12345");
    expect(() => {
      scrubber.checkUrl("https://api.github.com?token=ghp_longtoken12345");
    }).toThrow(/Secret "TOKEN" detected in request URL/);
  });

  it("checkUrl does not throw for clean URLs", () => {
    scrubber.register("TOKEN", "ghp_longtoken12345");
    expect(() => {
      scrubber.checkUrl("https://api.github.com/repos/user/repo");
    }).not.toThrow();
  });

  it("checkUrl works correctly after multiple calls", () => {
    scrubber.register("TOKEN", "ghp_longtoken12345");

    // First call — clean
    scrubber.checkUrl("https://clean-url.com");

    // Second call — dirty
    expect(() => {
      scrubber.checkUrl("https://evil.com?t=ghp_longtoken12345");
    }).toThrow();

    // Third call — clean again (regex state properly reset)
    scrubber.checkUrl("https://another-clean.com");
  });

  it("returns correct size", () => {
    scrubber.register("A", "longvalue_aaaa");
    scrubber.register("B", "longvalue_bbbb");
    scrubber.register("C", "short"); // skipped
    expect(scrubber.size).toBe(2);
  });
});

// ─── generateBootstrap ──────────────────────────────────────────────────────

describe("generateBootstrap", () => {
  it("returns empty string for empty map", () => {
    expect(generateBootstrap(new Map(), "/sandbox")).toBe("");
  });

  it("generates valid JavaScript with single secret", () => {
    const expose = new Map([["API_KEY", "sk-test-value"]]);
    const code = generateBootstrap(expose, "/sandbox");

    expect(code).toContain("globalThis.process");
    expect(code).toContain('"API_KEY"');
    expect(code).toContain('"sk-test-value"');
    expect(code).toContain('"/sandbox"');
  });

  it("generates valid JavaScript with multiple secrets", () => {
    const expose = new Map([
      ["KEY_A", "value-a"],
      ["KEY_B", "value-b"],
    ]);
    const code = generateBootstrap(expose, "/workspace");

    expect(code).toContain('"KEY_A"');
    expect(code).toContain('"value-a"');
    expect(code).toContain('"KEY_B"');
    expect(code).toContain('"value-b"');
  });

  it("escapes special characters in values", () => {
    const expose = new Map([["CONN", 'postgres://user:"pass@host/db']]);
    const code = generateBootstrap(expose, "/sandbox");

    // JSON.stringify escapes the quotes
    expect(code).toContain('\\"pass@host/db');
  });

  it("sets process.cwd() to the provided cwd", () => {
    const expose = new Map([["X", "test-value-123"]]);
    const code = generateBootstrap(expose, "/my/custom/dir");

    expect(code).toContain('"/my/custom/dir"');
  });
});

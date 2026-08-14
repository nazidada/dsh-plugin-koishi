import { describe, expect, it } from "vitest";

import { resolveConfig } from "./config.js";

const token = "b".repeat(64);

describe("Koishi bridge config", () => {
  it("accepts loopback HTTP and reads the environment token", () => {
    const config = resolveConfig({}, { DSH_KOISHI_TOKEN: token });
    expect(config.baseURL).toBe("http://127.0.0.1:8787");
    expect(config.token).toBe(token);
    expect(config.allowedChannels).toEqual([]);
  });

  it("rejects plaintext remote transport by default", () => {
    expect(() =>
      resolveConfig({ baseURL: "http://example.com", token }, {}),
    ).toThrow(/plain HTTP/);
    expect(
      resolveConfig(
        {
          baseURL: "http://example.com",
          allowInsecureRemote: true,
          token,
        },
        {},
      ).baseURL,
    ).toBe("http://example.com");
    expect(
      resolveConfig({ baseURL: "https://example.com", token }, {}).baseURL,
    ).toBe("https://example.com");
  });

  it("rejects credentials and paths in the gateway origin", () => {
    expect(() =>
      resolveConfig({ baseURL: "http://user:pass@127.0.0.1:8787", token }, {}),
    ).toThrow(/only scheme/);
    expect(() =>
      resolveConfig({ baseURL: "http://127.0.0.1:8787/prefix", token }, {}),
    ).toThrow(/only scheme/);
  });

  it("rejects malformed environment names, protocols, rules, and limits", () => {
    expect(() => resolveConfig({ token, tokenEnv: "NOT-VALID" }, {})).toThrow(
      /environment variable name/,
    );
    expect(() =>
      resolveConfig({ token, baseURL: "ftp://localhost" }, {}),
    ).toThrow(/http: or https:/);
    expect(() =>
      resolveConfig(
        {
          token,
          allowedChannels: [{ platform: "onebot", channelId: " " }],
        },
        {},
      ),
    ).toThrow(/requires platform and channelId/);
    expect(() => resolveConfig({ token, requestTimeoutMs: 999 }, {})).toThrow(
      /greater than or equal/,
    );
    expect(resolveConfig({ token, baseURL: "http://[::1]" }, {}).baseURL).toBe(
      "http://[::1]",
    );
  });
});

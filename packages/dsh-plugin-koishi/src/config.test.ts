import { describe, expect, it } from "vitest";

import { resolveConfig } from "./config.js";

const token = "a".repeat(64);

describe("Harness gateway config", () => {
  it("reads the token from the configured environment variable", () => {
    const config = resolveConfig({}, { DSH_KOISHI_TOKEN: token }, "/workspace");
    expect(config.token).toBe(token);
    expect(config.workspacePath).toBe("/workspace");
    expect(config.allowedChannels).toEqual([]);
  });

  it("requires a strong token and distinct absolute paths", () => {
    expect(() => resolveConfig({ token: "short" }, {}, "/workspace")).toThrow(
      /at least 32/,
    );
    expect(() =>
      resolveConfig(
        {
          token,
          messagePath: "/same",
          resetPath: "/same",
        },
        {},
        "/workspace",
      ),
    ).toThrow(/must be distinct/);
    expect(() =>
      resolveConfig({ token, messagePath: "relative" }, {}, "/workspace"),
    ).toThrow(/absolute URL path/);
    expect(() =>
      resolveConfig(
        {
          token,
          maxPendingPerSession: 9,
          maxDedupeEntriesPerSession: 8,
        },
        {},
        "/workspace",
      ),
    ).toThrow(/greater than or equal/);
  });

  it("rejects malformed environment names, rules, and numeric limits", () => {
    expect(() =>
      resolveConfig({ token, tokenEnv: "NOT-VALID" }, {}, "/workspace"),
    ).toThrow(/environment variable name/);
    expect(() =>
      resolveConfig(
        {
          token,
          allowedChannels: [{ platform: " ", channelId: "channel" }],
        },
        {},
        "/workspace",
      ),
    ).toThrow(/requires platform and channelId/);
    expect(() =>
      resolveConfig({ token, maxSessions: 0 }, {}, "/workspace"),
    ).toThrow(/safe integer/);
    expect(
      resolveConfig({ token, healthPath: "/healthz/" }, {}, "/workspace")
        .healthPath,
    ).toBe("/healthz");
  });
});

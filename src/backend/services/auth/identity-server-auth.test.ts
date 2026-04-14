import { describe, expect, it } from "vitest";
import {
  decodeIdentityServerAccessToken,
  getUserInfoFromIdentityServerAccessToken,
} from "./identity-server-auth";

function encodeBase64Url(value: string): string {
  return Buffer.from(value, "utf8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function createJwt(payload: Record<string, unknown>): string {
  const header = encodeBase64Url(JSON.stringify({ alg: "none", typ: "JWT" }));
  const encodedPayload = encodeBase64Url(JSON.stringify(payload));

  return `${header}.${encodedPayload}.signature`;
}

describe("decodeIdentityServerAccessToken", () => {
  it("decodes standard profile claims from the access token", () => {
    const token = createJwt({
      sub: "00000000-1111-2222-3333-444444444444",
      email: "bob.northwind@example.test",
      given_name: "Bob",
      family_name: "Northwind",
      idp: "Microsoft",
    });

    expect(decodeIdentityServerAccessToken(token)).toEqual({
      sub: "00000000-1111-2222-3333-444444444444",
      email: "bob.northwind@example.test",
      given_name: "Bob",
      family_name: "Northwind",
      name: undefined,
      preferred_username: undefined,
    });
  });

  it("returns null for an invalid token", () => {
    expect(decodeIdentityServerAccessToken("not-a-jwt")).toBeNull();
  });
});

describe("getUserInfoFromIdentityServerAccessToken", () => {
  it("builds user info from given and family name claims", () => {
    const token = createJwt({
      sub: "00000000-1111-2222-3333-444444444444",
      email: "bob.northwind@example.test",
      given_name: "Bob",
      family_name: "Northwind",
    });

    expect(getUserInfoFromIdentityServerAccessToken(token)).toEqual({
      id: "00000000-1111-2222-3333-444444444444",
      name: "Bob Northwind",
      email: "bob.northwind@example.test",
    });
  });

  it("falls back to preferred_username when name claims are missing", () => {
    const token = createJwt({
      sub: "user-123",
      preferred_username: "alex@example.com",
    });

    expect(getUserInfoFromIdentityServerAccessToken(token)).toEqual({
      id: "user-123",
      name: "alex@example.com",
      email: "alex@example.com",
    });
  });
});
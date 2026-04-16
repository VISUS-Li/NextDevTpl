import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("Auth sign-in captcha", () => {
  beforeEach(() => {
    vi.resetModules();
    process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY = "1x00000000000000000000AA";
    process.env.TURNSTILE_SECRET_KEY = "turnstile-secret";
  });

  afterEach(() => {
    delete process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;
    delete process.env.TURNSTILE_SECRET_KEY;
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  /**
   * 构造邮箱密码登录请求
   */
  function createAuthRequest(
    path: "sign-in" | "sign-up",
    headers?: HeadersInit
  ) {
    return new Request(`http://localhost:3000/api/auth/${path}/email`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        origin: "http://localhost:3000",
        ...headers,
      },
      body: JSON.stringify(
        path === "sign-in"
          ? {
              email: "user@example.com",
              password: "password123",
            }
          : {
              name: "User",
              email: "user@example.com",
              password: "password123",
            }
      ),
    });
  }

  it("缺少验证码时应直接返回 400", async () => {
    const { POST } = await import("@/app/api/auth/[...all]/route");
    const response = await POST(createAuthRequest("sign-in"));
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.message).toBe("Missing CAPTCHA response");
  });

  it("验证码校验失败时应返回 403", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = input instanceof URL ? input.toString() : String(input);
        if (url.includes("challenges.cloudflare.com/turnstile/v0/siteverify")) {
          return new Response(JSON.stringify({ success: false }), {
            status: 200,
            headers: {
              "Content-Type": "application/json",
            },
          });
        }
        throw new Error(`unexpected fetch: ${url}`);
      })
    );

    const { POST } = await import("@/app/api/auth/[...all]/route");
    const response = await POST(
      createAuthRequest("sign-in", {
        "x-captcha-response": "invalid-token",
      })
    );
    const data = await response.json();

    expect(response.status).toBe(403);
    expect(data.message).toBe("Captcha verification failed");
  });

  it("注册缺少验证码时应直接返回 400", async () => {
    const { POST } = await import("@/app/api/auth/[...all]/route");
    const response = await POST(createAuthRequest("sign-up"));
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.message).toBe("Missing CAPTCHA response");
  });
});

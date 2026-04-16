"use client";

import { Eye, EyeOff } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import Script from "next/script";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { GoogleIcon } from "@/features/shared/icons";
import { useRouter } from "@/i18n/routing";
import {
  resendVerificationEmail,
  signInWithEmail,
  signInWithGoogle,
} from "@/lib/auth/client";

import { AuthErrorAlert } from "./auth-error-alert";
import { AuthLogo } from "./auth-logo";

const rememberedEmailStorageKey = "auth.sign-in.remembered-email";
const turnstileSiteKey =
  process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY?.trim() || "";
const turnstileEnabled = turnstileSiteKey.length > 0;

declare global {
  interface Window {
    turnstile?: {
      render: (
        container: HTMLElement,
        options: {
          sitekey: string;
          callback: (token: string) => void;
          "expired-callback"?: () => void;
          "error-callback"?: () => void;
        }
      ) => string;
      reset: (widgetId?: string) => void;
      remove: (widgetId?: string) => void;
    };
  }
}

/**
 * 渲染 Turnstile 挂件
 */
function renderTurnstileWidget(params: {
  container: HTMLDivElement | null;
  widgetIdRef: { current: string | null };
  onTokenChange: (token: string) => void;
}) {
  if (
    !turnstileEnabled ||
    !window.turnstile ||
    !params.container ||
    params.widgetIdRef.current
  ) {
    return;
  }

  params.widgetIdRef.current = window.turnstile.render(params.container, {
    sitekey: turnstileSiteKey,
    callback: params.onTokenChange,
    "expired-callback": () => params.onTokenChange(""),
    "error-callback": () => params.onTokenChange(""),
  });
}

/**
 * 登录表单组件
 *
 * 功能:
 * - Google OAuth 登录
 * - 邮箱密码登录
 */
export function SignInForm() {
  const t = useTranslations("Auth.signIn");
  const tCommon = useTranslations("Auth.common");
  const router = useRouter();
  const searchParams = useSearchParams();
  const turnstileRef = useRef<HTMLDivElement | null>(null);
  const turnstileWidgetIdRef = useRef<string | null>(null);

  // 表单状态
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [rememberAccount, setRememberAccount] = useState(false);
  const [captchaToken, setCaptchaToken] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showResend, setShowResend] = useState(false);
  const [resendCooldown, setResendCooldown] = useState(0);
  const callbackUrl = searchParams.get("callbackUrl") || "/dashboard";

  /**
   * 登录成功后跳回来源页面。
   */
  const goToCallbackUrl = () => {
    if (
      callbackUrl.startsWith("http://") ||
      callbackUrl.startsWith("https://")
    ) {
      window.location.assign(callbackUrl);
      return;
    }
    router.push(callbackUrl);
  };

  /**
   * 判断是否为服务端异常，避免误报成密码错误
   */
  const isServerFailure = (error: unknown) => {
    if (!error || typeof error !== "object") return false;
    const status = "status" in error ? Number(error.status) : NaN;
    const message = "message" in error ? String(error.message || "") : "";
    return status >= 500 || message.toUpperCase().includes("SERVER_ERROR");
  };

  /**
   * 判断是否为验证码失败，便于给用户明确提示
   */
  const isCaptchaFailure = (error: unknown) => {
    if (!error || typeof error !== "object") return false;
    const status = "status" in error ? Number(error.status) : NaN;
    const message = "message" in error ? String(error.message || "") : "";
    return (
      [400, 403].includes(status) && message.toLowerCase().includes("captcha")
    );
  };

  /**
   * 失败后重置验证码，避免旧 token 重放
   */
  const resetTurnstile = () => {
    setCaptchaToken("");
    if (!turnstileWidgetIdRef.current || !window.turnstile) {
      return;
    }
    window.turnstile.reset(turnstileWidgetIdRef.current);
  };

  useEffect(() => {
    if (searchParams.get("reason") === "session-expired") {
      setError(t("errors.sessionExpired"));
    }
  }, [searchParams, t]);

  useEffect(() => {
    const rememberedEmail = window.localStorage.getItem(
      rememberedEmailStorageKey
    );
    if (!rememberedEmail) {
      return;
    }
    setEmail(rememberedEmail);
    setRememberAccount(true);
  }, []);

  useEffect(() => {
    renderTurnstileWidget({
      container: turnstileRef.current,
      widgetIdRef: turnstileWidgetIdRef,
      onTokenChange: setCaptchaToken,
    });
    return () => {
      if (!turnstileWidgetIdRef.current || !window.turnstile) {
        return;
      }
      window.turnstile.remove(turnstileWidgetIdRef.current);
      turnstileWidgetIdRef.current = null;
    };
  }, []);

  /**
   * 重新发送验证邮件
   */
  const handleResendEmail = async () => {
    if (resendCooldown > 0 || !email) return;

    try {
      await resendVerificationEmail(email);
      setResendCooldown(60);
      const timer = setInterval(() => {
        setResendCooldown((prev) => {
          if (prev <= 1) {
            clearInterval(timer);
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
    } catch {
      // 静默失败
    }
  };

  /**
   * 处理 Google 登录
   */
  const handleGoogleSignIn = async () => {
    try {
      setIsLoading(true);
      setError(null);
      await signInWithGoogle(callbackUrl);
    } catch {
      setError(t("errors.google"));
    } finally {
      setIsLoading(false);
    }
  };

  /**
   * 处理邮箱密码登录
   */
  const handleEmailSignIn = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!email || !password) {
      setError(t("errors.missingFields"));
      return;
    }

    if (turnstileEnabled && !captchaToken) {
      setError(t("errors.captchaRequired"));
      return;
    }

    try {
      setIsLoading(true);
      setError(null);
      const result = await signInWithEmail(email, password, callbackUrl, {
        rememberMe: rememberAccount,
        captchaToken,
      });

      if (result.error) {
        if (isCaptchaFailure(result.error)) {
          setError(t("errors.captchaFailed"));
          setShowResend(false);
          resetTurnstile();
          setIsLoading(false);
          return;
        }
        if (isServerFailure(result.error)) {
          setError(t("errors.serverUnavailable"));
          setShowResend(false);
          setIsLoading(false);
          return;
        }
        if (result.error.code === "EMAIL_NOT_VERIFIED") {
          setError(t("errors.emailNotVerified"));
          setShowResend(true);
        } else {
          setError(t("errors.invalidCredentials"));
          setShowResend(false);
        }
        setIsLoading(false);
        return;
      }

      if (rememberAccount) {
        window.localStorage.setItem(rememberedEmailStorageKey, email);
      } else {
        window.localStorage.removeItem(rememberedEmailStorageKey);
      }

      // 登录成功，提示并跳转
      toast.success(t("success"));
      goToCallbackUrl();
    } catch (error) {
      setError(
        isCaptchaFailure(error)
          ? t("errors.captchaFailed")
          : isServerFailure(error)
            ? t("errors.serverUnavailable")
            : t("errors.invalidCredentials")
      );
      if (isCaptchaFailure(error)) {
        resetTurnstile();
      }
      setIsLoading(false);
    }
  };

  return (
    <div className="w-full max-w-md space-y-6 px-1 sm:px-0">
      {turnstileEnabled && (
        <Script
          id="cloudflare-turnstile"
          src="https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit"
          strategy="afterInteractive"
          onLoad={() =>
            renderTurnstileWidget({
              container: turnstileRef.current,
              widgetIdRef: turnstileWidgetIdRef,
              onTokenChange: setCaptchaToken,
            })
          }
        />
      )}

      {/* Logo 和标题 */}
      <div className="flex flex-col items-center space-y-2 text-center">
        <AuthLogo />
        <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
        <p className="text-sm text-muted-foreground">{t("subtitle")}</p>
      </div>

      {/* 错误提示 */}
      <AuthErrorAlert message={error} />

      {/* 重发验证邮件 */}
      {showResend && (
        <Button
          variant="outline"
          className="h-11 w-full text-base"
          onClick={handleResendEmail}
          disabled={resendCooldown > 0}
        >
          {resendCooldown > 0
            ? t("resendCooldown", { seconds: resendCooldown })
            : t("resendVerification")}
        </Button>
      )}

      {/* OAuth 登录按钮 */}
      <div className="space-y-3">
        <Button
          variant="outline"
          className="h-11 w-full text-base"
          onClick={handleGoogleSignIn}
          disabled={isLoading}
        >
          <GoogleIcon className="mr-2 h-4 w-4" />
          {tCommon("google")}
        </Button>
      </div>

      {/* 分隔线 */}
      <div className="relative">
        <div className="absolute inset-0 flex items-center">
          <Separator className="w-full" />
        </div>
        <div className="relative flex justify-center text-xs uppercase">
          <span className="bg-background px-2 text-muted-foreground">
            {tCommon("or")}
          </span>
        </div>
      </div>

      {/* 邮箱密码表单 */}
      <form
        onSubmit={handleEmailSignIn}
        className="space-y-4"
        suppressHydrationWarning
      >
        {/* 邮箱输入 */}
        <div className="space-y-2">
          <Label htmlFor="email">{t("emailLabel")}</Label>
          <Input
            id="email"
            type="email"
            name="email"
            placeholder={t("emailPlaceholder")}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            disabled={isLoading}
            autoComplete="username"
            inputMode="email"
            autoCorrect="off"
            autoCapitalize="none"
            spellCheck={false}
            className="h-11 text-base"
          />
        </div>

        {/* 密码输入 */}
        <div className="space-y-2">
          <Label htmlFor="password">{t("passwordLabel")}</Label>
          <div className="relative">
            <Input
              id="password"
              name="password"
              type={showPassword ? "text" : "password"}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={isLoading}
              autoComplete="current-password"
              className="h-11 pr-10 text-base"
              autoCorrect="off"
              autoCapitalize="none"
              spellCheck={false}
            />
            <button
              type="button"
              onClick={() => setShowPassword(!showPassword)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
              tabIndex={-1}
            >
              {showPassword ? (
                <EyeOff className="h-4 w-4" />
              ) : (
                <Eye className="h-4 w-4" />
              )}
            </button>
          </div>
        </div>

        {/* 记住邮箱和登录状态 */}
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <Checkbox
              id="remember-account"
              checked={rememberAccount}
              onCheckedChange={(checked) =>
                setRememberAccount(checked === true)
              }
              disabled={isLoading}
            />
            <Label
              htmlFor="remember-account"
              className="cursor-pointer text-sm font-normal text-muted-foreground"
            >
              {t("rememberAccount")}
            </Label>
          </div>
          <Link
            href="/forgot-password"
            className="text-sm text-muted-foreground underline hover:text-foreground transition-colors"
          >
            {t("forgotPassword")}
          </Link>
        </div>

        {/* 人机验证 */}
        {turnstileEnabled && (
          <div className="space-y-2">
            <Label>{t("captchaLabel")}</Label>
            <div
              ref={turnstileRef}
              className="min-h-[65px] rounded-md border border-border bg-background p-3"
            />
          </div>
        )}

        {/* 提交按钮 */}
        <Button
          type="submit"
          className="h-11 w-full text-base"
          disabled={isLoading}
        >
          {isLoading ? t("loading") : t("submit")}
        </Button>
      </form>

      {/* 注册链接 */}
      <p className="text-center text-sm text-muted-foreground">
        {t("noAccount")}{" "}
        <Link
          href="/sign-up"
          className="font-medium text-foreground hover:underline"
        >
          {t("signUpLink")}
        </Link>
      </p>
    </div>
  );
}

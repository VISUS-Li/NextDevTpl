"use client";

import { Eye, EyeOff } from "lucide-react";
import Link from "next/link";
import Script from "next/script";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { GoogleIcon } from "@/features/shared/icons";
import { useRouter } from "@/i18n/routing";
import { signInWithGoogle, signUpWithEmail } from "@/lib/auth/client";

import { AuthErrorAlert } from "./auth-error-alert";
import { AuthLogo } from "./auth-logo";

const turnstileSiteKey =
  process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY?.trim() || "";
const turnstileEnabled = turnstileSiteKey.length > 0;

/**
 * 渲染注册页 Turnstile 挂件
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
 * 注册表单组件
 *
 * 功能:
 * - Google OAuth 注册
 * - GitHub OAuth 注册
 * - 邮箱密码注册
 */
export function SignUpForm() {
  const t = useTranslations("Auth.signUp");
  const tCommon = useTranslations("Auth.common");
  const router = useRouter();
  const turnstileRef = useRef<HTMLDivElement | null>(null);
  const turnstileWidgetIdRef = useRef<string | null>(null);

  // 表单状态
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [captchaToken, setCaptchaToken] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /**
   * 判断是否为服务端异常，避免误报成邮箱已存在
   */
  const isServerFailure = (error: unknown) => {
    if (!error || typeof error !== "object") return false;
    const status = "status" in error ? Number(error.status) : NaN;
    const message = "message" in error ? String(error.message || "") : "";
    return status >= 500 || message.toUpperCase().includes("SERVER_ERROR");
  };

  /**
   * 判断是否为验证码错误
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
   * 失败后重置验证码
   */
  const resetTurnstile = () => {
    setCaptchaToken("");
    if (!turnstileWidgetIdRef.current || !window.turnstile) {
      return;
    }
    window.turnstile.reset(turnstileWidgetIdRef.current);
  };

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
   * 处理 Google 注册
   */
  const handleGoogleSignUp = async () => {
    try {
      setIsLoading(true);
      setError(null);
      await signInWithGoogle();
    } catch {
      setError(t("errors.google"));
    } finally {
      setIsLoading(false);
    }
  };

  /**
   * 处理邮箱密码注册
   */
  const handleEmailSignUp = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!name || !email || !password) {
      setError(t("errors.missingFields"));
      return;
    }

    if (password.length < 8) {
      setError(t("errors.passwordTooShort"));
      return;
    }

    if (password !== confirmPassword) {
      setError(t("errors.passwordMismatch"));
      return;
    }

    if (turnstileEnabled && !captchaToken) {
      setError(t("errors.captchaRequired"));
      return;
    }

    try {
      setIsLoading(true);
      setError(null);
      const result = await signUpWithEmail(email, password, name, {
        captchaToken,
      });

      if (result.error) {
        if (isCaptchaFailure(result.error)) {
          setError(t("errors.captchaFailed"));
          resetTurnstile();
          setIsLoading(false);
          return;
        }
        if (isServerFailure(result.error)) {
          setError(t("errors.serverUnavailable"));
          setIsLoading(false);
          return;
        }
        setError(
          result.error.code === "USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL"
            ? t("errors.emailInUse")
            : result.error.message || t("errors.emailInUse")
        );
        setIsLoading(false);
        return;
      }

      // 注册成功后直接进入用户后台，避免在官网场景下卡在邮箱验证
      router.push("/dashboard");
    } catch (error) {
      setError(
        isCaptchaFailure(error)
          ? t("errors.captchaFailed")
          : isServerFailure(error)
            ? t("errors.serverUnavailable")
            : error instanceof Error
              ? error.message
              : t("errors.emailInUse")
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
          id="cloudflare-turnstile-sign-up"
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

      {/* OAuth 登录按钮 */}
      <div className="space-y-3">
        <Button
          variant="outline"
          className="w-full"
          onClick={handleGoogleSignUp}
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
          <span className="bg-muted/30 px-2 text-muted-foreground">
            {tCommon("or")}
          </span>
        </div>
      </div>

      {/* 邮箱密码表单 */}
      <form
        onSubmit={handleEmailSignUp}
        className="space-y-4"
        suppressHydrationWarning
      >
        {/* 姓名输入 */}
        <div className="space-y-2">
          <Label htmlFor="name">{t("nameLabel")}</Label>
          <Input
            id="name"
            type="text"
            placeholder={t("namePlaceholder")}
            value={name}
            onChange={(e) => setName(e.target.value)}
            disabled={isLoading}
            autoComplete="name"
            autoCorrect="off"
            autoCapitalize="none"
            spellCheck={false}
            className="h-11 text-base"
          />
        </div>

        {/* 邮箱输入 */}
        <div className="space-y-2">
          <Label htmlFor="email">{t("emailLabel")}</Label>
          <Input
            id="email"
            type="email"
            placeholder={t("emailPlaceholder")}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            disabled={isLoading}
            autoComplete="email"
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
              type={showPassword ? "text" : "password"}
              placeholder={t("passwordPlaceholder")}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={isLoading}
              autoComplete="new-password"
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

        {/* 确认密码输入 */}
        <div className="space-y-2">
          <Label htmlFor="confirmPassword">{t("confirmPasswordLabel")}</Label>
          <Input
            id="confirmPassword"
            type={showPassword ? "text" : "password"}
            placeholder={t("confirmPasswordPlaceholder")}
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            disabled={isLoading}
            autoComplete="new-password"
            autoCorrect="off"
            autoCapitalize="none"
            spellCheck={false}
            className="h-11 text-base"
          />
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

      {/* 登录链接 */}
      <p className="text-center text-sm text-muted-foreground">
        {t("haveAccount")}{" "}
        <Link
          href="/sign-in"
          className="font-medium text-foreground hover:underline"
        >
          {t("signInLink")}
        </Link>
      </p>
    </div>
  );
}

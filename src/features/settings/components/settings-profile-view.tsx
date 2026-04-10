"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Camera, Loader2 } from "lucide-react";
import { useParams } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { useAction } from "next-safe-action/hooks";
import type { ComponentProps } from "react";
import { useRef, useState, useTransition } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import type { z } from "zod";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { CreditUsageSection } from "@/features/credits/components";
import { updateProfileAction } from "@/features/settings/actions";
import { updateProfileSchema } from "@/features/settings/schemas";
import { getSignedUploadUrlAction } from "@/features/storage/actions";
import { ALLOWED_IMAGE_TYPES, MAX_FILE_SIZE } from "@/features/storage/types";
import { UserToolConfigSection } from "@/features/tool-config/components/user-tool-config-section";
import { usePathname, useRouter } from "@/i18n/routing";
import { BillingSection } from "./billing-section";
import { SecuritySection } from "./security-section";

/**
 * SettingsProfileView Props 类型
 */
interface SettingsProfileViewProps {
  /** 用户初始数据 */
  user: {
    id: string;
    name: string;
    email: string;
    image?: string | null | undefined;
  };
  /** 初始标签页 */
  initialTab: "account" | "security" | "billing" | "usage" | "tools";
  /** 用户工具配置数据 */
  toolConfigData: ComponentProps<typeof UserToolConfigSection>["data"];
}

/**
 * 表单数据类型
 */
type FormValues = z.infer<typeof updateProfileSchema>;

/**
 * 读取头像展示地址，兼容外部 URL 和本地代理路径。
 */
function getAvatarDisplayUrl(image: string | null | undefined) {
  if (!image) {
    return undefined;
  }
  if (image.startsWith("http://") || image.startsWith("https://")) {
    return image;
  }
  const avatarsBucket =
    process.env.NEXT_PUBLIC_AVATARS_BUCKET_NAME ?? "avatars";
  return `/image-proxy/${avatarsBucket}/${image}`;
}

/**
 * 生成头像对象键名，避免覆盖旧文件。
 */
function generateAvatarObjectKey(userId: string, file: File) {
  const extension = file.name.split(".").pop()?.toLowerCase() ?? "jpg";
  return `${userId}-${Date.now()}.${extension}`;
}

/**
 * 设置页面主视图组件
 *
 * 包含:
 * - Tabs 导航 (Account, Security, Billing, Usage, Notifications)
 * - General 表单 (Name, Email)
 * - Avatar 上传
 * - Language 设置
 * - Delete Account 危险区域
 */
export function SettingsProfileView({
  user,
  initialTab,
  toolConfigData,
}: SettingsProfileViewProps) {
  // 文件上传 ref
  const fileInputRef = useRef<HTMLInputElement>(null);

  // 国际化
  const t = useTranslations("Settings");
  const tTabs = useTranslations("Settings.tabs");

  // 国际化路由
  const locale = useLocale();
  const router = useRouter();
  const pathname = usePathname();
  const params = useParams();
  const [isChangingLocale, startLocaleTransition] = useTransition();

  // 头像上传状态
  const [isUploadingAvatar, setIsUploadingAvatar] = useState(false);

  // 头像预览 URL (本地预览)
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null);

  /**
   * 切换语言
   */
  const handleLanguageChange = (newLocale: string) => {
    startLocaleTransition(() => {
      router.replace(
        // @ts-expect-error -- TypeScript will validate that only known `params`
        // are used in combination with a given `pathname`. Since the two will
        // always match for the current route, we can skip runtime checks.
        { pathname, params },
        { locale: newLocale }
      );
    });
  };

  /**
   * 获取用户名首字母作为头像回退
   */
  const getInitials = (name: string) => {
    return name
      .split(" ")
      .map((n) => n[0])
      .join("")
      .toUpperCase()
      .slice(0, 2);
  };

  /**
   * 获取当前显示的头像 URL
   */
  const currentAvatarUrl = avatarPreview ?? getAvatarDisplayUrl(user.image);

  /**
   * 表单实例
   */
  const form = useForm<FormValues>({
    resolver: zodResolver(updateProfileSchema),
    defaultValues: {
      name: user.name,
    },
  });

  /**
   * Server Action 绑定 - 更新资料
   */
  const { execute: executeUpdateProfile, isPending } = useAction(
    updateProfileAction,
    {
      onSuccess: ({ data }) => {
        if (data?.message) {
          toast.success(data.message);
        }
      },
      onError: ({ error }) => {
        if (error.serverError) {
          toast.error(error.serverError);
        }
        if (error.validationErrors) {
          const errors = Object.values(error.validationErrors).flat();
          toast.error(errors.join(", ") || t("errors.validationFailed"));
        }
      },
    }
  );

  /**
   * 表单提交
   */
  const onSubmit = (values: FormValues) => {
    executeUpdateProfile(values);
  };

  /**
   * 处理头像点击
   */
  const handleAvatarClick = () => {
    if (!isUploadingAvatar) {
      fileInputRef.current?.click();
    }
  };

  /**
   * 处理文件选择并上传头像
   */
  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // 验证文件类型
    if (
      !ALLOWED_IMAGE_TYPES.includes(
        file.type as (typeof ALLOWED_IMAGE_TYPES)[number]
      )
    ) {
      toast.error(
        t("errors.unsupportedFileType", {
          types: ALLOWED_IMAGE_TYPES.join(", "),
        })
      );
      return;
    }

    // 验证文件大小
    if (file.size > MAX_FILE_SIZE) {
      toast.error(
        t("errors.fileTooLarge", { size: MAX_FILE_SIZE / 1024 / 1024 })
      );
      return;
    }

    setIsUploadingAvatar(true);

    try {
      // 1. 创建本地预览
      const localPreviewUrl = URL.createObjectURL(file);
      setAvatarPreview(localPreviewUrl);

      // 2. 生成唯一文件名
      const key = generateAvatarObjectKey(user.id, file);

      // 3. 获取签名上传 URL
      const uploadUrlResult = await getSignedUploadUrlAction({
        key,
        contentType: file.type as
          | "image/jpeg"
          | "image/png"
          | "image/gif"
          | "image/webp",
      });

      if (!uploadUrlResult?.data?.uploadUrl) {
        throw new Error(t("errors.uploadFailed"));
      }

      // 4. 直接上传文件到存储
      const uploadResponse = await fetch(uploadUrlResult.data.uploadUrl, {
        method: "PUT",
        body: file,
        headers: {
          "Content-Type": file.type,
        },
      });

      if (!uploadResponse.ok) {
        throw new Error(t("errors.fileUploadFailed"));
      }

      // 5. 更新数据库中的头像字段
      executeUpdateProfile({ image: uploadUrlResult.data.key });
      toast.success(t("success.avatarUpdated"));
    } catch (error) {
      console.error("头像上传错误:", error);
      toast.error(
        error instanceof Error ? error.message : t("errors.avatarUploadError")
      );
      // 清除预览
      setAvatarPreview(null);
    } finally {
      setIsUploadingAvatar(false);
      // 重置文件输入
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    }
  };

  /**
   * 处理删除账户
   */
  const handleDeleteAccount = () => {
    // TODO: 实现删除账户功能
    toast.error(t("deleteAccount.warning"));
  };

  return (
    <div className="max-w-4xl space-y-8">
      {/* Tabs 导航 */}
      <Tabs defaultValue={initialTab} className="w-full">
        <div className="border-b border-border pb-2">
          <TabsList className="h-auto gap-1 bg-transparent p-0">
            <TabsTrigger
              value="account"
              className="rounded-md border border-transparent px-4 py-2 data-[state=active]:border-primary/20 data-[state=active]:bg-primary/10 data-[state=active]:text-primary data-[state=active]:shadow-none"
            >
              {tTabs("account")}
            </TabsTrigger>
            <TabsTrigger
              value="security"
              className="rounded-md border border-transparent px-4 py-2 data-[state=active]:border-primary/20 data-[state=active]:bg-primary/10 data-[state=active]:text-primary data-[state=active]:shadow-none"
            >
              {tTabs("security")}
            </TabsTrigger>
            <TabsTrigger
              value="billing"
              className="rounded-md border border-transparent px-4 py-2 data-[state=active]:border-primary/20 data-[state=active]:bg-primary/10 data-[state=active]:text-primary data-[state=active]:shadow-none"
            >
              {tTabs("billing")}
            </TabsTrigger>
            <TabsTrigger
              value="usage"
              className="rounded-md border border-transparent px-4 py-2 data-[state=active]:border-primary/20 data-[state=active]:bg-primary/10 data-[state=active]:text-primary data-[state=active]:shadow-none"
            >
              {tTabs("usage")}
            </TabsTrigger>
            <TabsTrigger
              value="tools"
              className="rounded-md border border-transparent px-4 py-2 data-[state=active]:border-primary/20 data-[state=active]:bg-primary/10 data-[state=active]:text-primary data-[state=active]:shadow-none"
            >
              {tTabs("tools")}
            </TabsTrigger>
          </TabsList>
        </div>

        {/* Account Tab 内容 */}
        <TabsContent value="account" className="mt-8 space-y-10 pl-4">
          {/* General Section */}
          <section className="space-y-6">
            {/* Section Header with Save Button */}
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-xl font-semibold">{t("general.title")}</h2>
                <p className="text-sm text-muted-foreground">
                  {t("general.description")}
                </p>
              </div>
              <Button
                type="submit"
                form="profile-form"
                size="sm"
                disabled={isPending}
              >
                {isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                {t("general.save")}
              </Button>
            </div>

            {/* Form */}
            <Form {...form}>
              <form
                id="profile-form"
                onSubmit={form.handleSubmit(onSubmit)}
                className="space-y-6"
              >
                {/* Name Field */}
                <FormField
                  control={form.control}
                  name="name"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t("general.name")}</FormLabel>
                      <FormControl>
                        <Input
                          placeholder={t("general.namePlaceholder")}
                          disabled={isPending}
                          className="max-w-md"
                          {...field}
                        />
                      </FormControl>
                      <FormDescription>
                        {t("general.nameDescription")}
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                {/* Email Field (Read-only) */}
                <div className="space-y-2">
                  <label
                    className="text-sm font-medium leading-none"
                    htmlFor="settings-email"
                  >
                    {t("general.email")}
                  </label>
                  <Input
                    id="settings-email"
                    type="email"
                    value={user.email}
                    disabled
                    className="max-w-md bg-muted"
                  />
                  <p className="text-sm text-muted-foreground">
                    {t("general.emailDescription")}
                  </p>
                </div>
              </form>
            </Form>
          </section>

          <Separator />

          {/* Avatar Section */}
          <section className="space-y-6">
            <div>
              <h2 className="text-xl font-semibold">{t("avatar.title")}</h2>
              <p className="text-sm text-muted-foreground">
                {t("avatar.description")}
              </p>
            </div>

            <div className="flex flex-col items-center space-y-4">
              {/* 隐藏的文件输入 */}
              <input
                ref={fileInputRef}
                type="file"
                accept={ALLOWED_IMAGE_TYPES.join(",")}
                className="hidden"
                onChange={handleFileChange}
                disabled={isUploadingAvatar}
              />

              {/* 可点击的头像 */}
              <button
                type="button"
                onClick={handleAvatarClick}
                disabled={isUploadingAvatar}
                className="group relative cursor-pointer disabled:cursor-not-allowed"
              >
                <Avatar className="h-24 w-24 transition-opacity group-hover:opacity-80 group-disabled:opacity-60">
                  <AvatarImage src={currentAvatarUrl} alt={user.name} />
                  <AvatarFallback className="bg-primary text-primary-foreground text-2xl">
                    {getInitials(user.name)}
                  </AvatarFallback>
                </Avatar>
                {/* Hover 遮罩 / 上传中状态 */}
                <div className="absolute inset-0 flex items-center justify-center rounded-full bg-black/40 opacity-0 transition-opacity group-hover:opacity-100 group-disabled:opacity-100">
                  {isUploadingAvatar ? (
                    <Loader2 className="h-6 w-6 text-white animate-spin" />
                  ) : (
                    <Camera className="h-6 w-6 text-white" />
                  )}
                </div>
              </button>

              <p className="text-sm text-muted-foreground">
                {isUploadingAvatar
                  ? t("avatar.uploading")
                  : t("avatar.supportedFormats", {
                      size: MAX_FILE_SIZE / 1024 / 1024,
                    })}
              </p>
            </div>
          </section>

          <Separator />

          {/* Language Settings Section */}
          <section className="space-y-6">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-xl font-semibold">{t("language.title")}</h2>
                <p className="text-sm text-muted-foreground">
                  {t("language.description")}
                </p>
              </div>

              <Select
                value={locale}
                onValueChange={handleLanguageChange}
                disabled={isChangingLocale}
              >
                <SelectTrigger className="w-40">
                  <SelectValue placeholder={t("language.placeholder")} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="en">🇺🇸 English</SelectItem>
                  <SelectItem value="zh">🇨🇳 中文</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </section>

          <Separator />

          {/* Delete Account Section (Danger Zone) */}
          <section className="space-y-6">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-xl font-semibold text-destructive">
                  {t("deleteAccount.title")}
                </h2>
                <p className="text-sm text-muted-foreground">
                  {t("deleteAccount.description")}
                </p>
              </div>

              <Button
                type="button"
                variant="outline"
                className="border-destructive text-destructive hover:text-destructive hover:bg-destructive/10"
                onClick={handleDeleteAccount}
              >
                {t("deleteAccount.button")}
              </Button>
            </div>
          </section>
        </TabsContent>

        {/* Security Tab */}
        <TabsContent value="security" className="mt-8 pl-4">
          <SecuritySection />
        </TabsContent>

        {/* Billing Tab */}
        <TabsContent value="billing" className="mt-8 pl-4">
          <BillingSection />
        </TabsContent>

        {/* Usage Tab - 积分使用情况 */}
        <TabsContent value="usage" className="mt-8 pl-4">
          <CreditUsageSection />
        </TabsContent>

        {/* Tools Tab - 用户工具配置 */}
        <TabsContent value="tools" className="mt-8 pl-4">
          <UserToolConfigSection data={toolConfigData} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

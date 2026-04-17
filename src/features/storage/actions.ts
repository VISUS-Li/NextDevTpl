"use server";

/**
 * 存储系统 Server Actions
 *
 * 提供文件上传和管理的服务端操作接口
 */

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { adminAction, protectedAction } from "@/lib/safe-action";
import { getStorageProvider } from "./providers";
import { saveStoragePolicyConfig } from "./records";
import { ALLOWED_IMAGE_TYPES, type AllowedImageType } from "./types";

const withStorageAdminAction = (name: string) =>
  adminAction.metadata({ action: `storage.admin.${name}` });
const withStorageAction = (name: string) =>
  protectedAction.metadata({ action: `storage.${name}` });

const storagePrefixRuleSchema = z.object({
  prefix: z.string().min(1, "前缀不能为空"),
  retentionClass: z.enum(["permanent", "long_term", "temporary", "ephemeral"]),
  ttlHours: z.number().int().positive().optional(),
  purpose: z.string().min(1).optional(),
  enabled: z.boolean().optional(),
});

const saveStoragePolicySchema = z.object({
  projectKey: z.string().min(1).optional(),
  policy: z.object({
    ephemeralHours: z.number().int().positive(),
    temporaryDays: z.number().int().positive(),
    longTermDays: z.number().int().positive(),
    prefixRules: z.array(storagePrefixRuleSchema),
  }),
});

// ============================================
// 存储配置
// ============================================

/**
 * 获取头像存储桶名称
 */
function getAvatarsBucket(): string {
  const bucket = process.env.NEXT_PUBLIC_AVATARS_BUCKET_NAME;
  if (!bucket) {
    throw new Error("NEXT_PUBLIC_AVATARS_BUCKET_NAME 环境变量未设置");
  }
  return bucket;
}

/**
 * 允许的存储桶白名单
 *
 * 安全措施：只允许访问预定义的存储桶
 */
function getAllowedBuckets(): string[] {
  return [getAvatarsBucket()];
}

// ============================================
// 上传 URL Actions
// ============================================

/**
 * 保存平台级对象存储策略。
 */
export const saveStoragePolicyAction = withStorageAdminAction("savePolicy")
  .schema(saveStoragePolicySchema)
  .action(async ({ parsedInput, ctx }) => {
    const revision = await saveStoragePolicyConfig({
      actorId: ctx.userId,
      policy: {
        ephemeralHours: parsedInput.policy.ephemeralHours,
        temporaryDays: parsedInput.policy.temporaryDays,
        longTermDays: parsedInput.policy.longTermDays,
        prefixRules: parsedInput.policy.prefixRules.map((item) => ({
          prefix: item.prefix,
          retentionClass: item.retentionClass,
          ...(item.ttlHours === undefined ? {} : { ttlHours: item.ttlHours }),
          ...(item.purpose === undefined ? {} : { purpose: item.purpose }),
          ...(item.enabled === undefined ? {} : { enabled: item.enabled }),
        })),
      },
      ...(parsedInput.projectKey ? { projectKey: parsedInput.projectKey } : {}),
    });

    revalidatePath("/admin/storage");
    revalidatePath("/admin/tool-config");

    return {
      message: "存储策略已保存",
      revision,
    };
  });

/**
 * 获取签名上传 URL
 *
 * 受保护的 Action - 需要用户登录
 * 客户端使用此 URL 直接上传文件到存储
 */
export const getSignedUploadUrlAction = withStorageAction("getSignedUploadUrl")
  .schema(
    z.object({
      /** 文件键名 (完整路径，如 avatars/user-123.jpg) */
      key: z
        .string()
        .min(1, "文件键名不能为空")
        .max(255, "文件键名过长")
        .regex(/^[a-zA-Z0-9\-/.]+$/, "文件键名包含非法字符"),
      /** 文件 MIME 类型 */
      contentType: z.enum(
        ["image/jpeg", "image/png", "image/gif", "image/webp"],
        {
          message: `只支持以下文件类型: ${ALLOWED_IMAGE_TYPES.join(", ")}`,
        }
      ),
      /** 存储桶名称 (可选，默认使用头像桶) */
      bucket: z.string().optional(),
    })
  )
  .action(async ({ parsedInput, ctx }) => {
    const { key, contentType, bucket: inputBucket } = parsedInput;
    const { userId } = ctx;

    // 确定使用的存储桶
    const bucket = inputBucket ?? getAvatarsBucket();

    // 安全检查：验证存储桶在白名单中
    const allowedBuckets = getAllowedBuckets();
    if (!allowedBuckets.includes(bucket)) {
      throw new Error("不允许访问该存储桶");
    }

    // 安全检查：确保用户只能上传自己的文件
    // 文件键名必须包含用户 ID
    if (!key.includes(userId)) {
      throw new Error("文件路径无效：必须包含用户 ID");
    }

    // 获取签名上传 URL
    const provider = getStorageProvider();
    const uploadUrl = await provider.getSignedUploadUrl(
      key,
      bucket,
      contentType as AllowedImageType
    );

    return {
      uploadUrl,
      key,
      bucket,
    };
  });

/**
 * 删除文件
 *
 * 受保护的 Action - 需要用户登录
 * 用户只能删除自己的文件
 */
export const deleteFileAction = withStorageAction("deleteFile")
  .schema(
    z.object({
      /** 文件键名 */
      key: z.string().min(1, "文件键名不能为空"),
      /** 存储桶名称 (可选，默认使用头像桶) */
      bucket: z.string().optional(),
    })
  )
  .action(async ({ parsedInput, ctx }) => {
    const { key, bucket: inputBucket } = parsedInput;
    const { userId } = ctx;

    // 确定使用的存储桶
    const bucket = inputBucket ?? getAvatarsBucket();

    // 安全检查：验证存储桶在白名单中
    const allowedBuckets = getAllowedBuckets();
    if (!allowedBuckets.includes(bucket)) {
      throw new Error("不允许访问该存储桶");
    }

    // 安全检查：确保用户只能删除自己的文件
    if (!key.includes(userId)) {
      throw new Error("无权删除此文件");
    }

    // 删除文件
    const provider = getStorageProvider();
    await provider.deleteObject(key, bucket);

    return {
      success: true,
      key,
    };
  });

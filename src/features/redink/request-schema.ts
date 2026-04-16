import { z } from "zod";

/**
 * RedInk 文本片段。
 */
const textPartSchema = z.object({
  type: z.literal("text"),
  text: z.string().trim().min(1),
});

/**
 * RedInk 图片 URL 片段。
 */
const imageUrlPartSchema = z.object({
  type: z.literal("image_url"),
  imageUrl: z.string().url(),
  detail: z.enum(["auto", "low", "high"]).optional(),
});

/**
 * RedInk 图片资源片段。
 */
const imageAssetPartSchema = z.object({
  type: z.literal("image_asset"),
  bucket: z.string().trim().min(1).max(120),
  key: z.string().trim().min(1).max(500),
  detail: z.enum(["auto", "low", "high"]).optional(),
});

/**
 * RedInk 音频 URL 片段。
 */
const audioUrlPartSchema = z.object({
  type: z.literal("audio_url"),
  audioUrl: z.string().url(),
  format: z.string().trim().min(1).max(40).optional(),
});

/**
 * RedInk 音频资源片段。
 */
const audioAssetPartSchema = z.object({
  type: z.literal("audio_asset"),
  bucket: z.string().trim().min(1).max(120),
  key: z.string().trim().min(1).max(500),
  format: z.string().trim().min(1).max(40).optional(),
});

/**
 * RedInk 视频 URL 片段。
 */
const videoUrlPartSchema = z.object({
  type: z.literal("video_url"),
  videoUrl: z.string().url(),
});

/**
 * RedInk 视频资源片段。
 */
const videoAssetPartSchema = z.object({
  type: z.literal("video_asset"),
  bucket: z.string().trim().min(1).max(120),
  key: z.string().trim().min(1).max(500),
});

/**
 * RedInk 文件资源片段。
 */
const fileAssetPartSchema = z.object({
  type: z.literal("file_asset"),
  bucket: z.string().trim().min(1).max(120),
  key: z.string().trim().min(1).max(500),
  filename: z.string().trim().min(1).max(255).optional(),
  mimeType: z.string().trim().min(1).max(120).optional(),
});

/**
 * RedInk 消息片段联合类型。
 */
export const redinkMessagePartSchema = z.discriminatedUnion("type", [
  textPartSchema,
  imageUrlPartSchema,
  imageAssetPartSchema,
  audioUrlPartSchema,
  audioAssetPartSchema,
  videoUrlPartSchema,
  videoAssetPartSchema,
  fileAssetPartSchema,
]);

/**
 * RedInk 标准消息结构。
 */
export const redinkMessageSchema = z.object({
  role: z.enum(["system", "user", "assistant"]),
  content: z.union([
    z.string().min(1),
    z.array(redinkMessagePartSchema).min(1),
  ]),
});

/**
 * RedInk 支持 input 或 messages 两种输入方式。
 */
export const redinkInputSchema = z.union([
  z.string().min(1),
  z.array(redinkMessageSchema).min(1),
]);

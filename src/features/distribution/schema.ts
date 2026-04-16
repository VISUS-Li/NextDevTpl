import { z } from "zod";

/**
 * 提现申请表单校验
 */
export const createDistributionWithdrawalSchema = z.object({
  amount: z.number().int().min(1, "提现金额必须大于 0"),
  feeAmount: z.number().int().min(0, "手续费不能小于 0"),
  channel: z.string().trim().min(1, "请选择收款渠道").max(40, "渠道名称过长"),
  accountName: z.string().trim().min(1, "请输入收款人").max(80, "收款人名称过长"),
  accountNo: z.string().trim().min(1, "请输入收款账号").max(120, "收款账号过长"),
  note: z.string().trim().max(200, "备注最多 200 个字符").optional(),
});

/**
 * 管理端提现审核校验
 */
export const reviewDistributionWithdrawalSchema = z.object({
  requestId: z.string().min(1, "申请记录不能为空"),
  decision: z.enum(["reject", "paid"]),
  note: z.string().trim().max(200, "备注最多 200 个字符").optional(),
});

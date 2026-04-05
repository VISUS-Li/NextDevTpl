import { redirect } from "next/navigation";

/**
 * 积分页入口页
 *
 * 当前积分详情已经并入设置页 usage 标签
 */
export default function CreditsPage() {
  redirect("/dashboard/settings?tab=usage");
}

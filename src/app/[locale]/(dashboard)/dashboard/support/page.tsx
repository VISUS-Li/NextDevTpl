import { desc, eq } from "drizzle-orm";
import { Plus, Ticket } from "lucide-react";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { db } from "@/db";
import { ticket } from "@/db/schema";
import {
  ticketCategories,
  ticketPriorities,
  ticketStatuses,
} from "@/features/support/schemas";
import { Link } from "@/i18n/routing";
import { getServerSession } from "@/lib/auth/server";

/**
 * 用户工单列表页面
 *
 * 展示用户提交的所有支持工单
 */
export default async function SupportPage() {
  const supportT = await getTranslations("Support");

  // 获取当前用户会话
  const session = await getServerSession();
  if (!session?.user) {
    redirect("/sign-in?reason=session-expired");
  }

  // 获取用户的工单列表
  const tickets = await db
    .select()
    .from(ticket)
    .where(eq(ticket.userId, session.user.id))
    .orderBy(desc(ticket.createdAt));

  /**
   * 获取状态徽章样式
   */
  const getStatusBadge = (status: string) => {
    const statusConfig = ticketStatuses.find((s) => s.value === status);
    const colorMap: Record<string, string> = {
      open: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-300",
      in_progress:
        "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-300",
      resolved:
        "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300",
      closed: "bg-gray-100 text-gray-800 dark:bg-gray-900 dark:text-gray-300",
    };
    return (
      <Badge
        className={colorMap[status] || colorMap.closed}
        variant="secondary"
      >
        {statusConfig?.labelKey ? supportT(statusConfig.labelKey) : status}
      </Badge>
    );
  };

  /**
   * 获取优先级徽章样式
   */
  const getPriorityBadge = (priority: string) => {
    const priorityConfig = ticketPriorities.find((p) => p.value === priority);
    const colorMap: Record<string, string> = {
      low: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300",
      medium:
        "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-300",
      high: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-300",
    };
    return (
      <Badge
        className={colorMap[priority] || colorMap.medium}
        variant="secondary"
      >
        {priorityConfig?.labelKey
          ? supportT(priorityConfig.labelKey)
          : priority}
      </Badge>
    );
  };

  /**
   * 获取类别标签
   */
  const getCategoryLabel = (category: string) => {
    const categoryConfig = ticketCategories.find((c) => c.value === category);
    return categoryConfig?.labelKey
      ? supportT(categoryConfig.labelKey)
      : category;
  };

  return (
    <div className="space-y-6">
      {/* 页面标题 */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">
            {supportT("list.title")}
          </h2>
          <p className="text-muted-foreground">
            {supportT("list.description")}
          </p>
        </div>
        <Link href="/dashboard/support/new">
          <Button>
            <Plus className="mr-2 h-4 w-4" />
            {supportT("list.create")}
          </Button>
        </Link>
      </div>

      {/* 工单列表 */}
      {tickets.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <Ticket className="h-12 w-12 text-muted-foreground mb-4" />
            <h3 className="text-lg font-medium">
              {supportT("list.emptyTitle")}
            </h3>
            <p className="text-muted-foreground mb-4">
              {supportT("list.emptyDescription")}
            </p>
            <Link href="/dashboard/support/new">
              <Button>
                <Plus className="mr-2 h-4 w-4" />
                {supportT("list.createFirst")}
              </Button>
            </Link>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {tickets.map((ticketItem) => (
            <Link
              key={ticketItem.id}
              href={`/dashboard/support/${ticketItem.id}`}
            >
              <Card className="hover:bg-muted/50 transition-colors cursor-pointer">
                <CardHeader className="pb-2">
                  <div className="flex items-start justify-between">
                    <div className="space-y-1">
                      <CardTitle className="text-base">
                        {ticketItem.subject}
                      </CardTitle>
                      <p className="text-sm text-muted-foreground">
                        {getCategoryLabel(ticketItem.category)} ·{" "}
                        {new Date(ticketItem.createdAt).toLocaleDateString(
                          supportT("locale") === "zh" ? "zh-CN" : "en-US"
                        )}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      {getPriorityBadge(ticketItem.priority)}
                      {getStatusBadge(ticketItem.status)}
                    </div>
                  </div>
                </CardHeader>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

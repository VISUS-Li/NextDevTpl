"use client";

import { ArrowLeft, Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { createTicketAction } from "@/features/support/actions";
import { ticketCategories, ticketPriorities } from "@/features/support/schemas";
import { Link, useRouter } from "@/i18n/routing";

/**
 * 新建工单页面
 *
 * 用户填写表单创建新的支持工单
 */
export default function NewTicketPage() {
  const router = useRouter();
  const t = useTranslations("Support");
  const [isLoading, setIsLoading] = useState(false);

  // 表单状态
  const [subject, setSubject] = useState("");
  const [category, setCategory] = useState<string>("other");
  const [priority, setPriority] = useState<string>("medium");
  const [message, setMessage] = useState("");

  /**
   * 处理表单提交
   */
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);

    try {
      const result = await createTicketAction({
        subject,
        category: category as
          | "billing"
          | "technical"
          | "bug"
          | "feature"
          | "other",
        priority: priority as "low" | "medium" | "high",
        message,
      });

      if (result?.data) {
        toast.success(t("toasts.ticketCreated"));
        router.push(`/dashboard/support/${result.data.ticketId}`);
      } else if (result?.serverError) {
        toast.error(result.serverError);
      }
    } catch (error) {
      toast.error(t("toasts.ticketCreateFailed"));
      console.error(error);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* 页面标题 */}
      <div className="flex items-center gap-4">
        <Link href="/dashboard/support">
          <Button variant="ghost" size="icon">
            <ArrowLeft className="h-4 w-4" />
          </Button>
        </Link>
        <div>
          <h2 className="text-2xl font-bold tracking-tight">
            {t("new.title")}
          </h2>
          <p className="text-muted-foreground">{t("new.description")}</p>
        </div>
      </div>

      {/* 工单表单 */}
      <Card>
        <CardHeader>
          <CardTitle>{t("new.formTitle")}</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-6">
            {/* 主题 */}
            <div className="space-y-2">
              <Label htmlFor="subject">{t("new.subject")} *</Label>
              <Input
                id="subject"
                placeholder={t("new.subjectPlaceholder")}
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                required
                minLength={5}
                maxLength={200}
              />
            </div>

            {/* 类别和优先级 */}
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="category">{t("new.category")}</Label>
                <Select value={category} onValueChange={setCategory}>
                  <SelectTrigger id="category">
                    <SelectValue placeholder={t("new.categoryPlaceholder")} />
                  </SelectTrigger>
                  <SelectContent>
                    {ticketCategories.map((cat) => (
                      <SelectItem key={cat.value} value={cat.value}>
                        {t(cat.labelKey)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="priority">{t("new.priority")}</Label>
                <Select value={priority} onValueChange={setPriority}>
                  <SelectTrigger id="priority">
                    <SelectValue placeholder={t("new.priorityPlaceholder")} />
                  </SelectTrigger>
                  <SelectContent>
                    {ticketPriorities.map((pri) => (
                      <SelectItem key={pri.value} value={pri.value}>
                        {t(pri.labelKey)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* 详细描述 */}
            <div className="space-y-2">
              <Label htmlFor="message">{t("new.message")} *</Label>
              <Textarea
                id="message"
                placeholder={t("new.messagePlaceholder")}
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                required
                minLength={10}
                maxLength={5000}
                rows={8}
              />
              <p className="text-xs text-muted-foreground">
                {t("reply.counter", { count: message.length })}
              </p>
            </div>

            {/* 提交按钮 */}
            <div className="flex justify-end gap-4">
              <Link href="/dashboard/support">
                <Button type="button" variant="outline">
                  {t("new.cancel")}
                </Button>
              </Link>
              <Button type="submit" disabled={isLoading}>
                {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                {t("new.submit")}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}

"use client";

import { useState } from "react";
import { useAction } from "next-safe-action/hooks";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { saveAdminToolConfigAction } from "@/features/tool-config/actions";

type AdminToolConfigField = {
  fieldKey: string;
  label: string;
  description: string | null;
  group: string;
  type: "string" | "textarea" | "number" | "boolean" | "select" | "json" | "secret";
  value?: unknown;
  secretSet?: boolean;
  source: string;
  options: unknown;
  required: boolean;
  editable: boolean;
};

type AdminToolConfig = {
  tool: {
    toolKey: string;
    name: string;
    description: string | null;
    enabled: boolean;
  };
  editor: {
    projectKey: string;
    revision: number;
    fields: AdminToolConfigField[];
  };
};

interface AdminToolConfigViewProps {
  data: {
    project: {
      key: string;
      name: string;
      configRevision: number;
    };
    toolConfigs: AdminToolConfig[];
  };
}

/**
 * 管理员工具配置页面
 */
export function AdminToolConfigView({ data }: AdminToolConfigViewProps) {
  const [formValues, setFormValues] = useState(() => createInitialValues(data));
  const { execute, isPending } = useAction(saveAdminToolConfigAction, {
    onSuccess: ({ data: result }) => {
      toast.success(result?.message ?? "工具配置已保存");
    },
    onError: ({ error }) => {
      toast.error(error.serverError ?? "工具配置保存失败");
    },
  });

  const firstTool = data.toolConfigs[0]?.tool.toolKey ?? "";

  /**
   * 更新当前工具字段值
   */
  const updateFieldValue = (toolKey: string, fieldKey: string, value: string) => {
    setFormValues((current) => ({
      ...current,
      [toolKey]: {
        ...(current[toolKey] ?? {}),
        [fieldKey]: value,
      },
    }));
  };

  /**
   * 提交当前工具配置
   */
  const submitToolConfig = (toolConfig: AdminToolConfig) => {
    const values = Object.fromEntries(
      toolConfig.editor.fields
        .map((field) => {
          const rawValue = formValues[toolConfig.tool.toolKey]?.[field.fieldKey] ?? "";
          if (field.type === "secret" && rawValue === "") {
            return null;
          }
          return [field.fieldKey, parseFieldValue(field, rawValue)];
        })
        .filter((entry): entry is [string, string | number | boolean | null] =>
          Array.isArray(entry)
        )
    );

    execute({
      projectKey: data.project.key,
      tool: toolConfig.tool.toolKey,
      values,
      clearSecrets: [],
    });
  };

  return (
    <div className="space-y-6 p-6">
      <div>
        <p className="text-sm text-muted-foreground">项目：{data.project.name}</p>
        <h1 className="text-2xl font-semibold tracking-tight">工具配置</h1>
        <p className="text-sm text-muted-foreground">
          为每个工具设置管理员默认配置，用户只会看到允许个人覆盖的字段。
        </p>
      </div>

      <Tabs defaultValue={firstTool} className="space-y-4">
        <TabsList>
          {data.toolConfigs.map(({ tool }) => (
            <TabsTrigger key={tool.toolKey} value={tool.toolKey}>
              {tool.name}
            </TabsTrigger>
          ))}
        </TabsList>

        {data.toolConfigs.map((toolConfig) => (
          <TabsContent key={toolConfig.tool.toolKey} value={toolConfig.tool.toolKey}>
            <Card>
              <CardHeader>
                <div className="flex flex-wrap items-center gap-2">
                  <CardTitle>{toolConfig.tool.name}</CardTitle>
                  <Badge variant={toolConfig.tool.enabled ? "default" : "secondary"}>
                    {toolConfig.tool.enabled ? "已启用" : "已停用"}
                  </Badge>
                  <Badge variant="outline">版本 {toolConfig.editor.revision}</Badge>
                </div>
                <CardDescription>
                  {toolConfig.tool.description ?? "配置该工具的默认运行参数"}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                {["ai", "tool", "advanced"].map((group) => {
                  const fields = toolConfig.editor.fields.filter(
                    (field) => field.group === group
                  );
                  if (fields.length === 0) return null;

                  return (
                    <div key={group} className="space-y-4">
                      <h2 className="text-base font-medium">{getGroupLabel(group)}</h2>
                      <div className="grid gap-4 md:grid-cols-2">
                        {fields.map((field) => (
                          <div key={field.fieldKey} className="space-y-2">
                            <Label htmlFor={`${toolConfig.tool.toolKey}-${field.fieldKey}`}>
                              {field.label}
                              {field.required ? " *" : ""}
                            </Label>
                            {renderFieldInput({
                              field,
                              toolKey: toolConfig.tool.toolKey,
                              value:
                                formValues[toolConfig.tool.toolKey]?.[field.fieldKey] ?? "",
                              updateFieldValue,
                            })}
                            {field.description ? (
                              <p className="text-xs text-muted-foreground">
                                {field.description}
                              </p>
                            ) : null}
                            {field.type === "secret" && field.secretSet ? (
                              <p className="text-xs text-muted-foreground">
                                已设置密钥，留空不会覆盖旧值。
                              </p>
                            ) : null}
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })}

                <Button
                  type="button"
                  disabled={isPending}
                  onClick={() => submitToolConfig(toolConfig)}
                >
                  保存 {toolConfig.tool.name} 配置
                </Button>
              </CardContent>
            </Card>
          </TabsContent>
        ))}
      </Tabs>
    </div>
  );
}

function createInitialValues(data: AdminToolConfigViewProps["data"]) {
  return Object.fromEntries(
    data.toolConfigs.map((toolConfig) => [
      toolConfig.tool.toolKey,
      Object.fromEntries(
        toolConfig.editor.fields.map((field) => [
          field.fieldKey,
          field.type === "secret" ? "" : stringifyFieldValue(field.value),
        ])
      ),
    ])
  );
}

function stringifyFieldValue(value: unknown) {
  if (value === undefined || value === null) return "";
  if (typeof value === "string") return value;
  return JSON.stringify(value);
}

function parseFieldValue(field: AdminToolConfigField, value: string) {
  if (value === "") return null;
  if (field.type === "number") return Number(value);
  if (field.type === "boolean") return value === "true";
  if (field.type === "json") return JSON.parse(value) as Record<string, unknown>;
  return value;
}

function getGroupLabel(group: string) {
  if (group === "ai") return "AI 配置";
  if (group === "advanced") return "高级配置";
  return "工具配置";
}

function renderFieldInput(params: {
  field: AdminToolConfigField;
  toolKey: string;
  value: string;
  updateFieldValue: (toolKey: string, fieldKey: string, value: string) => void;
}) {
  const { field, toolKey, value, updateFieldValue } = params;
  const id = `${toolKey}-${field.fieldKey}`;
  const onValueChange = (nextValue: string) =>
    updateFieldValue(toolKey, field.fieldKey, nextValue);

  if (field.type === "textarea" || field.type === "json") {
    return (
      <Textarea
        id={id}
        value={value}
        onChange={(event) => onValueChange(event.target.value)}
      />
    );
  }

  if (field.type === "select") {
    const options = Array.isArray(field.options) ? field.options : [];
    return (
      <Select value={value} onValueChange={onValueChange}>
        <SelectTrigger id={id}>
          <SelectValue placeholder="请选择" />
        </SelectTrigger>
        <SelectContent>
          {options.map((option) => (
            <SelectItem key={String(option)} value={String(option)}>
              {String(option)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    );
  }

  if (field.type === "boolean") {
    return (
      <Select value={value || "false"} onValueChange={onValueChange}>
        <SelectTrigger id={id}>
          <SelectValue placeholder="请选择" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="true">是</SelectItem>
          <SelectItem value="false">否</SelectItem>
        </SelectContent>
      </Select>
    );
  }

  return (
    <Input
      id={id}
      type={field.type === "secret" ? "password" : "text"}
      value={value}
      placeholder={field.type === "secret" ? "留空保持不变" : undefined}
      onChange={(event) => onValueChange(event.target.value)}
    />
  );
}

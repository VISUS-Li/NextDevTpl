"use client";

import { useAction } from "next-safe-action/hooks";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
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
import { saveUserToolConfigAction } from "@/features/tool-config/actions";

type UserToolConfigField = {
  fieldKey: string;
  label: string;
  settingLabel: string;
  description: string | null;
  group: string;
  type:
    | "string"
    | "textarea"
    | "number"
    | "boolean"
    | "select"
    | "json"
    | "secret";
  value?: unknown;
  secretSet?: boolean;
  source: string;
  options: unknown;
  required: boolean;
  editable: boolean;
};

type UserToolConfig = {
  tool: {
    toolKey: string;
    name: string;
    description: string | null;
  };
  editor: {
    revision: number;
    fields: UserToolConfigField[];
  };
};

interface UserToolConfigSectionProps {
  data: {
    project: {
      key: string;
      name: string;
    };
    toolConfigs: UserToolConfig[];
  };
}

/**
 * 用户工具配置设置区块
 */
export function UserToolConfigSection({ data }: UserToolConfigSectionProps) {
  const [formValues, setFormValues] = useState(() => createInitialValues(data));
  const { execute, isPending } = useAction(saveUserToolConfigAction, {
    onSuccess: ({ data: result }) => {
      toast.success(result?.message ?? "我的工具配置已保存");
    },
    onError: ({ error }) => {
      toast.error(error.serverError ?? "工具配置保存失败");
    },
  });
  const firstTool = data.toolConfigs[0]?.tool.toolKey ?? "";

  /**
   * 更新当前字段输入值
   */
  const updateFieldValue = (
    toolKey: string,
    fieldKey: string,
    value: string
  ) => {
    setFormValues((current) => ({
      ...current,
      [toolKey]: {
        ...(current[toolKey] ?? {}),
        [fieldKey]: value,
      },
    }));
  };

  /**
   * 提交用户自己的工具配置
   */
  const submitToolConfig = (toolConfig: UserToolConfig) => {
    const values = Object.fromEntries(
      toolConfig.editor.fields
        .map((field) => {
          const rawValue =
            formValues[toolConfig.tool.toolKey]?.[field.fieldKey] ?? "";
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

  if (data.toolConfigs.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>工具配置</CardTitle>
          <CardDescription>当前没有可由用户设置的工具字段。</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <section className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold">工具配置</h2>
        <p className="text-sm text-muted-foreground">
          为每个工具设置你自己的 API
          Key、模型或提示词；未设置时使用管理员默认值。
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
          <TabsContent
            key={toolConfig.tool.toolKey}
            value={toolConfig.tool.toolKey}
          >
            <Card>
              <CardHeader>
                <CardTitle>{toolConfig.tool.name}</CardTitle>
                <CardDescription>
                  {toolConfig.tool.description ?? "设置该工具的个人参数"}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                {getGroupOrder(toolConfig.editor.fields).map((group) => {
                  const fields = toolConfig.editor.fields.filter(
                    (field) => field.group === group
                  );
                  if (fields.length === 0) return null;

                  return (
                    <div key={group} className="space-y-4">
                      <h3 className="text-base font-medium">
                        {getGroupLabel(group)}
                      </h3>
                      <div className="grid gap-4 md:grid-cols-2">
                        {fields.map((field) => (
                          <div key={field.fieldKey} className="space-y-2">
                            <Label
                              htmlFor={`${toolConfig.tool.toolKey}-${field.fieldKey}`}
                              className="flex flex-col gap-1"
                            >
                              <span>
                                {field.settingLabel}
                                {field.required ? " *" : ""}
                              </span>
                              {field.settingLabel !== field.label ? (
                                <span className="text-xs font-normal text-muted-foreground">
                                  槽位：{field.label}
                                </span>
                              ) : null}
                            </Label>
                            {renderFieldInput({
                              field,
                              toolKey: toolConfig.tool.toolKey,
                              value:
                                formValues[toolConfig.tool.toolKey]?.[
                                  field.fieldKey
                                ] ?? "",
                              updateFieldValue,
                            })}
                            <p className="text-xs text-muted-foreground">
                              {getFieldHelpText(field)}
                            </p>
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
                  保存我的 {toolConfig.tool.name} 配置
                </Button>
              </CardContent>
            </Card>
          </TabsContent>
        ))}
      </Tabs>
    </section>
  );
}

function createInitialValues(data: UserToolConfigSectionProps["data"]) {
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

function parseFieldValue(field: UserToolConfigField, value: string) {
  if (value === "") return null;
  if (field.type === "number") return Number(value);
  if (field.type === "boolean") return value === "true";
  if (field.type === "json")
    return JSON.parse(value) as Record<string, unknown>;
  return value;
}

function getGroupLabel(group: string) {
  if (group === "config") return "通用配置";
  if (group === "secret") return "密钥配置";
  if (group === "json") return "JSON 配置";
  if (group === "text") return "文本配置";
  return group;
}

function getGroupOrder(fields: UserToolConfigField[]) {
  const groupOrder = ["config", "secret", "json", "text"];
  const availableGroups = new Set(fields.map((field) => field.group));
  return groupOrder.filter((group) => availableGroups.has(group));
}

function getFieldHelpText(field: UserToolConfigField) {
  if (field.type === "secret" && field.secretSet) {
    return "已设置密钥，留空不会覆盖旧值。";
  }
  if (field.source === "project_admin") {
    return "当前使用管理员默认值。";
  }
  return field.description ?? "保存后只影响你自己的工具运行配置。";
}

function renderFieldInput(params: {
  field: UserToolConfigField;
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

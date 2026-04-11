"use client";

import { useAction } from "next-safe-action/hooks";
import { useState } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
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
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { saveAdminToolConfigAction } from "@/features/tool-config/actions";
import { cn } from "@/lib/utils";

type AdminToolConfigField = {
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

type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

type JsonPath = Array<number | string>;

type JsonValueType =
  | "array"
  | "boolean"
  | "null"
  | "number"
  | "object"
  | "string";

/**
 * 管理员工具配置页面
 */
export function AdminToolConfigView({ data }: AdminToolConfigViewProps) {
  const [formValues, setFormValues] = useState(() => createInitialValues(data));
  const [jsonViewModes, setJsonViewModes] = useState<
    Record<string, "form" | "json">
  >({});
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
   * 切换 JSON 字段显示模式
   */
  const updateJsonViewMode = (
    toolKey: string,
    fieldKey: string,
    mode: "form" | "json"
  ) => {
    setJsonViewModes((current) => ({
      ...current,
      [`${toolKey}.${fieldKey}`]: mode,
    }));
  };

  /**
   * 提交当前工具配置
   */
  const submitToolConfig = (toolConfig: AdminToolConfig) => {
    let values: Record<string, string | number | boolean | null | JsonValue>;
    try {
      values = Object.fromEntries(
        toolConfig.editor.fields
          .map((field) => {
            const rawValue =
              formValues[toolConfig.tool.toolKey]?.[field.fieldKey] ?? "";
            // 空密钥和空下拉不应提交，否则会把未修改的字段写成无效值。
            if (
              (field.type === "secret" || field.type === "select") &&
              rawValue === ""
            ) {
              return null;
            }
            return [field.fieldKey, parseFieldValue(field, rawValue)];
          })
          .filter(
            (
              entry
            ): entry is [
              string,
              string | number | boolean | null | JsonValue,
            ] => Array.isArray(entry)
          )
      );
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "工具配置格式不正确，无法保存"
      );
      return;
    }

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
        <p className="text-sm text-muted-foreground">
          项目：{data.project.name}
        </p>
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
          <TabsContent
            key={toolConfig.tool.toolKey}
            value={toolConfig.tool.toolKey}
          >
            <Card>
              <CardHeader>
                <div className="flex flex-wrap items-center gap-2">
                  <CardTitle>{toolConfig.tool.name}</CardTitle>
                  <Badge
                    variant={toolConfig.tool.enabled ? "default" : "secondary"}
                  >
                    {toolConfig.tool.enabled ? "已启用" : "已停用"}
                  </Badge>
                  <Badge variant="outline">
                    版本 {toolConfig.editor.revision}
                  </Badge>
                </div>
                <CardDescription>
                  {toolConfig.tool.description ?? "配置该工具的默认运行参数"}
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
                      <h2 className="text-base font-medium">
                        {getGroupLabel(group)}
                      </h2>
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
                              jsonViewMode:
                                jsonViewModes[
                                  `${toolConfig.tool.toolKey}.${field.fieldKey}`
                                ] ?? "json",
                              updateJsonViewMode,
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
                  loading={isPending}
                  loadingText={`保存 ${toolConfig.tool.name} 配置中...`}
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
          field.type === "secret"
            ? ""
            : stringifyFieldValue(field.value, field.type === "json"),
        ])
      ),
    ])
  );
}

/**
 * 把配置值转换成表单可编辑字符串
 */
function stringifyFieldValue(value: unknown, pretty = false) {
  if (value === undefined || value === null) return "";
  if (typeof value === "string") return value;
  return JSON.stringify(value, null, pretty ? 2 : undefined);
}

/**
 * 根据字段类型还原提交值
 */
function parseFieldValue(field: AdminToolConfigField, value: string) {
  if (value === "") return null;
  if (field.type === "number") return Number(value);
  if (field.type === "boolean") return value === "true";
  if (field.type === "json") {
    try {
      return JSON.parse(value) as JsonValue;
    } catch {
      throw new Error(`${field.settingLabel} 不是有效的 JSON`);
    }
  }
  return value;
}

function getGroupLabel(group: string) {
  if (group === "config") return "通用配置";
  if (group === "secret") return "密钥配置";
  if (group === "json") return "JSON 配置";
  if (group === "text") return "文本配置";
  return group;
}

function getGroupOrder(fields: AdminToolConfigField[]) {
  const groupOrder = ["config", "secret", "json", "text"];
  const availableGroups = new Set(fields.map((field) => field.group));
  return groupOrder.filter((group) => availableGroups.has(group));
}

function renderFieldInput(params: {
  field: AdminToolConfigField;
  toolKey: string;
  value: string;
  updateFieldValue: (toolKey: string, fieldKey: string, value: string) => void;
  jsonViewMode: "form" | "json";
  updateJsonViewMode: (
    toolKey: string,
    fieldKey: string,
    mode: "form" | "json"
  ) => void;
}) {
  const {
    field,
    toolKey,
    value,
    updateFieldValue,
    jsonViewMode,
    updateJsonViewMode,
  } = params;
  const id = `${toolKey}-${field.fieldKey}`;
  const onValueChange = (nextValue: string) =>
    updateFieldValue(toolKey, field.fieldKey, nextValue);

  if (field.type === "textarea") {
    return (
      <Textarea
        id={id}
        value={value}
        onChange={(event) => onValueChange(event.target.value)}
      />
    );
  }

  if (field.type === "json") {
    return (
      <JsonFieldInput
        field={field}
        id={id}
        jsonViewMode={jsonViewMode}
        toolKey={toolKey}
        updateJsonViewMode={updateJsonViewMode}
        value={value}
        onValueChange={onValueChange}
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

/**
 * JSON 字段编辑器
 */
function JsonFieldInput(params: {
  field: AdminToolConfigField;
  id: string;
  jsonViewMode: "form" | "json";
  toolKey: string;
  updateJsonViewMode: (
    toolKey: string,
    fieldKey: string,
    mode: "form" | "json"
  ) => void;
  value: string;
  onValueChange: (nextValue: string) => void;
}) {
  const {
    field,
    id,
    jsonViewMode,
    toolKey,
    updateJsonViewMode,
    value,
    onValueChange,
  } = params;
  const parsedValue = parseJsonFieldValue(value);
  const hasValidJson = parsedValue !== undefined;

  return (
    <div className="space-y-3 rounded-lg border p-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="space-y-1">
          <p className="text-sm font-medium">JSON 编辑方式</p>
          <p className="text-xs text-muted-foreground">
            可直接逐项编辑，也可切换查看格式化 JSON
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span
            className={cn(
              "text-xs",
              jsonViewMode === "form"
                ? "text-foreground"
                : "text-muted-foreground"
            )}
          >
            表单
          </span>
          <Switch
            aria-label={`${field.settingLabel} JSON 视图切换`}
            checked={jsonViewMode === "json"}
            onCheckedChange={(checked) =>
              updateJsonViewMode(
                toolKey,
                field.fieldKey,
                checked ? "json" : "form"
              )
            }
          />
          <span
            className={cn(
              "text-xs",
              jsonViewMode === "json"
                ? "text-foreground"
                : "text-muted-foreground"
            )}
          >
            JSON
          </span>
        </div>
      </div>

      {jsonViewMode === "json" ? (
        <Textarea
          id={id}
          value={value}
          className="min-h-56 font-mono text-xs"
          onChange={(event) => onValueChange(event.target.value)}
        />
      ) : hasValidJson ? (
        <JsonValueEditor
          documentValue={parsedValue}
          value={parsedValue}
          path={[]}
          rootLabel={field.settingLabel}
          onChange={(nextValue) =>
            onValueChange(JSON.stringify(nextValue, null, 2))
          }
        />
      ) : (
        <div className="space-y-2 rounded-md border border-destructive/40 bg-destructive/5 p-3">
          <p className="text-sm font-medium text-destructive">
            当前 JSON 无法解析
          </p>
          <p className="text-xs text-muted-foreground">
            请切换到 JSON 视图修正格式后，再回到表单视图逐项编辑
          </p>
        </div>
      )}
    </div>
  );
}

/**
 * 递归渲染 JSON 值编辑器
 */
function JsonValueEditor(params: {
  documentValue: JsonValue;
  value: JsonValue;
  path: JsonPath;
  rootLabel: string;
  onChange: (nextValue: JsonValue) => void;
}) {
  const { documentValue, value, path, rootLabel, onChange } = params;
  const [draftKey, setDraftKey] = useState("");
  const [draftType, setDraftType] = useState<JsonValueType>("string");

  /**
   * 更新指定路径上的 JSON 值
   */
  const updateAtPath = (targetPath: JsonPath, nextValue: JsonValue) => {
    onChange(replaceJsonValueAtPath(documentValue, targetPath, nextValue));
  };

  /**
   * 删除指定路径上的 JSON 值
   */
  const removeAtPath = (targetPath: JsonPath) => {
    onChange(removeJsonValueAtPath(documentValue, targetPath));
  };

  /**
   * 变更对象字段名
   */
  const renameFieldKey = (
    targetPath: JsonPath,
    currentKey: string,
    nextKey: string
  ) => {
    const trimmedKey = nextKey.trim();
    if (!trimmedKey || trimmedKey === currentKey) return;
    onChange(
      renameJsonObjectKey(documentValue, targetPath, currentKey, trimmedKey)
    );
  };

  /**
   * 新增对象字段
   */
  const appendObjectField = (targetPath: JsonPath) => {
    const key = draftKey.trim();
    if (!key) return;
    const currentNode = getJsonValueAtPath(documentValue, targetPath);
    if (!isJsonObject(currentNode) || key in currentNode) return;
    updateAtPath(targetPath, {
      ...currentNode,
      [key]: createEmptyJsonValue(draftType),
    });
    setDraftKey("");
  };

  /**
   * 新增数组项
   */
  const appendArrayItem = (targetPath: JsonPath) => {
    const currentNode = getJsonValueAtPath(documentValue, targetPath);
    if (!Array.isArray(currentNode)) return;
    updateAtPath(targetPath, [...currentNode, createEmptyJsonValue(draftType)]);
  };

  if (Array.isArray(value)) {
    return (
      <div className="space-y-3 rounded-md border p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <p className="text-sm font-medium">
              {getJsonPathLabel(rootLabel, path)}
            </p>
            <p className="text-xs text-muted-foreground">
              数组，共 {value.length} 项
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Select
              value={draftType}
              onValueChange={(nextValue) =>
                setDraftType(nextValue as JsonValueType)
              }
            >
              <SelectTrigger className="w-32">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {JSON_VALUE_TYPE_OPTIONS.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => appendArrayItem(path)}
            >
              新增项
            </Button>
          </div>
        </div>

        <div className="space-y-3">
          {value.map((item, index) => {
            const itemPath = [...path, index];
            return (
              <div
                key={itemPath.join(".")}
                className="space-y-2 rounded-md border p-3"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="text-xs text-muted-foreground">
                    第 {index + 1} 项
                  </div>
                  <div className="flex items-center gap-2">
                    <JsonTypeSelect
                      value={getJsonValueType(item)}
                      onValueChange={(nextType) =>
                        updateAtPath(
                          itemPath,
                          convertJsonValueType(item, nextType)
                        )
                      }
                    />
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      onClick={() => removeAtPath(itemPath)}
                    >
                      删除
                    </Button>
                  </div>
                </div>
                <JsonValueEditor
                  documentValue={documentValue}
                  value={item}
                  path={itemPath}
                  rootLabel={rootLabel}
                  onChange={onChange}
                />
              </div>
            );
          })}
          {value.length === 0 ? (
            <p className="text-xs text-muted-foreground">当前数组为空</p>
          ) : null}
        </div>
      </div>
    );
  }

  if (isJsonObject(value)) {
    const entries = Object.entries(value);
    return (
      <div className="space-y-3 rounded-md border p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <p className="text-sm font-medium">
              {getJsonPathLabel(rootLabel, path)}
            </p>
            <p className="text-xs text-muted-foreground">
              对象，共 {entries.length} 个字段
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Input
              value={draftKey}
              className="w-36"
              placeholder="字段名"
              onChange={(event) => setDraftKey(event.target.value)}
            />
            <Select
              value={draftType}
              onValueChange={(nextValue) =>
                setDraftType(nextValue as JsonValueType)
              }
            >
              <SelectTrigger className="w-32">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {JSON_VALUE_TYPE_OPTIONS.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => appendObjectField(path)}
            >
              新增字段
            </Button>
          </div>
        </div>

        <div className="space-y-3">
          {entries.map(([key, itemValue]) => {
            const itemPath = [...path, key];
            return (
              <div
                key={itemPath.join(".")}
                className="space-y-2 rounded-md border p-3"
              >
                <div className="grid gap-2 md:grid-cols-[minmax(0,180px)_140px_auto]">
                  <Input
                    aria-label={`${getJsonPathLabel(rootLabel, itemPath)} 字段名`}
                    defaultValue={key}
                    onBlur={(event) =>
                      renameFieldKey(path, key, event.target.value)
                    }
                  />
                  <JsonTypeSelect
                    value={getJsonValueType(itemValue)}
                    onValueChange={(nextType) =>
                      updateAtPath(
                        itemPath,
                        convertJsonValueType(itemValue, nextType)
                      )
                    }
                  />
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={() => removeAtPath(itemPath)}
                  >
                    删除字段
                  </Button>
                </div>
                <JsonValueEditor
                  documentValue={documentValue}
                  value={itemValue}
                  path={itemPath}
                  rootLabel={rootLabel}
                  onChange={onChange}
                />
              </div>
            );
          })}
          {entries.length === 0 ? (
            <p className="text-xs text-muted-foreground">当前对象为空</p>
          ) : null}
        </div>
      </div>
    );
  }

  return (
    <JsonPrimitiveEditor
      rootLabel={rootLabel}
      path={path}
      value={value}
      onChange={(nextValue) => updateAtPath(path, nextValue)}
    />
  );
}

/**
 * 编辑 JSON 基础类型
 */
function JsonPrimitiveEditor(params: {
  rootLabel: string;
  path: JsonPath;
  value: boolean | null | number | string;
  onChange: (nextValue: JsonValue) => void;
}) {
  const { rootLabel, path, value, onChange } = params;
  const type = getJsonValueType(value);
  const pathLabel = getJsonPathLabel(rootLabel, path);

  return (
    <div className="space-y-2 rounded-md border border-dashed p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">{pathLabel}</p>
        <JsonTypeSelect
          value={type}
          onValueChange={(nextType) =>
            onChange(convertJsonValueType(value, nextType))
          }
        />
      </div>

      {type === "string" ? (
        <Input
          aria-label={`${pathLabel} 值`}
          value={String(value)}
          onChange={(event) => onChange(event.target.value)}
        />
      ) : null}

      {type === "number" ? (
        <Input
          aria-label={`${pathLabel} 值`}
          type="number"
          value={Number(value)}
          onChange={(event) => onChange(Number(event.target.value))}
        />
      ) : null}

      {type === "boolean" ? (
        <Select
          value={String(Boolean(value))}
          onValueChange={(nextValue) => onChange(nextValue === "true")}
        >
          <SelectTrigger aria-label={`${pathLabel} 值`}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="true">true</SelectItem>
            <SelectItem value="false">false</SelectItem>
          </SelectContent>
        </Select>
      ) : null}

      {type === "null" ? (
        <p className="text-xs text-muted-foreground">当前值为 null</p>
      ) : null}
    </div>
  );
}

function JsonTypeSelect(params: {
  value: JsonValueType;
  onValueChange: (nextType: JsonValueType) => void;
}) {
  const { value, onValueChange } = params;

  return (
    <Select
      value={value}
      onValueChange={(nextValue) => onValueChange(nextValue as JsonValueType)}
    >
      <SelectTrigger className="w-32">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {JSON_VALUE_TYPE_OPTIONS.map((option) => (
          <SelectItem key={option.value} value={option.value}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

const JSON_VALUE_TYPE_OPTIONS: Array<{ label: string; value: JsonValueType }> =
  [
    { value: "string", label: "文本" },
    { value: "number", label: "数字" },
    { value: "boolean", label: "布尔" },
    { value: "null", label: "空值" },
    { value: "object", label: "对象" },
    { value: "array", label: "数组" },
  ];

/**
 * 解析 JSON 字段内容
 */
function parseJsonFieldValue(value: string) {
  if (!value.trim()) return {} as JsonValue;

  try {
    return JSON.parse(value) as JsonValue;
  } catch {
    return undefined;
  }
}

function isJsonObject(value: JsonValue): value is { [key: string]: JsonValue } {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function getJsonValueAtPath(value: JsonValue, path: JsonPath): JsonValue {
  return path.reduce<JsonValue>((currentValue, segment) => {
    if (Array.isArray(currentValue) && typeof segment === "number") {
      return currentValue[segment] as JsonValue;
    }
    if (isJsonObject(currentValue) && typeof segment === "string") {
      return currentValue[segment] as JsonValue;
    }
    return currentValue;
  }, value);
}

/**
 * 替换指定路径的 JSON 值
 */
function replaceJsonValueAtPath(
  value: JsonValue,
  path: JsonPath,
  nextValue: JsonValue
): JsonValue {
  if (path.length === 0) return nextValue;

  const [head, ...rest] = path;
  if (Array.isArray(value) && typeof head === "number") {
    return value.map((item, index) =>
      index === head ? replaceJsonValueAtPath(item, rest, nextValue) : item
    );
  }
  if (isJsonObject(value) && typeof head === "string") {
    return {
      ...value,
      [head]: replaceJsonValueAtPath(value[head] as JsonValue, rest, nextValue),
    };
  }
  return value;
}

/**
 * 删除指定路径的 JSON 值
 */
function removeJsonValueAtPath(value: JsonValue, path: JsonPath): JsonValue {
  if (path.length === 0) return value;
  if (path.length === 1) {
    const [head] = path;
    if (Array.isArray(value) && typeof head === "number") {
      return value.filter((_, index) => index !== head);
    }
    if (isJsonObject(value) && typeof head === "string") {
      const nextValue = { ...value };
      delete nextValue[head];
      return nextValue;
    }
    return value;
  }

  const [head, ...rest] = path;
  if (Array.isArray(value) && typeof head === "number") {
    return value.map((item, index) =>
      index === head ? removeJsonValueAtPath(item, rest) : item
    );
  }
  if (isJsonObject(value) && typeof head === "string") {
    return {
      ...value,
      [head]: removeJsonValueAtPath(value[head] as JsonValue, rest),
    };
  }
  return value;
}

/**
 * 重命名对象字段
 */
function renameJsonObjectKey(
  value: JsonValue,
  path: JsonPath,
  currentKey: string,
  nextKey: string
): JsonValue {
  const target = getJsonValueAtPath(value, path);
  if (!isJsonObject(target) || nextKey in target) return value;

  const nextTarget = Object.fromEntries(
    Object.entries(target).map(([key, itemValue]) => [
      key === currentKey ? nextKey : key,
      itemValue,
    ])
  ) as JsonValue;

  return replaceJsonValueAtPath(value, path, nextTarget);
}

function getJsonValueType(value: JsonValue): JsonValueType {
  if (Array.isArray(value)) return "array";
  if (value === null) return "null";
  if (typeof value === "boolean") return "boolean";
  if (typeof value === "number") return "number";
  if (typeof value === "string") return "string";
  return "object";
}

/**
 * 创建指定类型的空 JSON 值
 */
function createEmptyJsonValue(type: JsonValueType): JsonValue {
  if (type === "array") return [];
  if (type === "boolean") return false;
  if (type === "null") return null;
  if (type === "number") return 0;
  if (type === "object") return {};
  return "";
}

/**
 * 切换 JSON 值类型时，尽量复用当前值
 */
function convertJsonValueType(
  value: JsonValue,
  nextType: JsonValueType
): JsonValue {
  if (nextType === getJsonValueType(value)) return value;
  if (nextType === "string") return typeof value === "string" ? value : "";
  if (nextType === "number")
    return typeof value === "number" ? value : Number(value) || 0;
  if (nextType === "boolean") return typeof value === "boolean" ? value : false;
  if (nextType === "null") return null;
  if (nextType === "array") return Array.isArray(value) ? value : [];
  return isJsonObject(value) ? value : {};
}

function getJsonPathLabel(rootLabel: string, path: JsonPath) {
  if (path.length === 0) return rootLabel;
  return `${rootLabel}.${path.join(".")}`;
}

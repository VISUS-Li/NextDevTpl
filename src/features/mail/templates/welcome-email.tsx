import {
  Body,
  Button,
  Container,
  Head,
  Heading,
  Hr,
  Html,
  Preview,
  Section,
  Text,
} from "@react-email/components";
import { Tailwind } from "@react-email/tailwind";

/**
 * 欢迎邮件模板
 *
 * 新用户注册成功后发送
 */

interface WelcomeEmailProps {
  /** 用户名称 */
  name: string;
  /** 仪表盘链接 */
  dashboardUrl: string;
}

/**
 * 欢迎邮件组件
 */
export function WelcomeEmail({ name, dashboardUrl }: WelcomeEmailProps) {
  return (
    <Html>
      <Head />
      <Preview>Welcome to tripai - Your account is ready.</Preview>
      <Tailwind>
        <Body className="mx-auto my-auto bg-white font-sans">
          <Container className="mx-auto my-10 max-w-xl rounded-lg border border-solid border-gray-200 p-8">
            {/* Logo / 品牌区域 */}
            <Section className="mb-8 text-center">
              <Heading className="m-0 text-2xl font-bold text-gray-900">
                tripai
              </Heading>
            </Section>

            {/* 主标题 */}
            <Heading className="mb-4 text-xl font-semibold text-gray-900">
              Welcome, {name}! 🎉
            </Heading>

            {/* 正文内容 */}
            <Text className="mb-4 text-base leading-relaxed text-gray-600">
              Your tripai account has been created successfully. You can now
              start managing tools, subscriptions, and customer access from one
              place.
            </Text>

            <Text className="mb-6 text-base leading-relaxed text-gray-600">
              As a welcome gift, free credits have been added to your account.
              Use them to explore the dashboard and your first product flows.
            </Text>

            {/* CTA 按钮 */}
            <Section className="mb-8 text-center">
              <Button
                href={dashboardUrl}
                className="inline-block rounded-md bg-violet-600 px-6 py-3 text-center text-sm font-semibold text-white no-underline"
              >
                Go to Dashboard
              </Button>
            </Section>

            {/* 快速入门提示 */}
            <Section className="mb-6 rounded-lg bg-gray-50 p-4">
              <Text className="m-0 mb-2 text-sm font-semibold text-gray-900">
                Quick Start Tips:
              </Text>
              <Text className="m-0 text-sm text-gray-600">
                • Add your first tool or subscription product
                <br />• Review pricing, checkout, and access settings
                <br />• Open the dashboard to manage users and orders
              </Text>
            </Section>

            <Hr className="my-6 border-gray-200" />

            {/* 页脚 */}
            <Text className="m-0 text-center text-xs text-gray-500">
              Need help? Reply to this email.
            </Text>
            <Text className="m-0 mt-2 text-center text-xs text-gray-400">
              © {new Date().getFullYear()} tripai. All rights reserved.
            </Text>
          </Container>
        </Body>
      </Tailwind>
    </Html>
  );
}

/**
 * 默认导出 - 用于 React Email 预览
 */
export default WelcomeEmail;

/**
 * 预览时的默认 Props
 */
WelcomeEmail.PreviewProps = {
  name: "John Doe",
  dashboardUrl: "https://tripai.icu/dashboard",
} satisfies WelcomeEmailProps;

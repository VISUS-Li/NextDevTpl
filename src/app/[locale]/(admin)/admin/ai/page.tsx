import { AdminAIGatewayView } from "@/features/ai-gateway/components/admin-ai-gateway-view";
import {
  getAIGatewayAdminPageData,
  getAIGatewayOverview,
} from "@/features/ai-gateway";

/**
 * AI 管理后台页面。
 */
export default async function AdminAIGatewayPage() {
  const [overview, pageData] = await Promise.all([
    getAIGatewayOverview(),
    getAIGatewayAdminPageData(),
  ]);

  return (
    <AdminAIGatewayView
      initialOverview={overview}
      initialProviders={pageData.providers}
      initialBindings={pageData.bindings}
      initialPricingRules={pageData.pricingRules}
      initialRequests={pageData.requests}
    />
  );
}

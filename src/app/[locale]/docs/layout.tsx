import { DocsLayout } from "fumadocs-ui/layouts/docs";
import { RootProvider } from "fumadocs-ui/provider/next";
import type { ReactNode } from "react";

import { Header } from "@/features/marketing/components";
import { docsSource } from "@/lib/source";

/**
 * 文档布局。
 */
export default async function Layout({ children }: { children: ReactNode }) {
  return (
    <div className="tripai-docs-page">
      <Header variant="docs" />
      <div className="pt-16">
        <RootProvider>
          <DocsLayout
            containerProps={{
              className: "tripai-docs-layout",
            }}
            tree={docsSource.pageTree}
            nav={{
              enabled: false,
            }}
            sidebar={{
              defaultOpenLevel: 1,
            }}
          >
            {children}
          </DocsLayout>
        </RootProvider>
      </div>
    </div>
  );
}

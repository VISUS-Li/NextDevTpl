import { Footer, Header } from "@/features/marketing/components";

export default async function MarketingLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-screen flex-col">
      <Header />
      <main className="flex-1 pb-28 md:pb-0">{children}</main>
      <Footer />
    </div>
  );
}

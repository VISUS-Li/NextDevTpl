import { Footer, Header } from "@/features/marketing/components";
import { getServerSession } from "@/lib/auth/server";

export default async function MarketingLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getServerSession();
  const user = session?.user ?? null;

  return (
    <div className="flex min-h-screen flex-col">
      <Header user={user} />
      <main className="flex-1 pb-28 md:pb-0">{children}</main>
      <Footer />
    </div>
  );
}

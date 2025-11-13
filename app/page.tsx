import { DashboardView } from "@/components/dashboard-view";
import { loadDashboardData } from "@/lib/core/dashboard-data";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function Home() {
  const data = await loadDashboardData({ refreshMode: "missing" });

  return (
    <div className="min-h-screen bg-gradient-to-b from-background via-background to-muted/40 py-10">
      <main className="mx-auto flex w-full max-w-6xl flex-col gap-8 px-4 md:px-8">
        <DashboardView initialData={data} />
      </main>
    </div>
  );
}

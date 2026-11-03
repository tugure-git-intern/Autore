import { DashboardOverview } from "@/components/dashboard-overview";

export default function DashboardPage() {
  return (
    <div>
      <h1 className="text-xl font-semibold tracking-tight text-ink">Dashboard</h1>
      <p className="mt-1 text-sm text-muted">Ringkasan status CI/CD Autore.</p>
      <DashboardOverview />
    </div>
  );
}
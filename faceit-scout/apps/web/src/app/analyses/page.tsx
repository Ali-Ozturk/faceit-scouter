import { AnalysisForm } from "./analysis-form";

export const dynamic = "force-dynamic";

export default function AnalysesPage() {
  return (
    <div className="space-y-8">
      <section>
        <h1 className="text-3xl font-bold">FACEIT match discovery</h1>
        <p className="mt-2 text-slate-600">
          Find historical matches where the current opposing lineup played together.
        </p>
      </section>
      <AnalysisForm />
    </div>
  );
}

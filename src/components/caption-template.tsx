"use client";

type CaptionTemplateProps = {
  problem: string;
  solution: string;
  materials: string;
  result: string;
};

export function CaptionTemplate({ problem, solution, materials, result }: CaptionTemplateProps) {
  const caption = `Problem: ${problem}\nSolution: ${solution}\nMaterials/Scope: ${materials}\nResult: ${result}`;

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-3">
      <p className="text-xs uppercase tracking-wide text-slate-500">Social Caption</p>
      <pre className="mt-2 whitespace-pre-wrap text-sm text-slate-700">{caption}</pre>
      <button
        type="button"
        className="mt-2 rounded-xl border border-slate-300 px-3 py-2 text-sm"
        onClick={() => navigator.clipboard.writeText(caption)}
      >
        Copy caption
      </button>
    </div>
  );
}

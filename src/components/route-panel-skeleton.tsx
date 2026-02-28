type RoutePanelSkeletonProps = {
  cards?: number;
  sections?: number;
};

export function RoutePanelSkeleton({ cards = 4, sections = 3 }: RoutePanelSkeletonProps) {
  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-slate-200 bg-white p-4">
        <div className="h-4 w-36 animate-pulse rounded bg-slate-200" />
        <div className="mt-3 grid grid-cols-2 gap-2">
          {Array.from({ length: cards }).map((_, index) => (
            <div key={index} className="h-20 animate-pulse rounded-xl bg-slate-100" />
          ))}
        </div>
      </div>
      {Array.from({ length: sections }).map((_, index) => (
        <div key={index} className="h-28 animate-pulse rounded-2xl border border-slate-200 bg-white" />
      ))}
    </div>
  );
}


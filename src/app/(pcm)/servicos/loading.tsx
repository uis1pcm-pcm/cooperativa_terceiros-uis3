import Skeleton from "@/components/Skeleton";

const PLACEHOLDER_ITEMS = Array.from({ length: 6 });

export default function ServicesListLoading() {
  return (
    <div className="container mx-auto max-w-6xl space-y-6 px-4 py-6">
      <div className="flex flex-col gap-4 rounded-2xl border bg-card/80 p-5 shadow-sm">
        <Skeleton className="h-6 w-48" />
        <Skeleton className="h-4 w-72" />
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {PLACEHOLDER_ITEMS.map((_, index) => (
          <div
            key={index}
            className="flex flex-col gap-4 rounded-2xl border border-dashed border-border/80 bg-muted/30 p-5 shadow-sm"
          >
            <div className="space-y-3">
              <div className="flex gap-2">
                <Skeleton className="h-5 w-24 rounded-full" />
                <Skeleton className="h-5 w-28 rounded-full" />
              </div>
              <Skeleton className="h-5 w-3/4" />
              <Skeleton className="h-4 w-2/3" />
            </div>
            <Skeleton className="h-2 w-full rounded-full" />
            <Skeleton className="h-8 w-full" />
          </div>
        ))}
      </div>
    </div>
  );
}

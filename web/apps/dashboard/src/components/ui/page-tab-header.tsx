import type { ComponentType, ReactNode } from "react";

export interface PageTabHeaderProps {
  title: string;
  description?: string;
  icon?: ComponentType<{ className?: string }>;
  action?: ReactNode;
  className?: string;
}

/**
 * Secondary Tab Card / Breadcrumb Area ala Google Cloud Console.
 * Berlatar putih bersih tanpa bingkai: sudut melengkung atas (rounded-t-xl) melebur ke kanvas
 * agar menyatu mulus dengan lembaran konten di bawahnya.
 */
export function PageTabHeader({
  title,
  description,
  icon: Icon,
  action,
  className = "",
}: PageTabHeaderProps) {
  return (
    <div
      data-testid="page-tab-header"
      className={`rounded-t-xl sm:rounded-t-2xl bg-white p-5 sm:p-6 ${className}`}
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          {Icon ? (
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-gray-200 bg-gray-50 text-[#545F72]">
              <Icon className="h-5 w-5" />
            </div>
          ) : null}
          <div>
            <h1 className="text-lg font-bold tracking-tight text-gray-900 sm:text-xl">
              {title}
            </h1>
            {description ? (
              <p className="mt-0.5 text-xs text-gray-500 sm:text-sm">{description}</p>
            ) : null}
          </div>
        </div>
        {action ? <div className="flex shrink-0 items-center gap-2">{action}</div> : null}
      </div>
    </div>
  );
}

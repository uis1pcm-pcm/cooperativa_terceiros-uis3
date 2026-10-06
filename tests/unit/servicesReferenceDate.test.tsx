import React from "react";
import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { act } from "react-dom/test-utils";
import { createRoot } from "react-dom/client";

// Alguns arquivos do app ainda são compilados com runtime JSX "classic" nos testes.
// Garantir que `React` exista no escopo global para evitar "React is not defined".
(globalThis as any).React = React;

let currentParams = new URLSearchParams("refDate=2025-11-24");
const replaceMock = vi.fn((target: string) => {
  const query = target.split("?")[1] ?? "";
  currentParams = new URLSearchParams(query);
});
const refreshMock = vi.fn();

const plannedMock = vi.hoisted(() =>
  vi.fn((_: unknown, reference?: unknown) => (reference instanceof Date ? reference.getUTCDate() : 0)),
);
const realMock = vi.hoisted(() => vi.fn(() => 33));

vi.mock("next/navigation", () => ({
  useSearchParams: () => ({
    get: (key: string) => currentParams.get(key),
    toString: () => currentParams.toString(),
  }),
  useRouter: () => ({ replace: replaceMock, refresh: refreshMock }),
  usePathname: () => "/servicos",
  useParams: () => ({}),
}));

vi.mock("next/link", () => ({
  default: ({ children, href }: { children: React.ReactNode; href?: string }) => (
    <a href={href}>{children}</a>
  ),
}));

vi.mock("next/dynamic", () => ({
  default: () => () => <div data-testid="dynamic-component" />,
}));

vi.mock("@/components/DeleteServiceButton", () => ({
  default: () => <div data-testid="delete-button" />,
}));

vi.mock("@/components/SCurveDeferred", () => ({
  __esModule: true,
  default: ({ metrics }: { metrics?: { plannedToDate?: number } }) => (
    <div data-testid="curve">{metrics?.plannedToDate ?? 0}%</div>
  ),
}));

vi.mock("@/components/ReferenceDateSelector", async () => {
  const React = await import("react");
  const navigation = await import("next/navigation");
  const useRouter = (navigation as any).useRouter as () => { replace: (url: string) => void; refresh: () => void };
  const usePathname = (navigation as any).usePathname as () => string;
  const useSearchParams = (navigation as any).useSearchParams as () => { toString: () => string };

  return {
    __esModule: true,
    default: ({ value }: { value: string }) => {
      const router = useRouter();
      const pathname = usePathname();
      const searchParams = useSearchParams();
      const handleChange = (event: React.ChangeEvent<HTMLInputElement>) => {
        const params = new URLSearchParams(searchParams?.toString());
        const newValue = event.target.value;
        if (newValue) params.set("refDate", newValue);
        else params.delete("refDate");
        const query = params.toString();
        const target = query ? `${pathname}?${query}` : pathname;
        router.replace(target);
        router.refresh();
      };
      return (
        <input
          type="date"
          value={value}
          onChange={handleChange}
          aria-label="Selecionar data de referência"
        />
      );
    },
  };
});

vi.mock("@/lib/serviceProgress", () => ({
  resolveServicoPercentualPlanejado: plannedMock,
  resolveServicoRealPercent: realMock,
}));

vi.mock("@/lib/useFirebaseAuthSession", () => ({
  useFirebaseAuthSession: () => ({ ready: true, issue: null, user: null }),
}));

vi.mock("@/lib/firebase", () => ({
  tryGetFirestore: () => null,
  isFirestoreLongPollingForced: false,
}));

vi.mock("firebase/firestore", () => ({
  collection: () => ({}),
  doc: () => ({}),
  limit: () => ({}),
  onSnapshot: () => () => {},
  orderBy: () => ({}),
  query: () => ({}),
}));

vi.mock("@/lib/networkErrors", () => ({
  isConnectionResetError: () => false,
}));

vi.mock("@/lib/curve", () => ({ plannedCurve: (series: unknown) => series }));

vi.mock("@/app/(pcm)/servicos/[id]/shared", () => ({
  ServiceRealtimeData: {} as unknown,
  buildRealizedSeries: (_: unknown, series: unknown) => series,
  computeTimeWindowHours: () => 0,
  composeServiceRealtimeData: (base: unknown) => base,
  deriveRealizedPercent: (value: number) => value,
  filterUpdatesWithRelevantContent: (items: unknown) => items,
  formatDate: () => "--",
  formatDateTime: () => "--",
  formatUpdateSummary: () => "--",
  mapChecklistSnapshot: (value: unknown) => value,
  mapServiceSnapshot: (value: unknown) => value,
  mapUpdateSnapshot: (value: unknown) => value,
  mergeServiceRealtime: (_current: unknown, incoming: unknown) => incoming,
  normaliseStatus: (status?: string | null) => status ?? "Aberto",
  toNewChecklist: (items: unknown[]) => items,
  toNewUpdates: (items: unknown[]) => items,
}));

import ServicesListClient from "@/app/(pcm)/servicos/ServicesListClient";
import ServiceDetailClient from "@/app/(pcm)/servicos/[id]/ServiceDetailClient";

function renderWithRoot(element: React.ReactElement) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => root.render(element));
  return { container, root };
}

function setNativeInputValue(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set;
  if (setter) {
    setter.call(input, value);
  } else {
    input.value = value;
  }
}

describe("referência de data nas listas e detalhes de serviço", () => {
  beforeEach(() => {
    currentParams = new URLSearchParams("refDate=2025-11-24");
    replaceMock.mockClear();
    refreshMock.mockClear();
    plannedMock.mockClear();
    realMock.mockClear();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("propaga a data de referência da query para a listagem de serviços e recalcula ao alterar a seleção", async () => {
    const { container, root } = renderWithRoot(
      <ServicesListClient
        initialItems={[{ id: "1", status: "aberto", os: "OS-1" } as any]}
        initialCursor={null}
      />,
    );

    expect(container.textContent).toContain("Planejado (24/11/2025): 24%");

    const input = container.querySelector('input[type="date"]') as HTMLInputElement;
    await act(async () => {
      setNativeInputValue(input, "2025-11-25");
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
    });

    await act(async () => {
      root.render(
        <ServicesListClient
          initialItems={[{ id: "1", status: "aberto", os: "OS-1" } as any]}
          initialCursor={null}
        />,
      );
    });

    expect(replaceMock).toHaveBeenCalled();
    expect(refreshMock).toHaveBeenCalled();
    expect(container.textContent).toContain("Planejado (25/11/2025): 25%");
  });

  it("usa a data de referência para recalcular o planejado no detalhe do serviço", async () => {
    const { container, root } = renderWithRoot(
      <ServiceDetailClient
        serviceId="abc"
        baseService={{ id: "abc", status: "aberto", progress: 10 } as any}
        fallbackService={null}
        initialChecklist={[]}
        initialUpdates={[]}
        initialPlanned={[]}
        initialRealizedSeries={[]}
        initialRealizedPercent={10}
        latestToken={null}
        tokenLink={null}
      />,
    );

    expect(container.textContent).toContain("Planejado até hoje24%");

    const input = container.querySelector('input[type="date"]') as HTMLInputElement;
    await act(async () => {
      setNativeInputValue(input, "2025-11-25");
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
    });

    await act(async () => {
      root.render(
        <ServiceDetailClient
          serviceId="abc"
          baseService={{ id: "abc", status: "aberto", progress: 10 } as any}
          fallbackService={null}
          initialChecklist={[]}
          initialUpdates={[]}
          initialPlanned={[]}
          initialRealizedSeries={[]}
          initialRealizedPercent={10}
          latestToken={null}
          tokenLink={null}
        />,
      );
    });

    expect(replaceMock).toHaveBeenCalled();
    expect(refreshMock).toHaveBeenCalled();
    expect(container.textContent).toContain("Planejado até hoje25%");
  });
});

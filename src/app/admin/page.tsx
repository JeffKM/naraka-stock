"use client";

import { useQuery } from "@tanstack/react-query";
import { useSyncExternalStore } from "react";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { DashboardSection } from "@/components/admin/DashboardSection";
import { EventSection } from "@/components/admin/EventSection";
import { ManualNewsSection } from "@/components/admin/ManualNewsSection";
import { MarketSection } from "@/components/admin/MarketSection";
import { RankingSection } from "@/components/admin/RankingSection";
import { ResetSection } from "@/components/admin/ResetSection";
import { SignupCodeSection } from "@/components/admin/SignupCodeSection";
import { StockSection } from "@/components/admin/StockSection";
import { SupportSection } from "@/components/admin/SupportSection";
import { UserSection } from "@/components/admin/UserSection";
import { VisitCodeSection } from "@/components/admin/VisitCodeSection";
import { getJson } from "@/lib/api/client";
import type { AdminSupportPost, Me } from "@/types/domain";

const TAB_VALUES = ["status", "ops", "users", "manage", "support"] as const;
type AdminTab = (typeof TAB_VALUES)[number];

function isAdminTab(value: string): value is AdminTab {
  return (TAB_VALUES as readonly string[]).includes(value);
}

// 탭 상태를 URL 해시(#ops 등)에 실어 새로고침·뒤로가기에도 유지한다
function subscribeHash(callback: () => void) {
  window.addEventListener("hashchange", callback);
  return () => window.removeEventListener("hashchange", callback);
}

function useHashTab(): [AdminTab, (tab: string) => void] {
  const tab = useSyncExternalStore(
    subscribeHash,
    () => {
      const hash = window.location.hash.slice(1);
      return isAdminTab(hash) ? hash : "status";
    },
    () => "status" as const
  );
  return [tab, (next) => { window.location.hash = next; }];
}

// 어드민 콘솔 (T-602~T-605). 최종 권한 검증은 모든 /api/admin/* 의 requireAdmin이 담당.
export default function AdminPage() {
  const [tab, setTab] = useHashTab();

  const { data: me, isLoading } = useQuery({
    queryKey: ["me"],
    queryFn: () => getJson<Me>("/api/auth/me"),
    retry: false,
  });

  // 문의 탭 뱃지용 미처리 건수 — SupportSection 기본 목록과 캐시 공유
  const { data: pendingSupport } = useQuery({
    queryKey: ["admin-support", false],
    queryFn: () =>
      getJson<{ posts: AdminSupportPost[] }>("/api/admin/support?status=pending"),
    refetchInterval: 60_000,
    enabled: !!me?.isAdmin,
  });
  const pendingCount = pendingSupport?.posts.length ?? 0;

  if (isLoading) return null;
  if (!me?.isAdmin) {
    return <p className="py-16 text-center text-muted-foreground">접근 권한이 없습니다</p>;
  }

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-xl font-bold">운영자 콘솔</h1>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="w-full">
          <TabsTrigger value="status">현황</TabsTrigger>
          <TabsTrigger value="ops">운영</TabsTrigger>
          <TabsTrigger value="users">유저</TabsTrigger>
          <TabsTrigger value="manage">관리</TabsTrigger>
          <TabsTrigger value="support">
            문의
            {pendingCount > 0 && (
              <Badge className="h-4 min-w-4 px-1 text-[10px] tabular-nums">
                {pendingCount}
              </Badge>
            )}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="status" className="flex flex-col gap-4">
          <DashboardSection />
          <RankingSection />
        </TabsContent>

        <TabsContent value="ops" className="flex flex-col gap-4">
          <MarketSection />
          <EventSection />
          <ManualNewsSection />
        </TabsContent>

        <TabsContent value="users" className="flex flex-col gap-4">
          <SignupCodeSection />
          <VisitCodeSection />
          <UserSection />
        </TabsContent>

        <TabsContent value="manage" className="flex flex-col gap-4">
          <StockSection />
          <ResetSection />
        </TabsContent>

        <TabsContent value="support" className="flex flex-col gap-4">
          <SupportSection />
        </TabsContent>
      </Tabs>
    </div>
  );
}

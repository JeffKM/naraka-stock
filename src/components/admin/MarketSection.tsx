"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { getJson } from "@/lib/api/client";

interface MarketSettingsDto {
  openHour: number;
  closeHour: number;
  closedWeekdays: number[];
  holidayExceptions: string[];
  extraOpenDays: string[];
  today: string; // 오늘 날짜 (KST)
  todayOverride: { openHour: number; closeHour: number } | null;
}

const WEEKDAYS = [
  { value: 1, label: "월" },
  { value: 2, label: "화" },
  { value: 3, label: "수" },
  { value: 4, label: "목" },
  { value: 5, label: "금" },
  { value: 6, label: "토" },
  { value: 7, label: "일" },
] as const;

// 장 운영 설정: 개장/마감 시간·정기 휴장 요일·예외일 (Phase 8)
export function MarketSection() {
  const queryClient = useQueryClient();
  const [form, setForm] = useState<MarketSettingsDto | null>(null);
  const [holidayInput, setHolidayInput] = useState("");
  const [extraInput, setExtraInput] = useState("");
  const [saving, setSaving] = useState(false);

  const { data } = useQuery({
    queryKey: ["admin-market"],
    queryFn: () => getJson<MarketSettingsDto>("/api/admin/market"),
  });
  const settings = form ?? data;

  function edit(patch: Partial<MarketSettingsDto>) {
    if (!settings) return;
    setForm({ ...settings, ...patch });
  }

  function toggleWeekday(day: number) {
    if (!settings) return;
    const closed = settings.closedWeekdays.includes(day)
      ? settings.closedWeekdays.filter((d) => d !== day)
      : [...settings.closedWeekdays, day].sort();
    edit({ closedWeekdays: closed });
  }

  async function save() {
    if (!settings || saving) return;
    setSaving(true);
    try {
      const res = await fetch("/api/admin/market", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(settings),
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error.message);
      toast.success("저장 완료 — 장 시간 변경은 다음 배치 경로부터 완전 반영됩니다");
      setForm(null);
      queryClient.invalidateQueries({ queryKey: ["admin-market"] });
      queryClient.invalidateQueries({ queryKey: ["quotes"] });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "저장 실패");
    } finally {
      setSaving(false);
    }
  }

  if (!settings) return null;

  const dateChips = (
    list: string[],
    onRemove: (d: string) => void
  ) =>
    list.map((d) => (
      <Badge key={d} variant="secondary" className="gap-1">
        {d}
        <button onClick={() => onRemove(d)} aria-label={`${d} 삭제`}>
          ✕
        </button>
      </Badge>
    ));

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">장 운영 설정</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="flex items-center gap-2">
          <span className="w-24 shrink-0 text-sm text-muted-foreground">장 시간</span>
          <Input
            type="number"
            min={0}
            max={23}
            value={settings.openHour}
            onChange={(e) => edit({ openHour: Number(e.target.value) })}
            className="w-20"
          />
          <span className="text-sm text-muted-foreground">시 ~</span>
          <Input
            type="number"
            min={1}
            max={24}
            value={settings.closeHour}
            onChange={(e) => edit({ closeHour: Number(e.target.value) })}
            className="w-20"
          />
          <span className="text-sm text-muted-foreground">
            시 ({(settings.closeHour - settings.openHour) * 12}틱/일)
          </span>
        </div>

        <div className="flex items-center gap-2">
          <span className="w-24 shrink-0 text-sm text-muted-foreground">정기 휴장 요일</span>
          <div className="flex flex-wrap gap-1">
            {WEEKDAYS.map((d) => (
              <Button
                key={d.value}
                size="sm"
                variant={settings.closedWeekdays.includes(d.value) ? "destructive" : "outline"}
                onClick={() => toggleWeekday(d.value)}
                className="h-7 w-9 px-0"
              >
                {d.label}
              </Button>
            ))}
          </div>
        </div>
        <p className="-mt-2 pl-24 text-xs text-muted-foreground">
          빨간 요일이 휴장입니다. 없으면 매일 개장.
        </p>

        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <span className="w-24 shrink-0 text-sm text-muted-foreground">임시 휴장일</span>
            <Input
              type="date"
              value={holidayInput}
              onChange={(e) => setHolidayInput(e.target.value)}
              className="w-40"
            />
            <Button
              variant="outline"
              size="sm"
              disabled={!holidayInput}
              onClick={() => {
                edit({
                  holidayExceptions: [
                    ...new Set([...settings.holidayExceptions, holidayInput]),
                  ].sort(),
                });
                setHolidayInput("");
              }}
            >
              추가
            </Button>
          </div>
          {settings.holidayExceptions.length > 0 && (
            <div className="flex flex-wrap gap-1 pl-24">
              {dateChips(settings.holidayExceptions, (d) =>
                edit({
                  holidayExceptions: settings.holidayExceptions.filter((x) => x !== d),
                })
              )}
            </div>
          )}
        </div>

        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <span className="w-24 shrink-0 text-sm text-muted-foreground">임시 개장일</span>
            <Input
              type="date"
              value={extraInput}
              onChange={(e) => setExtraInput(e.target.value)}
              className="w-40"
            />
            <Button
              variant="outline"
              size="sm"
              disabled={!extraInput}
              onClick={() => {
                edit({
                  extraOpenDays: [...new Set([...settings.extraOpenDays, extraInput])].sort(),
                });
                setExtraInput("");
              }}
            >
              추가
            </Button>
          </div>
          {settings.extraOpenDays.length > 0 && (
            <div className="flex flex-wrap gap-1 pl-24">
              {dateChips(settings.extraOpenDays, (d) =>
                edit({ extraOpenDays: settings.extraOpenDays.filter((x) => x !== d) })
              )}
            </div>
          )}
        </div>

        <Button onClick={save} disabled={!form || saving}>
          {saving ? "저장 중..." : "저장"}
        </Button>
        <p className="text-xs text-muted-foreground">
          장 시간을 바꾸면 <b>다음 22:00 배치가 만드는 경로부터</b> 새 틱 수로 생성됩니다.
          이미 생성된 오늘 경로는 그대로라, 장을 늘리면 남는 시간은 종가로 고정 표시됩니다.
        </p>

        <TodayHoursBlock settings={settings} />
      </CardContent>
    </Card>
  );
}

// 오늘 하루만 장 시간 변경 (자정 폐장 후 ~ 당일 개장 전에만 적용/해제 가능)
function TodayHoursBlock({ settings }: { settings: MarketSettingsDto }) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState<{ openHour: number; closeHour: number } | null>(null);
  const [busy, setBusy] = useState(false);

  const hours =
    form ??
    settings.todayOverride ?? {
      openHour: settings.openHour,
      closeHour: settings.closeHour,
    };

  async function request(init: RequestInit, successMessage: string) {
    if (busy) return;
    setBusy(true);
    try {
      const res = await fetch("/api/admin/market/today", init);
      const json = await res.json();
      if (!json.success) throw new Error(json.error.message);
      toast.success(successMessage);
      setForm(null);
      queryClient.invalidateQueries({ queryKey: ["admin-market"] });
      queryClient.invalidateQueries({ queryKey: ["quotes"] });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "실패");
    } finally {
      setBusy(false);
    }
  }

  const apply = () =>
    request(
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(hours),
      },
      `오늘(${settings.today})만 ${hours.openHour}시~${hours.closeHour}시로 엽니다`
    );
  const clear = () => request({ method: "DELETE" }, "오늘 장 시간을 기본값으로 되돌렸습니다");

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-dashed p-3">
      <p className="text-sm font-medium">
        오늘({settings.today})만 장 시간 변경{" "}
        {settings.todayOverride && (
          <Badge variant="secondary">
            적용 중 {settings.todayOverride.openHour}시~{settings.todayOverride.closeHour}시
          </Badge>
        )}
      </p>
      <div className="flex items-center gap-2">
        <Input
          type="number"
          min={0}
          max={23}
          value={hours.openHour}
          onChange={(e) => setForm({ ...hours, openHour: Number(e.target.value) })}
          className="w-20"
        />
        <span className="text-sm text-muted-foreground">시 ~</span>
        <Input
          type="number"
          min={1}
          max={24}
          value={hours.closeHour}
          onChange={(e) => setForm({ ...hours, closeHour: Number(e.target.value) })}
          className="w-20"
        />
        <span className="text-sm text-muted-foreground">시</span>
        <Button size="sm" onClick={apply} disabled={busy}>
          오늘만 적용
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={clear}
          disabled={busy || !settings.todayOverride}
        >
          해제
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        자정 폐장 후 ~ 당일 개장 전에만 바꿀 수 있습니다. 바꾸지 않으면 위 기본 장
        시간대로 열리고, 날짜가 지나면 자동으로 풀립니다.
      </p>
    </div>
  );
}
